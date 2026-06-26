import { describe, it, expect } from "vitest";
import { runTick, type BotDoc, type BoolExpr, type FieldPath } from "./dsl.js";
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
    ...o.self,
  },
  opponent: { x: 100, facing: -1, distance: 100, ...o.opponent },
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
      move: "strike",
      band: "mid",
    });
    expect(runTick(doc, getMockState(), {})).toEqual({
      type: "attack",
      move: "strike",
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
    ["opponent.x", { opponent: { x: 250 } }, 250],
    ["opponent.facing", { opponent: { facing: -1 } }, -1],
    ["opponent.distance", { opponent: { distance: 88 } }, 88],
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
