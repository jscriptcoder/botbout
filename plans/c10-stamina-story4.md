# Plan: C10 Story 4 — Opponent stamina read (`L_act` layer)

**Branch**: feat/stamina-opponent-read
**Status**: Active

> Child story from `plans/c10-stamina-split.md` (Story 4 row + Story detail + note N2).
> Resolved design: `docs/DESIGN.md` §P1. The last C10 economy story before the
> consolidated `CANONICAL_RULES` stamina wiring.

## Goal

Expose `opponent.stamina` and `opponent.gassed` on the **`L_act` perception layer** —
the coherent delayed snapshot (invariant #4) — turning the self-side economy into a
two-player read game: a bot can bait the gas and punish a gassed foe.

## Architecture (why this rides existing machinery)

The `L_act` action layer + per-fighter history ring buffer already exist (perception
keystone C2, PRs #7–#10) and already serve `attacking`/`attackBand`/`posture`/
`throwing`/`knockdown`. Story 4 adds stamina to that **same** delayed snapshot — **no
new perception machinery**:

- `Frame` (sim.ts) records one tick's outward facts; `frameOf` captures the action
  fields. **4a adds `stamina: f.stamina` here** so it's delayed coherently with the
  other action tells.
- `perceiveOpponent` (sim.ts) splits the snapshot — positional fields from `oppPos`
  (`L_pos`), action fields from `oppAct` (`L_act`). Stamina joins the **`oppAct`** group
  (`stamina: oppAct.stamina`), so it is `L_act`-delayed like `attacking`.
- `OpponentState` (types.ts) is the contract — widened with `stamina` (4a) then
  `gassed` (4b).
- `FIELD_READERS` (dsl.ts) is the static TCB allowlist — gains `opponent.stamina` (4a)
  and `opponent.gassed` (4b). The boundary can't depend on `Rules`; only the _value_ is
  config-gated. Boolean tells convert via `? 1 : 0` (like `attacking`/`throwing`).
- **`opponent.gassed` derives from the DELAYED stamina** (`oppAct.stamina`) vs the
  shared `gasThreshold` — observably identical to a separately-recorded delayed gassed
  (the threshold is a static `Rules` constant ⇒ `delayed(gassed(s)) == gassed(delayed(s))`),
  and exactly what note N2 specifies. So 4b adds **no** new `Frame` field — only a
  derivation in `perceiveOpponent` reusing 4a's delayed number + a shared gas-line helper.

## Acceptance Criteria

- [ ] A bot reads `opponent.stamina` as the opponent's stamina **from `tick − L_act`** —
      the same delayed layer as `opponent.attacking` (NOT the live value, NOT the `L_pos`
      layer).
- [ ] A bot reads `opponent.gassed` as the `L_act`-delayed gassed boolean — `1` iff the
      _delayed_ opponent stamina ≤ the shared `gasThreshold`, else `0`.
- [ ] With `L_act = 0` perception, both reads are **live** (skeleton-consistent).
- [ ] With **no stamina configured**, `opponent.stamina` reads the inert sentinel `0` and
      `opponent.gassed` reads `0`; a fight whose bots don't read the new fields is
      **byte-identical** to the pre-Story-4 engine.
- [ ] `sim.ts` mutation ~95%+ (changed-line 100%); `dsl.ts` interpreter **100%**; the
      static `FIELD_READERS` allowlist gains both fields.

## Slices

Every slice follows RED-GREEN-MUTATE-KILL MUTANTS-REFACTOR. No production code without a
failing test. Read CLAUDE.md (invariants #1–#4, the additive guarantee) before each slice.

### Slice 4a: A bot reads `opponent.stamina` as the opponent's `L_act`-delayed stamina

**Value**: A bot author can pace against the opponent's _perceived_ conditioning — e.g.
press when the delayed stamina reads low — through the same one-frame-delayed tell as
`opponent.attacking`.

**Path**: `runFight` tick loop → each tick `frameOf` records `f.stamina` into the
opponent's history `Frame` → `perceiveOpponent` reads `oppAct.stamina` (the `L_act`-delayed
frame) into `OpponentState.stamina` → `viewFor` builds the snapshot → the DSL interpreter
serves `FIELD_READERS["opponent.stamina"]` → a reader bot branches on it → observable as
the bot's action timing in `result.events`. _Skipped this slice:_ the derived `gassed`
boolean (4b).

**Required implementation skills**: Before code, load `tdd`, `testing`, `mutation-testing`,
`refactoring`.

**Acceptance criteria** (present for confirmation before code):

1. A reader bot that acts only when `opponent.stamina ≤ K` first acts **`L_act` ticks after**
   the opponent's stamina actually crosses `K` (the drop happens when the opponent commits a
   costed move). Asserted as a **relationship**: the reader's reaction tick under `L_act = D`
   is later than under `L_act = 0` by `D` ticks (delay is observable, no literal stamina value
   pinned beyond the test's own fixture).
2. The read follows the **action** layer, not the positional layer: in a fight with
   `L_act ≠ L_pos`, the reaction timing tracks `L_act` (pins `oppAct.stamina`, kills the
   `oppAct → oppPos` swap mutant).
3. With `L_act = 0`, the reader acts the same tick the stamina crosses `K` (live).
4. **Additive guard**: an unconfigured fight (no `Rules.stamina`) whose bots ignore the new
   field is byte-identical to pre-4a; a bot reading `opponent.stamina` in an unconfigured
   fight gets sentinel `0`.

**RED**: In `perception.test.ts` (the home of the L*act-delayed opponent tells — mirrors the
`opponent.posture`/`throwing`/`knockdown` describes), a `describe("perception latency — delayed
opponent stamina (L_act)")`. A `BLOCK_ON_LOW_STAMINA` bot blocks the instant it perceives
`opponent.stamina ≤ K`; a `SPEND_ONCE` opponent commits one costed strike (long recovery, no
regen) so its stamina drops at a known tick and holds. `firstBlockTick` reveals \_when* the drop
was perceived. Delay test: `lAct` 0/1/2 → tick 1/2/3 (the structural observe-after-commit tick

- L_act). Layer test: `lPos = 5, lAct = 0` → still tick 1 (pins `oppAct.stamina`, kills the
  `oppAct → oppPos` swap). Sentinel test: no `Rules.stamina` ⇒ reads 0. Absent-perception test:
  no `perception` field ⇒ live + byte-identical replay. Allowlist test: `validate` accepts it.
  Likely mutator gaps from `mutator-rules.md`: the `frameOf` field assignment (a removed/zeroed
  `stamina:` makes the read constant-0). Plus an `interpret-tick.test.ts` numeric-reads `it.each`
  row `["opponent.stamina", {opponent: {stamina: N}}, N]` and an `opponent.stamina` default in
  `getMockState`. **Compile-coupling (house pattern):** TS won't compile the test until the field
  exists everywhere, so land the type plumbing with a STUB `stamina: 0` in `perceiveOpponent` (the
  RED), then wire `oppAct.stamina` (the GREEN).

**GREEN**: Add `stamina: number` to `Frame` + `stamina: f.stamina` to `frameOf`; add
`stamina: number` to `OpponentState`; add `stamina: oppAct.stamina` to `perceiveOpponent`;
add `"opponent.stamina"` to `FieldPath` + `FIELD_READERS["opponent.stamina"]: (s) =>
s.opponent.stamina`.

**MUTATE**: `mutation-testing` on the changed `sim.ts` lines (`frameOf` stamina capture,
`perceiveOpponent` stamina assignment) + the `dsl.ts` reader. Confirm interpreter 100%.

**KILL MUTANTS**: Strengthen the `L_act ≠ L_pos` assertion if the source-swap mutant
survives; add the live (`L_act = 0`) case if the delay mutant survives.

**REFACTOR**: Assess (likely none — a field-add mirrors the existing tells).

**Done when**: AC 1–4 met, interpreter 100%, `sim.ts` changed-line mutation 100%, human
approves commit.

### Slice 4b: A bot reads `opponent.gassed` as the `L_act`-delayed gas tell

**Value**: A bot author gets the derived punish-signal directly — `opponent.gassed === 1`
means "the foe I perceive is over the gas line" — without re-deriving the threshold, on the
same delayed layer.

**Path**: `perceiveOpponent` derives `gassed` from `oppAct.stamina` (4a's delayed number)
vs the shared `gasThreshold` (via a gas-line helper shared with self's `gassed`) →
`OpponentState.gassed` → `FIELD_READERS["opponent.gassed"]` (`? 1 : 0`) → a punisher bot
branches on it → observable in `result.events`. _Skipped:_ any new `Frame` field (derive from
the already-delayed stamina).

**Required implementation skills**: load `tdd`, `testing`, `mutation-testing`, `refactoring`.

**Acceptance criteria** (present for confirmation before code):

1. A punisher bot that acts only when `opponent.gassed === 1` first acts **`L_act` ticks
   after** the opponent's stamina actually crosses `gasThreshold` (relationship: delayed vs
   live differ by `L_act`).
2. `opponent.gassed` reads `1` iff the **delayed** opponent stamina ≤ `gasThreshold` — pinned
   at the boundary (delayed stamina == threshold ⇒ gassed; == threshold+1 ⇒ not), so the
   `≤` can't drift and the comparison reads the _delayed_ (`oppAct`) stamina, not live self.
3. With `L_act = 0`, the punisher acts live when the opponent crosses the line.
4. **Additive guard**: no `gasThreshold` (or no meter) ⇒ `opponent.gassed` reads `0` always;
   byte-identical to a fight that ignores it. Consistent with self's "absent threshold ⇒
   never gassed".

**RED**: In `perception.test.ts` (alongside the 4a stamina describe), a `describe("perception
latency — delayed opponent gassed (L_act)")`. A `BLOCK_ON_GASSED` bot blocks the instant it
perceives `opponent.gassed === 1`; the opponent crosses `gasThreshold` at a known tick (spends
once, as in 4a). `firstBlockTick` proves the delay: `lAct` 0/1/2 → tick 1/2/3, and `lPos ≠ lAct`
still tracks `lAct`. Boundary: delayed stamina == threshold ⇒ block, == threshold+1 ⇒ never.
Plus the no-threshold guard (never fires) + the allowlist (`validate`) test. Likely mutator
gaps: the `≤` boundary (pinned by the threshold/+1 pair); the gas-line helper's "absent
threshold ⇒ never gassed" branch (pinned by the no-threshold guard); deriving from
`oppAct.stamina` not self/live (pinned by `L_act > 0` delay). Plus an `interpret-tick.test.ts`
row `["opponent.gassed", {opponent: {gassed: true}}, 1]` (+ a `false → 0` row if needed to
kill the conversion mutant) and an `opponent.gassed` default in `getMockState`.

**GREEN**: Extract a pure gas-line helper `isGassedAt(stamina, rules)` (shared knowledge: the
gas line is `stamina ≤ gasThreshold`, absent ⇒ never) and rewrite `gassed(f, rules) =
isGassedAt(f.stamina, rules)` (behavior-preserving). Add `gassed: boolean` to `OpponentState`;
thread `rules` (or `gasThreshold`) into `perceiveOpponent` and set `gassed:
isGassedAt(oppAct.stamina, rules)`. Add `"opponent.gassed"` to `FieldPath` +
`FIELD_READERS["opponent.gassed"]: (s) => (s.opponent.gassed ? 1 : 0)`.

**MUTATE**: `mutation-testing` on the `perceiveOpponent` derivation + the shared
`isGassedAt` helper + the `dsl.ts` reader (the `? 1 : 0` conversion). Confirm interpreter 100%.

**KILL MUTANTS**: Add the `false → 0` interpreter row if the conversion mutant survives; add
the boundary pair if `≤` drifts.

**REFACTOR**: Assess the `isGassedAt` extraction reads cleanly as the single gas-line source.

**Done when**: AC 1–4 met, interpreter 100%, `sim.ts` changed-line mutation 100%, human
approves commit.

## Pre-PR Quality Gate

Before each PR:

1. Mutation testing — `mutation-testing` skill on changed `sim.ts`/`dsl.ts` lines.
2. Refactoring assessment — `refactoring` skill.
3. `npm run typecheck`, `npm run lint`, `npm test`, `npm run format:check` pass.
4. Confirm the additive guard test (absent config ⇒ byte-identical / sentinel reads) is green.

## After this story

Story 4 closes the C10 _behavioral_ economy. Remaining C10 work (tracked in
`plans/c10-stamina-split.md`): the consolidated **`CANONICAL_RULES` stamina wiring** —
promote the fixture numbers (`gasThreshold`/`gasRecoveryPenalty`/per-move `staminaCost`/
`max`/`regen`/`blockChip`/`parryChip`) into the canonical table, each proven by a `runFight`
relationship test, re-tuned against gas + the C9 arsenal. That is its own planning unit.

---

_Delete this file when the plan is complete. If `plans/` is empty, delete the directory._
