# Plan: B4 — opponent passivity clock read (delayed)

**Branch**: feat/passivity-opponent-read (already cut)
**Status**: Active

## Goal

Expose **`opponent.passivityRemaining`** — a bot's perception of how close the FOE is to a
passivity foul — on the **`L_act`-delayed** ring-buffer layer (like `opponent.stamina`), so a bot
can bait the foe's forced commit and prep a counter. **Completes Capability B (passivity).**

## Context (find-gaps 2026-07-02 — see the tracker's "B4 — resolved decisions" section)

- **D1 — DELAYED on `L_act`.** Rides `oppAct` like `opponent.stamina`/`gassed`/`attacking`, NOT a
  live scoreboard read. The pending timer is a body-condition tell you must WORK to read (the
  latency IS the value); the RESULT (the landed foul) is already live via A3's `opponent.penalties`.
- **D2 — raw `ticksSinceOffense` in the Frame, derive on serve.** `frameOf` records raw
  `f.ticksSinceOffense` (staying scoring-config-agnostic, like it records raw `stamina`);
  `perceiveOpponent` derives `Math.max(0, limit − oppAct.ticksSinceOffense)`, threading `match` in as
  a new param (the C10 S4b `isGassedAt` precedent). Observably identical to framing the countdown —
  `limit` is constant ⇒ `delayed(max(0, limit − tso)) == max(0, limit − delayed(tso))`.
- **D3 — coherent with B3.** Same formula as `self.passivityRemaining` on the delayed clock;
  `frameOf` records at loop-top BEFORE the tick's passivity increment (same pre-increment convention
  as B3's `viewFor`), so at **`L_act = 0`** the read equals the foe's own `self.passivityRemaining`.
- **D4 — sentinel `0` unconfigured; interpreter stays 100%; mechanical spec regen** (A3/B3 precedent).

**Non-negotiables:** byte-identical absent `match.passivity`; replay-stable + swap-symmetric present;
no new `endReason`; no officiating/penalty change; **`dsl.ts` interpreter branch unchanged** (static
reader). `limit` stays test-fixture-only (no `CANONICAL_RULES` wiring — that's Capability D).

## Acceptance Criteria

- [ ] **AC-1 — delayed countdown.** With `match.passivity.limit = L`, fixed `perception.lAct = d`
      (jitter off), and an idle foe, a perceiving bot reads `opponent.passivityRemaining == L − (t − d)`
      at tick `t` — the foe's countdown as of `d` ticks ago (`d` HIGHER than the foe's live remaining).
      The SAME gate fires `d` ticks later than it would on the foe's live `self.passivityRemaining`.
- [ ] **AC-2 — live coherence at `lAct = 0`.** With `lAct = 0`, `opponent.passivityRemaining` equals the
      foe's own `self.passivityRemaining` each tick (the delayed frame resolves to the current frame).
- [ ] **AC-3 — re-engage snap-back is delayed.** When the foe's clock zeroes at tick `T` (a connect /
      passivity re-engage), a perceiving bot sees `opponent.passivityRemaining` jump back toward `L` at
      tick `T + d`, not at `T`.
- [ ] **AC-4 — sentinel `0` unconfigured.** Absent `match.passivity`, `opponent.passivityRemaining`
      reads `0` for the whole bout (never derived; a config-absent read must not throw).
- [ ] **AC-5 — actionable (bait the commit).** A bot that gates a counter-prep action on
      `opponent.passivityRemaining <= T` acts on the foe's imminent-foul window (perceived delayed),
      demonstrating B4's value.
- [ ] **AC-6 — byte-identical absent, interpreter 100%, spec drift-clean.** Absent `match.passivity`,
      replay byte-identical to pre-B4 (new `Frame.ticksSinceOffense` frames `0`, never in `FightResult`;
      served value sentinel `0`). Static `FIELD_READERS` ⇒ `dsl.ts` interpreter stays 100%. `docs/spec.md`
      regenerated (field joins read-surface list + JSON-schema enum; drift test green). Replay-stable +
      swap-symmetric present.

## Slices

Every slice follows RED-GREEN-MUTATE-KILL MUTANTS-REFACTOR. No production code without a failing test.

### Slice 1 (only): a bot perceives the foe's passivity countdown on the delayed layer

**Value**: an authoring LLM / bot can read `opponent.passivityRemaining` and bait the foe's forced
engagement — the two-player payoff that completes Capability B. Observable via a `runFight` test where
a perceiving bot gates a distinctive action on the delayed countdown.

**Path**: `runFight` loop → `frameOf` records raw `ticksSinceOffense` into the history ring → per-tick
`perceiveOpponent` derives `Math.max(0, limit − oppAct.ticksSinceOffense)` from the `lAct`-delayed frame
(threading `match`) → flows through `viewFor`'s `{ ...opponent }` spread into `OpponentState` → the DSL
`FIELD_READERS` static entry serves it to the bot → the bot's gated action lands in `events[T].{a,b}.action`.
Intentionally skipped: no live path (D1 delayed), no canonical wiring (D), no `viewFor` opponent-side
change (the field rides the existing spread).

**Required implementation skills**: Before code changes, load `tdd`, `testing`, `mutation-testing`,
`refactoring`.

**Acceptance criteria**: AC-1…AC-6 above. **Present to human and confirm before writing code.**

**RED** — mirror the B3 self-read harness (`run-fight.test.ts` `describe("… story B3")`), but the
gate reads `opponent.passivityRemaining` and the perceiving bot is the OTHER fighter; assert
`events[T].b.action` (foe = A idles-since-start so its clock counts up cleanly). Add
`rules.perception = { lPos: 0, lAct: d }` (jitter off) to isolate the action layer. New
`describe("runFight — opponent passivity read (story B4)")`:

- **AC-1 (delayed value + direction).** A idle, `limit L`, B gates `eq V` on `opponent.passivityRemaining`.
  With `lAct = d`, B fires at tick `t` where `L − (t − d) = V` ⇒ `t = (L − V) + d`. Assert B steps at that
  tick and idles on the neighbours. Run at `d = 0` AND `d = 2`: the `+d` offset is the discriminator (a
  live read would fire at `L − V` for both). Kills the subtraction/direction mutants (`limit + tso`,
  `tso − limit`) AND proves the delay. Likely mutants (from `mutator-rules.md`): `−`→`+`, `Math.max(0,·)`
  boundary, the `oppAct` frame index.
- **AC-2 (coherence at `lAct = 0`).** With `lAct = 0`, a B-bot gating `eq V` on `opponent.passivityRemaining`
  fires the SAME tick an A-bot gating `eq V` on `self.passivityRemaining` fires — the delayed frame is the
  current frame. Pins the frame-vs-live off-by-one.
- **AC-3 (delayed snap-back).** A connects/re-engages at a known `T` (its clock zeroes); B gates `eq L`
  (fresh clock). Assert B's snap-back gate fires at `T + d`, not `T`. Proves the reset is perceived delayed.
- **AC-4 (sentinel 0 unconfigured).** No `match.passivity`: B gating `eq 0` fires from tick 0; B gating
  `gt 0` never fires. Kills the config-ternary → `true` (would deref an absent `match.passivity.limit` and
  throw) and → `false`.
- **AC-5 (actionable).** B gates `attack` (in range) on `opponent.passivityRemaining <= T` (`T` accounts
  for the move's startup lead, derived against the harness constants as in B3 AC-6); assert B lands a point
  timed to the foe's imminent foul that an ungated (idle) B would miss.
- **AC-6 (byte-identical / replay / swap).** (a) A full non-trivial fight with `match.passivity` ABSENT
  replays byte-identical to the pre-B4 baseline (`toEqual` on the whole `FightResult`); (b) with it present,
  `runFight(cfg)` twice is identical (replay-stable); (c) swapping A/B slots mirrors the outcome
  (swap-symmetric). Plus the `interpret-tick.test.ts` reader-table row (below) as the direct
  `FIELD_READERS` pin.

Also add to `interpret-tick.test.ts`: `getMockState` opponent default gains `passivityRemaining: 0`, and
the parameterized reader table gains
`["opponent.passivityRemaining", { opponent: { passivityRemaining: 7 } }, 7]` — the direct unit that
kills the static `dsl.ts` reader mutant.

**GREEN** — minimal additions:

- `types.ts`: add `passivityRemaining: number` to `OpponentState` (comment: perceived countdown,
  `L_act`-delayed; `0` = imminent / no-config sentinel).
- `sim.ts` `Frame`: add `ticksSinceOffense: number` (raw passivity clock — an `L_act` tell, derived on
  serve, like `stamina`).
- `sim.ts` `frameOf`: add `ticksSinceOffense: f.ticksSinceOffense` (unconditional — always present on the
  Fighter, only incremented under `match?.passivity`, so absent config it frames `0`; the ring is internal).
- `sim.ts` `perceiveOpponent`: add a `match: FightConfig["match"]` param; add
  `passivityRemaining: match?.passivity ? Math.max(0, match.passivity.limit − oppAct.ticksSinceOffense) : 0`
  to the returned object (the `Omit<OpponentState, "points" | "penalties">` return picks up the new field).
- `sim.ts`: pass `match` at both `perceiveOpponent` call sites. (No `viewFor` opponent-side change — the
  field rides the existing `{ ...opponent }` spread.)
- `dsl.ts`: add `| "opponent.passivityRemaining"` to the `FieldPath` union and
  `"opponent.passivityRemaining": (s) => s.opponent.passivityRemaining,` to `FIELD_READERS` (`ALLOWED_FIELDS`
  auto-derives ⇒ validation + spec enum follow for free; **no new interpreter branch**).
- `docs/spec.md`: regenerate via `npm run gen:spec` (mechanical — field joins the read-surface list +
  JSON-schema enum; the drift test then passes).

**MUTATE** — scoped Stryker (per project memory: `rm -rf .stryker-tmp reports` first; multiple `--mutate`
flags are LAST-WINS ⇒ run each range in a SEPARATE invocation):

- `sim.ts` `perceiveOpponent` derivation line (the ternary + `Math.max` + subtraction).
- `sim.ts` `frameOf` `ticksSinceOffense` line.
- `dsl.ts` the new `FIELD_READERS` reader line.

**KILL MUTANTS** — expect the AC-1 direction/offset tests to cover the subtraction + frame-index mutants,
AC-4 the config-ternary, the interpret-tick row the `dsl.ts` reader. Add targeted tests for any survivor;
document any genuine equivalent (e.g. a defensive `Math.max(0,·)` unwrap Stryker may not even generate, per
B3). Ask the human if a survivor's value is ambiguous.

**REFACTOR** — assess only if it adds value. Candidate: if `perceiveOpponent`'s derivation duplicates
B3's `viewFor` countdown, consider a shared `passivityRemainingOf(ticksSinceOffense, match)` helper —
but only extract if it genuinely de-duplicates knowledge (the DRY-is-knowledge test); a two-line
`match?.passivity ? Math.max(0, …) : 0` on each side may not warrant it. Load `refactoring` to decide.

**Done when**: AC-1…AC-6 met, byte-identical-absent + replay-stable + swap-symmetric proven, scoped
mutation reviewed (changed `sim.ts`/`dsl.ts` regions), typecheck + lint + `gen:spec` drift green, human
approves commit.

## Pre-PR Quality Gate

1. Scoped mutation on the changed `sim.ts` (`frameOf` + `perceiveOpponent`) and `dsl.ts` (reader) regions.
2. Refactoring assessment (`refactoring` skill) — the shared-helper question above.
3. `npm run typecheck` + `npm run lint` + full `npm test` (incl. the `gen-spec` drift test) green.
4. Confirm byte-identical-absent (whole-`FightResult` `toEqual` vs a pre-B4 baseline) and swap-symmetry.

## Downstream (NOT this PR)

After B4 merges, **Capability B is COMPLETE**. Remaining §7: **C** (tie-resolution: senshu + overtime)
→ **D** (benchmark + spec adoption — folds `match.passivity`/`jogai` into the benchmark `MATCH` +
`INPUT_HASH`, bumps `BENCHMARK_VERSION`, teaches the officiating in `docs/spec.md` prose).

---

_Delete this file when B4 is merged (record lives in git / the PR / the tracker's Progress + B4 sections)._
