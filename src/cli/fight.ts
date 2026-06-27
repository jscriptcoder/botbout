/// <reference types="node" />
// ============================================================================
// CLI fight runner — the thin imperative shell. Loads two bot documents through
// the validator gate, runs them against each other with the provisional demo
// frame table, and prints the tick log + result.
//
//   npm run fight -- <botA.json> <botB.json> [--seed N] [--ticks N] [--full]
//
// Stream/exit discipline (cli-design): the report goes to stdout; usage and
// errors go to stderr. Exit 0 = ran, 1 = a bot was rejected / unreadable,
// 2 = bad usage.
// ============================================================================
import { readFileSync } from "node:fs";
import { runFight } from "../engine/sim.js";
import { ValidationError } from "../engine/dsl.js";
import { loadBotDoc } from "./load.js";
import { formatFight, type FormatMode } from "./format.js";
import { DEMO_RULES } from "./demo-rules.js";

const USAGE =
  "usage: npm run fight -- <botA.json> <botB.json> [--seed N] [--ticks N] [--full]\n";

const die = (message: string, code: number): never => {
  process.stderr.write(message);
  process.exit(code);
};

const parseArgs = (
  argv: string[],
): { paths: string[]; seed: number; ticks: number; mode: FormatMode } => {
  const paths: string[] = [];
  let seed = 1;
  let ticks = 200;
  let mode: FormatMode = "changes";

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--seed") seed = Number(argv[++i]);
    else if (arg === "--ticks") ticks = Number(argv[++i]);
    else if (arg === "--full") mode = "full";
    else paths.push(arg);
  }

  return { paths, seed, ticks, mode };
};

const { paths, seed, ticks, mode } = parseArgs(process.argv.slice(2));

if (paths.length < 2) die(USAGE, 2);

if (!Number.isInteger(seed) || !Number.isInteger(ticks) || ticks < 1) {
  die("--seed and --ticks must be integers (--ticks >= 1)\n" + USAGE, 2);
}

const read = (path: string): string => {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return die(`cannot read bot file: ${path}\n`, 1);
  }
};

const load = (path: string) => {
  try {
    return loadBotDoc(read(path));
  } catch (e) {
    if (e instanceof ValidationError) {
      return die(
        `invalid bot ${path}:\n` +
          e.issues.map((i) => `  ${i.path}: ${i.reason}`).join("\n") +
          "\n",
        1,
      );
    }

    return die(`${path}: ${e instanceof Error ? e.message : String(e)}\n`, 1);
  }
};

const [pathA, pathB] = paths;
const botA = load(pathA);
const botB = load(pathB);

const result = runFight({
  rules: DEMO_RULES,
  botA,
  botB,
  maxTicks: ticks,
  seed,
});

process.stdout.write(formatFight(result, { seed, mode }) + "\n");
