import { describe, it, expect } from "vitest";
import { runFight, type FightConfig } from "./sim.js";
import type { BotDoc, BoolExpr } from "./dsl.js";
import type { Rules, Band, Action, MoveSpec } from "./types.js";
import { CANONICAL_RULES } from "./rules.js";

// ─── bot fixtures (mirroring the engine-test helpers — fixtures, not shared knowledge) ──
const bot = (rules: BotDoc["rules"], dflt: Action): BotDoc => ({
  version: 1,
  name: "b",
  rules,
  default: dflt,
});

const IDLE = bot([], { type: "idle" });

// Commits exactly one strike (at the given band) on the first tick, then idles.
const strikeOnce = (band: Band): BotDoc => ({
  version: 1,
  name: "atk1",
  memory: { fired: 0 },
  rules: [
    {
      when: {
        op: "eq",
        args: [
          { op: "mem", cell: "fired" },
          { op: "const", value: 0 },
        ],
      },
      set: [{ cell: "fired", to: { op: "const", value: 1 } }],
      do: { type: "attack", move: "strike", band },
    },
  ],
  default: { type: "idle" },
});

// Mirrors the PERCEIVED incoming attack band into a same-band guard (3 ⇒ high,
// 2 ⇒ mid, 1 ⇒ low; 0 ⇒ idle). A pure read of the L_act-delayed opponent.attackBand.
const BAND_MIRROR: BotDoc = bot(
  [
    {
      when: {
        op: "eq",
        args: [
          { op: "field", path: "opponent.attackBand" },
          { op: "const", value: 3 },
        ],
      },
      do: { type: "block", band: "high" },
    },
    {
      when: {
        op: "eq",
        args: [
          { op: "field", path: "opponent.attackBand" },
          { op: "const", value: 2 },
        ],
      },
      do: { type: "block", band: "mid" },
    },
    {
      when: {
        op: "eq",
        args: [
          { op: "field", path: "opponent.attackBand" },
          { op: "const", value: 1 },
        ],
      },
      do: { type: "block", band: "low" },
    },
  ],
  { type: "idle" },
);

// ─── small expression helpers ────────────────────────────────────────────────
const clk = (op: "eq" | "gte" | "lte", n: number): BoolExpr => ({
  op,
  args: [
    { op: "field", path: "clock.tick" },
    { op: "const", value: n },
  ],
});

const all = (...args: BoolExpr[]): BoolExpr => ({ op: "and", args });

// ─── lazy readers of the canonical numbers ────────────────────────────────────
// Read on call (inside tests/builders), never at module load — so a malformed table
// fails an assertion in a test rather than throwing at collection time.
const strike = (): MoveSpec => CANONICAL_RULES.moves.strike;
const lAct = (): number => CANONICAL_RULES.perception?.lAct ?? 0;

const fight = (o: Partial<FightConfig> = {}): FightConfig => ({
  rules: CANONICAL_RULES,
  botA: IDLE,
  botB: IDLE,
  maxTicks: 60,
  seed: 1,
  ...o,
});

// The canonical table positioned inside strike range and de-jittered, so the read-game
// inequalities resolve deterministically (jitter's seed-dependence at the knife-edge is
// proven generically in perception.test.ts — here we pin the nominal-latency backbone).
const deterministic = (o: Partial<Rules> = {}): Rules => ({
  ...CANONICAL_RULES,
  startGap: 200000, // inside strike.reach (240000) ⇒ a strike can connect
  perception: { ...CANONICAL_RULES.perception, jitter: 0 },
  ...o,
});

const withStartup = (startup: number): Rules =>
  deterministic({
    moves: {
      ...CANONICAL_RULES.moves,
      strike: { ...strike(), startup },
    },
  });

describe("CANONICAL_RULES — structural shape", () => {
  it("scores a clean strike as a single WKF yuko", () => {
    expect(strike().score).toBe(1);
  });

  it("starts fighters outside strike range (must close to hit)", () => {
    expect(CANONICAL_RULES.startGap).toBeGreaterThan(strike().reach);
  });

  it("makes the strike reactable but only just (startup = lAct + 1)", () => {
    expect(strike().startup).toBe(lAct() + 1);
  });

  it("makes a whiff punishable (recovery ≥ lAct + startup)", () => {
    expect(strike().recovery).toBeGreaterThanOrEqual(lAct() + strike().startup);
  });

  it("ships a reaction-viable, jittered perception layer", () => {
    expect(CANONICAL_RULES.perception?.lPos).toBe(1);
    expect(CANONICAL_RULES.perception?.lAct).toBe(6);
    expect(CANONICAL_RULES.perception?.jitter).toBe(1);
  });
});

describe("CANONICAL_RULES — neutral game (start out of range)", () => {
  it("an idle pair never scores — the start gap exceeds strike reach", () => {
    const result = runFight(fight({ botA: IDLE, botB: IDLE }));
    expect(result.scores).toEqual({ a: 0, b: 0 });
  });

  it("a strike thrown from the start position whiffs — you must close before you can hit", () => {
    // strikeOnce fires at tick 0 from the full start gap (300000) with reach 240000 ⇒ out of range.
    const result = runFight(
      fight({ botA: strikeOnce("mid"), botB: IDLE, maxTicks: 30 }),
    );

    expect(result.scores.a).toBe(0);
  });
});

describe("CANONICAL_RULES — a clean strike scores", () => {
  it("scores exactly 1 against an undefended foe in range", () => {
    const result = runFight(
      fight({
        rules: deterministic(),
        botA: strikeOnce("mid"),
        botB: IDLE,
        maxTicks: 30,
      }),
    );

    expect(result.scores.a).toBe(1);
  });
});

describe("CANONICAL_RULES — the strike read-game (reactable iff startup ≥ lAct+1)", () => {
  // BAND_MIRROR reads the delayed attackBand and guards that height; strikeOnce commits the strike.
  // scores.b is the attacker's score: 0 ⇒ the guard read & blocked, 1 ⇒ the strike landed.
  const counterEats = (band: Band, startup: number): number =>
    runFight(
      fight({
        rules: withStartup(startup),
        botA: BAND_MIRROR,
        botB: strikeOnce(band),
        maxTicks: 40,
      }),
    ).scores.b;

  it("a band-reading guard blocks the canonical strike at either height (the read is load-bearing)", () => {
    expect(counterEats("high", strike().startup)).toBe(0);
    expect(counterEats("low", strike().startup)).toBe(0);
  });

  it("no single fixed-height guard could do this — a fixed mid guard eats the high strike", () => {
    const fixedMid = bot([], { type: "block", band: "mid" });

    const scoreB = runFight(
      fight({
        rules: withStartup(strike().startup),
        botA: fixedMid,
        botB: strikeOnce("high"),
        maxTicks: 40,
      }),
    ).scores.b;

    expect(scoreB).toBe(1);
  });

  it("one tick faster (startup = lAct) beats the same read — the tell arrives too late", () => {
    expect(counterEats("high", lAct())).toBe(1);
  });
});

describe("CANONICAL_RULES — a whiffed strike is punishable", () => {
  it("a high strike whiffed over a croucher is punished during its long recovery", () => {
    const S = strike().startup; // active window opens at elapsed = startup
    const A = strike().active;

    // Punisher: crouch through the attacker's active window (duck the high strike), then strike
    // into its recovery. recovery ≥ lAct + startup is what lets the reaction land before wake-up.
    const punisher = bot(
      [
        {
          when: all(clk("gte", S), clk("lte", S + A - 1)),
          do: { type: "crouch" },
        },
        {
          when: clk("eq", S + A),
          do: { type: "attack", move: "strike", band: "mid" },
        },
      ],
      { type: "idle" },
    );

    const result = runFight(
      fight({
        rules: deterministic(),
        botA: punisher,
        botB: strikeOnce("high"),
        maxTicks: 40,
      }),
    );

    expect(result.scores.b).toBe(0); // the high strike whiffed over the crouch
    expect(result.scores.a).toBe(1); // and was punished during recovery
  });
});
