import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  BENCHMARK_VERSION,
  SEEDS,
  MAX_TICKS,
  GAUNTLET_NAMES,
  INPUT_HASH,
} from "./benchmark-config.js";
import { CANONICAL_RULES } from "./rules.js";
import { loadBotDoc } from "../cli/load.js";

const botPath = (name: string): string =>
  fileURLToPath(new URL(`../../bots/${name}.json`, import.meta.url));

// The digest of every input that determines a benchmark score: the frame table,
// the run parameters, and the verbatim content of each gauntlet bot. If any of
// these changes, the digest changes — the guard test below then fails until the
// BENCHMARK_VERSION (and INPUT_HASH) are bumped, so a stale version can never
// silently compare across different scoring rules.
const computeInputHash = (): string => {
  const gauntlet = GAUNTLET_NAMES.map((name) =>
    readFileSync(botPath(name), "utf8"),
  );

  const payload = JSON.stringify({
    rules: CANONICAL_RULES,
    seeds: SEEDS,
    maxTicks: MAX_TICKS,
    gauntlet,
  });

  return createHash("sha256").update(payload).digest("hex");
};

describe("benchmark config — the frozen, versioned manifest", () => {
  it("freezes the 6-archetype gauntlet roster in its locked order", () => {
    expect(GAUNTLET_NAMES).toEqual([
      "jabber",
      "rekka",
      "zoner",
      "grappler",
      "sweeper",
      "vulture",
    ]);
  });

  it("freezes the run parameters: seeds 1..10 at 600 ticks", () => {
    expect(SEEDS).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(MAX_TICKS).toBe(600);
  });

  it("carries a non-empty BENCHMARK_VERSION string", () => {
    expect(typeof BENCHMARK_VERSION).toBe("string");
    expect(BENCHMARK_VERSION.length).toBeGreaterThan(0);
  });

  it("every gauntlet bot loads + validates through the real gate (roster integrity)", () => {
    for (const name of GAUNTLET_NAMES) {
      expect(() =>
        loadBotDoc(readFileSync(botPath(name), "utf8")),
      ).not.toThrow();
    }
  });

  it("pins the scoring inputs to INPUT_HASH — bump BENCHMARK_VERSION + INPUT_HASH when this fails", () => {
    expect(computeInputHash()).toBe(INPUT_HASH);
  });
});
