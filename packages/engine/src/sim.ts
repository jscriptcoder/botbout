// ============================================================================
// Deterministic simulation loop — STUB / NEXT TASK.
//
// This is the heart that runs two validated bots against each other and emits a
// bit-reproducible replay. Implement against the invariants below. They are not
// optional: violating any one of them breaks replay determinism or fairness.
//
// INVARIANTS
//  1. Fixed timestep. One call to runTick per fighter per tick. The engine is
//     the loop; bots never loop.
//  2. Seeded RNG only. Thread a single seeded PRNG (e.g. mulberry32/xoshiro)
//     through the whole sim. No Math.random, no Date.now, no wall-clock.
//  3. Integer / fixed-point math for anything affecting outcomes (positions,
//     velocities, hp, stamina). No floats in the outcome path → identical
//     replays across platforms.
//  4. Same pre-tick snapshot for both fighters. Build an immutable snapshot of
//     tick T, call runTick(botA, viewFor(A)) and runTick(botB, viewFor(B)) both
//     reading it, THEN resolve both actions together. Neither sees the other's
//     action this tick (they only ever see delayed opponent state anyway).
//  5. Perception latency via ring buffer. Keep per-fighter public-state history;
//     the opponent view is read from (T - latency.action) for action fields and
//     (T - latency.position) for position fields — a single coherent snapshot,
//     never a mix of fresh and stale fields. Expose `staleness`,
//     `predictedDistance` (dead-reckoned), and `moveRecoveryRemaining` as
//     derived fields.
//  6. Deterministic resolution order for simultaneous actions: compare startup,
//     apply the move triangle (strike > grab > block > strike; dodge i-frames),
//     resolve trades by a fixed tiebreak, then hit detection, pushback, ring-out.
//  7. Commitment: once a move enters startup it runs to the end of recovery;
//     actions returned while locked are ignored (no cancels in v1).
//  8. Failure is telemetry, never a crash: illegal/unaffordable/over-budget
//     action ⇒ idle + a logged event the author can read afterward.
//
// REPLAY: persist { seed, rulesHash, botA, botB, initialConditions }. Re-running
// the sim from these must reproduce the fight tick-for-tick. The per-tick event
// log is derived, not authoritative.
// ============================================================================
import type { State, Rules } from "./types.js";
import type { BotDoc } from "./dsl.js";
// import { runTick } from "./dsl.js";

export interface FightConfig {
  seed: number;
  rules: Rules;
  botA: BotDoc;
  botB: BotDoc;
  maxTicks?: number;
}

export interface FightResult {
  winner: "A" | "B" | "draw";
  reason: "ko" | "ringout" | "timeout";
  ticks: number;
  // telemetry: moves landed/whiffed/blocked, damage-over-time, stamina curves,
  // momentum swings — the structured feedback that closes the "read your loss,
  // redesign the bot" loop. Shape this next.
  telemetry: unknown;
  // replay: { seed, rulesHash, botA, botB, initialConditions, events[] }
  replay: unknown;
}

export function runFight(_cfg: FightConfig): FightResult {
  throw new Error("not implemented — see invariants above; build this next");
}

// Helper the loop will need: project the full sim state into a per-fighter view
// (self = live, opponent = delayed snapshot + derived fields). Stub:
export function viewFor(_who: "A" | "B" /*, world, history, rules */): State {
  throw new Error("not implemented");
}
