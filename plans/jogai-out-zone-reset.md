# Plan: Jogai out-zone detection + reset (story A1)

**Branch**: feat/jogai-out-zone-reset
**Status**: Active

Story A1 from `plans/s7-match-remainder-stories.md`. Design: `docs/DESIGN.md` §7a.
The risk-first tracer for the whole §7 jogai/passivity line: it establishes the
new officiating boundary read over the existing hard clamp + the jogai reset spine,
with **no penalty yet** (penalty = A2, perception = A3).

## Goal

A fighter that walks into the out-zone triggers a yame-style reset of both fighters
back to their neutral start — proving the boundary geometry and edge-detect end to
end — while an absent `match.jogai` config leaves fights byte-identical.

## Scope & non-scope

**In:** `FightConfig.match.jogai?: { margin }`; the `[margin, width−margin]` legal
region as a pure scoring-layer read of `self.x`; on-entry edge-detect (per-fighter
was-in-bounds tracker); `resetToNeutral(both)` on a crossing; the officiating-order
integration alongside the existing yame block.

**Out (deferred):** the warning ladder / points / `penaltyCount` (A2); the
`self`/`opponent.penalties` reads (A3); any DSL surface (**A1 adds none** — no new
`FIELD_READERS`; the `dsl.ts` TCB is untouched); the `margin` becoming spec-taught
(a later spec slice, D2). No `endReason` change — a penalty-free jogai reset just
resets; the bout still ends by `winGap`/time as today.

## Invariants (must hold every slice)

- **Determinism / integer-only:** the boundary read is integer sub-unit comparison
  (`x < margin || x > width − margin`). No floats in the outcome path.
- **Byte-identical absent config:** no `match.jogai` ⇒ the loop path is unchanged ⇒
  identical frames/result to `main`. The movement clamp at `sim.ts:440` is **not
  touched** (fighters still clamp to `[0, width]`; jogai only *reads* position).
- **Same pre-tick snapshot / TCB:** jogai is resolved in `runFight` orchestration
  after combat, reading resolved end-of-tick positions. No `dsl.ts` change.
- **Swap-symmetry:** A↔B mirrored inputs give mirrored frames.

## Trusted-config assumption (B1)

`match.jogai.margin` is trusted config (like `Rules`), not bot-validated — no runtime
validation is added (consistent with `winGap` today). It must satisfy
`0 < margin < startX offset` so **both start positions begin in-bounds** (canonical:
`aStartX == 150000`, so `margin < 150000` — note `margin < width/2 == 300000` is NOT
tight enough). This is a spec/documentation note, not an A1 validation slice.

**Robustness (no runtime validation needed):** the `wasInBounds` tracker is
**initialized from the actual start position** — `wasInBounds[f] = inBounds(startX,
margin, width)` — not hardcoded `true`. So even a misconfigured `margin` that puts a
start position in the out-zone is treated as "**already out**": no spurious tick-1
crossing, no infinite-reset loop. A fighter only fires jogai on a genuine
in-bounds→out transition.

## Officiating order (B2)

Per tick, after combat resolution + `events.push`:

1. **Yame block first** (existing): fires only on `scored && isNeutral(a) &&
   isNeutral(b)` — gap check / reset. If it reset (or `break`s), jogai is **skipped**
   this tick.
2. **Jogai check** (new, only if the yame block did not reset): edge-detect each
   fighter; on an in-bounds→out crossing, `resetToNeutral` both. **A1 jogai adds no
   points**, so it runs **no `winGap` check** and never sets `endReason` (that arrives
   with A2's penalty).

**Correction to §7a:** the note "a score's yame reset pre-empts a same-tick jogai"
rests on `isNeutral(a) && isNeutral(b)`, which is almost never true when a fighter is
out mid-exchange (the scorer is still in recovery). So in practice **jogai fires
independently**, and a point scored earlier in the exchange **stands** (it was applied
during combat resolution) — a retreating defender can end an exchange after eating a
hit; the hit counts. WKF-consistent (you may step out anytime). `docs/DESIGN.md` §7a
updated to reflect this.

## Acceptance Criteria

- [ ] With `match.jogai.margin` set and no scoring, a fighter that walks from
      in-bounds to `x < margin` (or `x > width − margin`) causes **both** fighters
      to reset to their neutral start (`aStartX`/`bStartX`, `y=0`, neutral, standing,
      guard cleared, windows cleared) on that tick — via the existing `resetToNeutral`.
- [ ] A fighter exactly at `x == margin` (or `x == width − margin`) is **in-bounds**
      (boundary is inclusive of the legal region) — no reset.
- [ ] Single-fire-per-crossing: under full-reset a fighter **cannot** remain out for
      consecutive ticks (the reset pulls it to center the next tick), so single-fire
      follows structurally. The tracker's transition role is proven instead by **re-arm**
      (a later crossing fires again) and **B1** (a fighter that starts/resets out never
      spurious-fires) — there is no reachable multi-tick dwell to test.
- [ ] After a reset (offender back at center = in-bounds), a **later** fresh crossing
      fires again (re-arm).
- [ ] **(B1 robustness)** A `margin` large enough that a start position begins in the
      out-zone does **not** spurious-fire on tick 1 — the fighter is "already out"
      (tracker init from start position) and only fires on a genuine later crossing
      back-out. No infinite-reset loop.
- [ ] Absent `match.jogai`, the fight is **byte-identical** to `main` (fighter walks
      into the wall, clamps at the edge, no reset) — frame-log + result equality.
- [ ] The run is **replay-stable**: same `seed`+config twice ⇒ identical frames.
- [ ] **(S2 both-out)** When A and B cross into the out-zone on the **same** tick,
      exactly **one** `resetToNeutral(both)` occurs (one both-at-start frame), the
      outcome is swap-symmetric, and the loop continues (no double-fire).
- [ ] Swap-symmetric: mirroring A/B produces mirrored frames.

## Test observability & non-interactions (S1 / S3 / N1)

- **S1 — counting resets without a semantic handle.** A1 adds no `penaltyCount` /
  event marker (those are A2). Resets are counted by scanning the frame log for ticks
  (`tick > 0`) where `a.x == aStartX && b.x == bStartX` — in a no-score scenario this
  can only be a jogai reset. One such frame per excursion ⇒ single-fire, re-arm, and
  both-out are all directly assertable. No test-only observability handle is needed.
- **S3 — perception ring buffer untouched.** A1 reuses `resetToNeutral` (`sim.ts:814`),
  which mutates only body fields (`x`, `y`, `state`, `posture`, `guard`, windows) — it
  does **not** touch the per-fighter perception history ring buffer. Consistent with the
  yame precedent ("perception history is not reset"). True by construction; no new code.
- **N1 — entry-transition only.** Jogai fires solely on an in-bounds→out crossing, so a
  fighter that is committed / knocked down (`canAct=0`) while already in the out-zone
  does not re-fire (it can't `move`, and it already crossed on entry). Posture/`canAct`
  are irrelevant to the edge-detect.

## Slices

Every slice follows RED-GREEN-MUTATE-KILL MUTANTS-REFACTOR. No production code
without a failing test. A1 is one coherent behavior ("retreat → reset") and ships as
a **single PR** — its edge cases (inclusive boundary, single-fire, re-arm,
byte-identical-absent, swap-symmetry) are focused tests within the slice, not
separate PRs (they share the same code and the ordering is entangled with the yame
block from the start).

### Slice 1: A fighter walking into the out-zone resets both fighters to center

**Value**: Proves the jogai boundary read + reset path end to end (the spine every
later jogai/passivity slice builds on), and locks the byte-identical-absent guard.
**Actor / Trigger / Outcome**: A retreating fighter (Actor: the bot that walks) →
issues `move` away until `x` crosses `margin` (Trigger) → both bodies snap to their
neutral start on that tick, visible in the frame log (Observable outcome).
**Path**: `FightConfig.match.jogai.margin` → `runFight` per-tick officiating (after
combat resolution + `events.push`) → an `inBounds(x, margin, width)` integer
predicate + a per-fighter `wasInBounds` tracker → on a false→true out transition,
`resetToNeutral(a, aStartX)` / `resetToNeutral(b, bStartX)` + set both trackers
back to in-bounds → next frame shows the reset. Intentionally skipped: penalty,
points, warnings, perception, `endReason`.
**Required implementation skills**: Before code changes, load `tdd`, `testing`,
`mutation-testing`, `refactoring`.
**Acceptance criteria**: the seven criteria above. **Present to human and get
confirmation before writing any code.**
**RED** (behavior-first, mutation-aware — target the mutators likely to survive):
- Primary: mock rules with a known `ring.width`; `match: { winGap: 99, jogai: { margin } }`
  (high `winGap` so nothing ends early); bots scripted so A only ever `move`s away
  (no attacks ⇒ no score ⇒ isolates jogai from yame). Assert: on the tick A's `x`
  first satisfies `x < margin`, the frame shows `a.x == aStartX` **and** `b.x == bStartX`
  (+ neutral/standing). Kills "reset only offender" and "no reset" mutants.
- Inclusive-boundary: a fighter parked exactly at `x == margin` does **not** reset;
  at `margin − 1` it does. Pins `<` vs `<=` and the `margin` literal. Mirror on the
  high side (`width − margin` exact = in; `width − margin + 1` = out) to pin the
  `width − margin` expression and the `||`.
- Single-fire: A stays out three ticks ⇒ exactly one reset (assert the frame the tick
  after entry is already back at center and not re-resetting). Kills dropping the
  `wasInBounds` guard (which would re-fire every dwell tick).
- Re-arm: A walks out (reset), walks back in, walks out again ⇒ second reset fires.
  Kills dropping "set tracker in-bounds after reset".
- B1 robustness: a `margin` that puts `aStartX` in the out-zone ⇒ no reset on tick 1;
  the fight proceeds normally (fighter "already out"). Kills a hardcoded-`true` tracker
  init (which would infinite-reset). Pairs with the compute-from-start-position GREEN.
- Byte-identical-absent: same script with `jogai` omitted ⇒ frame-log + result deep-equal
  to the `main` run (A clamps at the wall, no reset). Kills the `match?.jogai &&` guard mutant.
- Replay-stability: run twice ⇒ identical `events`.
- Both-out (S2): scripts where both A and B walk into their respective out-zones the
  same tick ⇒ exactly one both-at-start frame (one reset), swap-symmetric, loop continues.
- N2 (winGap present, jogai absent): a `match: { winGap }` run with **no** `jogai` key ⇒
  byte-identical to the same run on `main` (the officiating step is gated on `match?.jogai`,
  not on `match` alone) — guards against the jogai check leaking into plain match mode.
- Swap-symmetry: mirror A/B start + scripts ⇒ mirrored frames.
- Score-then-jogai ordering (B2): a scenario where B lands a hit on A (B scores, B now
  in recovery = not neutral) and A is out-of-bounds the same tick ⇒ the yame block does
  NOT fire (B not neutral), jogai fires independently, both reset, and **B's point
  stands** (assert `b.points` unchanged by the reset). Confirms jogai-fires-independently
  + point-stands. Plus a structural guard: in the rare both-neutral+scored+out tick,
  yame resets first and jogai does not double-reset (assert a single reset, loop
  continues, no throw).
**GREEN**: minimal — add the optional `jogai` field to `FightConfig.match`; a pure
`inBounds(x, margin, width)` predicate; two `wasInBounds` booleans **initialized from
the actual start position** (`inBounds(aStartX, …)` / `inBounds(bStartX, …)`, per B1 —
not hardcoded `true`); after the existing yame block, an `if (match?.jogai)` officiating
step that edge-detects each fighter and resets both once on any in-bounds→out crossing
(respecting "at most one reset per tick" — skip if the yame block already reset this
tick). Reuse `resetToNeutral`.
**MUTATE**: run the `mutation-testing` skill on the changed `sim.ts` region; target the
boundary comparisons, the `||`, the `width − margin` arithmetic, the transition guard,
and the `match?.jogai` gate.
**KILL MUTANTS**: add/strengthen tests for any survivor (expect the equivalent-mutant
discussion only on TS-required guards). Changed-line mutation → 100%.
**REFACTOR**: assess extracting `inBounds` / the officiating step for readability;
only if it adds value. Keep the yame + jogai checks a single coherent officiating block.
**Done when**: all acceptance criteria met, mutation report reviewed (changed-line 100%,
overall `sim.ts` ~95%+), typecheck + lint clean, human approves commit.

**MUTATE result (2026-07-01):** scoped Stryker on the changed regions (`sim.ts:896-903`,
`1083-1101`) → **15/16 killed (93.75%)**. The lone survivor is
`if (match?.jogai)` → `if (true)` (1083) — a **documented EQUIVALENT mutant**: when `jogai`
is absent `jogaiMargin` is `undefined`, so `inBounds` returns `true` for everyone → the
crossing condition can never fire and the tracker writes are no-ops, so forcing the gate
`true` changes nothing observable. The gate is a pure skip-work optimization. All
non-equivalent mutants on the changed lines are killed (a transition test —
"fires on a genuine in→out crossing after re-entering" — was added to kill the else-block
survivor, pinning the tracker's out→in→out semantics). Full suite: **760 green**;
typecheck + lint clean. **REFACTOR:** none — the if/else block mirrors the yame block's
style and reads clearly; collapsing it would perturb the mutation surface without a
readability gain.

## Pre-PR Quality Gate

1. `mutation-testing` on the changed `sim.ts` region (`rm -rf .stryker-tmp` first —
   known pollution artifact per project memory).
2. `refactoring` assessment.
3. `npm run typecheck` + `npm run lint` + full `npm test` green.
4. Re-confirm byte-identical-absent + replay-stability tests are in the suite.

## Follow-ups (next stories, already split)

A2 (warning-ladder penalty + shared `penaltyCount`) → A3 (`self`/`opponent.penalties`
reads) → Capability B (passivity, reuses A2's ladder) → Capability C (tie-resolution)
→ D1 benchmark adoption / D2 spec. See `plans/s7-match-remainder-stories.md`.

---
*Delete this file when the plan is complete. If `plans/` is empty, delete the directory.*
