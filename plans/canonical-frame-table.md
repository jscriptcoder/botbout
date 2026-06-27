# Plan: Canonical frame table

**Branch**: per-slice (see each slice; suffixes off `main`)
**Status**: Active
**Decisions**: `plans/canonical-frame-table-decisions.md` (grill-me output — the why)

## Goal

Replace the provisional `src/cli/demo-rules.ts` with an authoritative, engine-level
`CANONICAL_RULES` (`src/engine/rules.ts`) whose every number is _proven by a
behavioral `runFight` test_ to produce the designed deep-karate meta.

## Acceptance Criteria

- [ ] `src/engine/rules.ts` exports `CANONICAL_RULES: Rules`; `src/cli/demo-rules.ts` is deleted; the runner uses the canonical table.
- [ ] `src/engine/rules.test.ts` derives every meta-defining number from a failing `runFight` outcome test (behavior through the public API), with structural asserts for pure bounds.
- [ ] The two master inequalities hold on canonical numbers: a band-read guard CAN block the strike (`S ≥ lAct+1`); a whiffed committed move CAN be punished (`R ≥ lAct+S_punish`).
- [ ] WKF scoring: strike 1, throw 3, sweep 0, okizeme finish 3 (via a new optional `finishScore`).
- [ ] Full C1–C8 mechanic set is enabled and each tuned to work (parry→counter, cancel rekka, crouch/jump occupancy, sweep→finish, i-frames).
- [ ] Engine `getMockRules` mocks remain independent (untouched); absent `finishScore` ⇒ engine byte-identical.
- [ ] All tests pass; typecheck/lint/format clean; `npm run fight` round-robin produces sensible results.

## Notes for every slice

- Behavioral tests assert **score / outcome** (did the attacker score? did the defender get hit?), **not** the internal HIT/BLOCK/PARRY taxonomy — so adding a deeper mechanic in a later slice never breaks an earlier slice's test (e.g. a slice-2 "guard stops the strike" test must survive slice-3 adding the parry window).
- `CANONICAL_RULES` is valid at every slice (optional fields absent ⇒ inert). Each table slice adds fields + the behavioral tests for the mechanics configured _so far_.
- `lAct` and `strike.reach` are pinned in Slice 2; later slices respect them (all committed startups `≥ lAct+1`; reach hierarchy `throw < sweep < strike` filled in additively — no re-tuning).
- Illustrative starting numbers are in the decisions doc; the tests pin the finals.

## Slices

Every slice follows RED-GREEN-MUTATE-KILL MUTANTS-REFACTOR. No production code without a failing test.

---

### Slice 1: A knockdown finish scores a configurable ippon value

**Branch**: `feat/finish-score`
**Value**: The okizeme finish (sweep/throw setup) can be worth a fixed ippon (3) instead of the finishing move's base score — making the C8 ground game mechanically worthwhile (engine consumers + the canonical table in Slice 5).
**Path**: `runFight` → `sim.ts` `computeStrike` downed branch → `finish` outcome points → recorded score. The only engine change in the whole plan.
**Required implementation skills**: load `tdd`, `testing`, `mutation-testing`, `refactoring`.
**Acceptance criteria** (confirm before code):

- With `rules.finishScore` set, an okizeme finish on a downed foe awards `finishScore` points (not the finishing strike's `spec.score`).
- With `finishScore` absent, the finish still awards `spec.score` ⇒ **byte-identical** to today (a replay regression test over an existing knockdown scenario).
- `finishScore` is added to `Rules` in `src/engine/types.ts` as optional; no other engine behavior changes.
  **RED**: A `runFight` test with mock rules (`getMockRules`) where `finishScore: 3` but the finishing `strike.score: 1`, a sweep-knockdown then finish, asserting the finisher's points jump by **3**. (Mutator watch: the `??` fallback — add the absent-`finishScore` byte-identical test so a mutant flipping `rules.finishScore ?? spec.score` to always-`spec.score` or always-`finishScore` dies.)
  **GREEN**: `points: rules.finishScore ?? spec.score` in the `computeStrike` downed/`finish` branch; add `finishScore?: number` to `Rules`.
  **MUTATE**: run mutation-testing on `sim.ts` (changed lines) + `dsl.ts` unaffected.
  **KILL MUTANTS**: ensure both the configured-3 and absent-fallback paths are pinned.
  **REFACTOR**: assess (likely none — one expression).
  **Done when**: ACs met, mutation report reviewed, byte-identical-when-absent proven, approval to commit.

---

### Slice 2: Fights run the canonical strike read-game (walking skeleton)

**Branch**: `feat/canonical-strike-core`
**Value**: A real, authoritative core table exists and is _proven_ to deliver the perception read-game — the foundation every later slice widens. (Actor: a fight using `CANONICAL_RULES`; observed via the behavioral suite through `runFight`.)
**Path**: new `src/engine/rules.ts` (`CANONICAL_RULES`) + `src/engine/rules.test.ts` → `runFight` with tiny inline bot factories → score outcomes. Runner NOT yet repointed (Slice 6).
**Required implementation skills**: load `tdd`, `testing`, `mutation-testing`, `refactoring`.
**Acceptance criteria** (confirm before code):

- Fighters start **out** of strike range (`startGap > strike.reach`) — an idle pair never scores; an approaching bot must close before it can hit.
- The strike is **reactable**: a bot that reads the delayed `attackBand` and guards the matching band stops the strike (defender not scored on), given `strike.startup ≥ lAct + 1`.
- A guard raised **one tick too late** is hit (the strike is not trivially blockable).
- A **whiffed** strike can be punished: a reaction strike scores during the whiffer's recovery (`recovery ≥ lAct + S_punish`).
- A clean strike scores **1**. Perception is `lPos~1, lAct~6, jitter~1`.
- Pure-bound structural asserts: `strike.score === 1`, `startGap > strike.reach`, `strike.startup ≥ lAct+1`, `strike.recovery ≥ lAct + strike.startup`.
  **RED**: behavioral `runFight` tests for each AC above (assert scores/outcomes, not taxonomy). Mutator watch: boundary mutants on `≥`/`>` thresholds — pin the "one tick too late = hit" and "exactly reactable" edges so off-by-one mutants die; the structural bound asserts kill arithmetic-relation mutants.
  **GREEN**: author `CANONICAL_RULES` with `tickRate, walkSpeed, ring, startGap, strike{startup,active,recovery,score,reach,cancelInto:[strike]}, perception` chosen to pass.
  **MUTATE**: mutation-testing on `rules.ts` is mostly constants — coverage comes from the behavioral suite; run on changed scope and confirm the suite kills threshold/relation mutants. (Constants with no behavioral consequence may be accepted as equivalent — note them.)
  **KILL MUTANTS**: strengthen edges (late-by-one, reactability threshold, approach boundary).
  **REFACTOR**: extract shared bot factories / a `canonicalFight` helper in the test file if it adds clarity.
  **Done when**: ACs met, suite green, mutation report reviewed, approval.

---

### Slice 3: The canonical strike has real defensive answers (parry, counter, cancel, crouch)

**Branch**: `feat/canonical-strike-defense`
**Value**: The strike's C5/C6 depth is live and tuned — a read parry deflects into a rewarded counter, a confirmed hit rekkas, and a croucher ducks a high strike.
**Path**: extend `CANONICAL_RULES` (+ `parryWindow, parryRecovery, counterWindow, counterBonus, cancelWindow`) + new behavioral tests.
**Required implementation skills**: load `tdd`, `testing`, `mutation-testing`, `refactoring`.
**Acceptance criteria** (confirm before code):

- A **freshly-raised** matching-band guard (age ≤ `parryWindow`) parries the strike (no score) and the attacker eats `parryRecovery` extra recovery; a guard held **past** the window only blocks. `parryWindow` is tight (~2–3).
- After a parry, the parrying fighter's counter strike within `counterWindow` scores **+`counterBonus`** (a counter ≈ waza-ari, ~2 total).
- A strike that **connects** opens `cancelWindow`; a `strike→strike` rekka cancels the recovery (hit-confirm); a **whiff/parry** never opens it (no-feint — assert the negative).
- A **high** canonical strike whiffs a **croucher** (occupancy; no new fields).
  **RED**: `runFight` tests for each (fresh-guard parry vs stale-guard block edge; counter-window-open vs closed; cancel on connect vs no-cancel on whiff; crouch-ducks-high). Mutator watch: window boundary mutants (`<=`/`<`) — pin the parry age edge and the counter/cancel window expiry ticks.
  **GREEN**: add the C5/C6 numbers to `CANONICAL_RULES` to pass.
  **MUTATE / KILL / REFACTOR**: as above; pin all window edges.
  **Done when**: ACs met, suite green, mutation report reviewed, approval.

---

### Slice 4: The canonical throw beats guards and is read-breakable

**Branch**: `feat/canonical-throw`
**Value**: The anti-turtle option is live on real numbers — throws beat any guard for 3, but a read throw-break (and a strike) defeat them, and a missed grab is punished.
**Path**: extend `CANONICAL_RULES` (+ `throw{startup,active,recovery,reach,score:3}, knockdownDuration`) + behavioral tests.
**Required implementation skills**: load `tdd`, `testing`, `mutation-testing`, `refactoring`.
**Acceptance criteria** (confirm before code):

- A throw beats a **correct-band guard**, scoring **3** and knocking down (throw > guard).
- A strike **stuffs** an in-range throw (strike > throw); the stuffed thrower stays committed/punishable.
- A **throw-break on read** defeats the grab — reactable, given `throw.startup ≥ lAct+1` (escapable iff `S ≥ lAct+1`); a mistimed break is wasted.
- A **whiffed** throw leaves the thrower punishable (`recovery ≥ lAct + S_punish`).
- Reach so far: `throw.reach < strike.reach`.
  **RED**: `runFight` tests for throw-beats-guard(=3), strike-stuffs-throw, read-throw-break (and the just-too-slow non-reactable edge), whiff-punish, plus the reach-order structural assert. Mutator watch: the `S ≥ lAct+1` reactability edge.
  **GREEN**: add the throw numbers + `knockdownDuration`.
  **MUTATE / KILL / REFACTOR**: as above.
  **Done when**: ACs met, suite green, mutation report reviewed, approval.

---

### Slice 5: The canonical sweep knocks down and hit-confirm-cancels into an ippon finish

**Branch**: `feat/canonical-sweep-okizeme`
**Depends on**: Slice 1 (`finishScore`) + Slice 3 (`cancelWindow`).
**Value**: The full ground/air game on real numbers — a low sweep knocks down, the okizeme finish (cancelled off the connect) scores 3, jumping clears the sweep, and the wake-up i-frames exist.
**Path**: extend `CANONICAL_RULES` (+ `sweep{...,knockdown,cancelInto:[strike]}, finishWindow, finishScore:3, jumpImpulse, gravity, lowClearance`) + behavioral tests.
**Required implementation skills**: load `tdd`, `testing`, `mutation-testing`, `refactoring`.
**Acceptance criteria** (confirm before code):

- A low sweep **whiffs a jumper** (airborne vacates low) and **connects on a croucher/stander**, scoring **0** + knockdown.
- The sweep knockdown opens the cancel window; a **hit-confirm cancel into strike** lands the okizeme **finish for 3** within a **tight `finishWindow` (~8)**.
- A **whiffed** sweep never cancels (no connect) and pays full recovery ⇒ punishable.
- `knockdownDuration > finishWindow` (a finished/expired knockdown leaves a wake-up **i-frame** tail where the foe is untargetable).
- The **jump arc clears `lowClearance`** across a sweep's active window (jump-over is viable, not frame-perfect-impossible).
- Reach hierarchy complete: `throw.reach < sweep.reach < strike.reach`.
  **RED**: `runFight` tests: sweep-vs-jumper(whiff)/vs-croucher(knockdown,score 0); sweep→cancel→finish==3; sweep-whiff-punishable; downed-then-i-frame untargetable after finishWindow; jump-clears-sweep; reach-order asserts. Mutator watch: `finishWindow`/`knockdownDuration` boundary ticks; the arc-vs-`lowClearance` threshold.
  **GREEN**: add the sweep/okizeme/vertical numbers to pass.
  **MUTATE / KILL / REFACTOR**: as above; pin the i-frame boundary and the jump-clearance edge.
  **Done when**: ACs met, suite green, mutation report reviewed, approval.

---

### Slice 6: The CLI runner and docs use the canonical table

**Branch**: `feat/canonical-wire-up`
**Value**: Users running `npm run fight` get the real canonical game; the provisional demo is gone and the single source of truth is `src/engine/rules.ts`.
**Path**: `src/cli/fight.ts` imports `CANONICAL_RULES`; delete `src/cli/demo-rules.ts`; refresh `README.md` + `.claude/CLAUDE.md`; re-run the example-bot round-robin and annotate/adjust bots as needed.
**Required implementation skills**: load `tdd`, `testing`, `refactoring` (mostly wiring/data + docs).
**Acceptance criteria** (confirm before code):

- `npm run fight -- bots/aggressor.json bots/turtle.json` runs on `CANONICAL_RULES` and prints a sensible result; the round-robin produces non-degenerate outcomes.
- `src/cli/demo-rules.ts` is deleted; no dangling imports; typecheck/lint/format clean; full suite green.
- README layout + CLAUDE.md reflect `src/engine/rules.ts` as the canonical frame table and drop the "provisional demo-rules" framing; the decisions doc and (completed) plan file are removed per the planning workflow.
- Example bots re-verified against canonical numbers; any that no longer demonstrate their mechanic are adjusted or annotated (bots are demo data — the sim is the truth).
  **RED**: the CLI has no unit-tested logic change; verification is the existing `format`/`load` suites staying green + a manual round-robin smoke (captured in the PR). If any helper logic is added, TDD it.
  **GREEN**: the import swap + deletion + doc edits.
  **MUTATE**: n/a for data/doc wiring (no new production logic); run the full suite + typecheck/lint/format gate.
  **REFACTOR**: assess.
  **Done when**: ACs met, gates green, round-robin smoke captured, approval; then delete `plans/canonical-frame-table*.md` (and `plans/` if empty).

## Pre-PR Quality Gate (every slice)

1. Mutation testing — run `mutation-testing` (engine slices; data slices rely on the behavioral suite + note any equivalent constant mutants).
2. Refactoring assessment — run `refactoring`.
3. Typecheck + lint + format clean.
4. For table slices: `CANONICAL_RULES` valid, behavioral suite green, engine `getMockRules` mocks untouched, absent-`finishScore` byte-identical (Slice 1).

---

_Delete this file (and the decisions doc) when the plan is complete. If `plans/` is empty, delete the directory._
