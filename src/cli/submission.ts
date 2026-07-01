// ============================================================================
// A benchmark submission outcome and its ranking — the hard-zero-distinct policy
// in code. A submission is either SCORED (it ran the gauntlet) or INVALID (it
// never fought: extraction found no JSON, or safeParse / validate rejected it).
// `compareSubmission` is a best-first comparator: every valid bot outranks every
// invalid one regardless of how badly it scored (an invalid bot is a distinct
// last-ranked category, NOT just a low score), valid bots order by win-rate then
// net-points (a bot that WINS more outranks one that merely farms more points),
// and invalids are mutually indistinguishable.
// ============================================================================
import type { BenchmarkResult } from "../engine/benchmark.js";
import type { ValidationIssue } from "../engine/dsl.js";

export type Submission =
  | { kind: "scored"; result: BenchmarkResult }
  | { kind: "invalid"; issues: ValidationIssue[] };

/** Best-first ordering: lower = ranks earlier. Use directly with Array.sort. */
export const compareSubmission = (a: Submission, b: Submission): number => {
  if (a.kind === "scored" && b.kind === "scored") {
    const winRateDiff = b.result.winRate - a.result.winRate;
    if (winRateDiff !== 0) return winRateDiff;

    return b.result.netPoints - a.result.netPoints;
  }

  if (a.kind === "scored") return -1; // a scored, b invalid → a first
  if (b.kind === "scored") return 1; // a invalid, b scored → a last

  return 0; // both invalid — no discrimination
};
