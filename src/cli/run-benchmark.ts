// ============================================================================
// Benchmark CLI logic — the testable core of `npm run benchmark`. Pure: it takes
// argv + injected dependencies (the bot loader, the frozen gauntlet, the frame
// table, run parameters) and returns { stdout, stderr, code } rather than
// touching the process. The thin entry script (benchmark.ts) wires the real
// filesystem + manifest and performs the actual stream writes / exit.
//
// Stream/exit discipline (cli-design): the report goes to stdout; usage and
// errors go to stderr. Exit 0 = scored, 1 = the bot was rejected / unreadable,
// 2 = bad usage.
// ============================================================================
import {
  benchmark,
  type BenchmarkResult,
  type OpponentScore,
} from "../engine/benchmark.js";
import { ValidationError, type BotDoc } from "../engine/dsl.js";
import type { Rules } from "../engine/types.js";

export type LoadBot = (path: string) => BotDoc;

export type BenchmarkDeps = {
  loadBot: LoadBot; // throws ValidationError (rejected) or Error (unreadable)
  gauntlet: BotDoc[];
  rules: Rules;
  seeds: readonly number[];
  maxTicks: number;
  version: string;
};

export type CliOutput = { stdout: string; stderr: string; code: number };

const USAGE = "usage: npm run benchmark -- <bot.json>\n";

const signed = (n: number): string => (n > 0 ? `+${n}` : `${n}`);

const losses = (o: OpponentScore): number => o.fights - o.wins - o.draws;

// A table whose first column (the opponent name) is left-aligned and every
// numeric column is right-aligned, each column padded to its widest cell. The
// left-aligned first column and right-aligned tail mean a row never carries
// leading or trailing whitespace, so no trim is needed.
const render = (rows: string[][]): string => {
  const widths = rows[0].map((_, col) =>
    Math.max(...rows.map((r) => r[col].length)),
  );

  return rows
    .map((r) =>
      r
        .map((cell, col) =>
          col === 0 ? cell.padEnd(widths[col]) : cell.padStart(widths[col]),
        )
        .join("  "),
    )
    .join("\n");
};

const formatReport = (
  bot: BotDoc,
  result: BenchmarkResult,
  deps: BenchmarkDeps,
): string => {
  const header = [
    `ModelKombat benchmark ${deps.version}`,
    `bot: ${bot.name}`,
    `gauntlet: ${result.perOpponent.length} opponents · ${deps.seeds.length} seeds · both sides = ${result.totalFights} fights`,
  ].join("\n");

  const head = ["opponent", "net", "W", "L", "D", "fights"];

  const table = render([
    head,
    ...result.perOpponent.map((o) => [
      o.name,
      signed(o.netPoints),
      `${o.wins}`,
      `${losses(o)}`,
      `${o.draws}`,
      `${o.fights}`,
    ]),
  ]);

  const totalLosses = result.totalFights - result.wins - result.draws;

  const summary =
    `net-points ${signed(result.netPoints)}   ` +
    `win-rate ${(result.winRate * 100).toFixed(1)}%   ` +
    `(${result.wins}W ${totalLosses}L ${result.draws}D of ${result.totalFights})`;

  return `${header}\n\n${table}\n\n${summary}`;
};

export const runBenchmarkCli = (
  argv: string[],
  deps: BenchmarkDeps,
): CliOutput => {
  const path = argv[0];
  if (path === undefined) return { stdout: "", stderr: USAGE, code: 2 };

  let bot: BotDoc;

  try {
    bot = deps.loadBot(path);
  } catch (e) {
    if (e instanceof ValidationError) {
      return {
        stdout: "",
        stderr:
          `invalid bot ${path}:\n` +
          e.issues.map((i) => `  ${i.path}: ${i.reason}`).join("\n") +
          "\n",
        code: 1,
      };
    }

    return {
      stdout: "",
      stderr: `${e instanceof Error ? e.message : String(e)}\n`,
      code: 1,
    };
  }

  const result = benchmark({
    bot,
    gauntlet: deps.gauntlet,
    seeds: deps.seeds,
    maxTicks: deps.maxTicks,
    rules: deps.rules,
  });

  return {
    stdout: formatReport(bot, result, deps) + "\n",
    stderr: "",
    code: 0,
  };
};
