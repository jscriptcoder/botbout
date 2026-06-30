import { describe, it, expect } from "vitest";
import { runBenchmarkCli, type BenchmarkDeps } from "./run-benchmark.js";
import { ValidationError, type BotDoc } from "../engine/dsl.js";
import type { Rules, Action } from "../engine/types.js";

// ─── factories ───────────────────────────────────────────────────────────────
// Same seed-independent setup as the aggregator test: SUBMITTED beats LOSER and
// trades with TRADER, so the printed totals are exactly net +4 / 50% win-rate.
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
const SUBMITTED = named("sub", ATTACK_MID);
const TRADER = named("trader", ATTACK_MID);
const LOSER = named("loser", { type: "idle" });

const deps = (o: Partial<BenchmarkDeps> = {}): BenchmarkDeps => ({
  loadBot: () => SUBMITTED,
  gauntlet: [LOSER, TRADER],
  rules: MOCK_RULES,
  seeds: [1, 2],
  maxTicks: 12,
  version: "vtest",
  ...o,
});

describe("runBenchmarkCli — report on stdout", () => {
  it("prints the full report: version header, bot name, per-opponent table, and headline net-points + win-rate", () => {
    const out = runBenchmarkCli(["bots/sub.json"], deps());

    expect(out.code).toBe(0);
    expect(out.stderr).toBe("");
    // The exact layout: net-points and win/draw counts per opponent, then the
    // headline. vs LOSER the bot wins all 4 (net +4); vs TRADER it draws all 4
    // (net 0); 4 wins of 8 ⇒ 50.0%. The names are left-aligned, numbers right.
    expect(out.stdout).toBe(
      [
        "ModelKombat benchmark vtest",
        "bot: sub",
        "gauntlet: 2 opponents · 2 seeds · both sides = 8 fights",
        "",
        "opponent  net  W  L  D  fights",
        "loser      +4  4  0  0       4",
        "trader      0  0  0  4       4",
        "",
        "net-points +4   win-rate 50.0%   (4W 0L 4D of 8)",
        "",
      ].join("\n"),
    );
  });

  it("is deterministic — identical stdout across repeat runs", () => {
    expect(runBenchmarkCli(["bots/sub.json"], deps()).stdout).toBe(
      runBenchmarkCli(["bots/sub.json"], deps()).stdout,
    );
  });
});

describe("runBenchmarkCli — stream and exit discipline", () => {
  it("exits 2 with a usage message on stderr when no bot path is given", () => {
    const out = runBenchmarkCli([], deps());

    expect(out.code).toBe(2);
    expect(out.stderr.toLowerCase()).toContain("usage");
    expect(out.stdout).toBe("");
  });

  it("exits 1 listing every structured validator issue (one per indented line) when the bot is rejected", () => {
    const out = runBenchmarkCli(["bad.json"], {
      ...deps(),
      loadBot: () => {
        throw new ValidationError([
          { path: "version", reason: "version must be 1" },
          { path: "name", reason: "must be a string" },
        ]);
      },
    });

    expect(out.code).toBe(1);
    expect(out.stdout).toBe("");
    // Exact shape: a header naming the file, then each issue on its own
    // "  <path>: <reason>" line — distinct from the generic-error path below.
    expect(out.stderr).toBe(
      "invalid bot bad.json:\n" +
        "  version: version must be 1\n" +
        "  name: must be a string\n",
    );
  });

  it("exits 1 with just the error message (no issue list) when the bot file cannot be read", () => {
    const out = runBenchmarkCli(["missing.json"], {
      ...deps(),
      loadBot: () => {
        throw new Error("cannot read bot file: missing.json");
      },
    });

    expect(out.code).toBe(1);
    expect(out.stdout).toBe("");
    expect(out.stderr).toBe("cannot read bot file: missing.json\n");
  });
});
