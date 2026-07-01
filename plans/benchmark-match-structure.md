# Plan: WKF match structure for the benchmark (§7 — yame + win condition)

**Branch**: one branch per slice (`feat/match-*`). This plan file + the Slice-7-done edit
to `plans/llm-benchmark-v1.md` landed via `feat/benchmark-match-structure` (PR #87, merged).
**Status**: Active — **Slice 1 ✅ (PR #88, merged), Slice 2 ✅ (PR #89). NEXT: Slice 3** (benchmark
adopts match mode + win-rate aggregation + `v2`/hash).

## Goal

Make a benchmark fight a real **WKF match** — ends at an **8-point gap** (else most points at
the 600-tick cap), with **_yame_ resets to neutral** between exchanges — so the score ranks
**who wins matches**, not who farms the most raw points over 600 ticks.

## Why (the follow-up this resolves)

The `llm-benchmark-v1` dogfood proved the spec sufficient but exposed two **Slice-1**
distortions that make the v1 score untrustworthy as a model ranking:

- **Metric**: `runFight` scores **raw cumulative points over 600 ticks with no match-cap**, so
  the score rewards relentless okizeme-looping over _winning_.
- **Gauntlet**: a 100%-win `sweeper` wall (+4664) collapses the spread (even member `jabber`
  goes 0-wins) — but that evidence is **under the old metric**.

This plan builds the design's already-locked §7 match structure (the roadmap's "match
structure" capability, pulled forward) to fix the metric, then **re-measures** the gauntlet
under the new metric before deciding any rebalance.

## Resolved design decisions (grill-me, 2026-07-01)

| #   | Decision         | Resolution                                                                                                                                                                     |
| --- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Q1  | Primary measure  | **WKF match outcomes** (not raw point accumulation)                                                                                                                            |
| Q2  | Scope            | **Build §7 match structure** with yame resets (not a CLI-layer shim)                                                                                                           |
| Q3  | §7 boundary      | **Yame + win condition only** — NO jogai / passivity (separate later slice)                                                                                                    |
| Q4  | Yame trigger     | A score happened this exchange **AND** both fighters back to neutral: `state.kind==="neutral" && counterRemaining===0 && cancelRemaining===0`                                  |
| Q5  | Yame persistence | Only the **body** resets (position → start gap, `y=0`, state→neutral, posture→standing, clear guardBand/guardAge/counter/cancel windows). **points, stamina, mem all PERSIST** |
| Q6  | Win condition    | **gap 8 / cap 600** (design values); gap checked **at yame**; equal points at the cap = **draw**                                                                               |
| Q7  | Switch           | One optional `runFight` cfg param **`match?: { winGap: number }`** enabling yame + early-stop together; absent ⇒ **byte-identical**; **NOT** in `Rules`/`CANONICAL_RULES`      |
| Q8  | Aggregation      | **win-rate primary**, Σ net-points (now bounded) **tiebreaker**; swap `compareSubmission` keys + the report headline                                                           |
| Q9  | Gauntlet         | **Measure-then-decide** — re-measure under match mode, rebalance only if still lopsided, preferring **rules tuning over roster swap**                                          |

### Flagged in-slice sub-decisions (resolve during TDD, not blocking)

- **Perception history is NOT reset at yame** (lean): perception is a continuous timeline, so for
  `L` ticks after a reset a fighter briefly perceives the opponent's pre-reset position — a
  bounded, deterministic, symmetric "ghost" — avoiding special-case fallback in the perception
  path. Confirm with a behavior test in Slice 2.
- **`FightResult.ticks`** = the **count of ticks executed** (a full fight = `maxTicks`; an early
  stop after executing tick index _t_ = `t+1`). Absent `match` ⇒ always `maxTicks`.
- **`FightResult` gains `endReason: "gap" | "time"`** (additive). `"gap"` = ended early on the
  8-point gap; `"time"` = ran to the cap and decided by most-points (or `draw`). Robust even when
  the gap is reached on the final tick (not derived from `ticks`). Absent `match` ⇒ always
  `"time"`. Slice 4's measurement counts gap-wins vs time-decisions from this field. (Adding the
  field updates a few `FightResult`-shape assertions; the fight simulation — `events`/`scores`/
  replay — is unaffected, so the byte-identical determinism property holds.)
- **No new DSL surface this feature.** Existing `self.points` / `opponent.points` /
  `clock.ticksRemaining` already let a bot reason about the score gap and match clock. The
  `dsl.ts` TCB allowlists are **untouched**.
- **Optional `yame` `FightEvent`** for the viewer/telemetry is **deferred** (the per-tick score
  trajectory in `events` already shows where exchanges resolved).
- **`winGap` is a scoring input** ⇒ it enters the manifest's hashed `INPUT_HASH` and forces a
  `BENCHMARK_VERSION` bump (Slice 3).

### Non-negotiable invariants (every slice)

1. **Determinism**: integer-only outcome path; the yame reset uses fixed reset values, the gap
   check is an integer comparison, early-termination just stops the loop — all replay-stable. No
   `Math.random` / `Date.now`. The single seeded PRNG is unchanged (yame consumes **no** draws;
   jitter still draws per-tick in the fixed A,B order).
2. **TCB**: `src/engine/dsl.ts` allowlists are the security boundary — **unchanged** (no new DSL
   op/field/reader this feature).
3. **Bounded docs**: unchanged (no DSL grammar change).
4. **Byte-identical absent-feature path**: absent `match` ⇒ the engine, `npm run fight`, and the
   whole existing suite are byte-identical. Proven by the existing determinism/replay tests.

## Acceptance Criteria (whole feature)

- [x] `runFight({ ..., match: { winGap: 8 } })` ends a fight when `|a.points − b.points| ≥ 8` with the
      leader as `winner` and `ticks` = the actual end tick; absent `match` ⇒ **byte-identical** (runs
      all `maxTicks`, `ticks === maxTicks`). _(Slice 1 — PR #88; Slice 2 moved the gap check to the
      yame boundary.)_
- [x] In match mode, after a scored exchange fully resolves (both fighters neutral, no open
      windows) the engine performs **yame**: bodies reset to the neutral start (positions, state,
      posture, guard, windows) while **points, stamina, and mem persist**; a fight can run multiple
      exchanges, and the 8-gap check fires **at the yame boundary** (an in-progress combo is never
      amputated). _(Slice 2 — PR #89.)_
- [ ] `npm run benchmark -- <bot.json>` fights **WKF matches** against the gauntlet, ranks by
      **win-rate (primary) then Σ net-points (tiebreaker)**, leads the report headline with
      win-rate, and reports `BENCHMARK_VERSION` `v2` with a matching `INPUT_HASH`.
- [ ] `compareSubmission` ranks scored submissions by **win-rate then net-points** (invalids still
      hard-zero-distinct, last).
- [ ] The gauntlet is **re-measured under match mode** (per-member win-rates captured) and the
      dogfood bot is **re-evaluated** under match mode, with the result characterized in a test.
- [ ] `docs/spec.md` **teaches match mode** (the 8-gap/time win condition + yame), generated from
      the manifest/rules, drift-tested.
- [ ] _(Conditional)_ If measurement still shows a bot too dominant, a **data-driven rebalance**
      (rules tuning preferred) lands with its own version bump.
- [ ] **Feature success metric** (definition of done): the benchmark score ranks by **match wins**
      — a bot can no longer out-rank by farming raw points (proven by bounded net-points + the
      re-dogfood in Slice 4) — **and** every gauntlet member's round-robin win-rate sits within the
      confirmed band (Slice 4 measurement, after Slice 6 if it was triggered). Only when **both**
      hold is the v1 score a trustworthy model ranking and the feature complete.

## Slices

Every slice follows RED-GREEN-MUTATE-KILL MUTANTS-REFACTOR. No production code without a failing
test. Read `.claude/CLAUDE.md` + the testing rules before each slice. Tests are vitest unit tests
for engine/aggregation/CLI logic — no browser/Playwright (no UI in v1).

**Test fixtures (Slices 1–2)**: drive the yame / match-end tests with **minimal hand-built mock
rules + bots and perception OFF** (`perception` absent ⇒ `lPos=lAct=jitter=0`, a single cheap
scoring move — the `run-benchmark.test.ts` `MOCK_RULES` `gyaku-zuki` is the model), so the scoring
ticks are **hand-predictable** and assertions are exact (e.g. "A scores at tick N, the gap reaches
8 at tick M"). Do **not** use `CANONICAL_RULES` for these — its jitter/perception make outcomes
deterministic-per-seed but not hand-predictable. Reserve `CANONICAL_RULES` for the slices that are
specifically about canonical behavior (Slice 3 manifest wiring, Slice 4 measurement).

---

### Slice 1: A fight ends at an 8-point gap — `match.winGap` early-stop (walking skeleton) — ✅ DONE (PR #88, merged)

_Shipped `FightConfig.match?: { winGap }` + `FightResult.endReason: "gap"|"time"` + `ticks` = executed;
`Math.abs` gap so either fighter triggers; even trade → gap 0 → runs to cap. Absent `match` ⇒
byte-identical. 718 tests; changed-line mutation 100% (22/22 — a trade fixture killed the `a−b`→`a+b`
survivor)._

**Value**: The benchmark operator / fight runner gets a fight that **ends when someone is ahead by
the win gap** — the thinnest end-to-end match outcome, and on its own it already bounds the
okizeme runaway (a +4664 brawl becomes a bounded early win).
**Actor / Trigger / Outcome**: `runFight` caller passes `match: { winGap }`; the fight loop
terminates early the first tick `|a.points − b.points| ≥ winGap`; `FightResult` reports the leader
as `winner` and the **actual end tick** in `ticks`.
**Path**: `FightConfig` gains optional `match?: { winGap: number }` → the `runFight` loop checks
the gap at the **end of each tick** (after resolution/advance) and `break`s when reached → `winner`
= the leader at the stop tick, `ticks` = count of ticks executed, `endReason` = `"gap"`. Absent
`match` ⇒ no check, runs all `maxTicks`, `ticks === maxTicks`, `endReason === "time"`
(byte-identical). _(Intentionally skipped here: yame resets — Slice 2; the gap check relocates to
the yame boundary there.)_
**Required implementation skills**: `tdd`, `testing`, `mutation-testing`, `refactoring`.
**Acceptance criteria**:

- With `match: { winGap: 8 }` and a fixture where A out-scores B, the fight ends the tick the gap
  first reaches 8: `winner === "A"`, `endReason === "gap"`, `ticks` < `maxTicks`,
  `scores.a − scores.b === 8` (or the first crossing value ≥ 8 if a single technique jumps it, e.g.
  a 3-point throw).
- A symmetric/low-scoring fixture that never reaches the gap runs to `maxTicks`: `endReason ===
"time"`, `ticks === maxTicks`, `winner` = most-points-at-cap (existing rule), equal = `draw`.
- **Absent `match`** ⇒ byte-identical: an existing replay/fight fixture produces identical
  `events`/`scores`/`ticks` (the determinism suite stays green unchanged).
- **Match mode is replay-stable**: the same `(bot, opponent, seed, match)` produces an identical
  `FightResult` (`winner`/`ticks`/`endReason`/`scores`/`events`) across repeat runs — the
  pure-function property the benchmark depends on (early-termination + the gap check consume no
  PRNG draws; jitter still draws per-tick in the fixed A,B order up to the stop tick).
  **RED**: a `sim`/`runFight` test for (a) early-stop at the gap with correct winner + end tick, (b)
  no-gap → time-cap path, (c) a `match`-absent byte-identical assertion. Mutator watch: the gap
  comparison (`>=` vs `>`, the subtraction direction, `Math.abs` on the gap), the loop-`break`
  placement, and `ticks = tick` vs `maxTicks`.
  **GREEN**: add `match?` to `FightConfig`; compute `gap = Math.abs(a.points − b.points)`; after the
  per-tick advance, `if (match && gap >= match.winGap) break;`; set `ticks`/`winner` from the stop
  state.
  **MUTATE**: Stryker on the changed `sim.ts` lines (the gap check + winner/ticks).
  **KILL MUTANTS**: cover the boundary (gap exactly 8 ends; 7 does not), the winner direction, and
  the absent-match no-op.
  **REFACTOR**: assess a small `decideWinner(a, b)` helper (the winner expression is now used at the
  break and at the cap).
  **Done when**: ACs met, absent-match byte-identical proven, human approves commit.

---

### Slice 2: Exchanges reset to neutral — yame, with the gap checked at the yame boundary — ✅ DONE (PR #89)

_Shipped the end-of-tick yame block: `scored` flag + `isNeutral(a)&&isNeutral(b)` predicate → gap check
at that boundary (relocated from Slice 1's per-tick stop ⇒ combo not amputated) → `resetToNeutral` both
bodies + clear `scored`. points/stamina/mem persist; perception history not reset; scoreless stretch ⇒
no reset. Slice-1 gap tests moved 89→96. Feat + a refactor sharing the start-gap layout between spawn &
reset (killed an equivalent `"A"|"B"` string mutant + DRY). 724 tests; changed-line mutation 100%
(26/26). The `counterRemaining`/`cancelRemaining` conjuncts are killed by their `=== 0`→`!== 0` mutants
(isNeutral never fires ⇒ visible-reset fails); the perception-ghost (`L>0`) characterization rides a
later slice (fixtures here keep perception OFF for hand-predictability)._

**Value**: The fight becomes a **sequence of clean exchanges** — after a scored exchange fully
resolves, both fighters reset to the neutral start (points/stamina/mem persist) and re-engage —
denying the free okizeme loop, and the 8-gap check now fires at yame so an in-progress combo
completes first.
**Actor / Trigger / Outcome**: in `match` mode, when a score has occurred this exchange and both
fighters are neutral with no open windows, the engine performs yame at end of tick: bodies reset,
the win-gap is evaluated, the fight continues (or ends).
**Path**: track a per-exchange `scored` flag (set when either `points` increases this tick) → at
end of tick, if `scored && both neutral (state.kind==="neutral" && counterRemaining===0 &&
cancelRemaining===0)` → **yame**: evaluate the 8-gap (relocated from Slice 1's per-tick check);
if not ended, reset each fighter's body to the neutral start and clear the `scored` flag.
**points, stamina, mem persist.** Perception history buffers are **NOT** reset (continuous
timeline). Absent `match` ⇒ no yame (byte-identical).

**Reset target (fixed original starts)**: each fighter resets to its **canonical opening x** — A →
`Math.trunc((ring.width − startGap)/2)` (left), B → `Math.trunc((ring.width + startGap)/2)` (right)
— **regardless of current side**. Fighters can cross (movement only clamps `x` to `[0, ring.width]`
— there is no anti-crossing/collision), so a crossed-over fighter snaps back across the opponent;
this is cosmetic (no collision, and `facing` is auto-recomputed from positions at the top of every
tick, so it needs **no** explicit reset). Reuse the `runFight` init expressions (the
`resetToNeutral` helper). The full body reset is: `x` ← canonical start, `y=0`, `state` ←
`{kind:"neutral"}`, `posture` ← `"standing"`, `guardBand` ← `null`, `guardAge=0`,
`counterRemaining=0`, `cancelRemaining=0`.

**Tick-pipeline ordering**: the yame check + reset run at the **very end of the tick, AFTER
`events.push`** — so the yame tick's recorded `events` frame shows the exchange's resolved end-of-
exchange positions (matching the actions taken that tick), and the reset is observed as the **next**
frame starting at neutral. (Within the tick the order is: intake → compute → apply → regen → advance
→ window decrement → `events.push` → **yame check/reset**.)

**Scoreless exchanges do not reset**: a tick sequence with no point scored (whiffs / blocks /
parries / mutual knockdown) leaves the `scored` flag false ⇒ **no yame**. Fighters continue from
their current positions, stamina, and windows — only a **scoring** exchange resets. So between
scores the fight evolves continuously (this is the design's "yame after a scoring technique").
**Required implementation skills**: `tdd`, `testing`, `mutation-testing`, `refactoring`.
**Acceptance criteria**:

- After a fixture's first scored exchange resolves to both-neutral, the next tick's fighter
  positions equal the **start-gap** positions and move-state is neutral — i.e. a visible reset —
  while `points` carry the accumulated score.
- **Stamina + mem persist across yame**: a fixture that spends stamina before the reset shows the
  post-reset `stamina` continuing from the pre-reset value (not refilled to max); a `mem` cell set
  before yame still reads after it.
- **Combo not amputated**: a fixture where a cancel/okizeme combo would push the gap ≥ 8
  mid-exchange ends the match **after** the exchange resolves (at yame), not mid-combo (contrast
  with Slice 1's per-tick stop).
- **Yame trigger precision**: no yame on a tick where a window is still open or a fighter is downed
  (the exchange isn't resolved); yame fires the first tick both are fully neutral after a score.
- **Bounded/terminating**: a fixture proves the fight always reaches a yame or the cap (no infinite
  exchange).
- **Absent `match`** ⇒ byte-identical (no reset path executes).
  **RED**: tests for (a) the reset-to-neutral snapshot + persistence of points/stamina/mem, (b) the
  trigger predicate (open window / downed ⇒ no yame; both-neutral-after-score ⇒ yame), (c) combo-not-
  amputated (gap check at yame), (d) the perception "no-reset" ghost behavior (a post-reset
  perceived position reflects the continuous timeline), (e) absent-match byte-identical. Mutator
  watch: the `scored` flag set/clear, each conjunct of the neutral predicate (`counterRemaining===0`,
  `cancelRemaining===0`, `state.kind` check), the reset field values, and the persist-vs-reset choice
  for stamina/mem.
  **GREEN**: add the `scored` tracking + the end-of-tick yame block (predicate, gap check, body
  reset); relocate the gap check from Slice 1's per-tick spot into the yame block.
  **MUTATE**: Stryker on the yame block + the relocated gap check.
  **KILL MUTANTS**: cover each predicate conjunct, each reset field, and the persistence of
  stamina/mem.
  **REFACTOR**: assess a `resetToNeutral(f, rules, side)` helper reusing the `runFight` init values
  (DRY with the fighter construction at the top of `runFight`).
  **Done when**: ACs met, perception-ghost decision confirmed by a test, byte-identical absent path
  proven, human approves commit.

---

### Slice 3: The benchmark fights WKF matches and ranks by win-rate

**Value**: `npm run benchmark` now scores **match outcomes** — fights end on the 8-gap, the
ranking leads with win-rate, and the version/hash reflect the new scoring inputs so old and new
scores aren't silently compared.
**Actor / Trigger / Outcome**: operator runs `npm run benchmark -- <bot.json>` → matches end early
on the gap, the report headline leads with **win-rate** (net-points demoted to tiebreaker), header
shows `v2`.
**Path**: `benchmark-config.ts` adds `MATCH = { winGap: 8 }`, folds it into `INPUT_HASH`, bumps
`BENCHMARK_VERSION` → `v2` → `benchmark.ts` `BenchmarkConfig` gains `match`, `playBothSides` passes
it to `runFight` → `compareSubmission` (submission.ts) swaps to **win-rate then net-points** → the
report headline (run-benchmark.ts) leads with win-rate → the thin CLI shell passes `MATCH` into the
config.
**Required implementation skills**: `tdd`, `testing`, `mutation-testing`, `refactoring`,
`cli-design`.
**Acceptance criteria**:

- The aggregator runs each (opponent × seed × side) fight with `match: { winGap: 8 }`; a fixture
  shows fights ending early (per-opponent `fights` unchanged, but outcomes are now match
  win/loss/draw).
- `compareSubmission` orders two scored submissions by **win-rate first, net-points second**
  (a higher-win-rate / lower-net bot outranks a lower-win-rate / higher-net bot); invalids remain
  last (hard-zero-distinct, unchanged).
- The report headline leads with win-rate as the primary figure (exact-string CLI test updated);
  the per-opponent W/L/D/net table shape is unchanged.
- `BENCHMARK_VERSION === "v2"`; the `INPUT_HASH` guard test recomputes to include `MATCH` and
  passes; the spec/header surfaces `v2`.
- Determinism: repeat runs are byte-stable.
  **RED**: aggregator test (fights run in match mode; a known fixture yields known win-rate +
  bounded net); `compareSubmission` key-swap test (the sort-order proof updates); CLI headline
  exact-string test; the `INPUT_HASH`/version guard test. Mutator watch: the comparator key order,
  the win-rate-vs-net precedence, the manifest hash inputs, threading `match` into `runFight`.
  **GREEN**: add `MATCH` + new hash/version to the manifest; thread `match` through
  `BenchmarkConfig`/`playBothSides`; swap `compareSubmission` keys; reorder the report headline; pass
  `MATCH` in the CLI shell.
  **MUTATE**: Stryker on `benchmark-config.ts`, `submission.ts`, the changed `benchmark.ts` /
  `run-benchmark.ts` lines.
  **KILL MUTANTS**: cover the comparator order both ways, the hash-input inclusion of `MATCH`, and
  the headline ordering.
  **REFACTOR**: assess sharing the win-rate/net comparator between `benchmark.ts` and `submission.ts`.
  **Done when**: ACs met, version/hash bumped + guard green, human approves commit.

---

### Slice 4: Re-measure the gauntlet under match mode + re-dogfood

**Value**: We learn whether the metric change **already fixed** the gauntlet spread (the +4664
evidence is stale), producing the data that drives the conditional rebalance — and the dogfood bot
gets an honest re-read under the real metric.
**Actor / Trigger / Outcome**: the benchmark is run for each gauntlet archetype as the submitted
bot; per-member win-rates are captured; the dogfood characterization test is updated to the
match-mode outcome.
**Path**: run `npm run benchmark` against each of the 6 members (and the dogfood bot) under match
mode → capture the per-member win-rates into a committed measurement note + the PR description →
update `src/cli/dogfood.test.ts` to assert the bot's **match-mode** result (pass/characterized).
**Required implementation skills**: `tdd`, `testing` (characterization), `mutation-testing` (for
the dogfood test).
**Acceptance criteria**:

- `dogfood.test.ts` asserts the dogfood bot's outcome **under match mode** (the prior raw-600-tick
  `−2682` near-miss assertion is replaced by the match-mode win/loss/draw + bounded net); the test
  is green and documents the new behavior.
- A measurement note (committed markdown under `docs/` or captured in the PR description) records,
  for each gauntlet member as a submitted bot, its **match-mode round-robin win-rate** vs the
  others (both sides, all seeds) — and applies **Slice 6's both-tails band** (`[25%, 75%]`
  provisional): the note explicitly states, per member, whether it is inside the band, and
  concludes a **rebalance go/no-go** (skip Slice 6 iff every member is inside the band).
- **No engine/aggregation production code changes** (pure measurement + a characterization-test
  update) — this slice does not alter outcomes.
  **RED**: the updated `dogfood.test.ts` asserting the match-mode result (fails against the old
  raw-points assertion until updated). Mutator watch: n/a beyond the dogfood assertion (no new prod
  logic).
  **GREEN**: regenerate the dogfood result under match mode; update the assertion; write the
  measurement note.
  **MUTATE**: Stryker scope limited (no new prod logic; the dogfood test's own assertions are the
  artifact).
  **KILL MUTANTS**: n/a (measurement slice).
  **REFACTOR**: none.
  **Done when**: dogfood re-characterized, per-member win-rates captured, a **rebalance go/no-go
  recommendation** written into the PR description (feeds Slice 6), human approves commit.

---

### Slice 5: `docs/spec.md` teaches match mode

**Value**: The one-shot spec instrument tells the LLM it is authoring for a **WKF match** (play to
the 8-gap / clock, exchanges reset at yame) — without it, a model optimizes for the wrong (raw-
points) objective.
**Actor / Trigger / Outcome**: `npm run gen:spec` regenerates `docs/spec.md` with a match-mode
description; the drift test stays green.
**Path**: `gen-spec.ts` benchmark-rules section gains the **win condition** (gap 8 / cap 600, from
the manifest) + a **yame** description; the strategic primer notes playing to the gap/clock and
that exchanges reset to neutral with stamina/score persisting → regenerate `docs/spec.md` → the
Slice-5a drift test transitively covers it. **Keep the existing `docs/spec.md` LF pin
(`.gitattributes` + `.prettierignore`) intact** so the drift test stays stable on Windows
(`core.autocrlf` would otherwise CRLF the regenerated file and break the byte-match).
**Required implementation skills**: `tdd`, `testing`, `mutation-testing`, `refactoring`,
`docs-guardian` (agent) for clarity.
**Acceptance criteria**:

- The benchmark-rules section states the win condition with numbers **sourced from the manifest**
  (`winGap`, `MAX_TICKS`, `BENCHMARK_VERSION` `v2`) — not hand-typed literals; a retune-tracking
  test proves interpolation (a changed `winGap` changes the text).
- The primer explains yame (reset-to-neutral; points/stamina/mem persist) and the
  win-rate-primary metric, consistent with Slice 3.
- The drift test regenerates and byte-matches the committed `docs/spec.md`.
  **RED**: a generator test asserting the win-condition numbers are sourced (retune-tracking) + the
  drift snapshot. Mutator watch: a hardcoded `8`/`600` that should be interpolated from the manifest.
  **GREEN**: extend the benchmark-rules + primer generator sections; regenerate the spec.
  **MUTATE**: Stryker on the changed `gen-spec.ts` regions.
  **KILL MUTANTS**: cover the interpolated win-condition numbers.
  **REFACTOR**: assess sharing the manifest read with the existing benchmark-rules section.
  **Done when**: ACs met, drift test green, human approves commit.

---

### Slice 6 _(conditional)_: Data-driven gauntlet rebalance

**Value**: _Only if_ Slice 4's measurement still shows a bot too dominant — restore the gauntlet's
discriminating spread so the score ranks models, not "did you beat the one unbeatable bot."
**Actor / Trigger / Outcome**: per Slice 4's go/no-go; prefer **rules tuning** (`CANONICAL_RULES`,
e.g. nerf the okizeme loop's payoff/timing) over a roster swap; if rules tuning, every number
proven by a `runFight` relationship test (the `rules.test.ts` convention).
**Path**: short `grill-me` on the specific imbalance the measurement found → tune `CANONICAL_RULES`
(or swap a roster member) → bump `INPUT_HASH`/`BENCHMARK_VERSION` → regenerate `docs/spec.md` (drift
test forces it).
**Required implementation skills**: `grill-me` (for the rebalance target), `tdd`, `testing`,
`mutation-testing`, `refactoring`.
**Trigger rule (shape locked; band confirmed in Slice 4)**: Slice 6 runs **iff** any gauntlet
member's **round-robin win-rate** (from Slice 4 — each member as submitted bot vs the rest, both
sides, all seeds) falls **outside the band `[LOW, HIGH]`** — provisional **`[25%, 75%]`**. This
bounds **both** tails: an unbeatable wall (a member > HIGH, like today's `sweeper` ~100%) **and** a
punching bag (a member < LOW, like today's `jabber` ~0%) — both collapse the gauntlet's
discriminating power. The band is confirmed against the observed spread in Slice 4 (the number may
move; the both-tails shape does not).
**Acceptance criteria** _(numbers set after Slice 4's data)_:

- After the rebalance, **every** member's round-robin win-rate lies within the confirmed band, by
  re-running Slice 4's measurement; the rebalance is justified by a `runFight` relationship test in
  `rules.test.ts`, not a literal tweak.
- Version/hash bumped; `docs/spec.md` regenerated.
  **RED/GREEN/MUTATE/KILL/REFACTOR**: per the rules-tuning convention (each tuned number proven by a
  behavioral `runFight` test in `rules.test.ts`).
  **Done when**: the measured spread is acceptable, version bumped, human approves commit — **or
  this slice is skipped** if Slice 4 shows the metric already fixed the spread (delete it from the
  plan with a note).

## Pre-PR Quality Gate (every slice)

1. Mutation testing — `mutation-testing` (engine changes target the existing ~95%+ `sim.ts` /
   100% interpreter bars; data/manifest files target 100% as their tests pin them).
2. Refactoring assessment — `refactoring`.
3. `npm run typecheck` + `npm run lint` + `npm run format:check` pass.
4. **Determinism check**: assert **byte-identical** fights/replay for the **absent-`match`** path
   (Slices 1–2) — the core safety property of this feature — **and** that **match mode is
   replay-stable** (same `(bot, opponent, seed, match)` ⇒ identical `FightResult`).

## Sequencing notes

- **1 → 2 → 3 → 4 → 5 → (6 conditional).** Slice 1 (early-stop) is the walking skeleton and alone
  bounds the runaway. Slice 2 (yame) adds the resets and relocates the gap check to the yame
  boundary. Slice 3 adopts match mode in the benchmark + the aggregation swap + version/hash bump.
  Slice 4 measures (gauntlet + dogfood). Slice 5 teaches the spec. Slice 6 rebalances **only if**
  the measurement demands it.
- Slices 1 and 2 are **engine** changes (one branch each, `feat/match-early-stop`,
  `feat/match-yame`); each must prove the absent-`match` byte-identical property before merge.
- Slice 6 is genuinely conditional — if Slice 4 shows no member exceeds the threshold, **skip it**
  and close the feature at Slice 5.
- This feature adds **no DSL surface** — `dsl.ts` and the TCB allowlists are untouched throughout
  (the `sim.ts` resolver + `runFight` orchestration are the only outcome-path changes).
- On completion: this realizes the roadmap's **match structure** capability (the deferred §7);
  update `.claude/CLAUDE.md` Status, then delete this plan file.

---

_Delete this file when the plan is complete. If `plans/` is empty, delete the directory._
