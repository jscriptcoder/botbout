// ============================================================================
// The spec generator — emits the FACTUAL, machine-truth backbone of the bot
// authoring spec (`docs/spec.md`) straight from the engine's single sources:
// the `dsl.ts` allowlists + `LIMITS` (the grammar a bot may use), the
// `CANONICAL_RULES` frame table (the numbers it fights on), and the benchmark
// manifest (how it is scored). Every list and number is read from those imports
// — nothing is retyped — so the spec CANNOT drift from the engine (a drift test
// pins the committed `docs/spec.md` byte-for-byte to this output).
//
// `generateSpec()` is PURE and deterministic (no wall-clock): same engine ⇒ same
// bytes. The hand-authored strategic primer + validated example bots are a later
// slice; this is only the factual reference.
// ============================================================================
import {
  ACTION_TYPES,
  ALLOWED_FIELDS,
  ALLOWED_RULES,
  BANDS,
  BOOL_OPS,
  CELL_RE,
  LIMITS,
  MOVES,
  NUM_OPS,
  RULE_READERS,
} from "../engine/dsl.js";
import { CANONICAL_RULES } from "../engine/rules.js";
import type { MoveSpec, Rules } from "../engine/types.js";
import {
  BENCHMARK_VERSION,
  GAUNTLET_NAMES,
  INPUT_HASH,
  MAX_TICKS,
  SEEDS,
} from "../engine/benchmark-config.js";

// markdown inline-code span
const code = (s: string): string => "`" + s + "`";

const bullets = (items: Iterable<string>): string =>
  [...items].map((s) => `- ${code(s)}`).join("\n");

const header = (): string =>
  [
    "# ModelKombat — Bot authoring spec",
    "",
    "> **GENERATED — do not edit by hand.** Regenerate with `npm run gen:spec`.",
    "> Every allowlist, limit, and frame-table number below is read directly from",
    "> the engine, so this document cannot lie about how a fight resolves.",
    "",
    `- **Benchmark version:** \`${BENCHMARK_VERSION}\` — a score is comparable only against another at the same version.`,
    `- **Input hash:** \`${INPUT_HASH}\` (pins the scoring inputs: rules + gauntlet + run params).`,
    "",
    "A bot is a **JSON document, not code**: no I/O, no loops, no recursion. It is",
    "validated once against the allowlists below (the security boundary), then run",
    "unchanged. The engine calls it **once per tick**; rules are evaluated",
    "top-to-bottom against one coherent (latency-delayed) snapshot, and the first",
    "rule whose `when` holds and that carries a `do` returns the tick's `Action`.",
  ].join("\n");

const limitsSection = (): string =>
  [
    "## Limits",
    "",
    "Hard caps enforced at validation time — a document that exceeds any of these",
    "is rejected. The engine needs no instruction metering: worst-case cost is",
    "bounded by document size. Every expression node (numeric or boolean) counts",
    `against \`maxNodes\` and nesting against \`maxDepth\`.`,
    "",
    ...Object.entries(LIMITS).map(([k, v]) => `- ${code(k)} — ${v}`),
  ].join("\n");

const documentShapeSection = (): string =>
  [
    "## Document shape",
    "",
    "```jsonc",
    "{",
    '  "version": 1,',
    '  "name": "string (1..64 chars)",',
    '  "memory": { "cellName": 0 },   // optional: declared int cells, persist across ticks within a fight',
    '  "rules": [ <Rule>, ... ],      // priority-ordered; first matching `do` wins',
    '  "default": <Action>            // taken when no rule fires',
    "}",
    "```",
    "",
    "```jsonc",
    "// Rule: if `when` holds, apply `set` writes; a `do` (if present) is the terminal action.",
    "// A rule with no `do` is a TRACKER (updates memory, evaluation continues).",
    '{ "when": <BoolExpr>, "set": [ { "cell": "name", "to": <NumExpr> } ], "do": <Action> }',
    "```",
  ].join("\n");

const expressionsSection = (): string =>
  [
    "## Expressions",
    "",
    "All values are **fixed-point integers**. Arithmetic is **int32-saturating**:",
    `every op clamps its result to [\`${LIMITS.intMin}\`, \`${LIMITS.intMax}\`];`,
    "`div` truncates toward zero and division by zero yields `0`. These rules make",
    "every evaluation bit-reproducible across platforms.",
    "",
    "**Numeric expressions** (`NumExpr`):",
    "",
    `- leaves: ${code("const")} (\`{op:"const",value}\`), ${code("field")} (\`{op:"field",path}\`), ${code("mem")} (\`{op:"mem",cell}\`), ${code("rule")} (\`{op:"rule",path}\`)`,
    `- all ${code("op")} tags (leaves + arithmetic): ${NUM_OPS.map(code).join(", ")}`,
    "",
    "**Boolean expressions** (`BoolExpr`):",
    "",
    `- operators: ${BOOL_OPS.map(code).join(", ")}`,
  ].join("\n");

const stateReadsSection = (): string =>
  [
    "## State read surface (`field`)",
    "",
    'The whitelisted state leaves a bot may read via `{op:"field",path}`. Opponent',
    "fields are served from a latency-delayed snapshot (see the perception",
    "constants in the frame table); `opponent.points` is a live scoreboard read.",
    "",
    bullets(ALLOWED_FIELDS),
  ].join("\n");

const ruleReadsSection = (): string =>
  [
    "## Ruleset read surface (`rule`)",
    "",
    "The frozen frame-table constants a bot may read symbolically via",
    '`{op:"rule",path}` — e.g. `rule("moves.mae-geri.reach")` instead of the literal.',
    "An unconfigured constant reads the sentinel `0`. Their current values are in",
    "the frame table below.",
    "",
    bullets(ALLOWED_RULES),
  ].join("\n");

const actionGrammarSection = (): string =>
  [
    "## Action grammar",
    "",
    "A bot returns exactly **one** action per tick. `dir` is relative to facing:",
    "`+1` toward the opponent, `-1` away, `0` hold.",
    "",
    `- action types: ${ACTION_TYPES.map(code).join(", ")}`,
    `- ${code("attack")} takes a ${code("move")} and a ${code("band")}.`,
    `- attack moves: ${[...MOVES].map(code).join(", ")}`,
    `- bands: ${[...BANDS].map(code).join(", ")}`,
  ].join("\n");

const moveRow = (id: string, m: MoveSpec): string =>
  `| ${code(id)} | ${m.startup} | ${m.active} | ${m.recovery} | ${m.score} | ${m.reach} | ${m.staminaCost ?? 0} | ${(m.bands ?? []).join("/") || "—"} |`;

const frameTableSection = (rules: Rules): string => {
  // `Object.entries` widens optional move values to `MoveSpec | undefined`, but
  // an absent optional key yields NO entry at runtime — every enumerated value
  // is a real `MoveSpec`. The assertion drops that unreachable `undefined` (so
  // there is no dead guard branch); an unconfigured move shows up as a missing
  // key, simply contributing no row.
  const moves = Object.entries(rules.moves) as [string, MoveSpec][];
  const rows = moves.map(([id, m]) => moveRow(id, m));

  const globals = Object.entries(RULE_READERS)
    .filter(([path]) => !path.startsWith("moves."))
    .map(([path, read]) => `- ${code(path)} — ${read(rules)}`);

  return [
    "## Frame table",
    "",
    "The authoritative numbers the platform fights on (`CANONICAL_RULES`).",
    "",
    "### Techniques",
    "",
    "| technique | startup | active | recovery | score | reach | cost | bands |",
    "| --- | --- | --- | --- | --- | --- | --- | --- |",
    ...rows,
    "",
    "### Global constants",
    "",
    ...globals,
  ].join("\n");
};

const errorCatalogSection = (): string =>
  [
    "## Validation-error catalog",
    "",
    "A rejected document reports structured `{ path, reason }` issues. The reason",
    "families an author hits:",
    "",
    "- **node budget exceeded** — the document has more expression nodes than `maxNodes`.",
    "- **too deeply nested** — an expression exceeds `maxDepth`.",
    "- **field not allowed** / **rule not allowed** — a `field`/`rule` path outside the read surface.",
    "- **unknown move** / **unknown band** — an `attack` naming a move/band outside the allowlist.",
    "- **undeclared cell** — a `mem` read or `set` write to a cell not declared in `memory`.",
    "- **unknown numeric/boolean op** — an unrecognised expression operator.",
  ].join("\n");

const benchmarkSection = (): string =>
  [
    "## Benchmark rules",
    "",
    "A submitted bot is scored deterministically against a frozen, versioned",
    "gauntlet — the spec is the only input; there is no feedback loop.",
    "",
    `- ${code("metric")} — Σ net-points over every (opponent × seed × side) fight; win-rate breaks ties.`,
    `- ${code("seeds")} — ${SEEDS[0]}..${SEEDS[SEEDS.length - 1]} (${SEEDS.length} seeds), each matchup played twice (bot as A and as B).`,
    `- ${code("maxTicks")} — ${MAX_TICKS}`,
    "- gauntlet opponents:",
    ...GAUNTLET_NAMES.map((n) => `  - ${code(n)}`),
  ].join("\n");

/**
 * A JSON Schema (draft-07) for the bot document. A deliberate **permissive
 * structural over-approximation** of `validate()`: it enforces shape, the
 * allowlists (enum membership sourced from the same `dsl.ts` sets the markdown
 * renders), and expression arities — but CANNOT encode the node budget, max
 * nesting depth, the byte cap, or declared-before-use cells, so `validate()`
 * stays the authority. `additionalProperties` is left open because the validator
 * ignores extra keys ⇒ everything `validate()` accepts, the schema accepts.
 */
export function botDocSchema(): Record<string, unknown> {
  const ref = (name: string): { $ref: string } => ({
    $ref: `#/definitions/${name}`,
  });

  // a `NumExpr`/`BoolExpr`/`Action` variant: pin the discriminator, require its
  // operand(s) — `oneOf` selects exactly one because the discriminators are
  // disjoint consts/enums.
  const variant = (
    disc: string,
    tag: Record<string, unknown>,
    required: string[],
    properties: Record<string, unknown>,
  ): Record<string, unknown> => ({
    type: "object",
    required: [disc, ...required],
    properties: { [disc]: tag, ...properties },
  });

  const dir = { enum: [-1, 0, 1] };

  return {
    $schema: "http://json-schema.org/draft-07/schema#",
    $ref: "#/definitions/BotDoc",
    definitions: {
      BotDoc: {
        type: "object",
        required: ["version", "name", "rules", "default"],
        properties: {
          version: { const: 1 },
          name: { type: "string", minLength: 1, maxLength: 64 },
          memory: {
            type: "object",
            maxProperties: LIMITS.maxCells,
            propertyNames: { pattern: CELL_RE.source },
            additionalProperties: { type: "integer" },
          },
          rules: {
            type: "array",
            maxItems: LIMITS.maxRules,
            items: ref("Rule"),
          },
          default: ref("Action"),
        },
      },
      Rule: {
        type: "object",
        required: ["when"],
        properties: {
          when: ref("BoolExpr"),
          set: {
            type: "array",
            items: {
              type: "object",
              required: ["cell", "to"],
              properties: { cell: { type: "string" }, to: ref("NumExpr") },
            },
          },
          do: ref("Action"),
        },
      },
      fieldPath: { type: "string", enum: [...ALLOWED_FIELDS] },
      rulePath: { type: "string", enum: [...ALLOWED_RULES] },
      move: { type: "string", enum: [...MOVES] },
      band: { type: "string", enum: [...BANDS] },
      NumExpr: {
        oneOf: [
          variant("op", { const: "const" }, ["value"], {
            value: {
              type: "integer",
              minimum: LIMITS.intMin,
              maximum: LIMITS.intMax,
            },
          }),
          variant("op", { const: "field" }, ["path"], {
            path: ref("fieldPath"),
          }),
          variant("op", { const: "mem" }, ["cell"], {
            cell: { type: "string" },
          }),
          variant("op", { const: "rule" }, ["path"], { path: ref("rulePath") }),
          variant("op", { enum: ["add", "mul", "min", "max"] }, ["args"], {
            args: { type: "array", minItems: 1, items: ref("NumExpr") },
          }),
          variant("op", { enum: ["sub", "div"] }, ["args"], {
            args: {
              type: "array",
              minItems: 2,
              maxItems: 2,
              items: ref("NumExpr"),
            },
          }),
          variant("op", { enum: ["neg", "abs"] }, ["arg"], {
            arg: ref("NumExpr"),
          }),
        ],
      },
      BoolExpr: {
        oneOf: [
          variant(
            "op",
            { enum: ["gt", "lt", "gte", "lte", "eq", "neq"] },
            ["args"],
            {
              args: {
                type: "array",
                minItems: 2,
                maxItems: 2,
                items: ref("NumExpr"),
              },
            },
          ),
          variant("op", { enum: ["and", "or"] }, ["args"], {
            args: { type: "array", minItems: 1, items: ref("BoolExpr") },
          }),
          variant("op", { const: "not" }, ["arg"], { arg: ref("BoolExpr") }),
        ],
      },
      Action: {
        oneOf: [
          variant("type", { const: "idle" }, [], {}),
          variant("type", { const: "move" }, ["dir"], { dir }),
          variant("type", { const: "block" }, ["band"], { band: ref("band") }),
          variant("type", { const: "crouch" }, [], {}),
          variant("type", { const: "jump" }, ["dir"], { dir }),
          variant("type", { const: "attack" }, ["move", "band"], {
            move: ref("move"),
            band: ref("band"),
          }),
          variant("type", { const: "sweep" }, [], {}),
          variant("type", { const: "throw" }, [], {}),
          variant("type", { const: "throw-break" }, [], {}),
        ],
      },
    },
  };
}

const jsonSchemaSection = (): string =>
  [
    "## JSON Schema",
    "",
    "A draft-07 JSON Schema for the bot document — a permissive structural",
    "over-approximation of the validator (enum membership sourced from the same",
    "allowlists above). It enforces shape, the allowlists, and expression arities,",
    "but CANNOT encode the node budget, max nesting depth, the byte cap, or",
    "declared-before-use cells — the `validate()` gate remains the authority.",
    "",
    "```json",
    JSON.stringify(botDocSchema(), null, 2),
    "```",
  ].join("\n");

/**
 * The committed `docs/spec.md` content — pure, deterministic, drift-tested.
 * `rules` defaults to `CANONICAL_RULES` (the frozen platform table); it is a
 * parameter only so the frame table can be exercised against an alternate
 * ruleset (e.g. one omitting an optional move).
 */
export function generateSpec(rules: Rules = CANONICAL_RULES): string {
  return (
    [
      header(),
      limitsSection(),
      documentShapeSection(),
      expressionsSection(),
      stateReadsSection(),
      ruleReadsSection(),
      actionGrammarSection(),
      frameTableSection(rules),
      errorCatalogSection(),
      jsonSchemaSection(),
      benchmarkSection(),
    ].join("\n\n") + "\n"
  );
}
