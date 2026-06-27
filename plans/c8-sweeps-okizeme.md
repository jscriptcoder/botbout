# Plan: C8 — Sweeps + limited okizeme

**Branch**: one branch per slice (`feat/c8-sweep-core`, `feat/c8-finish-window`, `feat/c8-self-finishwindow`, `feat/c8-opp-knockdown`)
**Status**: Active

## Goal

Add the ground game on top of C7's throw triangle: a `sweep` that knocks down (low band, no score), and a single guaranteed okizeme "finish" window before wake-up i-frames — perceivable so a bot can hit-confirm the finish.

## Design source of truth

`docs/DESIGN.md` §6 (ground game prose) + §11.6 (C8 resolution scope), resolved via grill-me. Key resolved decisions:

- **Sweep = a low-band STRIKE variant** — reuses the `computeStrike` §11.3 gate and §11.4 precedence. HIT → knockdown (score 0); a low guard blocks/parries it; it whiffs a jumper (low occupancy) but hits a croucher; it trades with strikes and stuffs throws — **all precedence is emergent from "sweep is a strike," no new resolution machinery.**
- **Contract**: `{type:"sweep"}` action (band implicitly `low`), `MoveId "sweep"`, `moves.sweep` `MoveSpec` with a new `knockdown?: boolean`. Intake maps `{type:"sweep"}` → `startAttack("sweep","low")`. **Inert without a `moves.sweep` spec ⇒ byte-identical to C7.**
- **One uniform knockdown lifecycle** (throw _and_ sweep): `downed{ elapsed, finish }`. `finish` starts at `Rules.finishWindow` (optional). Finish window = first `F` ticks (targetable by an opposing strike on **active + reach only** — guard/occupancy ignored, the target is prone). A finish HIT **scores then sets `finish = 0`** ⇒ exactly one; **never re-downs or extends `knockdownDuration`**. i-frames = the untargetable tail (emergent: `finish == 0` ⇒ `computeStrike` returns `null`, the existing C7 behavior). Wakes to an agentive neutral. **`finishWindow` absent ⇒ `F = 0` ⇒ no finish for any knockdown ⇒ throws byte-identical to C7.**
- **Perception** (both, additive to the State contract): `self.finishWindow` (live, `SelfState`, = the live opponent's `downed.finish`, like `self.cancelWindow`/`counterWindow`) + `opponent.knockdown` (bare boolean, `OpponentState`, on the `L_act` layer like `opponent.throwing`).

## Engine surfaces

`src/types.ts` (contract), `src/sim.ts` (`computeStrike`/`applyStrike`/`advance`, `MoveState.downed`, `Frame`/`frameOf`/`perceiveOpponent`/`viewFor`), `src/dsl.ts` (TCB allowlist: `sweep` action case, `MOVES` set, `FIELD_READERS` for the new perceivable fields), `docs/BOT-DSL.md` (bot API doc).

## Acceptance Criteria (feature-level)

- [x] A bot can author `{type:"sweep"}`; it validates and resolves as a low-band strike that knocks down on hit (score 0). _(Slice 1 — PR #35)_
- [x] A sweep is blocked/parried by a matching low guard (no knockdown), whiffs a jumper, hits a croucher, trades with strikes, and stuffs throws. _(Slice 1 — PR #35)_
- [ ] With `finishWindow` configured, any knockdown (throw or sweep) is finishable by exactly one opposing strike during the first `F` ticks; afterwards the downed fighter is untargetable (i-frames) until it wakes.
- [ ] A finish never re-downs or extends the knockdown; the fighter wakes to a normal neutral.
- [ ] `self.finishWindow` and `opponent.knockdown` are readable in the DSL and drive a hit-confirmed finish.
- [ ] With `finishWindow` absent **and** no `moves.sweep` spec, the engine is **byte-identical to C7** (regression-locked by a replay test).

## Slices

Every slice follows RED-GREEN-MUTATE-KILL MUTANTS-REFACTOR. No production code without a failing test. Read `.claude/CLAUDE.md` and the testing rules before each slice.

### Slice 1: A sweep is a low-band strike that knocks down on hit — ✅ DONE (PR #35)

**Value**: A bot author gains the `sweep` technique — a low attack that grounds an open opponent (tempo, no points), countered by blocking low or jumping.
**Path**: bot returns `{type:"sweep"}` → `dsl` validates (new action case + `"sweep"` in `MOVES`) → `intake` → `startAttack("sweep","low")` → `computeStrike` (existing §11.3 gate) classifies HIT/BLOCK/PARRY/WHIFF → `applyStrike` HIT branch downs the defender (`downed{elapsed:0}`, the C7 shape) instead of scoring → `advance` runs the existing knockdown clock. Observable via `runFight`: the downed fighter's actions are ignored for `knockdownDuration` ticks and the sweeper scores 0. **Intentionally skipped**: the finish window (Slice 2) — here a sweep-knockdown is fully untargetable, exactly like a C7 throw.
**Required implementation skills**: load `tdd`, `testing`, `mutation-testing`, `refactoring` before code.
**Acceptance criteria** (present + confirm before coding):

- A sweep that connects on an open, standing opponent in reach → defender `downed` (its actions ignored for `knockdownDuration` ticks); attacker scores **0**.
- A matching **low guard blocks** the sweep → no knockdown, no score (and stale-guard block vs fresh-guard parry both yield **no knockdown**, mirroring strike block/parry).
- The sweep **whiffs a jumper** (airborne vacates `low`) and **hits a croucher** (croucher occupies `low`).
- `sweep ∥ strike` → **trade** (sweep downs the striker; the striker's poke scores) and a sweep **stuffs an opposing throw** (`strike > throw`) and `sweep ∥ sweep` → **mutual knockdown** — all emergent (assert with **no new production code** beyond the HIT-knockdown branch; these are regression guards on the union).
- `{type:"sweep"}` with **no `moves.sweep` spec** is inert (no state change) ⇒ a fight with sweeping bots but no sweep frame data is **byte-identical** to the same fight with idling bots.
  **RED**: `runFight` tests over crafted bots/rules asserting the above. Mutator-aware cases: knockdown branch present vs absent (kill "remove knockdown ⇒ scores instead"); `score: 0` literal (kill arithmetic mutants); the `def.state.kind !== "downed"` guard on the knockdown branch (kill "re-down a downed fighter"); inert-without-spec (kill the `moves.sweep !== undefined` guard removal).
  **GREEN**: add `{type:"sweep"}` to `Action`, `"sweep"` to `MoveId`, `knockdown?: boolean` to `MoveSpec` (`types.ts`); `sweep` case in `dsl.ts` `action()` + `"sweep"` in `MOVES`; `intake` `sweep` branch (guarded by `rules.moves.sweep !== undefined`) → `startAttack("sweep","low")`; carry `knockdown` on the `StrikeOutcome` `hit` variant; `applyStrike` HIT branch downs the defender when `outcome.knockdown` and it is not already downed.
  **MUTATE**: run `mutation-testing` skill on `sim.ts`/`dsl.ts` diff → report.
  **KILL MUTANTS**: strengthen tests for survivors (ask human if a survivor's value is ambiguous).
  **REFACTOR**: assess only if it adds value (e.g. whether the HIT branch reads cleanly with the knockdown side effect).
  **Done when**: all ACs met, mutation report reviewed, `docs/BOT-DSL.md` documents `{type:"sweep"}`, human approves commit.

### Slice 2: A knockdown is finishable exactly once, then i-frames until wake

**Value**: Okizeme — after any knockdown (throw or sweep), the attacker gets one guaranteed finish opportunity; then the grounded fighter is invulnerable until it wakes. No ground loops.
**Path**: `applyStrike`/`applyThrow` knockdown now sets `downed{ elapsed:0, finish: rules.finishWindow ?? 0 }` → `computeStrike` against a downed defender returns a **finish HIT** iff `finish > 0` (gated by active + reach only; band/guard/occupancy ignored) else `null` (i-frames, the existing C7 untargetable path) → `applyStrike` finish-HIT scores the finisher and sets the target's `finish = 0` → `advance` decrements `downed.finish` each tick. Observable via `runFight`: an opposing strike during the first `F` ticks of a knockdown scores once; a second one in the same knockdown scores nothing; the clock and wake time are unchanged.
**Required implementation skills**: load `tdd`, `testing`, `mutation-testing`, `refactoring`.
**Acceptance criteria** (present + confirm before coding):

- With `finishWindow = F`, an opposing strike that is active + in reach during the first `F` ticks of a knockdown **scores `spec.score`** (band/guard/occupancy ignored — the target is prone).
- A **second** finish attempt in the same knockdown scores **nothing** (`finish == 0` after the first) — **exactly one**.
- After the finish window (or after a finish lands), the downed fighter is **untargetable** (i-frames) until `elapsed == knockdownDuration`, then **wakes to neutral** with full agency.
- A finish **does not re-down and does not extend** `knockdownDuration` (wake time identical with or without a finish landing).
- Applies uniformly to **both** throw-knockdowns and sweep-knockdowns.
- **`finishWindow` absent ⇒ no finish for any knockdown ⇒ throws byte-identical to C7** (replay regression test).
  **RED**: `runFight` tests for first-finish-scores / second-finish-noops / i-frame-tail-untargetable / wake-time-unchanged / both-sources / absent-finishWindow-byte-identical. Mutator-aware: the `finish > 0` boundary (kill `>=`/`>` and off-by-one on `F`); `finish = 0` after finish (kill survivor that leaves it open); `advance` decrement of `finish` (kill removal); knockdown sets `finish` from `finishWindow ?? 0` (kill the `?? 0` → undefined path).
  **GREEN**: add `finish` to the `downed` `MoveState`; `Rules.finishWindow?: number`; set `finish` on both knockdown apply paths; `computeStrike` downed-finishable branch (finish HIT, ignore band/guard/occupancy); `applyStrike` finish-HIT path (score + `finish = 0`, no re-down); `advance` decrements `finish`.
  **MUTATE / KILL MUTANTS / REFACTOR**: as per cycle.
  **Done when**: all ACs met (incl. the C7 byte-identical replay), mutation report reviewed, human approves commit. (Note: this slice intentionally **changes C7 throw behavior when `finishWindow` is configured** — update the affected C7 throw tests to assert the finishable-knockdown behavior under that config.)

### Slice 3: A bot reads its live finish window via `self.finishWindow`

**Value**: The finisher can reliably time the guaranteed finish (hit-confirm) instead of dead-reckoning its own knockdown.
**Path**: `viewFor` exposes `self.finishWindow` computed **live** from the live opponent's `downed.finish` (0 when the opponent is not downed) → `dsl` `FIELD_READERS["self.finishWindow"]` → a bot rule branches on it. Observable via `runFight`: a bot that only strikes `when self.finishWindow > 0` lands exactly the guaranteed finish and never wastes a strike otherwise.
**Required implementation skills**: load `tdd`, `testing`, `mutation-testing`, `refactoring`.
**Acceptance criteria** (present + confirm before coding):

- `self.finishWindow` equals the live opponent's `downed.finish` while the opponent is downed-finishable, and `0` otherwise (not downed, or in i-frames).
- It is **live** (never `L_act`/`L_pos` delayed) — verified by a perception-latency fight where `self.finishWindow` tracks the true value with zero lag.
- A bot reading `self.finishWindow` in a `when` clause can author a hit-confirmed finish.
- The field is on the `dsl` allowlist; an unknown-key bot still rejects (allowlist boundary intact).
  **RED**: tests asserting the value across downed-finishable / i-frame / not-downed, the live-under-latency case, and a confirm-finish bot. Mutator-aware: the "derive from **live** opponent, not perceived" wiring (kill a mutant that reads the delayed snapshot); the `0`-when-not-downed default.
  **GREEN**: thread the live opponent's `downed.finish` into `viewFor`; add `finishWindow` to `SelfState`; add `FIELD_READERS["self.finishWindow"]` in `dsl.ts`.
  **MUTATE / KILL MUTANTS / REFACTOR**: as per cycle.
  **Done when**: all ACs met, mutation report reviewed, `docs/BOT-DSL.md` documents `self.finishWindow`, human approves commit.

### Slice 4: A bot perceives a grounded opponent via `opponent.knockdown`

**Value**: A bot gains okizeme awareness — it can tell the opponent is grounded (delayed, like every other opponent tell) to decide whether to pressure or reset, completing the `knockdown ∧ finishWindow` read.
**Path**: `frameOf` records `knockdown` (`state.kind === "downed"`) into the per-fighter history `Frame` → `perceiveOpponent` reads it from the `L_act`-delayed frame → `OpponentState.knockdown` → `dsl` `FIELD_READERS["opponent.knockdown"]` (boolean exposed as 1/0). Observable via `runFight`: the perceived flag lags true knockdown by `L_act` ticks.
**Required implementation skills**: load `tdd`, `testing`, `mutation-testing`, `refactoring`.
**Acceptance criteria** (present + confirm before coding):

- `opponent.knockdown` is `1` while the (perceived) opponent is downed and `0` otherwise.
- It rides the **`L_act`** action layer (like `opponent.throwing`) — verified by a latency fight showing the documented lag (and at `L = 0`, live).
- It is on the `dsl` allowlist and readable in a bot `when` clause; combined with `self.finishWindow` it expresses the full okizeme read (`knockdown ∧ finishWindow>0` ⇒ finish; `knockdown ∧ finishWindow==0` ⇒ reset).
- Adding the field is **additive** — a bot that ignores it is unaffected.
  **RED**: tests for the flag value, the `L_act` lag, the `L = 0` live case, and a bot combining both fields. Mutator-aware: the `state.kind === "downed"` predicate in `frameOf` (kill negation/replacement); routing through the `lAct` frame (kill a mutant that reads `lPos`); the 1/0 boolean exposure.
  **GREEN**: add `knockdown` to `Frame` + `frameOf`; surface it in `perceiveOpponent`/`OpponentState`; add `FIELD_READERS["opponent.knockdown"]` in `dsl.ts`.
  **MUTATE / KILL MUTANTS / REFACTOR**: as per cycle.
  **Done when**: all ACs met, mutation report reviewed, `docs/BOT-DSL.md` documents `opponent.knockdown`, human approves commit.

## Pre-PR Quality Gate (each slice)

1. Mutation testing — run `mutation-testing` skill (`sim.ts` target ~95%, `dsl.ts` interpreter 100%, matching the C7 bar).
2. Refactoring assessment — run `refactoring` skill.
3. `npm run typecheck` and `npm run lint` pass; `npm test` green.
4. Confirm the byte-identical-to-C7 fallback still holds where claimed (Slices 1 & 2).

## End of feature

When all four slices merge: update `.claude/CLAUDE.md` Status (record C8 shipped, set NEXT to the next capability), consider `learn`/`adr` for any non-obvious decisions, then delete this plan file (and `plans/` if empty).

---

_Delete this file when the plan is complete. If `plans/` is empty, delete the directory._
