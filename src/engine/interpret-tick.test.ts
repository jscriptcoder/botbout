import { describe, it, expect } from "vitest";
import {
  runTick,
  LIMITS,
  type BotDoc,
  type BoolExpr,
  type FieldPath,
  type NumExpr,
} from "./dsl.js";
import { CANONICAL_RULES } from "./rules.js";
import type {
  State,
  Action,
  Rules,
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
    penalties: 0,
    passivityRemaining: 0,
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
    points: 0,
    penalties: 0,
    passivityRemaining: 0,
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
    ["self.penalties", { self: { penalties: 2 } }, 2],
    ["self.passivityRemaining", { self: { passivityRemaining: 8 } }, 8],
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
    ["opponent.points", { opponent: { points: 4 } }, 4],
    ["opponent.penalties", { opponent: { penalties: 3 } }, 3],
    ["opponent.passivityRemaining", { opponent: { passivityRemaining: 5 } }, 5],
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

describe("runTick — score gap (self.points vs opponent.points)", () => {
  // scoreGap = self.points − opponent.points; press (move) when behind (gap < 0),
  // hold (idle) otherwise. The subtraction direction is what makes "behind" mean
  // behind — a flipped operand order would invert the whole endgame.
  const scoreGapBot = bot(
    [
      {
        when: {
          op: "lt",
          args: [
            {
              op: "sub",
              args: [
                { op: "field", path: "self.points" },
                { op: "field", path: "opponent.points" },
              ],
            },
            { op: "const", value: 0 },
          ],
        },
        do: MOVE_IN,
      },
    ],
    { type: "idle" },
  );

  const atGap = (selfPts: number, oppPts: number): State =>
    getMockState({ self: { points: selfPts }, opponent: { points: oppPts } });

  it("presses when behind and holds when even or ahead — the gap direction drives the branch", () => {
    expect(runTick(scoreGapBot, atGap(1, 4), {})).toEqual(MOVE_IN); // behind
    expect(runTick(scoreGapBot, atGap(2, 2), {})).toEqual({ type: "idle" }); // even
    expect(runTick(scoreGapBot, atGap(4, 1), {})).toEqual({ type: "idle" }); // ahead
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

describe("runTick — rule(path) ruleset reads", () => {
  // A 3-arg runTick is assignable to this 4-arg (optional-rules) type, so these
  // tests typecheck during RED; the 4th arg is simply ignored until the
  // interpreter threads it (GREEN).
  const withRules: (
    doc: BotDoc,
    state: State,
    mem: Record<string, number>,
    rules?: Rules,
  ) => Action = runTick;

  // `rule` isn't in the NumExpr union until GREEN; build it as data.
  const ruleExpr = (path: string): NumExpr => ({ op: "rule", path }) as NumExpr;

  // Does `rule(path)` evaluate to exactly `expected` under `rules`?
  const evalsToRule = (
    path: string,
    expected: number,
    rules?: Rules,
  ): boolean =>
    withRules(
      bot([
        {
          when: {
            op: "eq",
            args: [ruleExpr(path), { op: "const", value: expected }],
          },
          do: MOVE_IN,
        },
      ]),
      getMockState(),
      {},
      rules,
    ).type === "move";

  // A rules fixture configuring only the required gyaku-zuki — every optional
  // constant is absent, so each optional reader's `?.` chain + sentinel fallback
  // is exercised in the "unconfigured" column below.
  const MINIMAL_RULES: Rules = {
    tickRate: 60,
    walkSpeed: 4000,
    ring: { width: 600000 },
    startGap: 300000,
    moves: {
      "gyaku-zuki": {
        startup: 7,
        active: 3,
        recovery: 14,
        score: 1,
        reach: 240000,
      },
    },
  };

  // Every readable constant under BOTH rulesets: canonical (configured ⇒ the real
  // value) and minimal (every optional reader absent ⇒ the inert sentinel 0). The
  // present case pins each reader's value/key; the absent case exercises its
  // optional-chaining guard. Each move's six stats are mutually distinct, so a
  // wrong-field read is caught.
  it.each<[string, number, number]>([
    // path, value on CANONICAL_RULES, value on MINIMAL_RULES
    ["tickRate", 60, 60],
    ["walkSpeed", 4000, 4000],
    ["ring.width", 600000, 600000],
    ["startGap", 300000, 300000],
    ["moves.gyaku-zuki.startup", 7, 7],
    ["moves.gyaku-zuki.active", 3, 3],
    ["moves.gyaku-zuki.recovery", 14, 14],
    ["moves.gyaku-zuki.score", 1, 1],
    ["moves.gyaku-zuki.reach", 240000, 240000],
    ["moves.gyaku-zuki.staminaCost", 20, 0],
    ["moves.sweep.startup", 7, 0],
    ["moves.sweep.active", 2, 0],
    ["moves.sweep.recovery", 13, 0],
    ["moves.sweep.score", 0, 0],
    ["moves.sweep.reach", 180000, 0],
    ["moves.sweep.staminaCost", 40, 0],
    ["moves.kizami-zuki.startup", 7, 0],
    ["moves.kizami-zuki.active", 2, 0],
    ["moves.kizami-zuki.recovery", 13, 0],
    ["moves.kizami-zuki.score", 1, 0],
    ["moves.kizami-zuki.reach", 210000, 0],
    ["moves.kizami-zuki.staminaCost", 15, 0],
    ["moves.mae-geri.startup", 9, 0],
    ["moves.mae-geri.active", 3, 0],
    ["moves.mae-geri.recovery", 16, 0],
    ["moves.mae-geri.score", 2, 0],
    ["moves.mae-geri.reach", 270000, 0],
    ["moves.mae-geri.staminaCost", 35, 0],
    ["moves.mawashi-geri.startup", 11, 0],
    ["moves.mawashi-geri.active", 3, 0],
    ["moves.mawashi-geri.recovery", 18, 0],
    ["moves.mawashi-geri.score", 2, 0],
    ["moves.mawashi-geri.reach", 300000, 0],
    ["moves.mawashi-geri.staminaCost", 45, 0],
    ["moves.mawashi-geri.scoreByBand.high", 3, 0],
    ["throw.startup", 7, 0],
    ["throw.active", 2, 0],
    ["throw.recovery", 14, 0],
    ["throw.reach", 120000, 0],
    ["throw.score", 3, 0],
    ["throw.staminaCost", 40, 0],
    ["jumpImpulse", 12000, 0],
    ["gravity", 4000, 0],
    ["lowClearance", 8000, 0],
    ["parryWindow", 2, 0],
    ["parryRecovery", 12, 0],
    ["counterWindow", 10, 0],
    ["counterBonus", 1, 0],
    ["cancelWindow", 6, 0],
    ["knockdownDuration", 18, 0],
    ["finishWindow", 10, 0],
    ["finishScore", 3, 0],
    ["perception.lPos", 1, 0],
    ["perception.lAct", 6, 0],
    ["perception.jitter", 1, 0],
    ["stamina.max", 100, 0],
    ["stamina.regen", 10, 0],
    ["stamina.blockChip", 5, 0],
    ["stamina.parryChip", 15, 0],
    ["stamina.gasThreshold", 30, 0],
    ["stamina.gasRecoveryPenalty", 6, 0],
  ])(
    "reads rule(%s): %i on canonical rules, %i when unconfigured",
    (path, canonical, minimal) => {
      expect(evalsToRule(path, canonical, CANONICAL_RULES)).toBe(true);
      expect(evalsToRule(path, minimal, MINIMAL_RULES)).toBe(true);
    },
  );

  it("reads scoreByBand.high as 0 when the roundhouse has no scoreByBand", () => {
    // mawashi-geri PRESENT but scoreByBand absent ⇒ the INNER `?.` must guard it
    // (the move-level `?.` short-circuit never reaches this branch otherwise).
    const noBandScore: Rules = {
      ...MINIMAL_RULES,
      moves: {
        ...MINIMAL_RULES.moves,
        "mawashi-geri": {
          startup: 11,
          active: 3,
          recovery: 18,
          score: 2,
          reach: 300000,
        },
      },
    };

    expect(
      evalsToRule("moves.mawashi-geri.scoreByBand.high", 0, noBandScore),
    ).toBe(true);
  });

  it("reads rule(path) as 0 when no rules are supplied to the interpreter", () => {
    // evalsToRule with no rules arg ⇒ runTick gets undefined ⇒ rule falls back to 0
    expect(evalsToRule("moves.gyaku-zuki.reach", 0)).toBe(true);
  });

  it("matches a magic-number twin on canonical rules (equivalence)", () => {
    const symbolic = bot([
      {
        when: {
          op: "lte",
          args: [
            { op: "field", path: "opponent.distance" },
            ruleExpr("moves.kizami-zuki.reach"),
          ],
        },
        do: { type: "attack", move: "kizami-zuki", band: "mid" },
      },
    ]);

    const twin = bot([
      {
        when: {
          op: "lte",
          args: [
            { op: "field", path: "opponent.distance" },
            { op: "const", value: 210000 },
          ],
        },
        do: { type: "attack", move: "kizami-zuki", band: "mid" },
      },
    ]);

    // just inside reach: both attack; just outside: both idle.
    const inRange = getMockState({ opponent: { distance: 210000 } });
    const outOfRange = getMockState({ opponent: { distance: 210001 } });

    expect(withRules(symbolic, inRange, {}, CANONICAL_RULES)).toEqual(
      withRules(twin, inRange, {}, CANONICAL_RULES),
    );
    expect(withRules(symbolic, outOfRange, {}, CANONICAL_RULES)).toEqual(
      withRules(twin, outOfRange, {}, CANONICAL_RULES),
    );
    expect(withRules(symbolic, inRange, {}, CANONICAL_RULES).type).toBe(
      "attack",
    );
  });

  it("tracks a retuned rules fixture while an inlined twin would not", () => {
    const retuned: Rules = {
      ...CANONICAL_RULES,
      moves: {
        ...CANONICAL_RULES.moves,
        "kizami-zuki": {
          ...CANONICAL_RULES.moves["kizami-zuki"]!,
          reach: 999000,
        },
      },
    };

    expect(evalsToRule("moves.kizami-zuki.reach", 999000, retuned)).toBe(true);
    // the old canonical value no longer matches under the retune
    expect(evalsToRule("moves.kizami-zuki.reach", 210000, retuned)).toBe(false);
  });
});
