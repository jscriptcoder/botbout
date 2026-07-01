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
import {
  ValidationError,
  type BotDoc,
  type ValidationIssue,
} from "../engine/dsl.js";
import type { Rules } from "../engine/types.js";
import { extractBotJson } from "./extract.js";
import { parseBotDoc, type ParsedBot } from "./load.js";

export type LoadBot = (path: string) => BotDoc;

export type BenchmarkDeps = {
  loadBot: LoadBot; // throws ValidationError (rejected) or Error (unreadable)
  readText: (path: string) => string; // raw reply text; throws Error if unreadable
  gauntlet: BotDoc[];
  rules: Rules;
  seeds: readonly number[];
  maxTicks: number;
  match?: { winGap: number }; // WKF match mode; absent ⇒ fights run to maxTicks
  version: string;
};

export type CliOutput = { stdout: string; stderr: string; code: number };

const USAGE =
  "usage: npm run benchmark -- <bot.json>\n" +
  "       npm run benchmark -- --from-reply <reply.txt>\n";

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
    `win-rate ${(result.winRate * 100).toFixed(1)}%   ` +
    `net-points ${signed(result.netPoints)}   ` +
    `(${result.wins}W ${totalLosses}L ${result.draws}D of ${result.totalFights})`;

  return `${header}\n\n${table}\n\n${summary}`;
};

// A validated bot scored against the gauntlet and rendered to a 0-exit report.
const scoredOutput = (bot: BotDoc, deps: BenchmarkDeps): CliOutput => {
  const result = benchmark({
    bot,
    gauntlet: deps.gauntlet,
    seeds: deps.seeds,
    maxTicks: deps.maxTicks,
    rules: deps.rules,
    match: deps.match,
  });

  return {
    stdout: formatReport(bot, result, deps) + "\n",
    stderr: "",
    code: 0,
  };
};

// A distinct, last-ranked invalid outcome (hard-zero-distinct): a labelled
// header naming the reply, then each structured issue on its own line.
const formatInvalid = (source: string, issues: ValidationIssue[]): string =>
  `invalid submission ${source}:\n` +
  issues.map((i) => `  ${i.path}: ${i.reason}`).join("\n") +
  "\n";

// A raw reply reduced to either a validated bot or the issues that reject it.
// Lenient extraction picks the JSON substring, then the SAME safeParse + validate
// TCB gate the strict loader uses runs (via parseBotDoc) — failures captured, not
// thrown. A reply with no extractable JSON is just another rejected ParsedBot.
const evaluateReply = (text: string): ParsedBot => {
  const extracted = extractBotJson(text);

  if (extracted === null) {
    return {
      ok: false,
      issues: [{ path: "$", reason: "no bot JSON found in reply" }],
    };
  }

  return parseBotDoc(extracted);
};

const fromBotFile = (
  path: string | undefined,
  deps: BenchmarkDeps,
): CliOutput => {
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

  return scoredOutput(bot, deps);
};

const fromReply = (
  replyPath: string | undefined,
  deps: BenchmarkDeps,
): CliOutput => {
  if (replyPath === undefined) return { stdout: "", stderr: USAGE, code: 2 };

  let text: string;

  try {
    text = deps.readText(replyPath);
  } catch (e) {
    return {
      stdout: "",
      stderr: `${e instanceof Error ? e.message : String(e)}\n`,
      code: 1,
    };
  }

  const outcome = evaluateReply(text);

  if (!outcome.ok) {
    return {
      stdout: "",
      stderr: formatInvalid(replyPath, outcome.issues),
      code: 1,
    };
  }

  return scoredOutput(outcome.bot, deps);
};

// Direct `<bot.json>` validates strictly (slice-1 behaviour, byte-unchanged);
// `--from-reply <reply.txt>` adds lenient extraction. One-shot — no repair loop.
export const runBenchmarkCli = (
  argv: string[],
  deps: BenchmarkDeps,
): CliOutput =>
  argv[0] === "--from-reply"
    ? fromReply(argv[1], deps)
    : fromBotFile(argv[0], deps);
