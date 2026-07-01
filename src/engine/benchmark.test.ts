import { describe, it, expect } from "vitest";
import { benchmark, type BenchmarkConfig } from "./benchmark.js";
import type { Rules, Action } from "./types.js";
import type { BotDoc } from "./dsl.js";

// ─── factories ───────────────────────────────────────────────────────────────
// Mock rules WITHOUT perception: no perception ⇒ no PRNG draws ⇒ every fight is
// seed-independent AND swap-symmetric, so the aggregation arithmetic is exactly
// predictable. gyaku-zuki reach 250000, startGap 200000 ⇒ in range.
const MOCK_RULES: Rules = {
  tickRate: 60,
  walkSpeed: 4000,
  ring: { width: 600000 },
  startGap: 200000,
  moves: {
    "gyaku-zuki": {
      startup: 4,
      active: 2,
      recovery: 6,
      score: 1,
      reach: 250000,
    },
  },
};

const named = (name: string, dflt: Action): BotDoc => ({
  version: 1,
  name,
  rules: [],
  default: dflt,
});

const ATTACK_MID: Action = { type: "attack", move: "gyaku-zuki", band: "mid" };

// Always attacks ⇒ scores 1 vs an idler over 12 ticks; trades 1-1 vs another attacker.
const SUBMITTED = named("sub", ATTACK_MID);
// Same behaviour as SUBMITTED but a DIFFERENT name ⇒ NOT a mirror (deep-equal includes name).
const TRADER = named("trader", ATTACK_MID);
// Never scores.
const LOSER = named("loser", { type: "idle" });
// Byte-for-byte identical to SUBMITTED ⇒ the no-mirror skip must drop it.
const SUBMITTED_CLONE = named("sub", ATTACK_MID);

const config = (o: Partial<BenchmarkConfig> = {}): BenchmarkConfig => ({
  bot: SUBMITTED,
  gauntlet: [LOSER, TRADER],
  seeds: [1, 2],
  maxTicks: 12,
  rules: MOCK_RULES,
  ...o,
});

describe("benchmark — aggregation over both sides × seeds", () => {
  it("sums net-points and win/draw counts across every (opponent × seed × side) fight", () => {
    const result = benchmark(config());

    // vs LOSER: bot scores 1, loser 0 ⇒ net +1 + a win, on all 2 seeds × 2 sides = 4 fights.
    // vs TRADER: both score 1 ⇒ net 0 + a draw, on all 4 fights.
    expect(result.perOpponent).toEqual([
      { name: "loser", netPoints: 4, wins: 4, draws: 0, fights: 4 },
      { name: "trader", netPoints: 0, wins: 0, draws: 4, fights: 4 },
    ]);
    expect(result.netPoints).toBe(4);
    expect(result.wins).toBe(4);
    expect(result.draws).toBe(4);
    expect(result.totalFights).toBe(8);
    expect(result.winRate).toBe(0.5); // 4 wins / 8 fights (draws are not wins)
  });

  it("plays each (opponent × seed) on BOTH sides — fights = |seeds| × 2 per opponent", () => {
    const result = benchmark(config({ gauntlet: [LOSER], seeds: [1, 2, 3] }));

    expect(result.totalFights).toBe(6); // 3 seeds × 2 sides
    expect(result.perOpponent[0].fights).toBe(6);
    expect(result.perOpponent[0].wins).toBe(6); // the bot wins as A AND as B
    expect(result.netPoints).toBe(6); // +1 each fight, both sides
  });

  it("skips a gauntlet opponent that deep-equals the submitted bot (no mirror)", () => {
    const result = benchmark(config({ gauntlet: [SUBMITTED_CLONE, LOSER] }));

    expect(result.perOpponent.map((o) => o.name)).toEqual(["loser"]); // clone dropped
    expect(result.totalFights).toBe(4); // only the LOSER pairing, both sides × 2 seeds
    expect(result.netPoints).toBe(4);
    expect(result.winRate).toBe(1);
  });

  it("returns a zeroed result with win-rate 0 when every opponent is skipped (no divide-by-zero)", () => {
    const result = benchmark(config({ gauntlet: [SUBMITTED_CLONE] }));

    expect(result.perOpponent).toEqual([]);
    expect(result.totalFights).toBe(0);
    expect(result.netPoints).toBe(0);
    expect(result.wins).toBe(0);
    expect(result.winRate).toBe(0);
  });

  it("is deterministic — the same config scores byte-identically twice", () => {
    expect(benchmark(config())).toEqual(benchmark(config()));
  });

  it("threads match mode into every fight — fights end at the win gap, bounding net-points", () => {
    // Over 300 ticks the bot out-scores the idle LOSER many times; match mode
    // ends each fight the moment the bot leads by 8, so net is EXACTLY the gap.
    const matched = config({
      gauntlet: [LOSER],
      seeds: [1],
      maxTicks: 300,
      match: { winGap: 8 },
    });

    const result = benchmark(matched);

    // 1 seed × 2 sides = 2 fights, each ending at a +8 gap ⇒ net 16, both wins.
    expect(result.perOpponent[0].netPoints).toBe(16);
    expect(result.perOpponent[0].wins).toBe(2);
    expect(result.winRate).toBe(1);

    // Without match the bot keeps farming past the gap to the cap ⇒ strictly more.
    const unmatched = benchmark({ ...matched, match: undefined });
    expect(unmatched.perOpponent[0].netPoints).toBeGreaterThan(16);
  });
});
