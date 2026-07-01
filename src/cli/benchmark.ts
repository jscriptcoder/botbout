/// <reference types="node" />
// ============================================================================
// CLI benchmark runner — the thin imperative shell. Loads the submitted bot and
// the frozen gauntlet through the validator gate, scores the bot against the
// gauntlet on the canonical frame table, and prints the ranking report.
//
//   npm run benchmark -- <bot.json>
//
// All logic lives in run-benchmark.ts (testable); this file only wires the real
// filesystem + manifest and performs the stream writes / exit.
// ============================================================================
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { loadBotDoc } from "./load.js";
import { runBenchmarkCli, type BenchmarkDeps } from "./run-benchmark.js";
import { CANONICAL_RULES } from "../engine/rules.js";
import {
  BENCHMARK_VERSION,
  SEEDS,
  MAX_TICKS,
  MATCH,
  GAUNTLET_NAMES,
} from "../engine/benchmark-config.js";

const botPath = (name: string): string =>
  fileURLToPath(new URL(`../../bots/${name}.json`, import.meta.url));

const loadBot = (path: string) => {
  let text: string;

  try {
    text = readFileSync(path, "utf8");
  } catch {
    throw new Error(`cannot read bot file: ${path}`);
  }

  return loadBotDoc(text);
};

const readText = (path: string): string => {
  try {
    return readFileSync(path, "utf8");
  } catch {
    throw new Error(`cannot read reply file: ${path}`);
  }
};

const gauntlet = GAUNTLET_NAMES.map((name) =>
  loadBotDoc(readFileSync(botPath(name), "utf8")),
);

const deps: BenchmarkDeps = {
  loadBot,
  readText,
  gauntlet,
  rules: CANONICAL_RULES,
  seeds: SEEDS,
  maxTicks: MAX_TICKS,
  match: MATCH,
  version: BENCHMARK_VERSION,
};

const out = runBenchmarkCli(process.argv.slice(2), deps);
process.stdout.write(out.stdout);
if (out.stderr) process.stderr.write(out.stderr);
process.exit(out.code);
