// ============================================================================
// Benchmark aggregator — the pure scoring core of the one-shot LLM bot-authoring
// benchmark. Given a submitted bot, a frozen gauntlet, the seed set, a tick cap,
// and the frame table, it runs every (opponent × seed × side) fight through the
// real deterministic engine (`runFight`) and reduces them to a ranking number:
// Σ net-points (primary) and win-rate (tiebreaker), with a per-opponent
// breakdown.
//
// PURE + deterministic: no I/O, no clock, no randomness of its own — the only
// entropy is each fight's seed, which threads `runFight`'s PRNG. Each
// (opponent × seed) is played TWICE — submitted bot as fighter A, then as
// fighter B — and both fights count, cancelling the start-side / PRNG-draw-order
// asymmetry baked into the perception jitter (a matchup is not side-symmetric).
//
// No mirror: a gauntlet opponent that deep-equals the submitted document is
// skipped (a bot vs its own clone is just side-asymmetry noise). For a real LLM
// submission this never triggers; it only matters when self-testing a roster bot.
// ============================================================================
import { runFight } from "./sim.js";
import type { Rules } from "./types.js";
import type { BotDoc } from "./dsl.js";

export type OpponentScore = {
  name: string;
  netPoints: number; // Σ (botScore − oppScore) over both sides × seeds
  wins: number; // fights the submitted bot won (a draw is not a win)
  draws: number;
  fights: number; // |seeds| × 2
};

export type BenchmarkResult = {
  netPoints: number; // primary ranking key
  winRate: number; // wins / totalFights (tiebreaker); 0 when no fights ran
  wins: number;
  draws: number;
  totalFights: number;
  perOpponent: OpponentScore[];
};

export type BenchmarkConfig = {
  bot: BotDoc;
  gauntlet: BotDoc[];
  seeds: readonly number[];
  maxTicks: number;
  rules: Rules;
};

// One fight reduced to the submitted bot's perspective.
type Outcome = { net: number; botWin: boolean; draw: boolean };

// Deep document identity for the no-mirror rule. Both documents are validated
// JSON (plain data, no functions/undefined), so a serialization compare is a
// faithful deep-equal. It is conservative on key order — a reordered-but-otherwise
// -identical doc would NOT be skipped — which only ever yields a (harmless) extra
// mirror fight, never a wrong skip; the real trigger is the SAME file submitted
// against itself, where order is identical.
const sameDoc = (a: BotDoc, b: BotDoc): boolean =>
  JSON.stringify(a) === JSON.stringify(b);

// Play one (bot vs opponent) matchup at one seed on BOTH sides, each reduced to
// the submitted bot's perspective.
const playBothSides = (
  bot: BotDoc,
  opp: BotDoc,
  seed: number,
  maxTicks: number,
  rules: Rules,
): Outcome[] => {
  const asA = runFight({ rules, botA: bot, botB: opp, maxTicks, seed });
  const asB = runFight({ rules, botA: opp, botB: bot, maxTicks, seed });

  return [
    {
      net: asA.scores.a - asA.scores.b,
      botWin: asA.winner === "A",
      draw: asA.winner === "draw",
    },
    {
      net: asB.scores.b - asB.scores.a,
      botWin: asB.winner === "B",
      draw: asB.winner === "draw",
    },
  ];
};

const scoreAgainst = (
  bot: BotDoc,
  opp: BotDoc,
  seeds: readonly number[],
  maxTicks: number,
  rules: Rules,
): OpponentScore => {
  const outcomes = seeds.flatMap((seed) =>
    playBothSides(bot, opp, seed, maxTicks, rules),
  );

  return {
    name: opp.name,
    netPoints: outcomes.reduce((sum, o) => sum + o.net, 0),
    wins: outcomes.filter((o) => o.botWin).length,
    draws: outcomes.filter((o) => o.draw).length,
    fights: outcomes.length,
  };
};

export const benchmark = (cfg: BenchmarkConfig): BenchmarkResult => {
  const { bot, gauntlet, seeds, maxTicks, rules } = cfg;

  const perOpponent = gauntlet
    .filter((opp) => !sameDoc(opp, bot)) // no mirror
    .map((opp) => scoreAgainst(bot, opp, seeds, maxTicks, rules));

  const netPoints = perOpponent.reduce((sum, o) => sum + o.netPoints, 0);
  const wins = perOpponent.reduce((sum, o) => sum + o.wins, 0);
  const draws = perOpponent.reduce((sum, o) => sum + o.draws, 0);
  const totalFights = perOpponent.reduce((sum, o) => sum + o.fights, 0);

  return {
    netPoints,
    winRate: totalFights === 0 ? 0 : wins / totalFights,
    wins,
    draws,
    totalFights,
    perOpponent,
  };
};
