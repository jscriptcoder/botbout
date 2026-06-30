import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { Ajv } from "ajv";

import { botDocSchema } from "./gen-spec.js";
import {
  ACTION_TYPES,
  ALLOWED_FIELDS,
  ALLOWED_RULES,
  BANDS,
  BOOL_OPS,
  MOVES,
  NUM_OPS,
  validate,
} from "../engine/dsl.js";

// Navigation shape for asserting the schema's enums/variants (test-only view of
// the JSON Schema data — the schema is the artifact under test).
type Variant = {
  properties: Record<
    string,
    { const?: string | number; enum?: (string | number)[] }
  >;
};
type SchemaNode = { enum?: (string | number)[]; oneOf?: Variant[] };

const defsOf = (): Record<string, SchemaNode> =>
  (botDocSchema() as { definitions: Record<string, SchemaNode> }).definitions;

// The op/type tags a `oneOf` covers, gathered across its variants' discriminator
// (`const` or `enum`) on `key` — so the union must equal the source allowlist.
const tagsOf = (variants: Variant[], key: string): (string | number)[] =>
  variants.flatMap((v) => {
    const disc = v.properties[key];

    return disc.const !== undefined ? [disc.const] : (disc.enum ?? []);
  });

const compiled = () => new Ajv({ strict: false }).compile(botDocSchema());

const botFiles = (): string[] => {
  const dir = fileURLToPath(new URL("../../bots", import.meta.url));

  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => `${dir}/${f}`);
};

// A valid doc exercising the features the bots/ corpus does NOT use — rule(),
// crouch, jump, mem/set/memory — so the agreement test covers the whole grammar.
const kitchenSink = (): unknown => ({
  version: 1,
  name: "kitchen-sink",
  memory: { acc: 0 },
  rules: [
    {
      when: {
        op: "gt",
        args: [
          { op: "rule", path: "moves.gyaku-zuki.reach" },
          { op: "const", value: 0 },
        ],
      },
      set: [
        {
          cell: "acc",
          to: {
            op: "add",
            args: [
              { op: "mem", cell: "acc" },
              { op: "const", value: 1 },
            ],
          },
        },
      ],
      do: { type: "crouch" },
    },
    {
      when: {
        op: "eq",
        args: [
          { op: "field", path: "self.canAct" },
          { op: "const", value: 1 },
        ],
      },
      do: { type: "jump", dir: 0 },
    },
  ],
  default: { type: "idle" },
});

describe("bot-doc JSON Schema agrees with validate()", () => {
  it("is a valid schema that ajv compiles", () => {
    expect(() => compiled()).not.toThrow();
  });

  it("accepts every bot the validator accepts (corpus ⊆ schema)", () => {
    const check = compiled();

    for (const file of botFiles()) {
      const doc: unknown = JSON.parse(readFileSync(file, "utf8"));

      if (validate(doc).ok) {
        expect(
          check(doc),
          `${file}: validate() accepts but schema rejects`,
        ).toBe(true);
      }
    }
  });

  it("accepts a kitchen-sink doc using rule(), crouch, jump in BOTH gates", () => {
    const doc = kitchenSink();
    expect(validate(doc).ok).toBe(true);
    expect(compiled()(doc)).toBe(true);
  });

  it("rejects a structurally-invalid doc in BOTH gates", () => {
    const badVersion = {
      version: 2,
      name: "x",
      rules: [],
      default: { type: "idle" },
    };

    expect(validate(badVersion).ok).toBe(false);
    expect(compiled()(badVersion)).toBe(false);

    const unknownMove = {
      version: 1,
      name: "x",
      rules: [],
      default: { type: "attack", move: "hadouken", band: "mid" },
    };

    expect(validate(unknownMove).ok).toBe(false);
    expect(compiled()(unknownMove)).toBe(false);
  });
});

describe("schema enums are sourced from the live dsl.ts allowlists", () => {
  it("field-path and rule-path enums equal their allowlists", () => {
    const defs = defsOf();
    expect(new Set(defs.fieldPath.enum)).toEqual(new Set(ALLOWED_FIELDS));
    expect(new Set(defs.rulePath.enum)).toEqual(new Set(ALLOWED_RULES));
  });

  it("move and band enums equal their allowlists", () => {
    const defs = defsOf();
    expect(new Set(defs.move.enum)).toEqual(new Set(MOVES));
    expect(new Set(defs.band.enum)).toEqual(new Set(BANDS));
  });

  it("NumExpr / BoolExpr / Action variants cover exactly the op & action tags", () => {
    const defs = defsOf();
    expect(new Set(tagsOf(defs.NumExpr.oneOf ?? [], "op"))).toEqual(
      new Set(NUM_OPS),
    );
    expect(new Set(tagsOf(defs.BoolExpr.oneOf ?? [], "op"))).toEqual(
      new Set(BOOL_OPS),
    );
    expect(new Set(tagsOf(defs.Action.oneOf ?? [], "type"))).toEqual(
      new Set(ACTION_TYPES),
    );
  });
});
