# §7 match-structure remainder — story split

Source design: `docs/DESIGN.md` §7a (grill 2026-07-01). Precedent to mirror:
benchmark match-structure (PRs #87–#93) — additive slices, each byte-identical
when its `match` config key is absent + replay-stable, with downstream
benchmark-adoption + spec-teaching slices.

## Progress

- **A1 — jogai out-zone detection + reset — ✅ DONE** (PR #97, merged 2026-07-01;
  `main`@`30e0288`). Optional `FightConfig.match.jogai.margin` over the unchanged
  hard clamp; on-entry edge-detect (in→out) fires `resetToNeutral(both)`; `wasInBounds`
  trackers re-armed post-reset (+ robust B1 init from start position); yame pre-empts
  jogai same-tick, a prior score stands. Byte-identical absent `match.jogai`, replay-stable,
  swap-symmetric. NO penalty/points/perception yet. Single-slice plan file deleted (record
  in git/PR #97).
- **A2 — jogai warning-ladder penalty — ⏭ NEXT.**

## Parent

**Actor:** the match officiating layer that scores an LLM-authored bot (and,
downstream, the frozen benchmark that ranks it).
**Capability:** complete WKF match officiating beyond yame + `winGap` — penalize
**retreat** (jogai), penalize **non-engagement** (passivity), and **decisively
resolve level bouts** (senshu + overtime).
**Outcome:** match outcomes reward genuine WKF engagement — no cornering-to-safety,
no far-apart stalling, no unresolved draws — so the benchmark measures real
fighting skill, not clock-farming.
**Current constraint:** three distinct mechanics, each with its own state,
perception surface, and downstream benchmark/spec adoption — far too large for one
PR. Every slice must stay byte-identical when its `match` key is absent
(`Rules`/`CANONICAL_RULES`/`npm run fight` untouched) and hold the invariants
(determinism, integer-only outcome math, DSL-as-data TCB, same pre-tick snapshot).

Each child story is a thin end-to-end capability: a rule that changes an
observable fight outcome, demonstrable by a `runFight` test, byte-identical absent
its config key.

## Recommended First Slice

**A1 — a fighter that retreats into the out-zone triggers a yame reset back to
center** (boundary geometry + on-entry edge-detect + reset; no penalty yet).

Why this first: it burns the single biggest *architecture risk* of the whole
feature — reading a new officiating boundary (`[margin, width−margin]`) over the
existing hard positional clamp and firing the reset path — as a clean tracer,
independent of the penalty ladder. End-to-end and demonstrable; every later jogai
and passivity slice builds on this reset/edge-detect spine.

## Split Candidates

### Capability A — Jogai (ring-out penalty)

| Slice | Value | Includes | Defers | Acceptance Examples | Release |
|---|---|---|---|---|---|
| **A1** out-zone detection + reset | Proves the boundary read + reset spine; de-risks geometry | `match.jogai.margin`; legal `[margin, width−margin]`; on-entry edge-detect (in-bounds→out); `resetToNeutral` both; `was-in-bounds` tracker set true post-reset | Penalty, points, warnings, perception | Given `margin` set, When A walks past `margin`, Then both reset to start that tick (points unchanged). Given absent `match.jogai`, Then byte-identical replay | Shippable (inert without config) |
| **A2** warning-ladder penalty | The jogai *value*: retreat costs points | Shared per-fighter `penaltyCount` (generic, reused by passivity); 1st foul free, 2+ ⇒ opponent +1 → existing `winGap`; `winGap` re-check at the jogai boundary (endReason `"gap"`); jogai `FightEvent` | Perception fields | Given A's 1st out-zone entry, Then warning only (0 pts). Given A's 2nd, Then B +1 pt + reset. Given enough retreats, Then B wins on `winGap` | Shippable |
| **A3** penalty perception | Bots can read the shared warning count | `self.penalties` + `opponent.penalties` (live scoreboard `FIELD_READERS`, like `opponent.points`); interpreter stays 100% | Passivity/senshu reads | Given A has 1 warning, Then A's bot reads `self.penalties==1` and B reads `opponent.penalties==1` | Shippable |

### Capability B — Passivity (non-engagement penalty) — reuses A2's ladder

| Slice | Value | Includes | Defers | Acceptance Examples | Release |
|---|---|---|---|---|---|
| **B1** clock + reset-on-contact + re-engage reset | Proves the anti-stall metric (the subtle part) | Per-fighter `ticksSinceOffense`; reset **only on contact** (hit/block/parry/grab/sweep-connect — whiff at air does NOT reset); exceed `match.passivity.limit` ⇒ `resetToNeutral` both + reset both clocks | Penalty, perception | Given two far-apart idle bots, When neither connects for `limit` ticks, Then both reset to `startGap`. Given a whiff-at-air spammer, Then it still goes passive (whiff didn't reset) | Shippable (inert without config) |
| **B2** passivity feeds shared ladder | Non-engagement costs points | Passivity `++` on the shared `penaltyCount` (shares the free first warning with jogai); opponent +1 after free; `winGap` re-check; `FightEvent` | — | Given B's clock hits `limit` twice, Then A +1 pt the 2nd time. Given one jogai already used the free warning, Then the next passivity immediately costs a point | Shippable |
| **B3** self passivity clock read (live) | Bot times its forced engagement | `self.passivityRemaining` (live `FIELD_READER`) | Opponent read | Given `limit` and elapsed ticks, Then `self.passivityRemaining` counts down and a bot commits contact just in time to avoid the foul | Shippable |
| **B4** opponent passivity read (delayed) | Bait the forced commit | `opponent.passivityRemaining` on the `L_act` layer (ring-buffer served, like `opponent.stamina` in C10 S4) | — | Given B is 3 ticks from passive, Then A perceives `opponent.passivityRemaining==3+jitter` on the delayed layer and can prep a counter | Shippable |

### Capability C — Tie resolution (senshu + overtime)

| Slice | Value | Includes | Defers | Acceptance Examples | Release |
|---|---|---|---|---|---|
| **C1** senshu first-blood tiebreak | Fixes the real `"draw"` gap cheaply (a bargain) | First-blood latch (first scorer holds senshu; simultaneous ⇒ none); at cap, level ⇒ winner = senshu-holder, endReason `"senshu"`; no senshu ⇒ `"draw"`. Config toggle under `match` | Overtime, perception | Given a 4-4 bout where A scored first, Then A wins, endReason `"senshu"`. Given 0-0 all bout, Then `"draw"` | Shippable (inert without config) |
| **C2** sudden-death overtime | Decisive resolution before falling to senshu | On level at cap: `resetToNeutral` both (points/stamina/mem persist), first fighter to gap ≥ 1 wins immediately, same-tick trade stays level, `match.overtimeTicks` cap ⇒ fall to C1's senshu; jogai/passivity live in OT; endReason `"overtime"` | — | Given level at cap, When A scores first in OT, Then A wins, endReason `"overtime"`. Given OT elapses scoreless, Then senshu (C1) decides | Shippable |
| **C3** senshu perception | Late-bout tiebreak strategy | `self.senshu` + `opponent.senshu` (live 1/0 scoreboard `FIELD_READERS`) | — | Given A holds senshu, Then A reads `self.senshu==1`, B reads `opponent.senshu==1` | Shippable |
| **C4** overtime perception | Play-safe vs all-in in sudden death | `clock.overtime` (live 1/0) — could ride C2 | — | Given the bout is in OT, Then both bots read `clock.overtime==1` | Shippable (may fold into C2) |

### Capability D — Downstream adoption (per the precedent; after the mechanics land)

| Slice | Value | Includes | Defers | Acceptance Examples | Release |
|---|---|---|---|---|---|
| **D1** benchmark adopts full officiating | The frozen gauntlet scores under jogai/passivity/tie-res | Fold new `match` config into the benchmark `MATCH` constant + `INPUT_HASH`; bump `BENCHMARK_VERSION`; re-characterize the gauntlet + `docs/benchmark-gauntlet-vN.md` | A possible rebalance (see Parking Lot) | Given the benchmark config change, Then `INPUT_HASH` guard test forces a version bump; the gauntlet is re-characterized in a note | Shippable |
| **D2** spec teaches the new rules | LLM authors know the officiating | Extend `generateSpec(rules, match)` to teach jogai margin/penalty, the passivity engagement rule, senshu/OT + corrected win/draw semantics; drift-test the regenerated `docs/spec.md` | — | Given the generator change, Then `docs/spec.md` documents jogai/passivity/tie-break and the byte-match drift test passes | Shippable |

## Parking Lot

- **Bargain — C1 (senshu) could jump the queue.** It's a tiny latch that
  immediately fixes the benchmark's `"draw"` gap, fully independent of jogai/
  passivity. If a quick decisive-outcomes win is wanted before the (larger)
  spatial/anti-stall work, plan C1 first. (Default keeps the grill's jogai-first
  sequence, which tackles the distinctive spatial mechanic + the original
  stall motivation.)
- **A1/A2 may merge** into one penalty-bearing jogai PR if the team prefers not to
  ship a consequence-free reset intermediate. Kept split to de-risk geometry alone.
- **C4 may fold into C2** (expose `clock.overtime` where OT is introduced).
- **D1 may split per capability** (adopt+re-characterize after jogai, then
  passivity, then tie-res) rather than one consolidated adoption — safer if any
  single mechanic swings the gauntlet hard.
- **Possible gauntlet rebalance follow-up** (like the match-structure sweeper
  de-wall / the still-open `vulture` parry→counter story): jogai caps the zoner/
  turtle escape space and passivity taxes patient counter-play — the `zoner` and
  `vulture` archetypes will feel these most, so expect a re-tune candidate.
- **Ladder constants** (1 free warning, +1 pt/foul) are fixed for the first pass;
  parameterize under `match` only if tuning demands it.
- **`opponent.penalties`** in A3 is a live scoreboard read (zero-delay, like
  `opponent.points`) — confirm it should NOT ride the `L_act` layer (penalties are
  public scoreboard facts, so live is correct).

## Warnings

- Keep the officiating **per-tick order** explicit (design §7a): resolve combat →
  update clocks → `events.push` → apply all triggered penalties (commutative
  per-fighter) → **at most one** `resetToNeutral(both)` → one `winGap` check. A
  same-tick score's yame reset pre-empts jogai. This ordering is the swap-symmetry
  contract — every slice touching officiating needs a swap-symmetry test.
- These are **not** component slices — resist a "detect out-of-bounds" /
  "apply penalty" / "expose field" horizontal read across all three capabilities.
  Each row above is a whole observable rule change with a `runFight` acceptance test.
- Replay-stability + byte-identical-absent must be re-proven per slice (the
  precedent's discipline), plus mutation on the changed `sim.ts`/`dsl.ts`/
  `gen-spec.ts` regions.

## A2 — resolved decisions & acceptance criteria (find-gaps 2026-07-02)

Confirmed before planning A2 (jogai warning-ladder penalty). Feeds `planning` directly.

**Observability contract (decision):** penalties are observed **via `points` + reset only** — a
paid foul shows as the opponent's `points` / `scores` / `winner` / `endReason`; a free warning
shows as a `resetToNeutral` with **no** point delta. **No** new `FightEvent` / `FightResult` field
this slice (stays byte-identical; all penalty surfacing waits for A3's DSL reads). "jogai
`FightEvent`" in the table = the existing per-tick frame, not a new event type.

**Acceptance criteria (design-resolved, §7a):**

- **AC-1 — free first foul.** Given `match.jogai.margin` set and a fighter on its 1st out-zone
  crossing of the bout, When it crosses in→out, Then both reset to start, that fighter's
  `penaltyCount` = 1, and **neither** fighter's `points` change (warning only).
- **AC-2 — 2nd+ foul scores the opponent.** Given a fighter on its 2nd (or later) crossing, When it
  crosses out, Then its **opponent** gains +1 point and both reset. (The point appears in the
  **next** tick's frame — awarded after `events.push`, per A1's reset precedent.)
- **AC-3 — penalty can end the match.** Given enough retreats that a jogai +1 makes the gap reach
  `winGap`, Then the fight ends that tick, `endReason "gap"`, winner = the leading fighter. (winGap
  re-checked inside the jogai block after the award; mutually exclusive with the yame block's check
  ⇒ at most one per tick.)
- **AC-4 — per-fighter counters, bout-persistent.** Each fighter has its own `penaltyCount` (generic
  name — passivity B2 will share it); it persists across every yame/jogai reset (like `points`),
  never reset mid-bout.
- **AC-5 — both-out same tick.** Given both fighters cross out on the same tick, Then each fighter's
  OWN foul history decides whether ITS opponent scores (both past the free warning ⇒ mutual +1,
  net-zero gap; one still on its free warning ⇒ only the other opponent scores), with a **single**
  reset and no spurious early-stop. (Swap-symmetric.)
- **AC-6 — yame pre-empts jogai.** Given the rare both-neutral + scored + out tick, Then the yame
  block resets first (snapping the offender in-bounds), so jogai does **not** fire ⇒ **no** penalty
  awarded, single reset.
- **AC-7 — byte-identical absent config.** Given `match.jogai` absent, Then replay is byte-identical
  to pre-A2 (the new `penaltyCount` field is never touched and never enters a frame). Given
  `match.jogai` present, replay is stable and swap-symmetric.

**Implementation notes (not user-facing):** award inline in the jogai block; field named
`penaltyCount` (generic) but extract a shared award helper only when passivity (B2) arrives (YAGNI).
Ladder constants (1 free warning, +1 pt/foul) hardcoded — `margin` stays the only `jogai` config. A1
tests that cross ≥2 times and asserted "points unchanged" get updated (the 2nd crossing now scores).

## Next Step

A1 is DONE (see Progress). Plan **A2 — jogai warning-ladder penalty** with `planning`:
shared per-fighter `penaltyCount` (generic, reused later by passivity); 1st out-zone
foul is a free warning, 2+ ⇒ opponent **+1 point** feeding the existing `winGap`
(endReason `"gap"`); `winGap` re-checked at the jogai boundary; a jogai `FightEvent`.
Defers perception (`self`/`opponent.penalties` → A3). Optionally run `find-gaps` on
the A2 plan first. Each planned implementation slice must run the full
RED-GREEN-MUTATE-KILL MUTANTS-REFACTOR cycle (`tdd` + `testing` +
`mutation-testing` + `refactoring`) before code changes.
