import { describe, it, expect } from "vitest";
import {
  validate,
  safeParse,
  LIMITS,
  type BotDoc,
  type FieldPath,
} from "./dsl.js";

// A complete, well-formed bot document. Overrides customize valid variations;
// invalid cases are built by spreading into a plain object (validate takes
// `unknown`, so no type assertions are needed at the call site).
const getMockBotDoc = (overrides?: Partial<BotDoc>): BotDoc => ({
  version: 1,
  name: "test-bot",
  memory: { hits: 0 },
  rules: [
    {
      when: {
        op: "gte",
        args: [
          { op: "field", path: "self.canAct" },
          { op: "const", value: 1 },
        ],
      },
      do: { type: "move", dir: 1 },
    },
  ],
  default: { type: "idle" },
  ...overrides,
});

describe("validate — bot intake gate", () => {
  it("accepts a minimal well-formed bot", () => {
    const result = validate(getMockBotDoc());
    expect(result.ok).toBe(true);
    expect(result.issues).toEqual([]);
  });

  describe("document envelope", () => {
    it("rejects a version other than 1", () => {
      const result = validate({ ...getMockBotDoc(), version: 2 });
      expect(result.ok).toBe(false);
      expect(result.issues).toContainEqual(
        expect.objectContaining({ path: "version" }),
      );
    });

    it("rejects a missing name", () => {
      const { name: _omit, ...noName } = getMockBotDoc();
      const result = validate(noName);
      expect(result.ok).toBe(false);
      expect(result.issues).toContainEqual(
        expect.objectContaining({ path: "name" }),
      );
    });

    it("accepts a name of exactly 64 characters", () => {
      const result = validate(getMockBotDoc({ name: "a".repeat(64) }));
      expect(result.ok).toBe(true);
    });

    it("rejects a name of 65 characters", () => {
      const result = validate(getMockBotDoc({ name: "a".repeat(65) }));
      expect(result.ok).toBe(false);
      expect(result.issues).toContainEqual(
        expect.objectContaining({ path: "name" }),
      );
    });
  });

  describe("expression allowlists", () => {
    it("rejects an unknown numeric op", () => {
      const doc = getMockBotDoc({
        rules: [
          {
            when: {
              op: "gt",
              args: [
                { op: "pow", args: [{ op: "const", value: 2 }] },
                { op: "const", value: 1 },
              ],
            },
            do: { type: "idle" },
          },
        ],
      } as unknown as Partial<BotDoc>);

      const result = validate(doc);
      expect(result.ok).toBe(false);
    });

    it("rejects an unknown boolean op", () => {
      const doc = {
        ...getMockBotDoc(),
        rules: [{ when: { op: "xnor", args: [] }, do: { type: "idle" } }],
      };

      const result = validate(doc);
      expect(result.ok).toBe(false);
    });

    it("rejects a field that is not on the allowlist", () => {
      const doc = {
        ...getMockBotDoc(),
        rules: [
          {
            when: {
              op: "gt",
              args: [
                { op: "field", path: "self.hp" },
                { op: "const", value: 0 },
              ],
            },
            do: { type: "idle" },
          },
        ],
      };

      const result = validate(doc);
      expect(result.ok).toBe(false);
      expect(result.issues).toContainEqual(
        expect.objectContaining({ reason: expect.stringContaining("self.hp") }),
      );
    });

    it("accepts an allowlisted field (opponent.distance)", () => {
      const result = validate(
        getMockBotDoc({
          rules: [
            {
              when: {
                op: "lte",
                args: [
                  { op: "field", path: "opponent.distance" },
                  { op: "const", value: 100 },
                ],
              },
              do: { type: "attack", move: "strike", band: "mid" },
            },
          ],
        }),
      );

      expect(result.ok).toBe(true);
    });
  });

  describe("memory cells", () => {
    it("rejects reading an undeclared cell", () => {
      const doc = {
        ...getMockBotDoc(),
        memory: {},
        rules: [
          {
            when: {
              op: "gt",
              args: [
                { op: "mem", cell: "ghost" },
                { op: "const", value: 0 },
              ],
            },
            do: { type: "idle" },
          },
        ],
      };

      const result = validate(doc);
      expect(result.ok).toBe(false);
      expect(result.issues).toContainEqual(
        expect.objectContaining({ reason: expect.stringContaining("ghost") }),
      );
    });

    it("rejects writing an undeclared cell in a set", () => {
      const doc = {
        ...getMockBotDoc(),
        memory: {},
        rules: [
          {
            when: {
              op: "gt",
              args: [
                { op: "const", value: 1 },
                { op: "const", value: 0 },
              ],
            },
            set: [{ cell: "ghost", to: { op: "const", value: 1 } }],
            do: { type: "idle" },
          },
        ],
      };

      const result = validate(doc);
      expect(result.ok).toBe(false);
    });

    it("rejects a cell name that breaks the naming rule", () => {
      const result = validate(getMockBotDoc({ memory: { "1bad": 0 } }));
      expect(result.ok).toBe(false);
    });
  });

  describe("action grammar", () => {
    it("rejects an unknown action type", () => {
      const doc = {
        ...getMockBotDoc(),
        default: { type: "teleport" },
      };

      expect(validate(doc).ok).toBe(false);
    });

    it("rejects a move with an out-of-range dir", () => {
      const doc = { ...getMockBotDoc(), default: { type: "move", dir: 2 } };
      expect(validate(doc).ok).toBe(false);
    });

    it("rejects an attack with an unknown move id", () => {
      const doc = {
        ...getMockBotDoc(),
        default: { type: "attack", move: "fireball", band: "mid" },
      };

      expect(validate(doc).ok).toBe(false);
    });

    it("rejects a block with an unknown band", () => {
      const doc = {
        ...getMockBotDoc(),
        default: { type: "block", band: "behind" },
      };

      expect(validate(doc).ok).toBe(false);
    });

    it("accepts the crouch action", () => {
      const doc = { ...getMockBotDoc(), default: { type: "crouch" } };
      expect(validate(doc).ok).toBe(true);
    });

    it("accepts the throw action", () => {
      const doc = { ...getMockBotDoc(), default: { type: "throw" } };
      expect(validate(doc).ok).toBe(true);
    });

    it.each([-1, 0, 1] as const)(
      "accepts the jump action with dir %i",
      (dir) => {
        const doc = getMockBotDoc({ default: { type: "jump", dir } });
        expect(validate(doc).ok).toBe(true);
      },
    );

    it("rejects a jump with an out-of-range dir", () => {
      const doc = { ...getMockBotDoc(), default: { type: "jump", dir: 2 } };
      expect(validate(doc).ok).toBe(false);
    });

    it("accepts every skeleton action form", () => {
      const result = validate(
        getMockBotDoc({
          rules: [
            {
              when: {
                op: "eq",
                args: [
                  { op: "const", value: 1 },
                  { op: "const", value: 1 },
                ],
              },
              do: { type: "block", band: "high" },
            },
            {
              when: {
                op: "eq",
                args: [
                  { op: "const", value: 1 },
                  { op: "const", value: 1 },
                ],
              },
              do: { type: "attack", move: "strike", band: "low" },
            },
            {
              when: {
                op: "eq",
                args: [
                  { op: "const", value: 1 },
                  { op: "const", value: 1 },
                ],
              },
              do: { type: "move", dir: -1 },
            },
          ],
          default: { type: "idle" },
        }),
      );

      expect(result.ok).toBe(true);
    });
  });

  describe("static limits", () => {
    it("accepts exactly maxRules rules", () => {
      const oneRule = getMockBotDoc().rules[0];

      const result = validate(
        getMockBotDoc({
          rules: Array.from({ length: LIMITS.maxRules }, () => oneRule),
        }),
      );

      expect(result.ok).toBe(true);
    });

    it("rejects one rule over maxRules", () => {
      const oneRule = getMockBotDoc().rules[0];

      const result = validate(
        getMockBotDoc({
          rules: Array.from({ length: LIMITS.maxRules + 1 }, () => oneRule),
        }),
      );

      expect(result.ok).toBe(false);
    });

    it("rejects more than maxCells declared cells", () => {
      const memory: Record<string, number> = {};
      for (let i = 0; i < LIMITS.maxCells + 1; i++) memory[`c${i}`] = 0;
      const result = validate(getMockBotDoc({ memory }));
      expect(result.ok).toBe(false);
    });
  });

  describe("composition and budgets", () => {
    it("accepts and/or/not composed over comparisons", () => {
      const result = validate(
        getMockBotDoc({
          rules: [
            {
              when: {
                op: "and",
                args: [
                  {
                    op: "or",
                    args: [
                      {
                        op: "lt",
                        args: [
                          { op: "field", path: "opponent.distance" },
                          { op: "const", value: 50 },
                        ],
                      },
                      {
                        op: "neq",
                        args: [
                          { op: "field", path: "self.facing" },
                          { op: "const", value: 0 },
                        ],
                      },
                    ],
                  },
                  {
                    op: "not",
                    arg: {
                      op: "eq",
                      args: [
                        { op: "field", path: "self.canAct" },
                        { op: "const", value: 0 },
                      ],
                    },
                  },
                ],
              },
              do: { type: "attack", move: "strike", band: "mid" },
            },
          ],
        }),
      );

      expect(result.ok).toBe(true);
    });

    it("rejects a document exceeding the node budget", () => {
      const many = Array.from({ length: 1400 }, () => ({
        op: "eq",
        args: [
          { op: "const", value: 1 },
          { op: "const", value: 1 },
        ],
      }));

      const doc = {
        ...getMockBotDoc(),
        rules: [{ when: { op: "and", args: many }, do: { type: "idle" } }],
      };

      expect(validate(doc).ok).toBe(false);
    });

    it("rejects an over-nested expression", () => {
      let expr: unknown = {
        op: "eq",
        args: [
          { op: "const", value: 1 },
          { op: "const", value: 1 },
        ],
      };

      for (let i = 0; i < 40; i++) expr = { op: "not", arg: expr };

      const doc = {
        ...getMockBotDoc(),
        rules: [{ when: expr, do: { type: "idle" } }],
      };

      expect(validate(doc).ok).toBe(false);
    });
  });

  describe("hardening — structure, integers, boundaries", () => {
    const allowedFields: FieldPath[] = [
      "self.x",
      "self.facing",
      "self.points",
      "self.canAct",
      "self.phaseRemaining",
      "self.counterWindow",
      "self.cancelWindow",
      "opponent.x",
      "opponent.facing",
      "opponent.distance",
      "opponent.y",
      "opponent.posture",
      "ring.width",
      "clock.tick",
      "clock.ticksRemaining",
    ];

    it.each(allowedFields)("accepts reading the allowed field %s", (path) => {
      const result = validate(
        getMockBotDoc({
          rules: [
            {
              when: {
                op: "gte",
                args: [
                  { op: "field", path },
                  { op: "const", value: 0 },
                ],
              },
              do: { type: "idle" },
            },
          ],
        }),
      );

      expect(result.ok).toBe(true);
    });

    it.each([[null], [undefined], [42], ["nope"], [[]]])(
      "rejects a non-object document (%s)",
      (bad) => {
        expect(validate(bad).ok).toBe(false);
      },
    );

    it("accepts a bot that declares no memory", () => {
      const { memory: _omit, ...noMemory } = getMockBotDoc();
      expect(validate(noMemory).ok).toBe(true);
    });

    it("rejects an empty name", () => {
      expect(validate(getMockBotDoc({ name: "" })).ok).toBe(false);
    });

    it("accepts a single-character name", () => {
      expect(validate(getMockBotDoc({ name: "x" })).ok).toBe(true);
    });

    it("rejects a non-integer const value", () => {
      const doc = {
        ...getMockBotDoc(),
        rules: [
          {
            when: {
              op: "gt",
              args: [
                { op: "const", value: 1.5 },
                { op: "const", value: 0 },
              ],
            },
            do: { type: "idle" },
          },
        ],
      };

      expect(validate(doc).ok).toBe(false);
    });

    it("rejects a non-integer memory initial value", () => {
      expect(validate(getMockBotDoc({ memory: { drift: 1.5 } })).ok).toBe(
        false,
      );
    });

    it("accepts exactly maxCells declared cells", () => {
      const memory: Record<string, number> = {};
      for (let i = 0; i < LIMITS.maxCells; i++) memory[`c${i}`] = 0;
      expect(validate(getMockBotDoc({ memory })).ok).toBe(true);
    });

    it("rejects an over-long cell name", () => {
      expect(
        validate(getMockBotDoc({ memory: { ["a".repeat(33)]: 0 } })).ok,
      ).toBe(false);
    });

    it("rejects a comparison with the wrong number of operands", () => {
      const doc = {
        ...getMockBotDoc(),
        rules: [
          {
            when: { op: "gt", args: [{ op: "const", value: 1 }] },
            do: { type: "idle" },
          },
        ],
      };

      expect(validate(doc).ok).toBe(false);
    });

    it("rejects rules that are not an array", () => {
      expect(validate({ ...getMockBotDoc(), rules: "nope" }).ok).toBe(false);
    });

    it("rejects a set that is not an array", () => {
      const doc = {
        ...getMockBotDoc(),
        rules: [
          {
            when: {
              op: "eq",
              args: [
                { op: "const", value: 1 },
                { op: "const", value: 1 },
              ],
            },
            set: "nope",
            do: { type: "idle" },
          },
        ],
      };

      expect(validate(doc).ok).toBe(false);
    });

    it("rejects a missing default action", () => {
      const { default: _omit, ...noDefault } = getMockBotDoc();
      expect(validate(noDefault).ok).toBe(false);
    });

    it("accepts a tracker rule that has no do", () => {
      const result = validate(
        getMockBotDoc({
          rules: [
            {
              when: {
                op: "eq",
                args: [
                  { op: "const", value: 1 },
                  { op: "const", value: 1 },
                ],
              },
              set: [{ cell: "hits", to: { op: "const", value: 1 } }],
            },
          ],
        }),
      );

      expect(result.ok).toBe(true);
    });

    it("rejects an invalid action inside a rule's do", () => {
      const doc = {
        ...getMockBotDoc(),
        rules: [
          {
            when: {
              op: "eq",
              args: [
                { op: "const", value: 1 },
                { op: "const", value: 1 },
              ],
            },
            do: { type: "teleport" },
          },
        ],
      };

      expect(validate(doc).ok).toBe(false);
    });

    it("rejects memory that is not an object", () => {
      expect(validate({ ...getMockBotDoc(), memory: 42 }).ok).toBe(false);
    });

    it("rejects a null condition node", () => {
      expect(
        validate({
          ...getMockBotDoc(),
          rules: [{ when: null, do: { type: "idle" } }],
        }).ok,
      ).toBe(false);
    });

    it("accepts reading a declared memory cell", () => {
      const result = validate(
        getMockBotDoc({
          rules: [
            {
              when: {
                op: "gt",
                args: [
                  { op: "mem", cell: "hits" },
                  { op: "const", value: 0 },
                ],
              },
              do: { type: "idle" },
            },
          ],
        }),
      );

      expect(result.ok).toBe(true);
    });

    it("rejects a mem node whose cell is not a string", () => {
      const doc = {
        ...getMockBotDoc(),
        rules: [
          {
            when: {
              op: "gt",
              args: [
                { op: "mem", cell: 5 },
                { op: "const", value: 0 },
              ],
            },
            do: { type: "idle" },
          },
        ],
      };

      expect(validate(doc).ok).toBe(false);
    });

    it("rejects a null numeric operand", () => {
      const doc = {
        ...getMockBotDoc(),
        rules: [
          {
            when: { op: "gt", args: [null, { op: "const", value: 0 }] },
            do: { type: "idle" },
          },
        ],
      };

      expect(validate(doc).ok).toBe(false);
    });

    it("rejects an and with no operands", () => {
      const doc = {
        ...getMockBotDoc(),
        rules: [{ when: { op: "and", args: [] }, do: { type: "idle" } }],
      };

      expect(validate(doc).ok).toBe(false);
    });

    it("rejects an attack with an unknown band", () => {
      expect(
        validate({
          ...getMockBotDoc(),
          default: { type: "attack", move: "strike", band: "behind" },
        }).ok,
      ).toBe(false);
    });

    const constComparing = (value: number) => ({
      ...getMockBotDoc(),
      rules: [
        {
          when: {
            op: "gt",
            args: [
              { op: "const", value },
              { op: "const", value: 0 },
            ],
          },
          do: { type: "idle" },
        },
      ],
    });

    it("rejects a const above the int32 max", () => {
      expect(validate(constComparing(LIMITS.intMax + 1)).ok).toBe(false);
    });

    it("rejects a const below the int32 min", () => {
      expect(validate(constComparing(LIMITS.intMin - 1)).ok).toBe(false);
    });

    it("accepts a const at the int32 max boundary", () => {
      expect(validate(constComparing(LIMITS.intMax)).ok).toBe(true);
    });

    it("accepts a const at the int32 min boundary", () => {
      expect(validate(constComparing(LIMITS.intMin)).ok).toBe(true);
    });
  });
});

describe("safeParse — prototype-pollution-safe intake", () => {
  it("parses a valid JSON document", () => {
    const parsed = safeParse('{"version":1,"name":"ok"}');
    expect(parsed).toEqual({ version: 1, name: "ok" });
  });

  it("rejects a __proto__ key", () => {
    expect(() => safeParse('{"__proto__":{"polluted":true}}')).toThrow();
  });

  it("rejects a constructor key", () => {
    expect(() => safeParse('{"constructor":{}}')).toThrow();
  });

  it("rejects a document larger than maxBytes", () => {
    const huge = '"' + "a".repeat(LIMITS.maxBytes + 1) + '"';
    expect(() => safeParse(huge)).toThrow();
  });

  it("accepts a document of exactly maxBytes", () => {
    const exact = '"' + "a".repeat(LIMITS.maxBytes - 2) + '"';
    expect(exact.length).toBe(LIMITS.maxBytes);
    expect(() => safeParse(exact)).not.toThrow();
  });
});
