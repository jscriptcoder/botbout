# Plan: Jogai warning-ladder penalty (story A2)

**Branch**: feat/jogai-warning-ladder
**Status**: Active

## Goal

A fighter that retreats into the jogai out-zone repeatedly is penalized on a WKF
warning ladder — the 1st crossing is a free warning, every crossing after gives the
**opponent +1 point** (feeding the existing `winGap`) — so persistent cornering-to-safety
loses the bout.

## Context & source of truth

- Story split + resolved decisions/AC: `plans/s7-match-remainder-stories.md`
  (Capability A row **A2**, and the **"A2 — resolved decisions & acceptance criteria
  (find-gaps 2026-07-02)"** section).
- Design: `docs/DESIGN.md §7a` (jogai table + per-tick officiating order).
- Builds directly on **A1** (PR #97): `match.jogai.margin`, the `inBounds` predicate,
  the `aWasIn`/`bWasIn` edge-detect trackers, and the jogai officiating block in
  `src/engine/sim.ts` (~line 1077, after the yame block). A1 reset both fighters on a
  crossing but awarded **no** points; A2 adds the ladder + `winGap` re-check to that block.

## Non-negotiable invariants (carried from A1)

- **Byte-identical absent config.** `match.jogai` absent ⇒ replay identical to pre-A2. The
  new `penaltyCount` field is never touched and **never enters a `FightEvent` frame**.
- **Determinism / integer math.** The penalty is an integer `+1`. No floats, no wall-clock,
  no PRNG draw added.
- **DSL-as-data TCB.** A2 adds **no** DSL surface — no new `FIELD_READERS`, no `dsl.ts`
  change (bot-facing `self`/`opponent.penalties` are deferred to A3). `margin` is
  spec-taught, not a field.
- **Same pre-tick snapshot / officiating order.** Award happens in the jogai officiating
  block (after `events.push`), so a penalty point surfaces in the **next** tick's frame —
  exactly like A1's reset.

## Observability contract (find-gaps decision, 2026-07-02)

Penalties are observed **via `points` + reset only**: a paid foul shows as the opponent's
`points` / `scores` / `winner` / `endReason`; a free warning shows as a `resetToNeutral`
with **no** point delta. No new `FightEvent` / `FightResult` field this slice. "jogai
`FightEvent`" = the existing per-tick frame.

## Acceptance Criteria

Verbatim from the tracker's find-gaps section (test at the `runFight` behavioral level,
mirroring A1's jogai tests in `src/engine/run-fight.test.ts`):

- [ ] **AC-1 — free first foul.** 1st out-zone crossing of the bout ⇒ both reset, that
      fighter's `penaltyCount` = 1, **neither** fighter's `points` change.
- [ ] **AC-2 — 2nd+ foul scores the opponent.** 2nd (or later) crossing ⇒ the crossing
      fighter's **opponent** gains +1 (surfaces in the next tick's frame); 3rd crossing ⇒
      opponent +1 again (cumulative, per-foul).
- [ ] **AC-3 — penalty can end the match.** When a jogai +1 makes `|a−b| ≥ winGap`, the
      fight ends that tick, `endReason "gap"`, winner = the leader. (Check runs only when a
      penalty point was awarded; mutually exclusive with the yame block's check ⇒ ≤1/tick.)
- [ ] **AC-4 — per-fighter, bout-persistent.** Each fighter has its own `penaltyCount`;
      it persists across every yame/jogai reset (like `points`), never reset mid-bout.
- [ ] **AC-5 — both-out same tick.** Each fighter's own foul history decides whether ITS
      opponent scores (both past the free warning ⇒ mutual +1, net-zero gap; one still on
      its free warning ⇒ only the other opponent scores); single reset, no spurious stop.
- [ ] **AC-6 — yame pre-empts jogai.** In the rare both-neutral + scored + out tick, yame
      resets first (snapping the offender in-bounds) ⇒ jogai does **not** fire ⇒ no penalty.
- [ ] **AC-7 — byte-identical / stable / symmetric.** `match.jogai` absent ⇒ byte-identical
      to pre-A2; present ⇒ replay-stable and swap-symmetric.

## Slices

Every slice follows RED-GREEN-MUTATE-KILL MUTANTS-REFACTOR. No production code without a
failing test.

### Slice 1 (the whole story): retreating past the free warning scores the opponent, and can end the bout on `winGap`

**Value**: the match-officiating layer (and, downstream, the benchmark) penalizes persistent
retreat — the jogai *value*, not just A1's consequence-free reset. A retreating zoner now pays
in points and can lose the bout.

**Path**: `runFight` (scoring layer) → the jogai officiating block in `sim.ts` (after the
yame block) → on a crossing, increment the crossing fighter's `penaltyCount`, award its
opponent `+1` when `penaltyCount > 1`, re-check `winGap` if a point was awarded (break with
`endReason "gap"`), else `resetToNeutral` both + re-arm trackers → observable via
`result.events[t].{a,b}.points`, `result.scores`, `result.winner`, `result.endReason`.
No `FightEvent`/`FightResult`/DSL surface change. **Intentionally skipped:** bot-facing
`self`/`opponent.penalties` reads (A3); passivity sharing the counter (B2); CLI display.

**Required implementation skills**: Before code changes, load `tdd`, `testing`,
`mutation-testing`, and `refactoring`.

**Acceptance criteria**: AC-1…AC-7 above. **Present to human and confirm before writing code.**

**RED** (ordered TDD increments; behavior-driven `runFight` tests reusing A1's harness —
`RETREATER`/`AGGRESSOR`/`IDLE`, `getMockRules`, `getMockConfig`, `aStartX`/`bStartX`; mutation-aware):

1. **AC-1 free first foul** — A retreats, crosses out once ⇒ both reset AND `a.points==0 && b.points==0`.
   (Kills award-on-1st mutants: `penaltyCount > 1` → `>= 1` / `> 0`.) May extend A1's single-cross test.
2. **AC-2 paid 2nd foul** — A crosses out twice (re-arm) ⇒ after the 2nd crossing `b.points==1`,
   `a.points==0` (opponent scored, not self). (Kills: award-self, drop-award, wrong side.)
   **Updates the A1 re-arm test** that asserted "points unchanged" across the 2nd crossing.
3. **AC-2 cumulative** — A crosses out 3 times ⇒ `b.points==2`. (Kills `++`→no-op / `+=2`; pins
   per-foul +1 and increment-by-1.)
4. **AC-3 match-end on penalty** — small `winGap` (e.g. 2): A retreats until B's penalty points
   reach the gap ⇒ `endReason=="gap"`, `winner=="B"`, `ticks` = that crossing tick + 1, loop stops.
   (Kills: `>=`→`>`/`==`, missing break, `awarded` gate removed.)
5. **AC-3 no-end-on-free-warning** — with the same small `winGap`, a lone 1st crossing does NOT
   end the match (`endReason` still `"time"` at that point). (Kills: winGap check ungated from `awarded`.)
6. **AC-5 both-out symmetric** — both fighters retreat and cross out on the same tick, both on
   their 2nd foul ⇒ `a.points==1 && b.points==1` (mutual, net-zero), single reset (positions
   symmetric next tick), no early stop. (Kills: `aOut||bOut`→`aOut`, one-sided award, double reset.)
7. **AC-6 yame pre-empts jogai** — construct a both-neutral + scored + out tick ⇒ yame resets,
   **no** penalty point awarded (assert the offender's opponent gained nothing from jogai that tick).
   If genuinely unconstructable, document that the pre-empt is structural (yame's reset makes the
   crossing undetectable — already proven for the reset in A1's B2 test) and add the tightest feasible probe.
8. **AC-7 byte-identical** — `match.jogai` absent ⇒ `events` deep-equal a no-jogai run (and a
   winGap-only run); **replay-stability** (same config twice ⇒ identical `events`); **swap-symmetry**
   (swap botA/botB ⇒ mirrored `scores`/`winner`).

**GREEN**: add `penaltyCount: number` to the `Fighter` type (init `0`; **not** added to
`resetToNeutral`, **not** added to the `FightEvent` frame). In the existing `if (match?.jogai)`
crossing branch, replace the bare double-reset with:

```ts
const aOut = aWasIn && !aNowIn;
const bOut = bWasIn && !bNowIn;
if (aOut || bOut) {
  if (aOut && ++a.penaltyCount > 1) b.points += 1;   // 1st foul free, 2+ ⇒ opponent +1
  if (bOut && ++b.penaltyCount > 1) a.points += 1;
  if (Math.abs(a.points - b.points) >= match.winGap) {  // ungated: only an award moves the gap
    ticks = tick + 1;
    endReason = "gap";
    break;                       // before reset, like the yame block
  }
  resetToNeutral(a, aStartX);
  resetToNeutral(b, bStartX);
  scored = false;
  aWasIn = inBounds(aStartX);
  bWasIn = inBounds(bStartX);
} else { aWasIn = aNowIn; bWasIn = bNowIn; }
```

_Refinement (RED design): the `winGap` re-check is **ungated** — run whenever jogai fires, not
only when `awarded`. Since only an award can change the gap, this is behaviorally identical for all
reachable states in scope (no-combat + jogai) but avoids an un-killable `awarded`-gate mutant and
mirrors the yame block's post-reset check._

**MUTATE**: scoped Stryker on the changed `sim.ts` jogai region (`--mutate "src/engine/sim.ts:<start>-<end>"`).
`rm -rf .stryker-tmp` first (project pollution artifact). Target: changed-line 100% (document any
equivalent, e.g. the A1-inherited `if (match?.jogai)` guard).

**KILL MUTANTS**: strengthen tests for survivors — expect the ladder boundary (`> 1`), the two
award sides, the `awarded` gate, and the `>=` winGap comparison to be the hotspots. Ask the human
if a survivor's value is ambiguous.

**REFACTOR**: assess only if it adds value. Do **not** pre-extract a shared penalty-award helper —
`penaltyCount` is named generically for passivity (B2), but extraction waits for B2's second
consumer (YAGNI). Ladder constants (1 free, +1/foul) stay inline literals.

**Done when**: AC-1…AC-7 met, full suite green, typecheck + lint clean, mutation report reviewed
(changed-line 100% or documented equivalent), byte-identical-absent + replay + swap re-proven,
human approves commit.

## Pre-PR Quality Gate

1. Mutation testing — scoped run on the changed `sim.ts` region (`rm -rf .stryker-tmp` first).
2. Refactoring assessment — run `refactoring` skill.
3. `npm run typecheck` + `npm run lint` pass; full `npm test` green.
4. Confirm no DSL/TCB surface changed (`dsl.ts` untouched) and `Rules`/`CANONICAL_RULES`/
   `npm run fight` unaffected (match mode is scoring-layer only).

## Result (Slice 1 — RED→GREEN→MUTATE→KILL→REFACTOR complete)

- **Tests:** 770 pass (10 new A2 tests). AC-1…AC-5, AC-7 each proven by `runFight`; AC-3 has a
  match-end test + a below-gap guard + an equal-scores arithmetic guard.
- **AC-6 (yame pre-empts jogai):** covered **structurally**, not by a dedicated test — the pre-empt
  needs a both-neutral + scored + out tick (the scorer is otherwise mid-recovery), which is not
  cheaply constructible. The award lives inside the `if (aOut || bOut)` crossing branch, and yame's
  reset (running first) snaps the offender in-bounds so the crossing is undetectable ⇒ the branch is
  skipped ⇒ no penalty. This is the identical mechanism A1 relied on for its reset pre-empt.
- **MUTATE:** scoped Stryker on `sim.ts:1088-1121` + the two `penaltyCount` inits — **41 killed / 1
  survived = 97.62%**, changed-line 100%. The lone survivor is the A1-inherited `if (match?.jogai)`
  → `if (true)` guard: **equivalent** (forced on with no margin, `inBounds` is all-true ⇒ the block
  is inert and never reaches `match.winGap`).
- **REFACTOR:** none — the block is minimal; the shared award helper is deferred to passivity (B2).
- **Invariants:** byte-identical absent `match.jogai` (A1's N2 test still green), replay-stable +
  swap-symmetric under jogai, `dsl.ts`/TCB untouched, integer-only `+1`.

---
*Delete this file when the plan is complete (record lives in git/PR + the tracker's Progress section).*
