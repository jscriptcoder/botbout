# Plan: C1 — Senshu first-blood tiebreak

**Branch**: feat/senshu-tiebreak
**Status**: Active

## Goal

Decisively resolve a **level** bout at the tick cap via the WKF _senshu_ rule — the first
fighter to land a scored technique wins a tied bout (`endReason "senshu"`), closing the
benchmark's `"draw"` gap — behind an optional `match.senshu?: boolean` toggle, byte-identical
when absent.

## Source of truth

All decisions are resolved in the **"C1 — resolved decisions & acceptance criteria (find-gaps
2026-07-02)"** section of `plans/s7-match-remainder-stories.md` (and reconciled into
`docs/DESIGN.md` §7a). This plan sequences AC-1…AC-10 into two PR-sized slices. Do not
re-litigate the decisions here; if one proves wrong, update the tracker section first.

**Non-negotiable (CLAUDE.md):** determinism (integer-only outcome math, seeded PRNG, no
`Math.random`/`Date.now`/wall-clock); DSL-as-data TCB (`dsl.ts` untouched — senshu is a
scoring/officiating change, no read surface until C3); same pre-tick snapshot. Every slice:
**byte-identical when `match.senshu` absent** + **replay-stable** + **swap-symmetric**, with
scoped `sim.ts` mutation on the changed officiating regions.

## Acceptance Criteria

(Verbatim AC-1…AC-10 from the tracker; slice assignment in brackets.)

- [ ] **AC-1** first-blood latch (solo): A lands the first technique (1-0) ⇒ A holds senshu. _[C1a]_
- [ ] **AC-2** simultaneous ⇒ `none` (permanent); a level cap stays `"draw"`/`"time"`; a later solo technique does not claim it. _[C1a]_
- [ ] **AC-3** decides a level bout only: level cap (4-4) ⇒ holder wins `"senshu"`; non-level (5-3) ⇒ leader wins `"time"`. _[C1a]_
- [ ] **AC-4** gap early-stop unaffected: gap reaches `winGap` ⇒ `"gap"`, leader wins, senshu irrelevant. _[C1a]_
- [ ] **AC-5** no-senshu draw: level cap, no holder (0-0 or `none`) ⇒ `"draw"`/`"time"` (unchanged from pre-C1). _[C1a]_
- [ ] **AC-6** penalty never confers: a jogai/passivity penalty giving B its first point does not confer senshu; a later first A technique latches A. _[C1b]_
- [ ] **AC-7** holder's foul revokes: A holds senshu and commits any jogai/passivity foul (incl. free warning) ⇒ `none` (not transferred); level cap ⇒ `"draw"`/`"time"`. _[C1b]_
- [ ] **AC-8** same-tick latch-then-revoke: A scores its first technique AND fouls same tick ⇒ latch (combat) precedes revoke (penalty) ⇒ `none`. _[C1b]_
- [ ] **AC-9** persists across resets: A holds senshu through yame/jogai/passivity resets ⇒ still holds at the cap. _[C1a yame; C1b jogai/passivity]_
- [ ] **AC-10** byte-identical absent + swap-symmetric + replay-stable. _[both]_

## Anchors in `src/engine/sim.ts` (verified 2026-07-02)

- Config type `FightConfig.match`: ~L95–99 (add `senshu?: boolean`).
- Result type `FightResult.endReason`: L107 (add `"senshu"` to the union).
- Officiating state (`let ticks`, `endReason`, `scored`): L940–944 (declare `senshuHolder` here).
- Per-tick technique-delta signal **already present**: `aPointsBefore`/`bPointsBefore` snapshot at
  **L962–963** (tick-top); at **L1128** (post-`applyStrike`/`applyThrow`, **pre**-penalty-blocks)
  `a.points > aPointsBefore` is the pure scored-technique delta — penalties are applied later
  (jogai L1164–65, passivity L1205–06). **Latch reuses this — no new counter, no new field.**
- Jogai penalty block: L1155–1188 (`aOut`/`bOut` are the foul events; `applyPenalty` at L1164–65).
- Passivity penalty block: L1195–1221 (`aPassive`/`bPassive` foul events; `applyPenalty` L1205–06).
- Terminal tally: L1224 (`winner`), L1226–1232 (return). Senshu rewrites a terminal `"draw"` only.

## Slices

Every slice follows RED-GREEN-MUTATE-KILL MUTANTS-REFACTOR. No production code without a failing
test. Before code: load `tdd`, `testing`, `mutation-testing`, `refactoring`. Stryker hygiene
(project memory): `rm -rf .stryker-tmp reports` before each run; single-line scope needs the `N-N`
range form; multiple `--mutate` flags are last-wins (run ranges in separate invocations).

### Slice C1a: A level bout is won by the first fighter to score a technique (`endReason "senshu"`)

**Value**: the match layer / benchmark — a tied bout resolves decisively instead of `"draw"`, the
independent "bargain" tracer. No jogai/passivity coupling.
**Path**: `runFight` tick loop → latch `senshuHolder` from the L1128 technique-delta (gated on
`match?.senshu`, only while `undecided`) → terminal tally rewrites a `"draw"` to the holder with
`endReason "senshu"`. Observable via `FightResult.{winner, endReason}`. **Skipped this slice**:
revocation + penalty interaction (C1b — needs co-configured jogai/passivity).
**Required implementation skills**: `tdd`, `testing`, `mutation-testing`, `refactoring`.
**Acceptance criteria**: AC-1, AC-2, AC-3, AC-4, AC-5, AC-9 (yame-reset persistence), AC-10.
**Present these to the human and get confirmation before writing any code.**
**RED** (behavioral `runFight` tests in `run-fight.test.ts`, `describe("runFight — senshu tiebreak
(story C1a)")`), each with `match: { winGap: <high>, senshu: true }` so the bout runs to a level
cap:
- A scores first, B evens later, cap ⇒ 1-1 level ⇒ `winner "A"`, `endReason "senshu"` (AC-1/AC-3).
- Both score their first technique the **same** tick (1-1), then cap ⇒ `winner "draw"`,
  `endReason "time"`; a later solo A technique does NOT flip it (AC-2 — kills a mutant that lets a
  late score claim a `none` latch).
- Non-level cap (e.g. A 2, B 1 with A first) ⇒ `winner "A"`, `endReason "time"` (senshu never
  overrides a points winner — AC-3 negative; kills the `winner === "draw"` guard mutant).
- Gap reaches `winGap` ⇒ `endReason "gap"`, leader wins regardless of holder (AC-4).
- Level 0-0 cap ⇒ `winner "draw"`, `endReason "time"` (AC-5; kills a mutant that emits `"senshu"`
  for an `undecided`/`none` holder).
- Holder persists across a yame reset: A scores first, a scored-exchange yame reset fires, B later
  evens, cap ⇒ A still wins on senshu (AC-9).
- `match.senshu` absent ⇒ replay byte-identical to a no-senshu run (AC-10); present ⇒ swap the two
  bots ⇒ `winner` mirrors A↔B, `endReason` unchanged, scores mirror (AC-10). Mutator focus
  (`resources/mutator-rules.md`): the `undecided`/`none`/`A`/`B` equality branches, the
  `aTech && !bTech` boolean pair, the `winner === "draw" && match?.senshu` conjunction.
**GREEN**: add `senshu?: boolean` to the `match` type; add `"senshu"` to `endReason`; declare
`let senshuHolder = "undecided"` at L940–944; insert the gated latch block at L1128 reusing
`aPointsBefore`/`bPointsBefore`; make `winner` a `let` and rewrite a terminal `"draw"` to the
holder (set `endReason = "senshu"`). Minimum code only.
**MUTATE**: scoped Stryker on the latch block + the terminal rewrite lines (separate `N-N`
invocations per region).
**KILL MUTANTS**: strengthen the AC-2/AC-3/AC-5 boundary tests for any survivor; ask the human if a
survivor's value is ambiguous.
**REFACTOR**: assess only if it adds value (e.g. a tiny `latchSenshu` helper if the block reads
poorly) — do not extract for testability.
**Done when**: AC-1/2/3/4/5/9/10 green, byte-identical-absent + replay + swap-symmetry proven,
mutation report reviewed, human approves commit.

### Slice C1b: The senshu-holder loses it (→ `none`) on any jogai/passivity foul it commits

**Value**: the match layer — WKF-faithful revocation so an initiative-holder can't turtle behind a
foul; completes C1. Requires co-configured jogai/passivity.
**Path**: in the jogai block (L1155–1188) and passivity block (L1195–1221), when the **holder's**
own foul event fires (`aOut`/`bOut`, `aPassive`/`bPassive`), set `senshuHolder = "none"`. The latch
already excludes penalty points (its L1128 placement is pre-penalty), so **penalty-never-confers
(AC-6) is characterized here**, not newly coded.
**Required implementation skills**: `tdd`, `testing`, `mutation-testing`, `refactoring`.
**Acceptance criteria**: AC-6, AC-7, AC-8, AC-9 (jogai/passivity-reset persistence for a non-holder
foul), AC-10 (byte-identical when senshu present but no foul; swap-symmetric; replay-stable).
**Present to the human and get confirmation before writing any code.**
**RED** (`describe("runFight — senshu revocation (story C1b)")`, `match: { winGap, senshu: true,
jogai: { margin } }` and/or `passivity: { limit }`):
- A scores first (senshu A), then A retreats out-zone twice (a jogai foul); B evens; cap ⇒ senshu
  is `none` ⇒ `winner "draw"`, `endReason "time"` (AC-7; kills the `senshuHolder === "A"` revoke
  guard). Assert the point-gap is genuinely level so the revoke is what changes the outcome.
- **Free-warning revoke**: A holds senshu, A's **1st** (free, no-point) jogai foul ⇒ `none`
  (AC-7 boundary — kills a mutant that only revokes on a point-awarding 2nd+ foul).
- **Non-holder foul leaves senshu intact**: A holds senshu, **B** fouls ⇒ A still wins on senshu
  (AC-7 negative — kills a mutant revoking on the wrong fighter).
- **Penalty never confers** (AC-6): senshu configured + jogai; B is handed its first point by A's
  foul (no technique yet); then A lands its first technique ⇒ senshu latches to **A**, not B.
- **Same-tick latch-then-revoke** (AC-8): A scores its first technique AND crosses out the same
  tick ⇒ `none` (latch at L1128 precedes revoke in the jogai block — kills a mutant that reorders
  or drops the combat-phase latch).
- **Persistence under a non-holder reset** (AC-9): A holds senshu; B's passivity/jogai foul resets
  both bodies; A still holds senshu at the cap.
- **Byte-identical / swap / replay** (AC-10): senshu + jogai configured but **no foul occurs** ⇒
  outcome identical to C1a; swap bots ⇒ mirrored; same seed ⇒ replay-stable.
**GREEN**: add the two revocation lines to the jogai block (after `applyPenalty`, before the winGap
re-check) and the two to the passivity block; guard each on the fouling fighter being the current
holder.
**MUTATE**: scoped Stryker on the 4 new revocation lines (jogai + passivity), separate `N-N` runs.
**KILL MUTANTS**: cover the free-warning-revoke and wrong-fighter survivors directly.
**REFACTOR**: if the four revoke lines duplicate a clear concept, consider a `revokeSenshuOnFoul`
helper — only if it reads better; the jogai/passivity blocks stay otherwise untouched.
**Done when**: AC-6/7/8/9/10 green, byte-identical-when-no-foul + replay + swap proven, mutation
report reviewed, human approves commit.

## Pre-PR Quality Gate (each slice)

1. Mutation testing — scoped Stryker on the changed `sim.ts` regions (100% on changed lines, or a
   documented equivalent).
2. Refactoring assessment — run `refactoring`.
3. `npm run typecheck` + `npm run lint` clean; full `npm test` green (re-prove replay-stable +
   byte-identical-absent).
4. No DSL/TCB surface touched (`dsl.ts` unchanged); no `docs/spec.md` change (Capability D owns the
   prose + `Match` extension).

## On completion

Both slices merged ⇒ mark C1 done in `plans/s7-match-remainder-stories.md`'s Progress, flip Next
Step to **C2 (sudden-death overtime)**, and delete this plan file (record lives in git + the PRs).
If a notable insight emerges, use the `learn` agent for the CLAUDE.md Status entry.

---
*Delete this file when the plan is complete. If `plans/` is empty, delete the directory.*
