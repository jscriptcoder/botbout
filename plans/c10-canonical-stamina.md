# Plan: C10 — canonical stamina wiring

**Branch**: feat/canonical-stamina
**Status**: Active — Slices 1–2 SHIPPED (economy core: `stamina {max 100, regen 10}` + per-move
`staminaCost` strike 20 < throw/sweep 40; guard chip `blockChip 5 < parryChip 15`); next is
Slice 3 (gas line — closes C10).

> The final C10 unit (last row of `plans/c10-stamina-split.md`). The behavioral economy
> (Stories 1–4) is shipped; this promotes the per-story **test-fixture** numbers into
> `CANONICAL_RULES` (`src/engine/rules.ts`), every number proven by a `runFight`
> _relationship_ test in `rules.test.ts` — so the platform (`npm run fight`, the future
> API/viewer) actually fights with stamina. Resolved design: `docs/DESIGN.md` §P1.

## Goal

Add a `stamina` block + per-move `staminaCost` to `CANONICAL_RULES` such that the C10
design relationships hold on the canonical table — built additively in 3 slices
(economy → chip → gas), each leaving the table relationship-proven and the runner green.

## Key constraints (read before slicing)

- **Not test-level-additive on canonical.** Absent stamina ⇒ byte-identical is the
  _engine_ guarantee; but ADDING stamina to `CANONICAL_RULES` activates the meter for
  **every** canonical fight. So each slice must **re-run the full `rules.test.ts`** and
  keep the existing non-stamina relationship tests green — i.e. pick `max`/`regen`
  generous enough that the short existing fights (a few strikes) never hit the
  affordability wall or a gas penalty. If an existing test genuinely depends on unlimited
  stamina, that is a signal to adjust the number, not the test.
- **No literals-in-isolation.** Assert _relationships_ (spend-on-commit, regen offsets a
  sustainable poke, `parryChip > blockChip`, `specialCost > gasThreshold ≥ basicCost`,
  the gassed recovery extends). Structural-shape `describe`s may pin existence/ordering
  with `toBe`/`toBeGreaterThan` (mirroring the existing `rules.test.ts` shape tests), but
  the _behavior_ is proven by `runFight`.
- **C9 re-tune caveat.** The per-move cost **magnitudes** are provisional against today's
  single-strike arsenal; when C9 spreads costs across the 4-strike roster they get
  re-tuned additively. The **structural inequalities** locked here (basic < special; the
  gas band) survive C9 — design to those, not to the magnitudes.
- **`rules.ts` mutation 100%** (the project bar) — each canonical number killed by a
  relationship test and/or a structural-shape pin. `sim.ts`/`dsl.ts` unchanged (the
  machinery exists; this slice is data + tests only).

## Acceptance Criteria

- [x] `CANONICAL_RULES.stamina` exists (`max` + `regen`), and `strike`/`throw`/`sweep`
      carry a `staminaCost`, with **basic (strike) < special (throw, sweep)**. _(Slice 1)_
- [x] On the canonical table: a costed strike spends `staminaCost` on commit; a fighter
      poking at a sustainable cadence keeps acting (regen offsets it) while a faster
      spammer runs the meter down and degrades to idle. _(Slice 1)_
- [x] A block bleeds the defender's stamina on contact; a parry bleeds **strictly more**
      (`parryChip > blockChip`). _(Slice 2)_
- [ ] The emergent special-lockout holds on canonical: a gassed fighter (stamina ≤
      `gasThreshold`) **cannot afford** throw/sweep while its basic strike still commits
      (`specialCost > gasThreshold ≥ basicCost`); and a gassed strike's recovery extends
      by `gasRecoveryPenalty`.
- [ ] The full pre-existing `rules.test.ts` relationship suite stays green under the meter.
- [ ] `rules.ts` mutation 100%; `npm run fight` runs on the stamina-enabled table.

## Slices

Every slice follows RED-GREEN-MUTATE-KILL MUTANTS-REFACTOR. No production code (here:
canonical numbers) without a failing relationship test. Each slice is data
(`rules.ts`) + tests (`rules.test.ts`) only — the engine machinery already exists.

### Slice 1: The canonical meter paces the fight (economy core)

**Value**: The platform's fights now have conditioning — a fighter spends stamina to act
and recovers by pacing, so canonical fights curb spam without a second health bar.

**Path**: `CANONICAL_RULES.stamina = { max, regen }` + `staminaCost` on `strike`/`throw`/
`sweep` → `runFight` (the live sim machinery from Stories 1/3) spends on commit, gates
affordability, regens when uncommitted → observable in `result.events[t].{a,b}.stamina`
and in action timing (a spammer degrades to idle). _Skipped this slice:_ guard chip (2),
gas line (3).

**Required implementation skills**: Before code, load `tdd`, `testing`, `mutation-testing`,
`refactoring`.

**Acceptance criteria** (present for confirmation before code):

1. **Spend-on-commit**: a canonical strike drops the striker's `stamina` by exactly its
   `staminaCost` on the commit tick (whiff still costs) — asserted from `events…stamina`.
2. **Regen offsets a sustainable poke**: a bot striking at a paced cadence (one strike
   per ≳ recovery+regen-recovery window) never runs dry — its stamina oscillates but
   never blocks a commit; a bot spamming every free tick runs the meter down until a
   commit **degrades to idle** (the affordability `≥` gate). The two diverge ⇒ regen is
   load-bearing.
3. **Cost ordering**: structural-shape pins `strike.staminaCost < throw.staminaCost` and
   `< sweep.staminaCost` (basic < special — the room the gas band needs in Slice 3).
4. **Existing suite green**: the full `rules.test.ts` passes unchanged under the meter
   (numbers chosen so the short canonical fights don't hit the wall).

**RED**: In `rules.test.ts`, a `describe("CANONICAL_RULES — the stamina meter paces the
fight")` + a `describe("CANONICAL_RULES — stamina structural shape")`. A paced-poker vs a
free-spammer bot (reuse the `restrikeWhenFree`/`strikeAtTicks` helpers); assert the
spammer's stamina floors and a later commit degrades to idle while the poker keeps
scoring. Likely mutator gaps (`mutator-rules.md`): the `max`/`regen`/`staminaCost`
literals (each pinned by a relationship or a shape assertion); the `<` cost ordering.

**GREEN**: Add `stamina: { max, regen }` to `CANONICAL_RULES` and `staminaCost` to the
three moves — the **minimum** numbers that satisfy the relationships AND keep the existing
suite green. (Pick a scale where one strike is a small fraction of `max`, regen ≈ refills
one strike per its recovery window, throw/sweep cost a larger fraction.)

**MUTATE**: `mutation-testing` on the changed `rules.ts` lines. **KILL MUTANTS**:
strengthen a shape pin or relationship if a literal survives.

**REFACTOR**: Assess (likely none — data + a comment block mirroring the existing table).

**Done when**: AC 1–4 met, full suite green, `rules.ts` changed-line mutation 100%, human
approves commit.

### Slice 2: The canonical guard chip bleeds the defender (parry > block)

**Value**: On the canonical table, turtling under pressure now costs stamina — the gentle
secondary anti-turtle alongside the throw.

**Path**: `CANONICAL_RULES.stamina.blockChip`/`parryChip` → the §11-union chip machinery
(Story 2) draws from the defender on contact → observable as the defender's `stamina`
dropping on a blocked/parried canonical strike. _Skipped:_ gas line (3).

**Required implementation skills**: load `tdd`, `testing`, `mutation-testing`, `refactoring`.

**Acceptance criteria** (present for confirmation before code):

1. A canonical strike absorbed by a matching guard (a **block**) draws `blockChip` from
   the defender on the contact tick.
2. A fresh matching guard that **deflects** it (a **parry**) draws **strictly more**
   (`parryChip > blockChip`) — asserted as the relationship under the same strike.
3. An un-contacted held guard draws nothing (contact is the trigger).
4. Existing suite stays green; the chip numbers don't starve the short canonical fights.

**RED**: a `describe("CANONICAL_RULES — the guard chip bleeds the defender (parry >
block)")`. Reuse the canonical parry/block helpers (`guardFrom`, `parryThenCounter`);
assert the defender's post-contact `stamina` drop is larger for a parry than a block, and
zero for an untouched guard. Likely mutator gaps: the `blockChip`/`parryChip` literals
(pinned by the `>` relationship + a shape pin `parryChip > blockChip`).

**GREEN**: add `blockChip`/`parryChip` to `CANONICAL_RULES.stamina` with `parryChip >
blockChip`, sized so a single contact is a meaningful but non-lethal fraction of `max`.

**MUTATE / KILL MUTANTS / REFACTOR**: as Slice 1, scoped to the two new lines.

**Done when**: AC 1–4 met, full suite green, `rules.ts` changed-line mutation 100%, human
approves commit.

### Slice 3: The canonical gas line locks out specials (emergent inequality)

**Value**: The canonical conditioning mind-game — over-extend below the line and you are
slower and can't throw/sweep, a reason to pace. Completes C10 on the canonical table.

**Path**: `CANONICAL_RULES.stamina.gasThreshold`/`gasRecoveryPenalty` → the affordability
gate (Story 1) + the gas recovery penalty (Story 3) → a gassed fighter's throw/sweep
degrades to idle while its strike still commits, and its strike recovery extends →
observable in action timing + `events`. With `gasThreshold` wired, `opponent.gassed`
(Story 4) is also live on canonical. _Skipped:_ nothing — this closes C10.

**Required implementation skills**: load `tdd`, `testing`, `mutation-testing`, `refactoring`.

**Acceptance criteria** (present for confirmation before code):

1. **Emergent special-lockout**: with stamina driven to ≤ `gasThreshold`, a canonical
   `throw`/`sweep` degrades to idle (unaffordable) while a `strike` still commits —
   proving `specialCost > gasThreshold ≥ basicCost` on the canonical numbers (a
   guarantee/characterization relationship, no production logic — it rides Story 1's gate).
2. **Gassed recovery penalty**: a gassed canonical strike re-commits later than a fresh
   one by `gasRecoveryPenalty` (recovery-only), via the action-timing relationship.
3. Structural-shape pin: `strike.staminaCost ≤ gasThreshold < throw.staminaCost` (and
   `< sweep.staminaCost`) — the gas band sits between basic and special.
4. Existing suite stays green; `npm run fight` runs the full stamina-enabled table.

**RED**: a `describe("CANONICAL_RULES — the gas line locks out specials (specialCost >
gasThreshold ≥ basicCost)")` + a gas shape pin. Drive a fighter below the line (spam to
the floor), then assert throw/sweep → idle while strike commits, and the gassed strike's
later re-commit. Likely mutator gaps: the `gasThreshold`/`gasRecoveryPenalty` literals
(pinned by the band ordering + the lockout/penalty relationships).

**GREEN**: add `gasThreshold`/`gasRecoveryPenalty` to `CANONICAL_RULES.stamina` satisfying
`basicCost ≤ gasThreshold < specialCost`.

**MUTATE / KILL MUTANTS / REFACTOR**: as above.

**Done when**: AC 1–4 met, full suite green, `rules.ts` mutation 100%, human approves
commit. **On merge, C10 is fully canonical** — delete `plans/c10-stamina-split.md` (and
this file).

## Pre-PR Quality Gate

Before each PR:

1. Mutation testing — `mutation-testing` skill on changed `rules.ts` lines.
2. Refactoring assessment — `refactoring` skill (mostly a comment-block review).
3. `npm run typecheck`, `npm run lint`, `npm test`, `npm run format:check` pass —
   **including the full pre-existing `rules.test.ts` suite under the meter**.
4. `npm run fight` runs without error on the updated table.

## After this plan

C10 is complete (behavioral economy + canonical wiring). Next roadmap capability: the
**C9 multi-move arsenal** (resolved, `docs/DESIGN.md` §P7) — which will re-tune these
per-move costs across the 4-strike roster — then match structure / air-actions.

---

_Delete this file when the plan is complete. If `plans/` is empty, delete the directory._
