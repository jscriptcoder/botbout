import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { validate } from "../engine/dsl.js";
import { benchmark } from "../engine/benchmark.js";
import { loadBotDoc } from "./load.js";
import {
  GAUNTLET_NAMES,
  MATCH,
  MAX_TICKS,
  SEEDS,
} from "../engine/benchmark-config.js";
import { CANONICAL_RULES } from "../engine/rules.js";

// The dogfood bot — authored COLD from `docs/spec.md` alone (the one-shot
// benchmark input), exercising the spec's sweep→cancel→finish okizeme combo to
// prove the generated spec is a sufficient authoring instrument. Two things are
// pinned here: (1) it VALIDATES first-try, and (2) run through the real v3
// benchmark (WKF match mode, CANONICAL_RULES with the Slice-6 de-wall kd=18) it
// competes as a REAL match participant — winning some matchups and losing most.
// This replaces the stale raw-600-tick read (a −2682 "> half net-points"
// near-miss against a 100%-win sweeper); under match mode the sweeper is 69% and
// the score ranks by match wins, so the dogfood is a weak-but-legitimate entry.
const botText = (name: string): string =>
  readFileSync(
    fileURLToPath(new URL(`../../bots/${name}.json`, import.meta.url)),
    "utf8",
  );

describe("dogfood bot (authored from docs/spec.md)", () => {
  it("validates on the first generation", () => {
    const doc: unknown = JSON.parse(botText("dogfood"));
    expect(validate(doc).ok).toBe(true);
  });

  it("competes as a real match participant in the v3 benchmark (wins some, loses most)", () => {
    // The real aggregator over the frozen v3 gauntlet — the exact scoring inputs
    // pinned by BENCHMARK_VERSION/INPUT_HASH (a change bumps the version and this
    // characterization with it).
    const result = benchmark({
      bot: loadBotDoc(botText("dogfood")),
      gauntlet: GAUNTLET_NAMES.map((name) => loadBotDoc(botText(name))),
      seeds: SEEDS,
      maxTicks: MAX_TICKS,
      rules: CANONICAL_RULES,
      match: MATCH,
    });

    const losses = result.totalFights - result.wins - result.draws;

    // A real competitor: it takes genuine wins (no longer the degenerate 0-wins
    // raw-farm read) while losing the majority. Net (−1715) stays loop-inflated in
    // yame-starving matchups (vs rekka / sweeper), so RANKING is by win-rate
    // (primary); net is only the tiebreaker.
    expect(result.wins).toBe(15);
    expect(losses).toBe(104);
    expect(result.draws).toBe(1);
    expect(result.totalFights).toBe(120);
  });
});
