import { describe, it, expect } from "vitest";
import { runFight, type FightConfig, type FightEvent } from "./sim.js";
import { validate, type BotDoc } from "./dsl.js";
import type { Rules, Action } from "./types.js";

// ─── factories ───────────────────────────────────────────────────────────────
const bot = (rules: BotDoc["rules"], dflt: Action): BotDoc => ({
  version: 1,
  name: "b",
  rules,
  default: dflt,
});

// B marches toward A every tick, closing the gap by walkSpeed each tick.
const ADVANCER = bot([], { type: "move", dir: 1 });

// A holds still and raises a guard the instant it PERCEIVES the gap reach
// `threshold`. Block has no positional effect, so A never moves — the gap is
// driven purely by B, and the tick A first guards is a clean read of *when A
// perceived* the gap cross the threshold.
const reactiveBlocker = (threshold: number): BotDoc =>
  bot(
    [
      {
        when: {
          op: "lte",
          args: [
            { op: "field", path: "opponent.distance" },
            { op: "const", value: threshold },
          ],
        },
        do: { type: "block", band: "mid" },
      },
    ],
    { type: "idle" },
  );

const getMockRules = (o: Partial<Rules> = {}): Rules => ({
  tickRate: 60,
  walkSpeed: 4000,
  ring: { width: 600000 },
  startGap: 200000,
  moves: {
    strike: { startup: 4, active: 2, recovery: 6, score: 1, reach: 250000 },
  },
  ...o,
});

// Start gap is 200000, closing 4000/tick ⇒ perceived gap reaches 180000 (≤) at
// the 5th tick of perception. L_pos shifts that perception later by its value.
const getMockConfig = (o: Partial<FightConfig> = {}): FightConfig => ({
  rules: getMockRules(),
  botA: reactiveBlocker(180000),
  botB: ADVANCER,
  maxTicks: 20,
  seed: 1,
  ...o,
});

const withLPos = (lPos: number): FightConfig =>
  getMockConfig({ rules: getMockRules({ perception: { lPos } }) });

const firstBlockTick = (events: FightEvent[]): number | undefined =>
  events.find((e) => e.a.action.type === "block")?.tick;

describe("perception latency — delayed opponent position (L_pos)", () => {
  it("delays the reaction to the opponent's approach by exactly L_pos ticks", () => {
    // Live (L_pos = 0): the guard goes up the tick the true gap reaches 180000.
    expect(firstBlockTick(runFight(withLPos(0)).events)).toBe(5);
    // Each extra tick of latency delays that same reaction by exactly one tick.
    expect(firstBlockTick(runFight(withLPos(1)).events)).toBe(6);
    expect(firstBlockTick(runFight(withLPos(2)).events)).toBe(7);
    // L_pos = 3 also exercises the start-of-fight clamp (ticks 0–2 read the
    // initial frame, so A must NOT guard early).
    expect(firstBlockTick(runFight(withLPos(3)).events)).toBe(8);
  });

  it("treats absent perception config as L_pos = 0 (forward-compatible)", () => {
    const absent = runFight(getMockConfig()); // no `perception` field at all
    const zero = runFight(withLPos(0));

    expect(absent.events).toEqual(zero.events);
    expect(firstBlockTick(absent.events)).toBe(5);
  });
});

// ─── slice 2: delayed action perception (L_act) and the master inequality ─────

// Attacks exactly once (tick 0), then idles — so there is a single active frame.
const ATTACK_ONCE: BotDoc = {
  version: 1,
  name: "atk",
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
      do: { type: "attack", move: "strike", band: "mid" },
    },
  ],
  default: { type: "idle" },
};

// Raises a guard the instant it PERCEIVES the opponent attacking.
const REACTIVE_BLOCKER: BotDoc = bot(
  [
    {
      when: {
        op: "eq",
        args: [
          { op: "field", path: "opponent.attacking" },
          { op: "const", value: 1 },
        ],
      },
      do: { type: "block", band: "mid" },
    },
  ],
  { type: "idle" },
);

// Defender A reacts to attacker B; both stand still, in reach (gap 200000 ≤ reach
// 250000). The strike's startup and the latencies are the only variables. Single
// active frame ⇒ a crisp block-or-hit boundary.
const inequalityConfig = (
  lPos: number,
  lAct: number,
  startup: number,
): FightConfig =>
  getMockConfig({
    botA: REACTIVE_BLOCKER,
    botB: ATTACK_ONCE,
    rules: getMockRules({
      perception: { lPos, lAct },
      moves: {
        strike: { startup, active: 1, recovery: 6, score: 1, reach: 250000 },
      },
    }),
    maxTicks: 30,
  });

describe("perception latency — delayed action perception (L_act)", () => {
  it("lets a reaction-blocker negate a strike only when startup ≥ L_act + 1", () => {
    const L = 6;
    // The attack tell only appears one tick after commit, so the guard is up by
    // the active frame iff startup exceeds L_act by at least 1.
    expect(runFight(inequalityConfig(0, L, L + 1)).scores.b).toBe(0); // blocked
    expect(runFight(inequalityConfig(0, L, L)).scores.b).toBe(1); // lands
  });

  it("delays the attack tell by L_act independent of L_pos (coherent split snapshot)", () => {
    const L = 6;
    // L_pos differs from L_act; the boundary still tracks L_act, proving the
    // attacking flag is read from the t−L_act frame, not the t−L_pos one.
    expect(runFight(inequalityConfig(2, L, L + 1)).scores.b).toBe(0); // blocked
    expect(runFight(inequalityConfig(2, L, L)).scores.b).toBe(1); // lands
  });

  it("accepts a bot that reads opponent.attacking (additive to the allowlist)", () => {
    expect(validate(REACTIVE_BLOCKER).ok).toBe(true);
  });
});
