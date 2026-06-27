# Plan: Throw triangle (C7)

**Branch**: per-slice `feat/c7-*` (one PR per slice — see each slice)
**Status**: Active

## Goal

Land the §11.4 **throw triangle** — `strike > throw > guard > strike` — as the anti-turtle
mind-game: a clean throw beats any guard and scores 3 while knocking the defender down; an
active strike beats a throw; `throw-break` escapes a throw; throw-vs-throw clashes. (Sweeps +
limited okizeme are a separate later capability — **out of scope**, see bottom.)

## Why this is the union's test-forcing consumer

Throws create the first **same-tick mutual dependencies** between the two fighters
(strike-beats-throw, throw-clash) — the exact case the §11 **compute-then-apply union**
(`computeStrike`/`applyStrike`, live since C5, reused by C6) exists to resolve
order-independently. C5/C6 adopted the union _deliberately_; C7 is where it is **strictly
forced**. The frozen pre-tick snapshot guarantees swap-symmetry even though a throw mutates
the **defender** (knockdown) while a strike mutates the **attacker** (score).

## Invariants to hold (re-check every slice)

- **Determinism / fixed-point.** Knockdown timer, throw score, grab window are integer ticks /
  sub-units. No floats in the outcome path.
- **TCB / security boundary.** New actions (`throw`, `throw-break`) are allowlisted in
  `src/dsl.ts` (validator `action()` + grammar). New read fields go through `FIELD_READERS` +
  the `FieldPath` allowlist. No op touches host/network/fs/time/randomness.
- **Bounded DSL.** New actions add no loops/recursion; worst-case cost unchanged.
- **Same pre-tick snapshot.** All throw/strike outcomes are computed from one frozen
  post-intake snapshot, then applied atomically (compute-then-apply union).
- **Additive growth.** Every `Rules` / `State` / action / move addition is optional or
  additive — a previously valid bot stays valid; **all C7 `Rules` fields absent ⇒
  byte-identical to C6** (the `throw` action is inert when unconfigured, like `jump` with no
  impulse).

## Data-model additions (introduced incrementally by the slices that need them)

- **Action grammar** (`src/types.ts`, `src/dsl.ts`): `{ type: "throw" }` (slice 1),
  `{ type: "throw-break" }` (slice 3).
- **Rules** (`src/types.ts`, all optional): `throw?: ThrowSpec` where
  `ThrowSpec = { startup; active; recovery; reach; score }` (a throw is **not** height-banded —
  it beats any guard at any band); `knockdownDuration?` (ticks a thrown fighter is downed).
  Absent ⇒ throw inert.
- **MoveState** (`src/sim.ts`): `{ kind: "throwing"; elapsed; resolved }` (committed
  startup→grab-active→recovery) and `{ kind: "downed"; remaining }` (knockdown — `canAct=0`,
  intake ignored, `advance` decrements → neutral).
- **Resolution** (`src/sim.ts`): a `computeThrow` (parallel to `computeStrike`) + a small
  **precedence resolver** that combines both fighters' computed strike/throw outcomes under
  `strike > throw > guard` before `apply`. Grows across slices 2 & 4.
- **Read surface** (slice 5): `opponent.throwing` (boolean) on the `L_act` action layer — added
  to `OpponentState`, `Frame`, `frameOf`, `perceiveOpponent`, and `FIELD_READERS`/`FieldPath`.
  (`opponent.knockdown` is **deferred to C8**.)

> **Still NOT a real frame table.** Throw frame numbers live only in test mocks (same as
> strikes today). A concrete arsenal is a later additive slice.

## Acceptance Criteria (capability-level — each refined per slice before coding)

- [x] A throw whose grab window connects scores `throwScore` (3) against an **open or guarding**
      defender (incl. a parry-window guard) and knocks the defender down for `knockdownDuration`
      ticks (`canAct=0`), then they return to neutral. _(Slice 1 ✓)_
- [x] An active in-range strike **beats** a colliding throw: the throw fails (no score, no
      knockdown) and the strike scores; a strike landing during throw **startup** interrupts it.
      Resolution is swap-symmetric (A↔B assignment cannot change the outcome). _(Slice 2 ✓)_
- [x] A timed `throw-break` escapes a grab: no score, no knockdown. _(Slice 3 ✓)_
- [x] Two throws that collide **clash**: neither scores, neither is downed. _(Slice 4 ✓)_
- [ ] The opponent's throw is perceivable as a delayed tell on the `L_act` layer so a bot can
      time a break (reactable only when `S ≥ L_act + 1`, consistent with the perception keystone).
- [ ] With all C7 `Rules` fields absent, fights are **byte-identical** to C6.

## Slices

Every slice follows RED-GREEN-MUTATE-KILL MUTANTS-REFACTOR. No production code without a
failing test. Before code on each slice, load `tdd`, `testing`, `mutation-testing`,
`refactoring`. Read `.claude/CLAUDE.md` invariants + `docs/DESIGN.md` §11 first.

---

### Slice 1: A throw beats a guard — scores 3 and knocks the defender down ✅ SHIPPED

**Status**: Done — `src/sim.ts` (`computeThrow`/`applyThrow`, `throwing`/`downed` states),
`src/types.ts` (`ThrowSpec` + `Rules.throw`/`knockdownDuration` + `throw` action), `src/dsl.ts`
(throw allowlisted). 903 tests; changed-line mutation 94.95% (sim 94.85%, dsl 100%); 5 survivors
all equivalent. The `downed` state made `resolved` redundant (knockdown ⇒ untargetable), so it
was removed in REFACTOR. **Resolution note for slice 2:** `computeThrow` runs alongside
`computeStrike` from the frozen snapshot and each side resolves independently — the
`strike > throw` precedence resolver lands next.
**Branch**: `feat/c7-throw-beats-guard`
**Value**: A grappler bot can punish a turtle — `throw > guard` delivers the anti-turtle payoff
(the WKF 3-point _ippon_ moment). The walking skeleton of the throw.
**Path**: bot returns `{type:"throw"}` → `intake` starts a committed `throwing` move
(startup→grab-active→recovery from `Rules.throw`) → in S3, `computeThrow(att,def)` returns a
THROW outcome when the throw is **grab-active** and the defender is within `throw.reach` →
`apply` adds `throw.score` (3) to the attacker and sets the defender to `downed` for
`knockdownDuration` → `advance` decrements `downed.remaining` to neutral. Resolves vs **open
AND any guard band, including the parry window** (throw beats guard, throw beats parry). No
opposing offense yet ⇒ precedence is trivial (throw just lands). _Skipped here: strike>throw
(slice 2), throw-break (slice 3), clash (slice 4), perception (slice 5)._
**Required implementation skills**: `tdd`, `testing`, `mutation-testing`, `refactoring`.
**Acceptance criteria** (confirm before coding):

- Throw grab-active + defender open, in reach ⇒ attacker `+3`, defender `downed` for K ticks.
- Throw grab-active + defender guarding the same/any band ⇒ still `+3` + downed (throw > guard).
- Throw grab-active + defender in **parry window** ⇒ still `+3` + downed (throw beats parry).
- Throw out of `throw.reach` ⇒ whiff (no score, no knockdown), attacker still committed to recovery.
- Throw connects **only** during the grab-active window — never during startup or recovery.
- A `downed` fighter's returned action is ignored for exactly `knockdownDuration` ticks
  (`self.canAct=0`), then it is neutral again.
- A `downed` fighter is **not targetable**: it vacates **all** bands, so incoming strikes
  **and** throws whiff against it (no piling on — okizeme/finish-window/i-frames are C8).
- A throw connects **only on a grounded, non-downed defender** — it whiffs vs an **airborne**
  fighter (you cannot grab a jumper). "Grounded" includes **standing AND crouching**: a throw is
  unbanded, so crouching does **not** dodge it (throw beats crouch). Confirmed via find-gaps.
- `Rules.throw` / `knockdownDuration` absent ⇒ `throw` action inert ⇒ byte-identical to C6.
  **RED**: `runFight` tests asserting scores/knockdown for each AC above. Likely mutator gaps
  (see `mutation-testing` `resources/mutator-rules.md`): grab-active boundary (`>=`/`<` on
  startup / startup+active), reach comparison (`<=` vs `<`), knockdown decrement off-by-one,
  score constant (mutated 3→0), "no score AND no knockdown on whiff" (kill a mutant that drops
  only one half).
  **GREEN**: add the `throw` action (types + dsl allowlist), `ThrowSpec`/`knockdownDuration`
  rules, `throwing`/`downed` MoveStates, `computeThrow` + `applyThrow` (knockdown is a
  cross-fighter effect through the existing union), `advance` handling for both new states,
  `intake` honouring `throw` from a neutral fighter, `canAct`/`free-to-act` treating `downed` as
  locked.
  **MUTATE**: run `mutation-testing` — target `sim.ts` ~95%+, `dsl.ts` interpreter 100%.
  **KILL MUTANTS**: strengthen tests for survivors (ask if a survivor's value is ambiguous).
  **REFACTOR**: assess `computeThrow`/`computeStrike` shared shape (only if it adds value).
  **Done when**: all ACs met, mutation report reviewed, human approves commit.

---

### Slice 2: A strike beats a throw (and interrupts throw startup) ✅ SHIPPED

**Status**: Done — `src/sim.ts`: throw grabbability widened so a GROUNDED committed defender
(`attacking`) is grabbable (was: any non-`neutral` defender ungrabbable), and the §11.4
precedence resolver `stuffIfStruck` sits in the C5 compute-then-apply union — an opposing HIT
(active+in-range, encoded by `computeStrike`) voids the colliding/startup throw and marks the
throwing move `stuffed` (re-added to the state — genuinely needed now: a strike-interrupted
throw has no knockdown to make it untargetable) so it cannot grab on a later frame, while the
thrower stays committed through recovery (punishable). `src/run-fight.test.ts`: 6 tests (collide,
swap-symmetry, throw-lands-vs-startup, throw-lands-vs-out-of-range, startup-interrupt,
stuffed-stays-committed). 909 tests; changed-line mutation 50 killed / 4 survived — all 4
equivalent (2 carried-over Slice-1 `computeThrow` guard equivalents; 2 new at `stuffIfStruck`'s
non-throwing guard, where the voided throw outcome is always `null` ⇒ no observable effect). No
new `Rules` fields ⇒ byte-identical-to-C6 guarantee preserved (throw config absent ⇒ no stuffing).
**Branch**: `feat/c7-strike-beats-throw`
**Value**: The throw is not oppressive — `strike > throw` closes that leg of the triangle. This
is the **genuine same-tick mutual dependency** the compute-then-apply union exists for.
**Path**: in S3, compute both fighters' offensive outcomes (A/B × strike/throw) from the
frozen snapshot, then a **precedence resolver** applies `strike > throw`: if A is throwing in
its **startup or grab-active** phase and B has an **active, in-range** strike against A, A's
throw **fails** and B's strike **HITs** A (A is `open` while throwing). Both offensive phases
are covered — **locked by design** (§6 "strikes interrupt throw startup" + §11.4 "throw
grab-active vs strike"). Swap-symmetric by construction (both outcomes computed before either
applied). _(Reach gate: a strike beats a throw only when it is active **and in range** of the
thrower — a whiffing strike is no threat. Confirmed via find-gaps 2026-06-26.)_
**Required implementation skills**: `tdd`, `testing`, `mutation-testing`, `refactoring`.
**Acceptance criteria** (confirm before coding):

- A throws (grab-active) + B strikes (active, in reach of A) ⇒ B scores, A scores nothing, A
  **not** thrown / B **not** downed.
- The reverse role assignment (B throws, A strikes) yields the **mirror** outcome —
  swap-symmetry test (same frozen inputs, fighters swapped ⇒ swapped result).
- A strike active + in reach landing during A's **throw startup** ⇒ A's throw is cancelled
  (interrupted), strike scores.
- A's throw grab-active + B's strike **out of range** (whiffing) ⇒ throw still lands — a strike
  beats a throw **only when active AND in range** of the thrower (confirmed via find-gaps).
- B "striking" but still in **startup** (not active) ⇒ throw still lands (only an _active_
  strike beats a throw).
- A stuffed/interrupted throw is **marked resolved (cannot re-grab) but stays committed**
  through its move's remaining frames (`canAct=0`) — a stuffed throw is **punishable**, mirroring
  a whiffed strike running out its recovery. (Not cancelled to neutral.) Confirmed via find-gaps.
  **RED**: precedence tests for each AC; an explicit swap-symmetry test. Mutator gaps: the
  precedence branch order (strike checked before throw resolves), the defender-strike
  active-window predicate, the reach predicate, the throw-startup-cancel branch.
  **GREEN**: introduce the precedence resolver between `compute*` and `apply*`; suppress the
  throw outcome when the opposing strike outcome is a real hit on the thrower; emit the
  throw-cancel effect.
  **MUTATE / KILL MUTANTS / REFACTOR**: as standard.
  **Done when**: all ACs met (incl. swap-symmetry), mutation report reviewed, human approves.

---

### Slice 3: `throw-break` escapes a throw ✅ SHIPPED

**Status**: Done — `src/types.ts` (`{type:"throw-break"}` added to the Action union), `src/dsl.ts`
(`throw-break` allowlisted in the validator), `src/sim.ts` (the Slice-2 `stuffIfStruck` generalized
to `stuffIfDefeated` — a throw is now defeated by an opposing HIT **or**, on a grab-active tick, the
defender's `throw-break`; both void + mark the throw `stuffed`, thrower stays committed). `throw-break`
needs **no** `intake`/`guardBandOf`/`postureOf` change — it is a per-tick no-op like `idle` and not a
guard, so a striker hits it for free (strike > throw-break falls out of existing rules). 917 tests;
changed-line mutation 26 killed / 2 survived (both the carried-over Slice-2 equivalents at the
`stuffIfDefeated` non-throwing guard — a non-throwing fighter's throw outcome is always `null`, so
voiding it / `.stuffed` are unobservable); `dsl.ts` 100%. `Rules.throw` absent ⇒ `throw-break` parses
but is inert ⇒ byte-identical to C6.
**Branch**: `feat/c7-throw-break`
**Value**: The defender's out against a grab read — `throw-break > throw` completes the third
leg. Turns the throw into a true mixup rather than a guaranteed turtle-buster.
**Path**: `{type:"throw-break"}` (new allowlisted Action). `throw-break` is a **per-tick action
like `idle`/`block`** (no committed state, no whiff cost) — and it is **NOT a guard**, so a
fighter inputting it is `open`: a strike HITs it (strike > throw-break falls out of the existing
rules — **no new precedence**, and it's what stops break-spam from beating everything). When A's
throw is **grab-active** on B **on the same tick** B returns `throw-break`, the grab is escaped in
the precedence resolver: no score, no knockdown; A's throw is **resolved but stays committed
through its recovery** (punishable, same ruling as a stuffed throw — slice 2), B stays free. A
`throw-break` on any other tick (grab in startup/recovery, or no incoming grab) is **inert**.
**Required implementation skills**: `tdd`, `testing`, `mutation-testing`, `refactoring`.
**Acceptance criteria** (confirm before coding):

- A throw grab-active + B `throw-break` **on that same tick** ⇒ 0 points, B **not** downed; A's
  throw resolved but committed through recovery (punishable).
- B `throw-break` mistimed (grab in **startup/recovery**, not active that tick) ⇒ throw resolves
  normally / break wasted (single-tick coincidence — confirmed via find-gaps).
- A fighter inputting `throw-break` is **open to strikes** — an active in-range strike HITs it
  (strike > throw-break; no new precedence rule). This is the anti-break-spam balance.
- A wasted `throw-break` has **no special recovery cost** — it's a normal vulnerable tick.
- `throw-break` with no incoming throw ⇒ no effect (inert posture).
- `Rules.throw` absent ⇒ `throw-break` parses but is inert ⇒ byte-identical to C6.
  **RED**: tests for timed-break-escapes, mistimed-break-fails, lone-break-inert. Mutator gap:
  the break↔grab-active coincidence check; the **paired** "no score AND no knockdown" effect
  (kill a mutant dropping only one half).
  **GREEN**: allowlist `throw-break`; in the resolver, when the defender's posture is
  `throw-break` on a grab-active tick, void the throw outcome.
  **MUTATE / KILL MUTANTS / REFACTOR**: as standard.
  **Done when**: all ACs met, mutation report reviewed, human approves.

---

### Slice 4: Throw ∥ throw → clash, both whiff ✅ SHIPPED

**Status**: Done — `src/sim.ts`: (1) grabbability widened to include `throwing` defenders — the
predicate flipped to a positive ungrabbable set `kind === "airborne" || kind === "downed"` (so a
grab can land on a committed thrower), and (2) a `clash` branch added to the resolver — when **both**
throws are live (`aThrow !== null && bThrow !== null`, i.e. both grab-active + in reach) both are
voided ⇒ neither scores nor is downed. A **lone** live grab is not a clash: it lands on the
(grounded, possibly throwing) opponent. No new actions/Rules. 920 tests; changed-line mutation
**100% (28/28)** — no survivors. `dsl.ts` untouched. The two changes force each other: widening
alone double-grabs ({3,3}); the clash branch alone can't grab a thrower. Byte-identical to C6 when
nobody throws.
**Branch**: `feat/c7-throw-clash`
**Value**: Resolves the throw-vs-throw paradox — one of only **two** swap-symmetric outcomes in
§11.4 (the other is strike∥strike trade). Keeps the tick order-independent.
**Path**: in the precedence resolver, when **both** fighters are grab-active and in range of
each other → **clash**: neither scores, neither is downed, both go to recovery/whiff.
**Required implementation skills**: `tdd`, `testing`, `mutation-testing`, `refactoring`.
**Acceptance criteria** (confirm before coding):

- A & B both throw, both grab-active + in range ⇒ 0/0, neither downed.
- Swap-symmetry holds (it is a symmetric outcome by definition — assert both assignments).
- One in range, one out of range ⇒ only the in-range throw resolves (vs an open opponent ⇒ it
  scores + downs); the out-of-range throw whiffs.
  **RED**: clash test, symmetry test, asymmetric-range test. Mutator gaps: the both-grab-active
  branch; the per-side reach checks.
  **GREEN**: add the throw∥throw clash branch to the resolver (void both throw outcomes).
  **MUTATE / KILL MUTANTS / REFACTOR**: as standard.
  **Done when**: all ACs met, mutation report reviewed, human approves.

---

### Slice 5: Perceive the incoming throw (read surface)

**Branch**: `feat/c7-throw-tell`
**Value**: Makes `throw-break` a **reaction** skill-gradient, not pure prediction — consistent
with "perception is the only fog." A counter-bot can read the grab on the delayed action layer
and time a break (reactable only when `S ≥ L_act + 1`, the keystone inequality applied to
throws).
**Path**: expose the opponent's throw as a delayed tell on the **`L_act`** layer (invariant #4
— same coherent delayed snapshot as `attacking`/`attackBand`/`posture`). Thread a new field
through `OpponentState`, `Frame`, `frameOf`, `perceiveOpponent`, and the `FIELD_READERS` +
`FieldPath` allowlist in `src/dsl.ts`.
**Required implementation skills**: `tdd`, `testing`, `mutation-testing`, `refactoring`.
**Resolved decisions (find-gaps 2026-06-26)**:

- **Field = a bare `opponent.throwing` boolean** on the `L_act` layer (mirrors `opponent.attacking`).
  No phase countdown in C7 — add one later only if a test demands finer timing.
- **`opponent.knockdown` is deferred to C8 (okizeme)** — C7 has no consumer (a downed fighter
  isn't targetable and there's no finish window yet). Not added in this capability.
  **Acceptance criteria** (confirm before coding):
- The opponent's throw is perceivable, **delayed by `L_act`** (not `L_pos`, not live) — coherent
  with `attacking`/`attackBand`.
- A bot reacting to the tell can break a **slow** throw (`S ≥ L_act + 1`) but not a **fast** one
  (`S ≤ L_act`) — the perception gradient, mirroring the strike-block boundary.
- Additive field ⇒ a previously valid bot stays valid; `L=0` ⇒ tell perceived live.
  **RED**: a delayed-tell test (assert the tell lags by `L_act`); a reactable-vs-unreactable throw
  pair driven through a real break bot. Mutator gaps: the new reader function; routing the tell
  through the `L_act` (not `L_pos`) frame.
  **GREEN**: add the field + reader; emit it from `frameOf` on the action layer.
  **MUTATE / KILL MUTANTS / REFACTOR**: as standard.
  **Done when**: all ACs met, mutation report reviewed, human approves.

## Pre-PR Quality Gate (every slice)

1. Mutation testing — run `mutation-testing` (`sim.ts` ~95%+, `dsl.ts` interpreter 100%).
2. Refactoring assessment — run `refactoring`.
3. `npm run typecheck` + `npm run lint` pass.
4. Confirm the byte-identical-to-C6 guarantee still holds with all C7 `Rules` fields absent.

## Out of scope (follow-on capability — C8: sweeps + limited okizeme)

Deferred to a separate plan: the `sweep` action (knocks down, low/no score, vs `low`-band
occupancy), the **one guaranteed finish window** after a knockdown, wake-up **i-frames**, and
perceiving the okizeme state (`opponent.knockdown` likely lands there). C7 ships the throw
triangle + knockdown-as-tempo; C8 builds the ground game on top.

---

_Delete this file when the plan is complete. If `plans/` is empty, delete the directory._
