import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { generateSpec } from "./gen-spec.js";
import {
  ACTION_TYPES,
  ALLOWED_FIELDS,
  ALLOWED_RULES,
  BANDS,
  BOOL_OPS,
  LIMITS,
  MOVES,
  NUM_OPS,
  validate,
} from "../engine/dsl.js";
import { CANONICAL_RULES } from "../engine/rules.js";
import type { Rules } from "../engine/types.js";
import {
  BENCHMARK_VERSION,
  GAUNTLET_NAMES,
  INPUT_HASH,
  MAX_TICKS,
  SEEDS,
} from "../engine/benchmark-config.js";

// Inline-code span: the spec renders every allowlist member as markdown `code`,
// so a short token (a band `mid`, a bool op `or`/`and`/`not`) is asserted against
// its code-spanned form, not bare prose where it would trivially match. The
// backtick fence also makes `gyaku-zuki` distinct from `moves.gyaku-zuki.reach`.
const code = (s: string): string => "`" + s + "`";

// The line where the code-spanned `token` co-occurs with `value`. Order-
// independent (a token may be code-spanned in several sections — the allowlist
// AND the frame table — so we want the one line that PAIRS it with its value,
// killing value-swap mutants a bare `toContain` would miss).
const pairingLine = (
  spec: string,
  token: string,
  value: number,
): string | undefined =>
  spec
    .split("\n")
    .find((l) => l.includes(code(token)) && l.includes(String(value)));

// The body of a `## heading` section, exclusive of the heading and the next
// `## ` heading — so an assertion targets ONE section's prose (a value cited in
// the primer is not confused with the same value in the frame table).
const sectionOf = (spec: string, heading: string): string => {
  const lines = spec.split("\n");
  const start = lines.indexOf(heading);
  if (start < 0) return "";

  const rest = lines.slice(start + 1);
  const end = rest.findIndex((l) => l.startsWith("## "));

  return (end < 0 ? rest : rest.slice(0, end)).join("\n");
};

describe("generateSpec — the factual machine-truth spec", () => {
  it("is pure: byte-stable across calls (no wall-clock)", () => {
    expect(generateSpec()).toBe(generateSpec());
  });

  describe("header", () => {
    it("carries the benchmark version and input hash from the manifest", () => {
      const spec = generateSpec();
      expect(spec).toContain(BENCHMARK_VERSION);
      expect(spec).toContain(INPUT_HASH);
    });
  });

  describe("LIMITS", () => {
    it("renders every limit paired with its value on one line", () => {
      const spec = generateSpec();

      for (const [k, v] of Object.entries(LIMITS)) {
        expect(pairingLine(spec, k, v), `LIMITS.${k} = ${v}`).toBeDefined();
      }
    });
  });

  describe("grammar allowlists (sourced from dsl.ts)", () => {
    it("lists every numeric op as inline code", () => {
      const spec = generateSpec();
      for (const op of NUM_OPS) expect(spec).toContain(code(op));
    });

    it("lists every boolean op as inline code", () => {
      const spec = generateSpec();
      for (const op of BOOL_OPS) expect(spec).toContain(code(op));
    });

    it("lists every action type as inline code", () => {
      const spec = generateSpec();
      for (const t of ACTION_TYPES) expect(spec).toContain(code(t));
    });

    it("lists every attack move as inline code", () => {
      const spec = generateSpec();
      for (const m of MOVES) expect(spec).toContain(code(m));
    });

    it("lists every band as inline code", () => {
      const spec = generateSpec();
      for (const b of BANDS) expect(spec).toContain(code(b));
    });

    it("lists every readable field path as inline code", () => {
      const spec = generateSpec();
      for (const f of ALLOWED_FIELDS) expect(spec).toContain(code(f));
    });

    it("lists every readable rule path as inline code", () => {
      const spec = generateSpec();
      for (const r of ALLOWED_RULES) expect(spec).toContain(code(r));
    });
  });

  describe("frame table (sourced from CANONICAL_RULES)", () => {
    it("pairs each move with its reach", () => {
      const spec = generateSpec();

      for (const [id, move] of Object.entries(CANONICAL_RULES.moves)) {
        expect(pairingLine(spec, id, move.reach), `${id} reach`).toBeDefined();
      }
    });

    it("renders the perception latencies from the rules", () => {
      const spec = generateSpec();
      const lAct = CANONICAL_RULES.perception?.lAct ?? 0;
      const lPos = CANONICAL_RULES.perception?.lPos ?? 0;
      expect(pairingLine(spec, "perception.lAct", lAct)).toBeDefined();
      expect(pairingLine(spec, "perception.lPos", lPos)).toBeDefined();
    });

    it("shows each move's cancel-into routes (the okizeme/rekka follow-ups)", () => {
      const lines = generateSpec().split("\n");

      for (const [id, move] of Object.entries(CANONICAL_RULES.moves)) {
        const row = lines.find((l) => l.startsWith(`| ${code(id)} |`));
        expect(row, `${id} row`).toBeDefined();

        for (const target of move.cancelInto ?? []) {
          expect(row, `${id} cancels into ${target}`).toContain(target);
        }
      }
    });

    it("renders `—` for a move with no cancel routes", () => {
      const gyaku = { ...CANONICAL_RULES.moves["gyaku-zuki"] };

      delete gyaku.cancelInto;

      const rules: Rules = {
        ...CANONICAL_RULES,
        moves: { ...CANONICAL_RULES.moves, "gyaku-zuki": gyaku },
      };

      const row = generateSpec(rules)
        .split("\n")
        .find((l) => l.startsWith(`| ${code("gyaku-zuki")} |`));

      expect(row?.endsWith("| — |")).toBe(true);
    });

    it("lists only configured techniques — an unconfigured move gets no row", () => {
      const rulesNoSweep: Rules = {
        ...CANONICAL_RULES,
        moves: { ...CANONICAL_RULES.moves },
      };

      delete rulesNoSweep.moves.sweep;
      const lines = generateSpec(rulesNoSweep).split("\n");
      const sep = lines.findIndex((l) => l.startsWith("| --- |"));
      const body = lines.slice(sep + 1, lines.indexOf("", sep + 1));

      // the techniques table body holds ONLY valid rows (no stray cell for the
      // dropped move), and the dropped move is absent from it
      expect(body.length).toBe(Object.keys(rulesNoSweep.moves).length);
      for (const row of body) expect(row.startsWith("| ")).toBe(true);
      expect(body.some((r) => r.includes(code("sweep")))).toBe(false);
    });
  });

  describe("benchmark rules (sourced from the manifest)", () => {
    it("names every frozen gauntlet opponent", () => {
      const spec = generateSpec();
      for (const name of GAUNTLET_NAMES) expect(spec).toContain(name);
    });

    it("states the seed range and tick budget", () => {
      const spec = generateSpec();
      const seedLine = spec.split("\n").find((l) => l.includes(code("seeds")));
      expect(seedLine).toContain(String(SEEDS[0]));
      expect(seedLine).toContain(String(SEEDS[SEEDS.length - 1]));
      expect(pairingLine(spec, "maxTicks", MAX_TICKS)).toBeDefined();
    });
  });

  describe("validation-error catalog", () => {
    it("documents the reason families an author will hit", () => {
      const spec = generateSpec();
      expect(spec).toContain("node budget");
      expect(spec).toContain("not allowed");
      expect(spec).toContain("unknown move");
      expect(spec).toContain("undeclared cell");
    });
  });

  describe("strategic primer (interpolated from the rules)", () => {
    const HEADING = "## Strategy primer";
    const lAct = CANONICAL_RULES.perception?.lAct ?? 0;
    const gasThreshold = CANONICAL_RULES.stamina?.gasThreshold ?? 0;

    // The primer line carrying a given claim — found by a stable concept phrase,
    // so the asserted value is the one PAIRED with that claim (not a coincidental
    // match elsewhere in the section).
    const claimLine = (primer: string, phrase: string): string =>
      primer.split("\n").find((l) => l.includes(phrase)) ?? "";

    it("is its own section, placed after the frame table and before benchmark rules", () => {
      const spec = generateSpec();
      expect(sectionOf(spec, HEADING)).not.toBe("");
      expect(spec.indexOf("## Frame table")).toBeLessThan(
        spec.indexOf(HEADING),
      );
      expect(spec.indexOf(HEADING)).toBeLessThan(
        spec.indexOf("## Benchmark rules"),
      );
    });

    it("cites the canonical perception, okizeme, and gas constants", () => {
      const primer = sectionOf(generateSpec(), HEADING);
      const reactable = claimLine(primer, "reactable iff");
      expect(reactable).toContain(code(String(lAct)));
      expect(reactable).toContain(code(String(lAct + 1)));
      expect(claimLine(primer, "FINISH")).toContain(
        code(String(CANONICAL_RULES.finishScore)),
      );
      expect(claimLine(primer, "GASSED")).toContain(code(String(gasThreshold)));
    });

    it("interpolates from the rules — a retune updates the prose (no hardcoded literals)", () => {
      const retuned: Rules = {
        ...CANONICAL_RULES,
        perception: { lPos: 2, lAct: 9, jitter: 1 },
        finishScore: 5,
        stamina: {
          ...(CANONICAL_RULES.stamina ?? { max: 100 }),
          gasThreshold: 25,
        },
      };

      const primer = sectionOf(generateSpec(retuned), HEADING);
      const reactable = claimLine(primer, "reactable iff");
      expect(reactable).toContain(code("9")); // retuned lAct
      expect(reactable).toContain(code("10")); // retuned lAct + 1
      expect(claimLine(primer, "FINISH")).toContain(code("5")); // retuned finishScore
      expect(claimLine(primer, "GASSED")).toContain(code("25")); // retuned gasThreshold
    });

    it("collapses absent optional constants to the sentinel `0` — never throws, never renders `undefined`", () => {
      const bare: Rules = { ...CANONICAL_RULES };

      delete bare.perception;
      delete bare.throw;
      delete bare.stamina;

      const primer = sectionOf(generateSpec(bare), HEADING);
      expect(primer).not.toContain("undefined");
      expect(claimLine(primer, "reactable iff")).toContain(code("0")); // lAct sentinel
      expect(claimLine(primer, "triangle")).toContain(code("0")); // throw.reach sentinel
      expect(claimLine(primer, "GASSED")).toContain(code("0")); // stamina sentinel
    });
  });

  describe("example bots (embedded verbatim + validated)", () => {
    const EXAMPLES = ["jabber", "vulture", "rekka"];

    // The committed (LF) content of a bot fixture — normalized so the assertion
    // holds regardless of the working-tree EOL (bots/*.json are `i/lf w/crlf` on
    // Windows; the embed and the LF-pinned spec.md are LF).
    const readBot = (name: string): string =>
      readFileSync(
        fileURLToPath(new URL(`../../bots/${name}.json`, import.meta.url)),
        "utf8",
      )
        .replace(/\r\n/g, "\n")
        .trim();

    // The ```json fenced blocks inside a markdown section.
    const jsonBlocks = (md: string): string[] =>
      md
        .split("```json")
        .slice(1)
        .map((part) => part.slice(0, part.indexOf("```")).trim());

    it("embeds exactly the three examples, each verbatim and validate()-accepted", () => {
      const blocks = jsonBlocks(sectionOf(generateSpec(), "## Example bots"));

      expect(blocks).toHaveLength(EXAMPLES.length);

      for (const name of EXAMPLES) {
        const verbatim = readBot(name);
        expect(blocks, `${name} embedded verbatim`).toContain(verbatim);
        expect(validate(JSON.parse(verbatim)).ok, `${name} validates`).toBe(
          true,
        );
      }
    });

    it("places the examples after the strategy primer, before benchmark rules", () => {
      const spec = generateSpec();
      expect(spec.indexOf("## Strategy primer")).toBeLessThan(
        spec.indexOf("## Example bots"),
      );
      expect(spec.indexOf("## Example bots")).toBeLessThan(
        spec.indexOf("## Benchmark rules"),
      );
    });
  });
});

describe("docs/spec.md is the committed, drift-free generator output", () => {
  it("byte-matches a fresh generateSpec()", () => {
    const specPath = fileURLToPath(
      new URL("../../docs/spec.md", import.meta.url),
    );

    const committed = readFileSync(specPath, "utf8");
    expect(committed).toBe(generateSpec());
  });
});
