# Plan: Passivity feeds the shared penalty ladder (story B2)

**Branch**: feat/passivity-penalty
**Status**: Active

## Goal

Turn B1's inert passivity re-engage into a real penalty: a `ticksSinceOffense > limit` foul
increments the **shared** `Fighter.penaltyCount` (A2's ladder) — 1st free, 2+ ⇒ opponent +1 →
`winGap` re-check (`endReason "gap"`) → `resetToNeutral(both)`. Because jogai and passivity share
one `penaltyCount`, a warning spent on one mechanic makes the first foul of the other cost.

## Context & source of truth

- **Resolved decisions + ACs:** the tracker `plans/s7-match-remainder-stories.md`, section
  **"B2 — resolved decisions & acceptance criteria (find-gaps 2026-07-02)"** — D1 per-fighter
  mutual-net-zero award, D2 fire independently of a same-tick score, D3 extract shared
  `applyPenalty` helper, D4 reuse `endReason "gap"` with the winGap re-check in the passivity
  block; AC-1…AC-9. This plan implements that section verbatim.
- **Precedent to mirror exactly:** A2 (jogai warning-ladder, PR #98) — the passivity award is the
  *same* per-fighter ladder A2 built, now on a second trigger; and B1 (passivity clock, PR #100) —
  the block this plan extends. Each slice proves **byte-identical absent `match.passivity`** +
  **replay-stable** + **swap-symmetric**, with scoped mutation on the changed `sim.ts` regions.
- **Non-negotiable invariants:** determinism (integer-only outcome math, seeded PRNG), DSL-as-data
  TCB boundary (**B2 adds NO `FIELD_READER`, NO new `endReason`, NO `dsl.ts` change**), same
  pre-tick snapshot. `limit` is scoring-layer config (`FightConfig.match.passivity.limit`), NOT
  `Rules`/`CANONICAL_RULES` — `npm run fight` is unaffected. `limit` stays test-fixture-only (no
  canonical wiring — that's Capability D).

## Code touch points (all in `src/engine/sim.ts`)

**1. New module-level helper** (sibling to `resetToNeutral` at `sim.ts:831`) — the extracted ladder
award (D3):

```ts
// Shared warning-ladder award (jogai A2 + passivity B2): the fouler's per-fighter penaltyCount
// increments; past the one free warning (> 1) its opponent scores +1 — feeding winGap.
const applyPenalty = (fouler: Fighter, opponent: Fighter): void => {
  if (++fouler.penaltyCount > 1) opponent.points += 1;
};
```

**2. Jogai block** (`sim.ts:1124–1125`) — replace the two inline award lines with the helper (pure
extraction; jogai stays byte-identical — guarded by A2's tests + AC-9):

```ts
if (aOut) applyPenalty(a, b);
if (bOut) applyPenalty(b, a);
```

**3. Passivity block** (`sim.ts:1156–1164`) — from B1's penalty-free reset to the B2 award + winGap
re-check + reset:

```ts
if (match?.passivity) {
  const aPassive = a.ticksSinceOffense > match.passivity.limit;
  const bPassive = b.ticksSinceOffense > match.passivity.limit;
  if (aPassive || bPassive) {
    // Per-fighter award on the shared ladder (D1): each fighter whose OWN clock exceeded is a
    // fouler; both-idle ⇒ both fire same tick ⇒ mutual +1 net-zero. Fires independent of any
    // same-tick score (D2) — only yame's both-neutral reset pre-empts (via D5 clock-zeroing).
    if (aPassive) applyPenalty(a, b);
    if (bPassive) applyPenalty(b, a);
    // A passivity +1 can settle the bout (D4) — same winGap re-check as jogai; at most one per
    // tick (yame/jogai each zero the clocks ⇒ this reads 0 when they fired).
    if (Math.abs(a.points - b.points) >= match.winGap) {
      ticks = tick + 1;
      endReason = "gap";
      break;
    }
    resetToNeutral(a, aStartX);
    resetToNeutral(b, bStartX);
    scored = false;
  }
}
```

## Testing strategy / observability (the tricky part — learned from B1)

`penaltyCount` is **not** framed (only `x/y/action/points/stamina/degrade` are in `FighterFrame`),
so a passivity foul is observable **only** through its effects: the opponent's `points` rising on a
2nd+ foul, and the `resetToNeutral` snap-back (positions returning to `startX` next frame). Two
consequences drive the test construction:

- **Isolate combat points from penalty points.** To watch a *net* passivity point cleanly, the
  non-fouler must reset its clock **without scoring**. Use **GUARD(mid) vs ATTACKER(mid)**: the
  attacker's strike is **blocked** (negates the score) yet the block is the attacker's own
  `bOutcome !== null` ⇒ resets the *attacker's* clock with **zero** combat points, while the
  guarding fighter never commits an offense (`aOutcome === null`) ⇒ its clock climbs to the foul.
  Pick `limit` ≥ the attacker's max inter-block clock gap (~ its `recovery + startup`) so the
  attacker never fouls — the guard is the **sole fouler**. (Exact tick arithmetic derived in RED
  against the harness constants: gyaku-zuki startup 4 / active 2 / recovery 6, reach 250000, start
  gap 200000.)
- **Both-idle ⇒ mutual net-zero** needs no isolation: two IDLE bots both foul the same tick ⇒
  mutual +1 ⇒ gap stays 0 (assert both `points` equal, single reset via the snap-back).
- **Per-fighter award needs BOTH sides** (kills the `aPassive`/`bPassive` A-term & B-term mutants,
  the B1 T3-mirror lesson): a sole-fouler test with the guard as **A**, and its mirror with the
  guard as **B**.
- **Shared free warning (AC-3)** primes `penaltyCount` via a jogai foul first, then lets passivity
  fire — constructed so the jogai crossing happens *before* the passivity limit (small margin near
  start) but the **post-reset** stretch goes passive before re-crossing (a state-reading bot that
  idles once near center, or a tuned margin/limit pair); the first passivity foul then finds
  `penaltyCount == 1` ⇒ immediate opponent +1.

All tests are `runFight` behavioral tests in `src/engine/run-fight.test.ts` (reuse B1's
`ATTACKER`/`IDLE`/`GUARD`/`RETREATER`/`AGGRESSOR` bot factories); no new harness.

## Acceptance Criteria

Verbatim from the tracker's B2 section (AC-1…AC-9). Done when all are met by `runFight` tests:

- [ ] **AC-1** — 1st passivity foul is free (fouler `penaltyCount` → 1, neither `points` change, both reset).
- [ ] **AC-2** — 2nd+ passivity foul scores the opponent +1 (visible next tick, post-`events.push`).
- [ ] **AC-3** — shared free warning: a fighter that used its free warning on jogai pays on its first passivity foul (and symmetric).
- [ ] **AC-4** — a passivity +1 reaching `winGap` ends the bout, `endReason "gap"`, winner = leader.
- [ ] **AC-5** — both-passive same tick: each fighter's own foul count decides; both-past-free ⇒ mutual +1 net-zero; one-still-free ⇒ only the other scores; single reset; swap-symmetric.
- [ ] **AC-6** — attacker-only + fire-independent: a pure-defender fouls even on a tick it is being hit (hit-point and passivity penalty both apply).
- [ ] **AC-7** — yame (and a same-tick jogai reset) pre-empts passivity: the clock reads 0 ⇒ no passivity fire, single reset.
- [ ] **AC-8** — byte-identical absent `match.passivity`; replay-stable + swap-symmetric present.
- [ ] **AC-9** — jogai's A2 behavior (AC-1…AC-7) byte-identical after the shared-helper extraction.

## Slices

One slice — the award + win-by-gap is a single coherent behavior change, mirroring A2 (which shipped
award + winGap re-check in one PR); the D3 helper extraction is this slice's REFACTOR step (both call
sites then exist to justify it). *(Optional split noted at the end — not taken by default.)*

### Slice 1: A passivity foul feeds the shared penalty ladder and can win the bout on the gap

**Value**: the match officiating layer (and downstream benchmark) — non-engagement now *costs
points*, so a far-apart staller loses on `winGap`, not just gets re-centered.
**Path**: `runFight` per-tick officiating → passivity block (after yame + jogai) → per-fighter
`applyPenalty` on the shared `penaltyCount` → winGap re-check (`endReason "gap"`) → `resetToNeutral`
→ observable in `FightResult.events[*].{a,b}.points` / `winner` / `endReason` / positions. Skipped:
no perception (B3/B4), no canonical wiring (D), no new `endReason`.
**Required implementation skills**: before code, load `tdd`, `testing`, `mutation-testing`,
`refactoring`.
**Acceptance criteria**: AC-1…AC-9 above. **Present to human and confirm before writing any code.**
**RED**: `runFight` tests in `run-fight.test.ts`:
  - *free-then-score* (AC-1, AC-2): GUARD(A,mid) vs ATTACKER(B,mid), `limit` L tuned so B (blocks)
    never fouls and A is sole fouler → A's 1st foul: `points` still 0-0 at that boundary; A's 2nd
    foul: `b.points` = 1 in the next frame; positions snap to `startX` after each.
  - *sole-fouler mirror* (AC-5 A/B-term, swap-symmetry): the same with GUARD as **B** → `a.points`
    = 1 on B's 2nd foul.
  - *both-idle mutual net-zero* (AC-5): IDLE vs IDLE, small L → both foul same tick, `a.points ==
    b.points` (net-zero), single reset (positions snap once).
  - *shared free warning* (AC-3): jogai-primed fighter (margin near start) then passivity → first
    passivity foul scores the opponent immediately.
  - *win-by-gap* (AC-4): drive `winGap` sole-fouler passivity fouls → `winner`, `endReason "gap"`,
    `ticks` = the firing tick + 1.
  - *attacker-only stacking* (AC-6): a pure-defender scored-on the same tick its clock fouls → both
    the hit-point and the passivity +1 land.
  - *yame pre-empts* (AC-7): a scored + both-neutral tick with a clock at `> L` → no passivity point
    (yame reset zeroed the clock), single reset.
  - *byte-identical + replay* (AC-8): no-`passivity` run `toEqual` a pre-B2 baseline; same-config
    run twice `toEqual`.
  - *jogai unchanged* (AC-9): A2's existing jogai tests stay green after the extraction (they guard
    the refactor).
  Likely mutants to pre-empt (mutator-rules scan): `> match.passivity.limit` boundary (per-fighter,
  both sides); `++fouler.penaltyCount > 1` ladder boundary (`> 1` vs `>= 1`/`> 0`/`> 2` — needs the
  free-then-score pair + the shared-ladder AC-3); `aPassive || bPassive` fire condition and each
  term; `Math.abs(...) >= match.winGap` boundary; `opponent.points += 1` value; the per-fighter
  `if (aPassive)` / `if (bPassive)` guards (sole-fouler both sides).
**GREEN**: add the passivity award **inline** (duplicating A2's two-line ladder) + the winGap
re-check + reset in the passivity block (code block #3 above, pre-extraction form
`if (aPassive && ++a.penaltyCount > 1) b.points += 1;`). Minimum to pass.
**MUTATE**: `rm -rf .stryker-tmp reports` first (pollution artifact), then scoped Stryker
(`--mutate`) over the changed passivity block + the jogai award lines + the new helper (line
ranges, no `--incremental`). Produce killed/survived/score.
**KILL MUTANTS**: strengthen tests for survivors; the expected gap is the per-fighter A/B-term
(add the sole-fouler mirror, per B1's T3-mirror). Ask the human only if a survivor's value is
ambiguous.
**REFACTOR**: extract `applyPenalty(fouler, opponent)` (code block #1) and switch BOTH the jogai
(#2) and passivity (#3) award sites to it (D3). All tests — A2's jogai + the new passivity — stay
green, proving the extraction is behavior-preserving. Assess nothing further unless it adds value.
**Done when**: AC-1…AC-9 met, mutation report reviewed (changed regions ~100% / documented
equivalents only), typecheck + lint clean, human approves commit.

## Pre-PR Quality Gate

1. Mutation testing — scoped Stryker on the changed `sim.ts` regions (passivity block, jogai award
   lines, `applyPenalty`); `rm -rf .stryker-tmp reports` first.
2. Refactoring assessment — run `refactoring` (the `applyPenalty` extraction is the main call).
3. Full suite green (`npm test`), `npm run typecheck`, `npm run lint`.
4. Re-prove **byte-identical absent `match.passivity`** (AC-8) and **jogai byte-identical** (AC-9).
5. Confirm **no DSL/TCB surface**: `dsl.ts` unchanged, no new `FIELD_READER`, no new `endReason`.

## Optional split (not taken by default)

If a smaller review is preferred, Slice 1 could split into **1a** the per-fighter award +
mutual-net-zero (no early-stop) and **1b** the win-by-`winGap` early-stop + `endReason "gap"`.
Kept together here to mirror A2's single award+winGap PR and because the early-stop is the award's
direct consequence.

---
*Delete this file when the plan is complete. If `plans/` is empty, delete the directory.*
