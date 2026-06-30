import { describe, it, expect } from "vitest";
import {
  runTick,
  LIMITS,
  type BotDoc,
  type BoolExpr,
  type FieldPath,
  type NumExpr,
} from "./dsl.js";
import type {
  State,
  Action,
  SelfState,
  OpponentState,
  RingState,
  ClockState,
} from "./types.js";

// ─── factories ───────────────────────────────────────────────────────────────
const bot = (
  rules: BotDoc["rules"],
  dflt: Action = { type: "idle" },
): BotDoc => ({
  version: 1,
  name: "interp-test",
  rules,
  default: dflt,
});

type StateOverrides = {
  self?: Partial<SelfState>;
  opponent?: Partial<OpponentState>;
  ring?: Partial<RingState>;
  clock?: Partial<ClockState>;
};

const getMockState = (o: StateOverrides = {}): State => ({
  self: {
    x: 0,
    facing: 1,
    points: 0,
    canAct: true,
    phaseRemaining: 0,
    counterWindow: 0,
    cancelWindow: 0,
    finishWindow: 0,
    stamina: 0,
    gassed: 0,
    ...o.self,
  },
  opponent: {
    x: 100,
    y: 0,
    facing: -1,
    distance: 100,
    attacking: false,
    attackBand: 0,
    posture: 0,
    throwing: false,
    knockdown: false,
    vx: 0,
    predictedDistance: 100,
    stamina: 0,
    gassed: false,
    ...o.opponent,
  },
  ring: { width: 600, ...o.ring },
  clock: { tick: 0, ticksRemaining: 1800, ...o.clock },
});

const TRUE: BoolExpr = {
  op: "eq",
  args: [
    { op: "const", value: 1 },
    { op: "const", value: 1 },
  ],
};

const FALSE: BoolExpr = {
  op: "eq",
  args: [
    { op: "const", value: 1 },
    { op: "const", value: 0 },
  ],
};

const MOVE_IN: Action = { type: "move", dir: 1 };

// does a `when` cause the (only) rule to fire?
const fires = (when: BoolExpr, state: State = getMockState()): boolean =>
  runTick(bot([{ when, do: MOVE_IN }]), state, {}).type === "move";

describe("runTick — rule selection", () => {
  it("returns the first matching rule's action", () => {
    const doc = bot([
      { when: TRUE, do: { type: "move", dir: 1 } },
      { when: TRUE, do: { type: "block", band: "mid" } },
    ]);

    expect(runTick(doc, getMockState(), {})).toEqual({ type: "move", dir: 1 });
  });

  it("skips a non-matching rule and uses a later matching one", () => {
    const doc = bot([
      { when: FALSE, do: { type: "move", dir: 1 } },
      { when: TRUE, do: { type: "block", band: "high" } },
    ]);

    expect(runTick(doc, getMockState(), {})).toEqual({
      type: "block",
      band: "high",
    });
  });

  it("returns the default action when no rule matches", () => {
    const doc = bot([{ when: FALSE, do: { type: "block", band: "low" } }], {
      type: "attack",
      move: "gyaku-zuki",
      band: "mid",
    });

    expect(runTick(doc, getMockState(), {})).toEqual({
      type: "attack",
      move: "gyaku-zuki",
      band: "mid",
    });
  });
});

describe("runTick — memory", () => {
  it("applies a tracker rule's writes and continues evaluating", () => {
    const doc = bot([
      { when: TRUE, set: [{ cell: "seen", to: { op: "const", value: 5 } }] },
      {
        when: {
          op: "eq",
          args: [
            { op: "mem", cell: "seen" },
            { op: "const", value: 5 },
          ],
        },
        do: { type: "move", dir: -1 },
      },
    ]);

    const mem: Record<string, number> = { seen: 0 };
    const action = runTick(doc, getMockState(), mem);
    expect(action).toEqual({ type: "move", dir: -1 });
    expect(mem.seen).toBe(5);
  });

  it("evaluates a set write expression against state", () => {
    const doc = bot([
      {
        when: TRUE,
        set: [{ cell: "d", to: { op: "field", path: "opponent.distance" } }],
      },
    ]);

    const mem: Record<string, number> = { d: 0 };
    runTick(doc, getMockState({ opponent: { distance: 77 } }), mem);
    expect(mem.d).toBe(77);
  });

  it("applies every write in a rule's set", () => {
    const doc = bot([
      {
        when: TRUE,
        set: [
          { cell: "a", to: { op: "const", value: 1 } },
          { cell: "b", to: { op: "const", value: 2 } },
        ],
      },
    ]);

    const mem: Record<string, number> = { a: 0, b: 0 };
    runTick(doc, getMockState(), mem);
    expect(mem).toEqual({ a: 1, b: 2 });
  });

  it("reads an unset memory cell as 0", () => {
    const doc = bot([
      {
        when: {
          op: "eq",
          args: [
            { op: "mem", cell: "fresh" },
            { op: "const", value: 0 },
          ],
        },
        do: MOVE_IN,
      },
    ]);

    expect(runTick(doc, getMockState(), {})).toEqual(MOVE_IN);
  });
});

describe("runTick — numeric reads", () => {
  it.each<[FieldPath, StateOverrides, number]>([
    ["self.x", { self: { x: 12 } }, 12],
    ["self.facing", { self: { facing: -1 } }, -1],
    ["self.points", { self: { points: 3 } }, 3],
    ["self.canAct", { self: { canAct: true } }, 1],
    ["self.phaseRemaining", { self: { phaseRemaining: 7 } }, 7],
    ["self.counterWindow", { self: { counterWindow: 9 } }, 9],
    ["self.cancelWindow", { self: { cancelWindow: 5 } }, 5],
    ["self.stamina", { self: { stamina: 42 } }, 42],
    ["self.gassed", { self: { gassed: 1 } }, 1],
    ["opponent.x", { opponent: { x: 250 } }, 250],
    ["opponent.facing", { opponent: { facing: -1 } }, -1],
    ["opponent.distance", { opponent: { distance: 88 } }, 88],
    ["opponent.attacking", { opponent: { attacking: true } }, 1],
    ["opponent.vx", { opponent: { vx: -4000 } }, -4000],
    [
      "opponent.predictedDistance",
      { opponent: { predictedDistance: 150 } },
      150,
    ],
    ["opponent.stamina", { opponent: { stamina: 42 } }, 42],
    ["opponent.gassed", { opponent: { gassed: true } }, 1],
    ["ring.width", { ring: { width: 600 } }, 600],
    ["clock.tick", { clock: { tick: 42 } }, 42],
    ["clock.ticksRemaining", { clock: { ticksRemaining: 100 } }, 100],
  ])("reads field %s as its state value", (path, override, expected) => {
    const doc = bot([
      {
        when: {
          op: "eq",
          args: [
            { op: "field", path },
            { op: "const", value: expected },
          ],
        },
        do: MOVE_IN,
      },
    ]);

    expect(runTick(doc, getMockState(override), {})).toEqual(MOVE_IN);
  });

  it("reads a false boolean field as 0", () => {
    const doc = bot([
      {
        when: {
          op: "eq",
          args: [
            { op: "field", path: "self.canAct" },
            { op: "const", value: 0 },
          ],
        },
        do: MOVE_IN,
      },
    ]);

    expect(runTick(doc, getMockState({ self: { canAct: false } }), {})).toEqual(
      MOVE_IN,
    );
  });
});

describe("runTick — boolean operators", () => {
  it.each<
    [
      BoolExpr["op"] & ("gt" | "lt" | "gte" | "lte" | "eq" | "neq"),
      number,
      number,
      boolean,
    ]
  >([
    ["gt", 5, 5, false],
    ["gt", 6, 5, true],
    ["gte", 5, 5, true],
    ["gte", 4, 5, false],
    ["lt", 5, 5, false],
    ["lt", 4, 5, true],
    ["lte", 5, 5, true],
    ["lte", 6, 5, false],
    ["lte", 4, 5, true],
    ["eq", 5, 5, true],
    ["eq", 5, 6, false],
    ["neq", 5, 6, true],
    ["neq", 5, 5, false],
  ])("%s(%i, %i) fires = %s", (op, a, b, expected) => {
    const when = {
      op,
      args: [
        { op: "const", value: a },
        { op: "const", value: b },
      ],
    } as BoolExpr;

    expect(fires(when)).toBe(expected);
  });

  it("and is true only when all operands are true", () => {
    expect(fires({ op: "and", args: [TRUE, FALSE] })).toBe(false);
    expect(fires({ op: "and", args: [TRUE, TRUE] })).toBe(true);
  });

  it("or is true when any operand is true", () => {
    expect(fires({ op: "or", args: [FALSE, FALSE] })).toBe(false);
    expect(fires({ op: "or", args: [FALSE, TRUE] })).toBe(true);
  });

  it("not inverts its operand", () => {
    expect(fires({ op: "not", arg: FALSE })).toBe(true);
    expect(fires({ op: "not", arg: TRUE })).toBe(false);
  });
});

describe("runTick — arithmetic numeric operators", () => {
  const { intMin, intMax } = LIMITS;
  const c = (value: number): NumExpr => ({ op: "const", value });
  // The new ops aren't in the NumExpr union until GREEN; build them as data and
  // let the (post-GREEN) interpreter evaluate them through the public runTick.
  const n = (e: unknown): NumExpr => e as NumExpr;

  // Does `expr` evaluate to exactly `expected`? Compares via eq inside a rule.
  const evalsTo = (
    expr: NumExpr,
    expected: number,
    state: State = getMockState(),
  ): boolean =>
    runTick(
      bot([{ when: { op: "eq", args: [expr, c(expected)] }, do: MOVE_IN }]),
      state,
      {},
    ).type === "move";

  // Does this raw boolean expression (possibly nesting new ops) fire?
  const firesWhen = (when: unknown, state: State = getMockState()): boolean =>
    runTick(bot([{ when: when as BoolExpr, do: MOVE_IN }]), state, {}).type ===
    "move";

  it.each<[string, unknown, number]>([
    ["add two operands", { op: "add", args: [c(2), c(3)] }, 5],
    ["add a single operand (identity)", { op: "add", args: [c(5)] }, 5],
    ["add many operands", { op: "add", args: [c(1), c(2), c(3), c(4)] }, 10],
    ["sub", { op: "sub", args: [c(10), c(3)] }, 7],
    ["mul two operands", { op: "mul", args: [c(6), c(7)] }, 42],
    ["mul with a negative operand", { op: "mul", args: [c(-3), c(4)] }, -12],
    ["mul a single operand (identity)", { op: "mul", args: [c(9)] }, 9],
    ["min two operands", { op: "min", args: [c(3), c(5)] }, 3],
    ["min many operands", { op: "min", args: [c(4), c(2), c(9)] }, 2],
    ["max two operands", { op: "max", args: [c(3), c(5)] }, 5],
    ["max many operands", { op: "max", args: [c(4), c(2), c(9)] }, 9],
    ["neg of a positive", { op: "neg", arg: c(5) }, -5],
    ["neg of a negative", { op: "neg", arg: c(-5) }, 5],
    ["abs of a negative", { op: "abs", arg: c(-5) }, 5],
    ["abs of a positive", { op: "abs", arg: c(5) }, 5],
  ])("evaluates %s", (_label, expr, expected) => {
    expect(evalsTo(n(expr), expected)).toBe(true);
  });

  it.each<[number, number, number]>([
    [7, 2, 3],
    [-7, 2, -3],
    [7, -2, -3],
    [-7, -2, 3],
    [6, 3, 2],
    [5, 0, 0], // ÷0 := 0
  ])(
    "div(%i, %i) = %i (truncates toward zero; ÷0 yields 0)",
    (a, b, expected) => {
      expect(evalsTo(n({ op: "div", args: [c(a), c(b)] }), expected)).toBe(
        true,
      );
    },
  );

  it.each<[string, unknown, number]>([
    [
      "add overflow saturates to intMax",
      { op: "add", args: [c(intMax), c(1)] },
      intMax,
    ],
    [
      "sub underflow saturates to intMin",
      { op: "sub", args: [c(intMin), c(1)] },
      intMin,
    ],
    [
      "mul overflow saturates to intMax",
      { op: "mul", args: [c(intMax), c(2)] },
      intMax,
    ],
    [
      "neg of intMin saturates to intMax",
      { op: "neg", arg: c(intMin) },
      intMax,
    ],
    [
      "abs of intMin saturates to intMax",
      { op: "abs", arg: c(intMin) },
      intMax,
    ],
    [
      "div intMin by -1 saturates to intMax",
      { op: "div", args: [c(intMin), c(-1)] },
      intMax,
    ],
  ])("%s", (_label, expr, expected) => {
    expect(evalsTo(n(expr), expected)).toBe(true);
  });

  it("saturates each op's FINAL result, not a left-fold of per-step clamps", () => {
    // True sum intMax + intMax + intMin = 2147483646, which is in range ⇒ no
    // clamp. (A per-step-clamped left fold would give intMax, then + intMin = -1.)
    expect(
      evalsTo(
        n({ op: "add", args: [c(intMax), c(intMax), c(intMin)] }),
        2_147_483_646,
      ),
    ).toBe(true);
  });

  it("composes nested ops, each saturated", () => {
    // mul(2,3)=6 ; neg(1)=-1 ; add(6,-1)=5
    expect(
      evalsTo(
        n({
          op: "add",
          args: [
            { op: "mul", args: [c(2), c(3)] },
            { op: "neg", arg: c(1) },
          ],
        }),
        5,
      ),
    ).toBe(true);
  });

  it.each<[number, number]>([
    [0, 100],
    [100, 0],
  ])(
    "computes |self.x - opponent.x| = 100 over fields (self.x=%i, opp.x=%i)",
    (sx, ox) => {
      const expr = n({
        op: "abs",
        arg: {
          op: "sub",
          args: [
            { op: "field", path: "self.x" },
            { op: "field", path: "opponent.x" },
          ],
        },
      });

      expect(
        evalsTo(
          expr,
          100,
          getMockState({ self: { x: sx }, opponent: { x: ox } }),
        ),
      ).toBe(true);
    },
  );

  it("keeps a saturated overflow positive in a decision (intMax + 1 > 0)", () => {
    // If add wrapped instead of saturating, intMax+1 would be negative and the
    // rule would NOT fire.
    expect(
      firesWhen({
        op: "gt",
        args: [{ op: "add", args: [c(intMax), c(1)] }, c(0)],
      }),
    ).toBe(true);
  });
});
