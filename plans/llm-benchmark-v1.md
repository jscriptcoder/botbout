# Plan: LLM one-shot bot-authoring benchmark (v1, offline CLI)

**Branch**: one branch per slice — see each slice (`feat/benchmark-*`, `feat/dsl-*`, `feat/spec-*`)
**Status**: Active

## Goal

Make ModelKombat a **one-shot benchmark of LLM bot-authoring**: each model is handed one
generated spec, emits one bot, and we score that bot deterministically against a fixed,
versioned gauntlet — where the spec is the measuring instrument and the DSL isolates
strategic reasoning from constant-transcription noise.

## Context & locked design decisions

Resolved via `grill-me` (full record in the originating conversation). The load-bearing ones:

- **Metric**: a bot's score = **Σ net-points** over all (gauntlet opponent × seed × **side**)
  fights — each (opponent × seed) is played **twice**, submitted bot as fighter A and as
  fighter B, and net-points summed across both sides to cancel start-side / PRNG-draw-order
  bias (`sim.ts:820` draws per-tick jitter in a fixed A,B order, so a matchup is NOT
  side-symmetric). **win-rate** is the tiebreaker. Scored on the **existing engine** — match
  structure is NOT required (deferred).
- **Frozen & versioned run parameters**: seeds **`1..10`**, **`maxTicks 600`** ⇒ a run is a
  pure function of `(bot, benchmark-version)`.
- **Opponent**: a **fixed, versioned gauntlet** (NOT a moving king-of-the-hill; KotH stays a
  separate later feature). Starter roster = a curated subset of the session archetypes
  (pressure / band-reading turtle / grappler / sweeper-okizeme / zoner), spanning the
  strategic axes; frozen in slice 1.
- **DSL growth** (additive to `src/engine/dsl.ts`, the TCB): a unified **`rule(path)`** read
  over the whole frozen ruleset (allowlist generated, mirroring `FIELD_READERS`; nothing
  withheld; `latency` collapses into it) + **integer arithmetic** (`add/sub/mul/min/max/div/
neg/abs`; int32-saturating, div truncates toward zero, ÷0:=0). No `let`.
- **State surface**: add **`opponent.points`, exposed live** (a scoreboard fact, not a
  body-perception tell) ⇒ a bot derives `scoreGap` via arithmetic. Hit-confirm / self-posture
  / `edgeDistance` deferred.
- **Delivery**: **offline CLI** for v1 (`npm run benchmark`). The HTTP API (`/spec`,
  `/validate`, `/fight`) is an explicit later phase.
- **Spec**: a single self-contained **Markdown `spec.md`** — hybrid generated (grammar,
  allowlists, `LIMITS`, frame table, embedded **JSON Schema**, error catalog, benchmark rules)
  - hand-authored primer with **all numbers interpolated from `CANONICAL_RULES`** + **real
    validated example bots**. **Committed snapshot + drift test**; Markdown-only for v1.
- **Invalid-bot policy**: **hard-zero-distinct** (invalid bots never fight; recorded as a
  distinct last-ranked outcome with the validator errors) + **lenient JSON extraction** (last
  fenced ```json block, else last top-level `{…}`), identical for every model.
- **Telemetry** (human re-prompt aid, NOT a metric input): engine records a **typed degrade
  reason** per frame; CLI gains a stamina + reason view. Built **last**.

### Non-negotiable invariants (apply to every slice)

1. **Determinism**: integer/fixed-point only in the outcome path; one seeded PRNG; no
   `Math.random` / `Date.now`. DSL arithmetic must be bit-reproducible (hence int32-saturating
   / div-trunc / ÷0:=0).
2. **TCB**: `src/engine/dsl.ts` is the trusted computing base; its allowlists ARE the security
   boundary. New ops/reads are pure, read-only, and add nothing that touches host / network /
   filesystem / time / randomness. `rule(path)` reads transparent ruleset constants only.
3. **Bounded docs**: loop-free / recursion-free; worst-case cost bounded by `LIMITS`. New
   arithmetic nodes count against `maxNodes` / `maxDepth` like any other node.
4. **Same pre-tick snapshot**: unchanged. `opponent.points` is a live scoreboard read, outside
   the per-fighter perception history (it is not a body-perception field).

## Acceptance Criteria (whole feature)

- [x] `npm run benchmark -- <bot.json>` scores a valid bot against the frozen gauntlet over
      seeds `1..10` at `maxTicks 600`, **playing each (opponent × seed) twice (bot as A and as
      B)**, and prints a **deterministic** report: Σ net-points (primary), win-rate
      (tiebreaker), and a per-opponent breakdown. _(Slice 1 — PR #79)_
- [x] A bot can express integer **arithmetic** (`add/sub/mul/min/max/div/neg/abs`) with
      int32-saturating / div-trunc / ÷0:=0 semantics, validated and evaluated in a real fight.
      _(Slice 2 — PR #80)_
- [x] A bot can read any frozen-ruleset constant via **`rule(path)`**; a symbolic bot and its
      magic-number twin behave identically, and the symbolic one survives a `CANONICAL_RULES`
      retune that breaks the twin. _(Slice 3 — PR #81)_
- [x] A bot can read **`opponent.points`** (live) and act on the score gap. _(Slice 4 — PR #82)_
- [x] `spec.md` is **generated from `dsl.ts` + `rules.ts`**, committed, drift-tested, embeds a
      JSON Schema, interpolates all numbers from `CANONICAL_RULES`, and embeds **validated**
      example bots. _(Slices 5a/5b + 6 — incl. the strategic primer, the three embedded examples,
      and the `cancels into` frame-table column the dogfood surfaced.)_
- [x] **Dogfood**: a bot authored cold from `spec.md` alone **validates** ✅ and runs the spec's
      okizeme combo. It is **WKF-match-competitive** but a **documented near-miss** on "positive net
      vs > half" (the residual miss is a Slice-1 gauntlet/metric limitation, not a spec defect — the
      spec defect it found, missing cancel routes, was fixed). _(Slice 6 — see the Slice 6 dogfood
      note + the follow-up.)_
- [x] A raw model reply (prose / ```json fences) is **leniently extracted**; a malformed or
      schema-invalid bot is reported as **invalid** (last-ranked) with structured errors.
      _(Slice 7 — PR #86)_
- [ ] A fight report can show per-tick **stamina** and **typed degrade reasons**
      (`unaffordable` / `out-of-band` / `locked` / `inert`).

## Slices

Every slice follows RED-GREEN-MUTATE-KILL MUTANTS-REFACTOR. No production code without a
failing test. Read `.claude/CLAUDE.md` + the testing rules before each slice. Tests are vitest
unit tests for engine/DSL/scoring logic and CLI stdout behavior — no browser/Playwright (no UI
in v1).

---

### Slice 1: Score a valid bot against the frozen gauntlet (walking skeleton) — ✅ DONE (PR #79)

**Value**: The benchmark operator can score _any_ valid bot and get a deterministic ranking
number — the core benchmark loop, proven end-to-end with today's DSL and existing bots.
**Path**: `npm run benchmark -- bots/zoner.json` → CLI loads the bot through the existing
validator gate → runs it via `runFight` against each gauntlet bot (from a new versioned
manifest) across seeds `1..10` at `maxTicks 600`, **as both fighter A and fighter B** →
aggregates Σ net-points + win-rate →
prints a stable report to stdout. (Skipped for now: lenient extraction, invalid-bot policy,
telemetry — later slices.)
**Required implementation skills**: load `tdd`, `testing`, `mutation-testing`, `refactoring`;
`cli-design` for stream/exit discipline.
**Acceptance criteria**:

- A new `src/engine/benchmark.ts` (pure) exposes a function that, given `(bot, gauntlet, seeds,
maxTicks, rules)`, returns `{ netPoints, winRate, perOpponent: [...] }` computed over every
  (opponent × seed × side) fight using `runFight`, where each (opponent × seed) is run **twice**
  — submitted bot as fighter A and as fighter B — and both fights count.
- Net-points = Σ over all fights (both sides) of `(botScore − oppScore)`, where `botScore` is
  the submitted bot's score regardless of which side it played; win-rate = `botWins /
totalFights` (draw ≠ win); `totalFights = |gauntlet| × |seeds| × 2`.
- A tie on **both** net-points and win-rate is reported as a **genuine tie** — no third
  tiebreak key for v1 (an exact double-tie is vanishingly rare given net-points is a wide
  integer sum).
- A versioned gauntlet/params **manifest** module (`src/engine/benchmark-config.ts` or similar)
  exports the frozen roster (paths into `bots/`), `SEEDS = [1..10]`, `MAX_TICKS = 600`, and a
  `BENCHMARK_VERSION` string — the single source consumed by both this harness and the spec
  generator (slice 5).
- **Version policy**: `BENCHMARK_VERSION` is a manual string in the manifest. A **guard test**
  hashes the scoring inputs (serialized `CANONICAL_RULES` + gauntlet roster + `SEEDS` +
  `MAX_TICKS`) and pins that hash to the version, **failing CI if any input changes without a
  bump**. Documented policy: also bump on any change to the engine **outcome path** (`sim.ts` /
  `dsl.ts` interpreter), leaning on the existing determinism/replay tests to catch unintended
  outcome drift. So a score is comparable iff its `BENCHMARK_VERSION` matches.
- **Gauntlet composition** (LOCKED): the frozen roster is the **6 bots** `jabber, rekka, zoner,
grappler, sweeper, vulture` — spanning the strategic axes (pressure ×2 flavors = `jabber`
  poke + `rekka` cancel-combo, zoner = `zoner`, grappler = `grappler`, sweeper/okizeme =
  `sweeper`, band-reading defense = `vulture`) so no single counter-strategy can top-score.
  Self-defeating bots (`berserker` self-gasses, `turtle` blocks one band, `counter` never
  scores) are deliberately excluded — they don't discriminate as opponents. The submitted bot is
  **never** in the gauntlet (no mirror / self match): a gauntlet opponent whose loaded document
  **deep-equals** the submitted document is skipped (`totalFights` drops by `|seeds| × 2` for
  that opponent — only triggers when self-testing a roster bot; never for an LLM submission).
- `npm run benchmark -- <bot.json>` prints net-points, win-rate, and a per-opponent table to
  **stdout**; usage/errors to **stderr**; exit 0 on success, 2 on bad usage. Output is
  byte-stable across repeat runs (determinism).
- A bot path that the validator rejects exits non-zero with the structured errors (full
  hard-zero-distinct _reporting_ deferred to slice 7; here a rejected bot simply fails fast).
  **RED**: a `benchmark.test.ts` asserting the aggregation on a tiny fixed gauntlet (2 bots × 2
  seeds) yields known net-points/win-rate; a `format`/CLI test asserting the report layout and
  stream/exit discipline. Mutator watch: comparison-operator mutants on `>`/`>=` in
  win/draw/net-points, the `botScore − oppScore` subtraction direction, and the seed-loop bounds.
  **GREEN**: implement the pure aggregator + a thin CLI shell reusing `loadBotDoc` and
  `CANONICAL_RULES`; add the `benchmark` npm script and the manifest module.
  **MUTATE**: run Stryker on `benchmark.ts` (+ changed CLI lines).
  **KILL MUTANTS**: cover the subtraction direction, win-vs-draw boundary, and empty/edge
  aggregation.
  **REFACTOR**: assess sharing the table renderer with `src/cli/format.ts`.
  **Done when**: all ACs met, mutation report reviewed, human approves commit.

---

### Slice 2: Bots can compute — arithmetic NumExpr ops — ✅ DONE (PR #80)

**Value**: A bot author (LLM) can express thresholds and derived quantities instead of only
comparing raw leaves — the foundation for strategy that isn't a pile of magic numbers.
**Path**: a bot uses `{op:"add"|"sub"|"mul"|"min"|"max"|"div"|"neg"|"abs", ...}` inside a
`NumExpr` → `validate` accepts it (recursing, counting nodes/depth) → the interpreter evaluates
it with int32-saturating / div-trunc / ÷0:=0 → the computed value changes the action chosen in
a real fight.
**Required implementation skills**: `tdd`, `testing`, `mutation-testing`, `refactoring`;
`functional` for the pure evaluator; `typescript-strict` for the discriminated `NumExpr` union.
**Acceptance criteria**:

- `NumExpr` gains the eight ops: variadic `add/mul/min/max` (≥1 arg), binary `sub/div`, unary
  `neg/abs`. Validator enforces arities, recurses into args (node + depth budget), and rejects
  malformed shapes with structured errors.
- Interpreter evaluates each op over int32; **every op saturates its result to
  `[LIMITS.intMin, LIMITS.intMax]`**; `div` truncates toward zero; **÷0 := 0**.
- A `runFight`/interpreter test proves a bot whose action depends on an arithmetic expression
  picks the expected action (behavior, through the public interpreter), and that overflow
  saturates rather than producing a non-integer.
- Absent any arithmetic op ⇒ byte-identical to the pre-arithmetic engine.
  **RED**: validator tests (each op's arity + nesting budget + rejection paths); interpreter
  tests for saturation boundary, `div` truncation toward zero (incl. negative operands), and
  ÷0:=0. Mutator watch: arithmetic-operator swaps (`+`↔`-`, `*`↔`/`), the saturation clamp
  bounds (`Math.min`/`Math.max` arg swaps), `Math.trunc` vs round, and the ÷0 guard.
  **GREEN**: extend the `NumExpr` type, the validator's `num()` switch, and `evalNum()`’s switch
  with a shared int32-saturating helper.
  **MUTATE**: Stryker on the changed `dsl.ts` regions (target 100% on the new ops, matching the
  existing interpreter coverage bar).
  **KILL MUTANTS**: add cases for each surviving operator/boundary mutant.
  **REFACTOR**: assess a single `clampInt32` + `foldVariadic` helper.
  **Done when**: ACs met, `dsl.ts` interpreter stays 100%, human approves commit.

---

### Slice 3: Bots reference the ruleset symbolically — unified `rule(path)` — ✅ DONE (PR #81)

**Value**: A bot expresses "in range of the front kick" as `rule("moves.mae-geri.reach")`
instead of `270000` — removing transcription noise (the benchmark measures strategy) and
surviving frame-table retunes.
**Path**: a bot uses `{op:"rule", path:"<RulePath>"}` → `validate` checks the path against a
generated allowlist (mirroring `FIELD_READERS`, derived from the `Rules` shape) → `runTick`
(now threaded with `Rules`) resolves it via a `RULE_READERS` map → the constant feeds the
bot's expression in a real fight.
**Required implementation skills**: `tdd`, `testing`, `mutation-testing`, `refactoring`;
`api-design` for the path naming; `typescript-strict`.
**Acceptance criteria**:

- A `RULE_READERS: Record<RulePath, (r: Rules) => number>` enumerates every readable frozen
  constant: per-move stats (`moves.<id>.{startup,active,recovery,score,reach,staminaCost}` and
  `moves.mawashi-geri.scoreByBand.high`), perception (`perception.{lPos,lAct,jitter}`), stamina
  (`stamina.{max,regen,blockChip,parryChip,gasThreshold,gasRecoveryPenalty}`), windows
  (`parryWindow,parryRecovery,counterWindow,cancelWindow`), okizeme
  (`knockdownDuration,finishWindow,finishScore`), throw (`throw.{...}`), physics
  (`jumpImpulse,gravity,lowClearance`), and movement/ring (`walkSpeed,ring.width,startGap`).
  The validator allowlist is exactly its keys.
- An **optional/unconfigured** constant (e.g. `moves.sweep.reach` when sweep is absent) reads
  the sentinel **`0`** (matching the engine's inert-sentinel convention) — never throws. The
  validator stays **rules-agnostic**: a path is valid by _shape_, independent of which ruleset
  it runs on (preserving validate-once-run-on-any-rules). A bot gating on an unconfigured
  constant simply never satisfies that branch.
- `runTick` (and the `dsl.ts` interpreter signature) gains a `Rules` argument; `sim.ts` passes
  `CANONICAL_RULES`/the fight's rules. Reads are pure; no path can mutate or reach beyond the
  constant map (TCB boundary preserved).
- Behavior-equivalence test: a bot gating on `rule("moves.kizami-zuki.reach")` chooses the same
  actions as the `210000`-inlined twin on `CANONICAL_RULES`; and on a deliberately retuned
  rules fixture the symbolic bot tracks the new value while the inlined twin diverges.
  **RED**: validator tests (valid paths accepted, unknown/typo paths rejected, optional-constant
  sentinel); interpreter equivalence + retune-tracking test through `runTick`. Mutator watch: the
  sentinel default (`?? 0`), and any path-resolution branch.
  **GREEN**: add the `RulePath` type + `RULE_READERS`, the validator `rule` case, the interpreter
  `rule` case, and thread `Rules` through `runTick`/`sim.ts`.
  **MUTATE**: Stryker on the new `dsl.ts` regions + the `runTick` signature change.
  **KILL MUTANTS**: cover the sentinel and representative path families (move stat, global scalar,
  nested `scoreByBand`).
  **REFACTOR**: assess generating `RULE_READERS` keys + the JSON-Schema/spec enumeration from one
  source to avoid drift (feeds slice 5).
  **Done when**: ACs met, interpreter 100%, `latency` confirmed expressible as
  `rule("perception.lAct")`, human approves commit.

---

### Slice 4: Bots can read the scoreboard — live `opponent.points` — ✅ DONE (PR #82)

**Value**: A bot can tell whether it is ahead or behind and play an endgame (protect a lead as
`clock.ticksRemaining → 0`, or gamble when behind) — directly relevant to the net-points metric.
**Path**: `OpponentState` gains `points` → the live opponent view is populated from the real
opponent's `points` (live, not via the perception ring buffer) → `FIELD_READERS["opponent.points"]`
exposes it → a bot computes `scoreGap = sub(self.points, opponent.points)` and branches.
**Required implementation skills**: `tdd`, `testing`, `mutation-testing`, `refactoring`;
`typescript-strict`.
**Acceptance criteria**:

- `OpponentState.points: number` added to `types.ts`; `viewFor`/opponent-view construction sets
  it from the live opponent (zero perception delay — it is a scoreboard fact, consistent with
  `self.points` and `clock.tick` being live).
- `FIELD_READERS` + the `FieldPath` allowlist gain `"opponent.points"`.
- A `runFight` test: a bot that switches strategy on `scoreGap` (e.g. turtles when ahead by ≥N)
  demonstrably behaves differently when ahead vs behind.
- Absent any consumer ⇒ byte-identical (the field is additive; existing bots ignore it).
  **RED**: a reader test (`opponent.points` returns the live opponent score, not a delayed one)
  and a behavior test (scoreGap branch). Mutator watch: live-vs-delayed source selection, and the
  reader wiring.
  **GREEN**: extend `OpponentState`, the view construction, and `FIELD_READERS`.
  **MUTATE**: Stryker on the changed `sim.ts`/`dsl.ts` lines.
  **KILL MUTANTS**: assert the value is the _live_ score (a test where delayed ≠ live would catch
  a wrong source).
  **REFACTOR**: none expected.
  **Done when**: ACs met, human approves commit.

---

### Slice 5: Generate `spec.md` machine-truth sections + JSON Schema + drift test

**Split into 5a + 5b** (decided 2026-06-30): 5a ships the factual Markdown backbone + drift
test (a usable spec on its own); 5b embeds the JSON Schema + the `validate()`↔schema agreement
test. Smaller, independently reviewable PRs. (The strategic primer + validated example bots +
retiring `BOT-DSL.md` + the dogfood remain **Slice 6**.)

---

#### Slice 5a: Generate the factual `docs/spec.md` machine-truth sections + drift test — ✅ DONE (PR #83)

**Value**: An LLM (and the operator) gets an accurate, self-contained reference that _cannot
lie_ about the engine — the factual backbone of the benchmark instrument, byte-pinned so it can
never silently drift from `dsl.ts` / `rules.ts` / the manifest.
**Path**: `npm run gen:spec` runs a **pure** generator (`src/cli/gen-spec.ts`,
`generateSpec(): string`, no wall-clock) that reads `dsl.ts` allowlists + `LIMITS`,
`CANONICAL_RULES`, the `RULE_READERS`/`FIELD_READERS` key sets, and the benchmark manifest →
emits the factual sections of `spec.md` (header, `LIMITS`, grammar + action/op/field/move/band
allowlists, frame table, validation-error catalog, benchmark rules: metric/seeds/maxTicks/
gauntlet) → a thin shell writes a committed **`docs/spec.md`**.
**Required implementation skills**: `tdd`, `testing`, `mutation-testing`, `refactoring`;
`cli-design`; `docs-guardian` (agent) for the generated doc’s clarity.
**Acceptance criteria**:

- A **pure** `generateSpec(): string` produces a deterministic Markdown string from the imported
  source modules — **no `Date.now` / no wall-clock** (byte-stability is required for the drift
  test). A thin shell + `npm run gen:spec` writes it to **`docs/spec.md`** (alongside
  `DESIGN.md`).
- A **drift test** regenerates the spec and asserts it byte-matches the committed `docs/spec.md`
  (fails when an allowlist, `LIMITS`, the frame table, or the manifest changes until
  regenerated). `docs/spec.md` is added to `.prettierignore` (a generated artifact — its
  generator is its formatter — so `format:check` and the drift test don’t conflict).
- The frame table + benchmark-rules numbers are the _serialized_ `CANONICAL_RULES` + manifest
  (no hand-typed literals).
- The action / op / field-path / rule-path / move / band **allowlists** are rendered from the
  live `dsl.ts` allowlist sources (`FIELD_READERS`/`RULE_READERS` keys, `MOVES`, `BANDS`, the
  op-set), never retyped.
- The **validation-error catalog** enumerates the `ValidationIssue` reason families an author
  hits (node budget, depth, unknown op/move/band, field/rule not allowed, undeclared cell).
- `BENCHMARK_VERSION` + `INPUT_HASH` (from the manifest) appear in the spec header.
- `LIMITS` (maxNodes / maxDepth / maxRules / maxBytes / maxCells / int range) appear
  **prominently** with a one-line node-budget note for authors. LIMITS are **unchanged for v1**
  (generous for rule-based bots — eval is cheap integer ops); a real ceiling-hit during the
  slice-6 dogfood is an additive tuning bump carrying a `BENCHMARK_VERSION` note.
- **Behavior-neutral `dsl.ts` exports only** (decided 2026-06-30): the generator renders
  allowlists from the live source, so 5a `export`s the existing runtime sets (`ALLOWED_FIELDS`,
  `ALLOWED_RULES`, `MOVES`, `BANDS`) and adds completeness-checked exported arrays for action
  types + num/bool ops (`Record<Action["type"], true>` trick ⇒ a missing member is a compile
  error). NO validator/interpreter LOGIC changes ⇒ fights stay **byte-identical** (the existing
  determinism/replay suite proves it). Otherwise touches only `src/cli/`, `docs/`,
  `.prettierignore`, and one npm script.
  **RED**: a generator unit test (key sections present, numbers sourced from `CANONICAL_RULES`/
  manifest, allowlists sourced from `dsl.ts`) + the drift snapshot test. Mutator watch: any
  literal in the generator that should be sourced from `Rules`/allowlists.
  **GREEN**: implement `generateSpec` + the `gen:spec` shell/script + commit the first
  `docs/spec.md` + `.prettierignore` entry.
  **MUTATE**: Stryker on `gen-spec.ts`.
  **KILL MUTANTS**: ensure each generated section is asserted (not just presence but sourced
  content).
  **REFACTOR**: assess a single allowlist-enumeration source feeding both the Markdown lists and
  (next slice) the JSON Schema enums.
  **Done when**: ACs met, drift test green, human approves commit.

---

#### Slice 5b: Embed the bot-doc JSON Schema + `validate()`↔schema agreement test — ✅ DONE (PR #84)

**Value**: The spec carries a standard, machine-consumable JSON Schema for the bot document that
provably agrees with the real `validate()` gate on the bot corpus — tooling/LLMs can lean on it.
**Path**: `generateSpec` gains an **embedded JSON Schema** block whose `enum`s (moves, bands,
field paths, rule paths, ops) are injected from the same allowlist source 5a renders → the spec
is regenerated → a test validates the corpus against the embedded schema with **`ajv`**
(devDependency; test-only, never in the engine/TCB — the no-runtime-deps rule for `src/engine`
holds).
**Required implementation skills**: `tdd`, `testing`, `mutation-testing`, `refactoring`;
`api-design` for the schema shape.
**Acceptance criteria**:

- A **`botDocSchema()`** (exported from `gen-spec.ts`) builds the bot-doc JSON Schema:
  `version` const `1`, `name` 1..64, `memory` (`maxProperties` ← `LIMITS.maxCells`,
  `propertyNames.pattern` ← the cell regex, integer values), `rules` (`maxItems` ←
  `LIMITS.maxRules`) of `Rule`, `default` `Action`; reusable `$defs` (`NumExpr`/`BoolExpr`/
  `Action`/`Rule`) with recursion via `$ref`.
- **Tight, arity-precise** (decided 2026-06-30): discriminated `oneOf` variants per op-group with
  correct arities (variadic `add/mul/min/max` ≥1 arg; binary `sub/div` exactly 2; unary
  `neg/abs`; `const/field/mem/rule` leaves), `const` int32 bounds ← `LIMITS`. The **enum
  membership** (field/rule/move/band/op/action) is injected from the live allowlists
  (`ALLOWED_FIELDS`/`ALLOWED_RULES`/`MOVES`/`BANDS`/`NUM_OPS`/`BOOL_OPS`/`ACTION_TYPES`) — single
  source of truth; the op→arity partition mirrors the validator's switch (a small, locked grammar
  shape).
- A **permissive over-approximation**: `additionalProperties` left OPEN (the validator ignores
  extra keys) so _everything `validate()` accepts, the schema accepts_ — the agreement direction.
- The schema is **embedded** in `docs/spec.md` as a fenced ```json block (= `JSON.stringify(
  botDocSchema(), null, 2)`); the 5a drift test **transitively covers** it (no new drift test).
- **Agreement test (`ajv`, test-only devDependency)**: (a) `ajv` compiles the schema without
  error; (b) every `bots/*.json` that `validate()` **accepts** also passes the schema; (c) a
  synthetic **kitchen-sink** valid doc exercising the corpus-missing features (`rule()`,
  `crouch`, `jump`) passes **both** `validate()` and the schema; (d) ≥1 **known-bad** structural
  doc (e.g. `version ≠ 1` / unknown move / wrong-typed field) is rejected by **both**.
- **Enum-sourcing assertions**: the schema's field/rule/move/band/op/action enums **deep-equal**
  the allowlist sources (kills a dropped/added enum mutant).
- **Documented over-approximation**: the schema **cannot** encode the node-budget (`maxNodes`),
  max-depth, `maxBytes`, or declared-before-use cell scoping ⇒ `validate()` stays the authority.
- `ajv` added as a **devDependency** only; no `src/engine` import of it (the TCB / no-runtime-deps
  rule holds); no engine behavior change.
  **RED**: the agreement test (compile + corpus + kitchen-sink + known-bad) + the enum-equality
  assertions. Mutator watch: an enum hard-coded instead of sourced; a `$ref` target typo silently
  widening the schema; an arity bound (`minItems`/`maxItems`) dropped.
  **GREEN**: build `botDocSchema()` from the allowlist source, embed + regenerate the spec, wire
  `ajv` into the test.
  **MUTATE**: Stryker on the schema-builder region of `gen-spec.ts`.
  **KILL MUTANTS**: cover each injected enum + each arity bound (a wrong/missing member or arity
  fails agreement).
  **REFACTOR**: assess deriving the schema enums and the 5a Markdown allowlist lists from one
  shared enumeration.
  **Done when**: ACs met, agreement + drift tests green, human approves commit.

---

### Slice 6: `spec.md` strategic primer + validated worked examples (dogfood)

**Value**: The spec becomes a true _one-shot_ instrument — a model can derive optimal play, not
just legal syntax — and we prove it by authoring a bot cold from it.
**Path**: the generator gains a hand-authored strategic primer (master inequalities, the
`strike > throw > guard` triangle, okizeme, the gas economy) with **every number interpolated
from `CANONICAL_RULES`**, plus embedded **real example bots** from `bots/` → `spec.md` is
regenerated → a dogfood bot authored from `spec.md` alone is scored via slice 1.
**Required implementation skills**: `tdd`, `testing`, `mutation-testing`, `refactoring`;
`docs-guardian` (agent).
**Locked decisions (2026-06-30):** (a) embedded examples = **teach-first `jabber`, `vulture`,
`rekka`** (a poke, a band-reading defender, a cancel-combo bot — spanning the axes; accepts that
3 of 6 gauntlet opponents are shown, since the gauntlet is already public/versioned and beating
known opponents with one perception-limited bot is still genuinely strategic); (b) **one PR**
(the four deliverables are tightly coupled); (c) `docs/BOT-DSL.md` is **deleted** (not a pointer)
and all live references repointed.

**Acceptance criteria**:

- **`primerSection(rules)` is parameterized by `rules`** (exactly like `frameTableSection(rules)`)
  so every number is interpolated, never typed. It covers the strategic spine: the perception
  **master inequality** (`reactable iff S ≥ lAct+1`), the **`strike > throw > guard`** precedence
  triangle, the **height/occupancy** read-game (crouch vacates `high`, airborne vacates `low`),
  **parry → counter** + **on-contact cancel** windows, **okizeme** (finish window inside
  knockdown), and the **stamina/gas** economy (gassed loses kicks, keeps punches). Placed after
  the frame table, before benchmark rules.
- **Interpolation is mutation-proven via retune-tracking** (the testable form of "no bare magic
  numbers", mirroring Slice 3): `primerSection(rules)` run against a deliberately-**retuned** rules
  fixture produces primer text whose interpolated claims track the new values — a hardcoded literal
  diverges and fails; plus a positive assertion that key claims equal the `CANONICAL_RULES`-derived
  values.
- Each embedded example bot (`jabber`, `vulture`, `rekka`) is the **verbatim** content of its real
  `bots/*.json` (read from disk at generation time) and is run through `validate()` in a test (a
  broken example fails CI).
- The drift snapshot (Slice 5a) now **transitively** covers the full `spec.md` incl. primer +
  examples (no new drift test). Editing an embedded `bots/*.json` fails the drift test until
  `spec.md` is regenerated (desirable).
- **`docs/BOT-DSL.md` is deleted**: the generated, drift-tested `spec.md` is the single DSL source
  of truth. **Live** references in `docs/DESIGN.md` (§P5/P6/P7) and `README.md` are repointed to
  `docs/spec.md`; `.claude/CLAUDE.md`'s dated _Status_ log entries are left as the historical
  record (only its top-of-file "source of truth" line is updated).
- **Dogfood — DONE, documented near-miss + a spec defect FIXED** (decided 2026-06-30). A bot
  (`bots/dogfood.json`) authored cold from `spec.md` alone (a) **validates on first generation** ✅
  (CI-asserted in `src/cli/dogfood.test.ts`) and (b) runs the spec's **sweep→cancel→finish okizeme
  combo** — WKF-match-competitive (wins/ties 200-tick matches vs jabber/grappler) but **does NOT
  clear "positive net-points vs > half"** over the benchmark's **600 raw ticks** (net −2682; closest
  jabber −20, zoner −40). **The dogfood surfaced a genuine spec defect — now fixed:** the frame
  table omitted the **cancel routes** (`cancelInto`), so the dominant okizeme combo wasn't
  authorable from the spec; a `cancels into` column was added (generated from `CANONICAL_RULES`,
  drift-pinned, 100% mutation). **The residual miss is NOT a spec defect** but two **Slice-1**
  properties: (i) the frozen gauntlet is dominated by a **100%-win `sweeper`** (even gauntlet member
  `jabber` goes 0-wins), capping the achievable bar at ~4; (ii) `runFight` scores **raw cumulative
  points over 600 ticks with no WKF match-cap**, rewarding relentless okizeme-looping over winning
  the match. Per the user (2026-06-30), accept the spec deliverables and **log these as a follow-up**
  (see Sequencing notes); the bot + full report go in the PR description; the bot is committed as a
  CI-validated fixture. _(Caveat: the implementing agent has codebase knowledge, so its "cold"
  authoring is an imperfect proxy; the operator may run the true dogfood against a fresh model.)_
  **RED**: the interpolation/no-magic-number test + the example-validation test. Mutator watch:
  interpolation falling back to a hardcoded literal.
  **GREEN**: author the primer template + wire example embedding + regenerate `spec.md`.
  **MUTATE**: Stryker on the new generator regions.
  **KILL MUTANTS**: cover the interpolation source + example embedding.
  **REFACTOR**: assess primer section ordering for LLM consumption (one artifact, front-loaded
  grammar + schema).
  **Done when**: ACs met, dogfood evidence captured, human approves commit.

---

### Slice 7: Harden the harness for real model output — lenient extraction + hard-zero-distinct invalid — ✅ DONE (PR #86)

**Value**: The operator can feed a raw model reply (prose, ``json fences) and get a fair,
diagnostic result — including a clean, last-ranked "invalid" outcome with reasons.
**Path**: `npm run benchmark -- --from-reply <reply.txt>` (or auto-detect) → lenient extraction
(last fenced ``json block, else last top-level `{…}`) → `validate` → valid: run the gauntlet
(slice 1); invalid: emit a distinct **invalid** result ranked below every valid bot, carrying
the structured `ValidationError` issues.
**Required implementation skills**: `tdd`, `testing`, `mutation-testing`, `refactoring`;
`cli-design`.
**Acceptance criteria**:

- A pure `extractBotJson(text): string | null` with a deterministic, documented algorithm,
  identical for every model: (1) if the reply has fenced code blocks (`json or bare `),
  return the content of the **last** one; (2) else return the **last** balanced top-level `{…}`
  object; (3) else return `null`. Covered by tests over fenced / prose-wrapped / multi-block /
  no-JSON inputs.
- An invalid (post-extraction) bot produces a result object flagged `invalid` with the issues,
  and the report ranks it below any valid bot (a sort/comparison contract test).
- `null` extraction (no JSON found) **and** JSON that parses to a non-object (array/scalar) both
  flow to the **invalid** outcome — the latter via the existing validator (`asRecord` ⇒
  `version !== 1`) — each with a descriptive reason captured (e.g. "no bot JSON found in reply").
- No automated repair loop (one-shot preserved).
- Extraction is only applied in the `--from-reply` path; a direct `<bot.json>` still validates
  strictly (slice 1 behavior unchanged).
  **RED**: extraction tests (each input shape) + an invalid-ranking test. Mutator watch: the
  "last block" selection, the fenced-vs-bare fallback order, and the invalid-ranks-last comparison.
  **GREEN**: implement `extractBotJson` + wire the `--from-reply` path + the invalid result shape.
  **MUTATE**: Stryker on the extractor + ranking.
  **KILL MUTANTS**: cover fallback order + last-block selection + ranking boundary.
  **REFACTOR**: assess sharing the result/report types with slice 1.
  **Done when**: ACs met, human approves commit.

---

### Slice 8: Typed degrade telemetry + CLI stamina/reason view

**Value**: The human can see _why_ a bot underperformed (a requested move that degraded to
idle) and re-prompt the model effectively.
**Path**: `intake` records a typed reason when a neutral fighter’s requested action does not
take effect (`unaffordable` / `out-of-band` / `locked` / `inert` / `null`) → `FighterFrame`
carries `requestedAction` + `degrade` → `src/cli/format.ts` gains a stamina column and a degrade
marker (e.g. `idle ⟵ mawashi-geri: unaffordable`).
**Required implementation skills**: `tdd`, `testing`, `mutation-testing`, `refactoring`;
`cli-design`.
**Acceptance criteria**:

- `intake` (or a thin wrapper) returns/records a typed degrade reason without changing any
  outcome (pure-additive telemetry; determinism + byte-identical fights preserved — only the
  recorded frame metadata grows).
- `FighterFrame` gains `requestedAction: Action` and `degrade: DegradeReason | null`.
- `format.ts` shows a stamina column and renders the degrade reason in both `changes` and `full`
  modes; a formatter test asserts the rendering (incl. the gassed/unaffordable case from the
  session’s berserker trace).
- The benchmark report (slice 1/7) is unaffected (telemetry is opt-in to the fight view).
  **RED**: an `intake`/sim test asserting the reason for each degrade class (unaffordable kick
  while gassed, out-of-band `mae-geri high`, locked during recovery, inert unconfigured `sweep`),
  and a formatter test. Mutator watch: the reason-classification branches and the
  "outcome unchanged" guarantee.
  **GREEN**: thread the reason out of `intake`, extend `FighterFrame`, extend the formatter.
  **MUTATE**: Stryker on the classification + formatter.
  **KILL MUTANTS**: cover each reason class + the no-outcome-change invariant.
  **REFACTOR**: assess a single `degradeReasonOf` predicate.
  **Done when**: ACs met, fights remain byte-identical (telemetry-only change), human approves
  commit.

## Pre-PR Quality Gate (every slice)

1. Mutation testing — run `mutation-testing` (DSL/engine changes target the existing 100%
   interpreter / ~95%+ `sim.ts` bars).
2. Refactoring assessment — run `refactoring`.
3. `npm run typecheck` + `npm run lint` + `npm run format:check` pass.
4. Determinism check: where applicable, assert byte-identical replay / byte-identical fights for
   the absent-feature path.

## Sequencing notes

- **1 → (2,3,4) → 5a → 5b → 6 → 7 → 8.** Slice 1 is the walking skeleton (works with today’s
  DSL). 2–4 widen bot expressiveness (TCB changes) and must land before the spec so it documents
  the final DSL. 5a (factual Markdown + drift test) then 5b (embedded JSON Schema + agreement
  test) then 6 build the spec instrument (5b depends on 5a; 6 depends on 5b). 7 hardens the
  harness for real model replies (depends on 1). 8 is the human analysis aid (independent; last,
  non-blocking).
- 2, 3, 4 are mutually independent and could be authored/reviewed in parallel branches.
- The gauntlet roster references `bots/` (incl. PR #77’s session bots) — ensure those are merged
  before freezing the slice-1 manifest, or freeze against the pre-existing archetypes.

### Follow-up surfaced by the Slice 6 dogfood (NOT blocking Slice 6)

The dogfood proved the spec sufficient (after the cancel-routes fix) but exposed two **Slice-1**
issues that make "positive net vs > half" near-unreachable and limit the benchmark's discriminating
power. Sequence these via `grill-me` → `planning` before relying on the v1 score as a model
ranking (a `BENCHMARK_VERSION` bump):

- **Gauntlet balance**: `sweeper` is a **100%-win wall** (+4664, beats every opponent incl. rekka);
  `rekka` is +1303 (72%); `jabber` goes **0-wins**. A single dominant bot collapses the gauntlet's
  spread — rebalance (nerf the okizeme loop / reconsider the roster) so no opponent is unbeatable.
- **Metric vs match**: `runFight` scores **raw cumulative points over the full `maxTicks`** with **no
  WKF match-cap** (first-to-8 / lead-at-time), so the score rewards relentless okizeme-looping over
  _winning the match_. Decide whether the benchmark should score WKF match outcomes (the design's
  "points-only scoring with _yame_ resets") rather than raw 600-tick point totals.

---

_Delete this file when the plan is complete. If `plans/` is empty, delete the directory._
