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
  readText: () => "",
  gauntlet: [LOSER, TRADER],
  rules: MOCK_RULES,
  seeds: [1, 2],
  maxTicks: 12,
  version: "vtest",
  ...o,
});

const FENCE = "```";

// A raw model reply that wraps the given bot JSON in a ```json fence, the way a
// model would (prose around a fenced block). `--from-reply` must extract it.
const reply = (botJson: string): string =>
  `Here is my submission:\n${FENCE}json\n${botJson}\n${FENCE}\nGood luck!`;

describe("runBenchmarkCli — report on stdout", () => {
  it("prints the full report: version header, bot name, per-opponent table, and headline leading with win-rate", () => {
    const out = runBenchmarkCli(["bots/sub.json"], deps());

    expect(out.code).toBe(0);
    expect(out.stderr).toBe("");
    // The exact layout: net-points and win/draw counts per opponent, then the
    // headline LEADING with win-rate (the primary ranking figure). vs LOSER the
    // bot wins all 4 (net +4); vs TRADER it draws all 4 (net 0); 4 wins of 8 ⇒
    // 50.0%. The names are left-aligned, numbers right.
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
        "win-rate 50.0%   net-points +4   (4W 0L 4D of 8)",
        "",
      ].join("\n"),
    );
  });

  it("is deterministic — identical stdout across repeat runs", () => {
    expect(runBenchmarkCli(["bots/sub.json"], deps()).stdout).toBe(
      runBenchmarkCli(["bots/sub.json"], deps()).stdout,
    );
  });

  it("fights WKF matches when deps.match is set — fights end at the win gap, bounding net-points", () => {
    // Over 300 ticks the bot out-scores the idle LOSER on every seed × side;
    // match mode ends each fight at a +8 gap ⇒ net exactly +8 per fight (4 fights
    // ⇒ +32, 100% win-rate) rather than the unbounded farmed total.
    const out = runBenchmarkCli(
      ["bots/sub.json"],
      deps({ gauntlet: [LOSER], maxTicks: 300, match: { winGap: 8 } }),
    );

    expect(out.code).toBe(0);
    expect(out.stdout).toContain("win-rate 100.0%");
    expect(out.stdout).toContain("net-points +32");
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

describe("runBenchmarkCli — --from-reply (lenient extraction)", () => {
  // The reply path never touches the strict file loader: a throwing loadBot
  // proves the scored result came from extracting + validating the reply itself.
  const replyDeps = (text: string): BenchmarkDeps => ({
    ...deps(),
    readText: () => text,
    loadBot: () => {
      throw new Error("loadBot must not be called on the --from-reply path");
    },
  });

  it("extracts a fenced bot from a prose reply and scores it like a direct submission", () => {
    const out = runBenchmarkCli(
      ["--from-reply", "reply.txt"],
      replyDeps(reply(JSON.stringify(SUBMITTED))),
    );

    expect(out.code).toBe(0);
    expect(out.stderr).toBe("");
    // Byte-identical to the direct-path report for the same bot + gauntlet — the
    // reply path parses the extracted JSON through the same validate gate.
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
        "win-rate 50.0%   net-points +4   (4W 0L 4D of 8)",
        "",
      ].join("\n"),
    );
  });

  it("rejects a reply with no extractable JSON as a distinct invalid submission", () => {
    const out = runBenchmarkCli(
      ["--from-reply", "reply.txt"],
      replyDeps("Sorry, I can't help with that."),
    );

    expect(out.code).toBe(1);
    expect(out.stdout).toBe("");
    // Distinct from a low-scoring valid bot: a labelled invalid report + reason.
    expect(out.stderr).toBe(
      "invalid submission reply.txt:\n  $: no bot JSON found in reply\n",
    );
  });

  it("rejects a reply whose extracted JSON does not parse, capturing the parse error", () => {
    const out = runBenchmarkCli(
      ["--from-reply", "reply.txt"],
      replyDeps(reply("{not valid json}")),
    );

    expect(out.code).toBe(1);
    expect(out.stdout).toBe("");
    expect(out.stderr).toMatch(/^invalid submission reply\.txt:\n {2}\$: /);
  });

  it("rejects a reply whose extracted bot fails validation, listing every validator issue on its own line", () => {
    const out = runBenchmarkCli(
      ["--from-reply", "reply.txt"],
      replyDeps(reply('{"version":2,"name":"x"}')),
    );

    expect(out.code).toBe(1);
    expect(out.stdout).toBe("");
    // Every structured issue, newline-joined under a labelled header.
    expect(out.stderr).toBe(
      "invalid submission reply.txt:\n" +
        "  version: must be 1\n" +
        "  rules: must be an array\n" +
        "  default: expected an action\n",
    );
  });

  it("captures a safeParse rejection (a forbidden key) as the structured issue, not a generic parse error", () => {
    const out = runBenchmarkCli(
      ["--from-reply", "reply.txt"],
      replyDeps(reply('{"__proto__":1,"version":1,"name":"x"}')),
    );

    expect(out.code).toBe(1);
    expect(out.stdout).toBe("");
    // The safeParse ValidationError's own issue surfaces verbatim — NOT folded
    // into a generic "$: ..." parse-error line.
    expect(out.stderr).toBe(
      "invalid submission reply.txt:\n  __proto__: forbidden key\n",
    );
  });

  it("rejects extracted JSON that parses to a non-object (an array) via the validator", () => {
    const out = runBenchmarkCli(
      ["--from-reply", "reply.txt"],
      replyDeps(reply("[1, 2, 3]")),
    );

    expect(out.code).toBe(1);
    expect(out.stdout).toBe("");
    expect(out.stderr).toContain("invalid submission reply.txt:");
  });

  it("exits 1 with just the error message when the reply file cannot be read", () => {
    const out = runBenchmarkCli(["--from-reply", "missing.txt"], {
      ...deps(),
      readText: () => {
        throw new Error("cannot read reply file: missing.txt");
      },
    });

    expect(out.code).toBe(1);
    expect(out.stdout).toBe("");
    expect(out.stderr).toBe("cannot read reply file: missing.txt\n");
  });

  it("exits 2 with usage (showing the --from-reply form) when --from-reply is given no path", () => {
    const out = runBenchmarkCli(["--from-reply"], deps());

    expect(out.code).toBe(2);
    expect(out.stdout).toBe("");
    expect(out.stderr.toLowerCase()).toContain("usage");
    expect(out.stderr).toContain("--from-reply <reply.txt>");
  });
});
