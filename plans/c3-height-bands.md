# Plan: C3 — Height bands + 3 _uke_ guards

**Branch**: PR-per-slice (`feat/c3-band-guard`, `feat/c3-perceive-band`)
**Status**: Active
**Design source**: `docs/DESIGN.md` §2 (band + occupancy), §4 (3 guards), §11 (resolution order); roadmap capability **C3** in `docs/stories/first-slice-split.md`.

## Goal

A bot that guards the **correct height** blocks a strike; a guard at the **wrong height**
gets hit — and a bot can **perceive the opponent's attack band** (delayed by `L_act`) to
choose its guard. This is the core read/counter game.

## Scope decision (TDD-driven refinement of §11's "C3 down-payment")

§11 and the grill described C3 as also paying down the **two-phase compute-then-apply
effects machinery** + the **HIT/BLOCK/WHIFF taxonomy** + the **pre-intake frozen
snapshot**. Planning surfaced a conflict with the project's non-negotiable TDD rule:

- **BLOCK vs WHIFF are behaviourally indistinguishable in C3** — both yield "no score, no
  other effect" until **C6 (cancels)** consumes the distinction (cancel on hit/block,
  never whiff). Building the three-way taxonomy now = untested production code.
- **The effects union (MoveStart/Step/Score as data)** has no opponent-mutating consumer
  until **C5 (parry)** / throws. Building it now = a partially-speculative abstraction with
  no failing test to drive it.
- **The pre-intake frozen snapshot** (no same-tick step-dodge) _is_ testable, but it is
  **independent of height bands** — it's §11 conformance, not part of this capability.

**Therefore C3 builds only what a failing test demands: the band-keyed guard + the
perceived band.** The §11 structural items are deferred to the slice that first needs
them (C5 parry / throws bring the effects machinery + taxonomy; the pre-intake snapshot
rides with C5 or a standalone micro-slice). Order-independence in C3 stays trivially
intact because every effect is still **self-targeted** (score on the attacker, step on
self) — exactly the property the current single-`resolveHit` structure already provides.
Occupancy stays **out** of C3 too (no `y`/crouch posture exists to make it observable — it
arrives with C4).

> **Decision (approved 2026-06-26): DEFER.** C3 is the two slices below — band-keying +
> perception only. The §11 effects machinery / HIT-BLOCK-WHIFF taxonomy / pre-intake
> snapshot are built when their first consumer (C5 parry / throws) brings a RED test. §11
> remains the binding spec; we just don't build untested machinery ahead of a test.

## Acceptance Criteria

- [x] A strike whose band **differs** from the defender's raised guard band **connects and
      scores** (wrong-height guard ⇒ hit), for every band pairing. _(Slice 1)_
- [x] A strike whose band **matches** the defender's raised guard band is **blocked** (no
      score), for `high`, `mid`, and `low`. _(Slice 1)_
- [x] An **open** defender (not guarding — idle, moving, or committed/attacking) is **hit**
      by a strike of any band. _(Slice 1)_
- [ ] A bot can read `opponent.attackBand` — the opponent's current attack band, perceived
      **delayed by `L_act`** (same layer as `opponent.attacking`), encoded numerically — and
      branch on it to raise the matching guard. _(Slice 2)_
- [x] Regression: simultaneous **same-band** strikes still **trade** (both score); fights
      stay **byte-reproducible** and **swap-symmetric**; `perception` absent ⇒ unchanged.
      _(Slice 1)_

## Slices

Every slice follows RED-GREEN-MUTATE-KILL MUTANTS-REFACTOR. No production code without a
failing test. Read `.claude/CLAUDE.md`, `docs/DESIGN.md` §11, and the testing rules before
writing slices.

### Slice 1: A wrong-height guard gets hit; a correct-height guard blocks — ✅ DONE (`29a04b9` feat, `584b54d` refactor)

**Value**: Bot author — the core karate read. The guard you raise must match the incoming
height or you eat the strike.
**Path**: `runFight` tick → `intake` captures the attack's **band** into the attacking
move state → `resolveHit` compares the attacker's band against the defender's raised guard
band → score iff not matched. Observable via `FightResult.scores`. Intentionally skipped:
occupancy (no `y` yet — deferred to C4), the BLOCK/WHIFF distinction (no consumer — C6),
parry (C5).
**Required implementation skills**: load `tdd`, `testing`, `mutation-testing`,
`refactoring` before code.
**Acceptance criteria** (confirm before code):

- A `high` strike vs `block-mid` → attacker scores; vs `block-high` → no score.
- The same for `mid` (blocked only by `block-mid`) and `low` (blocked only by `block-low`)
  — all three bands exercised as both attack band and guard band.
- An idle / moving / committed defender (not guarding) is hit by a strike of any band.
- Existing `mid`-vs-`block-mid` block test and the same-band trade test stay green.
  **RED**: A fight where `ATTACKER(band=high)` faces `BLOCKER(band=mid)` asserts
  `scores.a === 1`; a sibling test with `BLOCKER(band=high)` asserts `scores.a === 0`. Add
  the symmetric `mid` and `low` cases. Anticipated mutants (per `mutator-rules.md`): equality
  swap (`===`→`!==`) on the band compare, logical-connector swap (`&&`→`||`) on
  `guarding && bandMatches`, and a constant-band substitution — the **full 3×{match,mismatch}
  matrix** kills all three; a single `mid` case would not.
  **GREEN**: add `band: Band` to the `attacking` `MoveState` (captured from `action.band` in
  `intake`); change `resolveHit`'s `defGuarding: boolean` to a defender **guard band**
  (`Band | null`, computed in `runFight` as today's neutral-and-block check, carrying
  `action.band`); block iff `guardBand !== null && guardBand === att.state.band`.
  **MUTATE**: run `mutation-testing` on `sim.ts`.
  **KILL MUTANTS**: strengthen until the band-compare and the guard predicate are fully
  covered; ask if any survivor's value is ambiguous.
  **REFACTOR**: assess only if it adds value (e.g. a small `isBlocked(attackBand, guardBand)`
  helper).
  **Done when**: all ACs met, mutation report reviewed, human approves commit.

### Slice 2: A bot perceives the opponent's attack band (delayed by `L_act`)

**Value**: Bot author — the read becomes _playable_: a counter-bot can see the incoming
height (late, per the perception keystone) and raise the matching guard, instead of
blind-guessing.
**Path**: per-fighter history `Frame` records the fighter's current attack band → served
from the **`L_act`-delayed** frame (the same coherent layer as `attacking`, invariant #4) →
exposed as `OpponentState.attackBand` → `FIELD_READERS["opponent.attackBand"]` →
bot reads it via `eq`/comparison. Observable via a reader-bot's actions and `scores`.
**Required implementation skills**: load `tdd`, `testing`, `mutation-testing`,
`refactoring` before code.
**Acceptance criteria** (confirm before code):

- Encoding: `opponent.attackBand` = `0` (not attacking), `1` (low), `2` (mid), `3` (high)
  — ascending with height; documented in `types.ts`/`dsl.ts`.
- The perceived band lags by **`L_act`** (not `L_pos`, not live): with `lAct = k`, a strike
  launched on tick T is first seen on tick T+k, mirroring the `attacking` tell.
- A defender bot keyed on `opponent.attackBand` raises the matching guard and **blocks**
  what it would otherwise have eaten (end-to-end with Slice 1).
- `perception` absent ⇒ `attackBand` perceived live at the same `0` baseline; replay stays
  byte-identical; jitter unchanged.
  **RED**: a fight with `lAct = 6` asserts a perceiving bot reads `0` until tick T+6 then the
  attack's band value; a bot reacting to `opponent.attackBand === 3` raises `block-high` and
  drives `scores` to 0 against a high attacker. Anticipated mutants: the enum literals
  (`1/2/3/0`), the `lAct`-vs-`lPos` frame selection (reuse the existing `attacking`-latency
  test shape), and an off-by-one in the delay — assert the exact first-perceived tick.
  **GREEN**: add `attackBand` to `Frame` (derived from the fighter's move state: its band
  when attacking, else `0`); serve it from the `lAct`-delayed frame in `perceiveOpponent`;
  add `attackBand: number` to `OpponentState`; add the `FIELD_READERS` entry + `FieldPath`
  member; document the mapping.
  **MUTATE**: run `mutation-testing` on `sim.ts` + `dsl.ts`.
  **KILL MUTANTS**: cover each enum value and the latency-layer selection; ask if ambiguous.
  **REFACTOR**: assess only if it adds value (e.g. a shared band↔number map).
  **Done when**: all ACs met, mutation report reviewed, human approves commit.

## Out of scope (deferred, with their consumer)

- **Two-phase compute-then-apply effects machinery + HIT/BLOCK/WHIFF taxonomy** → C5
  (parry) / throws — the first opponent-mutating effects. (§11.1/11.3)
- **Pre-intake frozen snapshot (no same-tick step-dodge)** → rides with C5, or a standalone
  micro-slice if pulled forward; independent of height bands. (§11.1)
- **Occupancy gate going live** → C4 (vertical axis / crouch posture). (§11.3 step 3)
- **Per-move legal-band restriction + per-band frame data** → with the real frame table.

## Pre-PR Quality Gate

Before each PR:

1. Mutation testing — run `mutation-testing` skill (`sim.ts` ≥ its current ~95%; new
   `dsl.ts` readers at 100%).
2. Refactoring assessment — run `refactoring` skill.
3. `npm run typecheck` and `npm run lint` pass.
4. `npm run format:check` passes.

---

_Delete this file when the plan is complete. If `plans/` is empty, delete the directory._
