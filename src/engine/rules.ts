// ============================================================================
// The CANONICAL frame table — the authoritative `Rules` the platform fights on.
// Engine-level single source of truth (the runner, and the future API / viewer,
// all consume this); it supersedes the provisional `src/cli/demo-rules.ts`.
//
// Every number here is PROVEN by a behavioral `runFight` test in `rules.test.ts`:
// the suite asserts the design relationships (the master inequalities + WKF
// scoring), not the literals in isolation — so the table is "balanced" in the
// structural sense (it satisfies the deep-karate read game), not the
// telemetry-tuned sense (that needs a mass-matchup harness — a later capability).
//
// Built additively, one capability slice at a time (mirroring the engine's C1–C8):
//   • Slice 2 (here): the strike read-game core — movement, the one strike, and the
//     reaction-viable perception layer. `lAct` and `strike.reach` are LOCKED here;
//     later slices respect them (every committed startup ≥ lAct+1; the reach
//     hierarchy throw < sweep < strike is filled in additively).
//   • Slices 3–5 (later): strike defenses (parry/counter/cancel windows), the throw
//     triangle, and the sweep + okizeme + air physics — each adds optional fields.
//
// Units: integer sub-units, SCALE = 1000 sub-units / world unit. The ring is 600
// units wide; fighters start 300 units apart; a strike reaches 240 units (so the
// pair starts OUT of range and must close ~60 units to threaten).
// ============================================================================
import type { Rules } from "./types.js";

export const CANONICAL_RULES: Rules = {
  tickRate: 60,
  walkSpeed: 4000, // 4 units/tick — closing the 60-unit neutral gap takes ~15 ticks
  ring: { width: 600000 }, // 600 units
  startGap: 300000, // 300 units apart; startGap > strike.reach ⇒ must close to hit
  moves: {
    // The base strike (WKF yuko = 1). It sits on the design's two knife-edges:
    //   • startup 7 = lAct (6) + 1 ⇒ the band tell is reactable — but only just.
    //   • recovery 13 = lAct (6) + startup (7) ⇒ a whiff is punishable — but only just.
    // (The C6 rekka route `cancelInto:["strike"]` arrives in Slice 3 with cancelWindow.)
    strike: {
      startup: 7,
      active: 3,
      recovery: 13,
      score: 1,
      reach: 240000, // 240 units — LOCKED; later reach hierarchy throw < sweep < strike
    },
  },
  // The perception keystone (C2): position lags 1 tick, the action tell lags 6, with
  // ±1 seeded jitter. lAct 6 with strike.startup 7 puts the read on the knife-edge
  // (S ≥ lAct + 1 holds with equality), so jitter + sharp timing decide the exchange.
  perception: { lPos: 1, lAct: 6, jitter: 1 },
};
