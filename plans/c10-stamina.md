# Plan: C10 Story 1 — self-side stamina economy

**Branch**: feat/stamina-economy
**Status**: Active

> Story + hardened ACs: `plans/c10-stamina-split.md`. Design: `docs/DESIGN.md` §P1.
> This plan covers **Story 1 only** (the self-side economy). Stories 2 (guard chip),
> 3 (gas penalty), 4 (opponent `L_act` read) and the `CANONICAL_RULES` wiring are
> follow-ups — see _Out of scope_ + the split file.

## Goal

A fighter spends stamina to act and recovers it by resting; over-aggression makes its
next move unaffordable (whiffs to idle); a bot reads `self.stamina` to pace itself —
all additive (absent `Rules.stamina` ⇒ byte-identical to today's engine).

## Acceptance Criteria

- [ ] A committed `attack`/`throw`/`sweep` spends its `staminaCost` **on commit** (even on a whiff).
- [ ] A move is affordable **iff `stamina ≥ staminaCost`**; the last affordable move empties to **exactly 0**; an unaffordable one degrades to **idle** — no spend, no startup, no score.
- [ ] Stamina **regens** `+regen`/tick (clamped to `max`) only while **uncommitted** (`state = neutral` ∧ not guarding); a commit/guard/knockdown/in-move tick regens **0**.
- [ ] `self.stamina` is a **live** DSL-readable field; a bot can branch on it.
- [ ] **Absent `Rules.stamina` ⇒ byte-identical** (no meter simulated; `self.stamina` reads `0`).

## Design decision to confirm before coding

**How do tests observe the meter?** Recommendation: **record `stamina` in `FighterFrame`**
(the event log) so slices assert `events[t].a.stamina` directly, _and_ cover the
`self.stamina` DSL read with a bot-branching test in Slice 1. Stamina is an
outcome-affecting integer that belongs in the replayable log. The schema gains a field
but **fight resolution is unchanged** (unconfigured ⇒ `stamina: 0` every frame); the
additive guard asserts the _meaningful_ fields (x/y/points/winner), and any existing
whole-frame snapshot assertions get the new field. _(Alternative: observe only
indirectly via a bot reading `self.stamina` — zero schema churn but circular for the
meter tracer. I recommend recording it.)_

## Contract changes (additive — all optional ⇒ absent = byte-identical)

- `types.ts`: `Rules.stamina?: { max: number }` in Slice 1, **widened to `{ max; regen }` in Slice 3** (the simulate-switch is the block's presence; no speculative field) · `MoveSpec.staminaCost?: number` · `ThrowSpec.staminaCost?: number` · `SelfState.stamina: number` · `FighterFrame.stamina: number`.
- `dsl.ts` (**TCB**): add `"self.stamina"` to `FieldPath` + `FIELD_READERS` (auto-joins `ALLOWED_FIELDS`). Purely additive — never rejects a previously valid bot.
- `sim.ts`: `Fighter.stamina` (init `rules.stamina?.max ?? 0`); cost deduct + affordability in `intake`; a `regen` step immediately **before** `advance`; expose in `viewFor`; record in the event frame.

## Slices

Every slice follows RED-GREEN-MUTATE-KILL MUTANTS-REFACTOR. No production code without a
failing test. Tests are co-located (`src/engine/sim.test.ts`, `dsl.test.ts`) and assert
**relationships, not literals** (mock rules via the existing `getMockRules`, independent
of `CANONICAL_RULES`).

### Slice 1: A costed move spends stamina, recorded in the event log and readable as `self.stamina`

**Value**: Bot author / replay viewer sees the meter; a bot can voluntarily pace on `self.stamina` (before any enforcement).
**Path**: bot returns `attack`/`throw`/`sweep` → `intake` deducts `staminaCost` (plain `−cost`, no floor) when `Rules.stamina` configured → `viewFor` exposes `self.stamina` → `FighterFrame.stamina` records it → DSL `field` reads it. _Skipped on purpose:_ affordability gate (Slice 2), regen (Slice 3), `self.gassed` (Story 3), the **cancel-follow-up cost** (a Story-1 follow-up micro-slice — the C6 rekka path needs its own scenario).
**Required implementation skills**: load `tdd`, `testing`, `mutation-testing`, `refactoring` before code.
**Acceptance criteria** _(confirm before code)_: (a) with `Rules.stamina={max}` and a strike `staminaCost=C`, a fighter that commits a strike has `stamina = max − C` on the commit tick, **even if the strike whiffs**, and stamina does **not** change again while the move runs (spend is on commit, not per-frame); (b) `throw` and `sweep` likewise spend their `staminaCost` on commit; (c) a second commit steps down again (triangulates real subtraction, not a hardcode); (d) a bot whose rule reads `self.stamina` branches on it (observable in the log); (e) **absent `Rules.stamina` ⇒** every frame's `stamina` is `0`, no deductions, and x/points are unchanged from the pre-stamina engine. _(No floor: the `[0]` lower bound is guaranteed by Slice 2's affordability — see refinement.)_
**RED**: `run-fight.test.ts` — a STRIKER vs IDLE fight asserts the attacker's `stamina = max − C` on the commit tick, is unchanged mid-move, and steps down on the next commit; a THROWER and a SWEEPER assert their spends; an additive-guard test asserts an unconfigured run has all-`0` stamina and unchanged x/points. `interpret-tick.test.ts` — `self.stamina` joins the `it.each` numeric-read table; `validate-bot.test.ts` — `self.stamina` joins `allowedFields`. **Likely mutants**: the `?? 0` cost lookup, the `rules.stamina` gate (deduct-when-unconfigured would break byte-identical; never-deduct would break the spend), the `− cost` arithmetic, the per-action `costOf` branches.
**GREEN**: add the contract fields; `Fighter.stamina` init (`rules.stamina?.max ?? 0`); deduct in `intake`'s three neutral-commit branches gated on `rules.stamina` (no floor); expose in `viewFor`; record in the frame; add the `FIELD_READERS` line + `getMockState` default.
**MUTATE**: run `mutation-testing` on `sim.ts` + `dsl.ts` diff.
**KILL MUTANTS**: pin the floor, the config gate, the cost arithmetic; `dsl.ts` interpreter line to 100%.
**REFACTOR**: assess a shared `costOf(action, rules)` helper if the three branches duplicate.
**Done when**: ACs met, mutation report reviewed (sim changed-line 100%, dsl interpreter 100%), human approves commit.

### Slice 2: An unaffordable move degrades to idle (spend to exactly 0; one short fails)

**Value**: Over-aggression is enforced — you can't act past your stamina.
**Path**: `intake` gates each costed commit on `rules.stamina === undefined || stamina ≥ cost`; unaffordable ⇒ no state change, no spend (the move never starts). _Skipped:_ regen (Slice 3).
**Required implementation skills**: load `tdd`, `testing`, `mutation-testing`, `refactoring`.
**Acceptance criteria** _(confirm before code)_: (a) **B1** — given `stamina == cost`, the move **commits** and stamina becomes `0`; given `stamina == cost − 1`, it degrades to **idle** (stamina unchanged, no startup); (b) an unaffordable strike that _would_ be active+in-range scores **nothing** (proves no startup, not just no spend); (c) once a spam-attacking fighter drops below `cost`, its subsequent attacks stop committing (stamina flat); (d) absent `Rules.stamina` ⇒ no gate (byte-identical); (e) because an unaffordable move never commits, stamina stays ≥ 0 — **this is the `[0]` lower-bound guarantee** that replaces a Slice-1 floor.
**RED**: `sim.test.ts` — boundary pair at `cost` vs `cost−1` (assert commit-to-0 vs idle); an in-range unaffordable strike adds **0 points**; the byte-identical guard. **Likely mutants**: `≥` vs `>` (B1 — the headline mutant), the `=== undefined` short-circuit, the branch that skips the deduction on rejection.
**GREEN**: wrap the three commit branches with the affordability predicate; reject ⇒ fall through to the no-op (idle) path with no deduction.
**MUTATE / KILL MUTANTS**: the `≥` boundary mutant **must** die (the B1 pin); the unaffordable-still-scores mutant must die.
**REFACTOR**: fold the gate into the `costOf` helper if it reads cleaner.
**Done when**: ACs met, B1 boundary mutant killed, human approves commit.

### Slice 3: An uncommitted fighter regens stamina; a committing/guarding fighter does not

**Value**: The pacing loop closes — back off to breathe, the core conditioning rhythm.
**Path**: a `regen` step **before** `advance` adds `regen` (clamped to `max`) iff `rules.stamina` ∧ `state = neutral` ∧ `guardBand === null` — evaluated on **post-intake** state (B2), before `advance` frees a finishing move. _Skipped:_ nothing — this completes Story 1.
**Required implementation skills**: load `tdd`, `testing`, `mutation-testing`, `refactoring`.
**Acceptance criteria** _(confirm before code)_: (a) an idling fighter gains `+regen`/tick, **clamped at `max`** (never over-fills); (b) **B2** — a fighter that commits a move on tick T nets `−cost` that tick (gains 0), not `−cost+regen`; (c) a **guarding** fighter gains 0 that tick; an in-move (incl. last recovery tick), knocked-down fighter gains 0; (d) a **crouching** fighter _does_ regen (neutral ∧ not guarding) — recorded as the resolved reading; (e) after spending to low, an idling fighter recovers over N ticks; (f) absent `Rules.stamina` ⇒ no regen (byte-identical).
**RED**: `sim.test.ts` — idle-to-max clamp; the B2 net `−cost` on a commit tick; guard tick gains 0; recover-over-rest. **Likely mutants**: the `min(max, …)` clamp, each `&&` in the regen predicate (drop `guardBand === null` ⇒ guarders regen; drop the neutral check ⇒ committers regen), the `+ regen` arithmetic, regen-after-advance vs before (B2).
**GREEN**: widen `Rules.stamina` to `{max,regen}`; add `regen(f, rules)` invoked before the `advance` calls using `f.guardBand` + post-intake `f.state`.
**MUTATE / KILL MUTANTS**: kill the predicate mutants (guarder/committer regen) and the placement mutant (B2).
**REFACTOR**: assess only if it adds value.
**Done when**: all Story-1 ACs met, mutation report reviewed, human approves commit.

## Out of scope (follow-ups — not this plan)

- **Story 2** guard contact-chip (cross-fighter, rides the §11 union via `applyStrike`).
- **Story 3** gas penalty + `self.gassed` (the cost inequality `specialCost > gasThreshold ≥ basicCost`).
- **Story 4** `opponent.stamina`/`gassed` on the `L_act` history layer.
- **`CANONICAL_RULES` wiring** — deferred to a C10-closing slice so the cost numbers are tuned **once** against gas (Story 3) and re-tuned when the C9 arsenal spreads costs. Until then stamina is inert in `npm run fight` (additive).
- **Telemetry event** on the affordability whiff — no telemetry object exists; Slice 2 delivers the degrade-to-idle **behavior** only.

## Implementation anchors (for resumption after compaction)

**Status: pre-RED.** Skills loaded (`tdd`, `testing`); grounded in conventions; **no
code written yet**. Next action: write the Slice 1 RED tests below, run to confirm
failure, then GREEN.

**Production sites** (`src/engine/`):

- `sim.ts`: `Fighter` type (~L104) + add `stamina`; init in `runFight` a/b (~L622/636) to `rules.stamina?.max ?? 0`; `intake` (~L265) — deduct in the three NEUTRAL-commit branches (`attack`, `sweep`-with-spec, `throw`-with-spec) gated on `rules.stamina`, no floor, do NOT touch the cancel branch (~L270); a `regen` step is Slice 3 (place before `advance` calls ~L775); `viewFor` (~L234) add `stamina: self.stamina` to the `self` object; `FighterFrame` type (~L64) add `stamina`; event push (~L785) record `stamina`.
- `dsl.ts` (**TCB**): `FieldPath` union (~L23) + `FIELD_READERS` (~L87) add `"self.stamina": (s) => s.self.stamina` (auto-joins `ALLOWED_FIELDS`).
- `types.ts`: `Rules.stamina?: { max: number }` · `MoveSpec.staminaCost?` · `ThrowSpec.staminaCost?` · `SelfState.stamina: number` · (no FighterFrame here — it lives in sim.ts).

**Test sites**:

- `run-fight.test.ts`: `getMockRules` (~L18, strike total = 4+2+6 = 12 frames), append a new `describe("runFight — stamina meter")`. Bots: `STRIKER = bot([], {type:"attack",move:"strike",band:"mid"})`, `THROWER = bot([], {type:"throw"})`, `SWEEPER = bot([], {type:"sweep"})`.
- `interpret-tick.test.ts`: add `stamina: 0` to `getMockState` self (~L31); add `["self.stamina", { self: { stamina: 42 } }, 42]` to the `it.each` table (~L189).
- `validate-bot.test.ts`: add `"self.stamina"` to `allowedFields` (~L433).

**Exact Slice 1 RED numbers**:

- STRIKER vs IDLE, `stamina:{max:100}`, strike `staminaCost:30`, maxTicks 13: commit at tick 0 ⇒ `events[0].a.stamina===70`; unchanged mid-move ⇒ `events[5].a.stamina===70`; move ends after tick 11 (elapsed reaches 12 ⇒ neutral), re-commit at tick 12 ⇒ `events[12].a.stamina===40` (triangulates real subtraction).
- THROWER vs IDLE, `throw:{startup:2,active:2,recovery:4,reach:120000,staminaCost:40}`, maxTicks 1 ⇒ `events[0].a.stamina===60`.
- SWEEPER vs IDLE, `moves:{strike:{…default…}, sweep:{startup:4,active:2,recovery:6,score:0,reach:180000,knockdown:true,staminaCost:20}}`, maxTicks 1 ⇒ `events[0].a.stamina===80`.
- Additive guard: `getMockRules()` (no `stamina`), STRIKER vs IDLE, maxTicks 5 ⇒ every `a.stamina`/`b.stamina === 0`, and the strike still scores (`events[4].a.points===1`) — proves the field is inert/byte-identical when unconfigured.

## Pre-PR Quality Gate (each slice)

1. `mutation-testing` — `sim.ts` ≈95%+ (changed-line 100%), `dsl.ts` interpreter 100%.
2. `refactoring` assessment.
3. `npm run typecheck` + `npm run lint` + full `npm test` green.
4. Additive guard test (absent `Rules.stamina` ⇒ byte-identical) present and passing.

---

_Delete this file when C10 Story 1 ships. (The split file tracks the remaining stories.)_
