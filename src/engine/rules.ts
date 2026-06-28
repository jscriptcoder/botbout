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
    // cancelInto:["strike"] is the C6 rekka route: a connect lets it hit-confirm into a follow-up.
    strike: {
      startup: 7,
      active: 3,
      recovery: 13,
      score: 1,
      reach: 240000, // 240 units — LOCKED; later reach hierarchy throw < sweep < strike
      cancelInto: ["strike"],
    },
  },
  // Defensive depth (C5/C6), tuned to the canonical strike's startup-7 timing:
  //   • parryWindow 2 — a matching guard's first 2 ticks (age 1–2) DEFLECT instead of block: a
  //     reaction-precise guard parries, a pre-emptive hold (older) only blocks (the read gradient).
  //   • parryRecovery 12 — a parried strike eats +12 recovery ⇒ heavily punishable / counterable.
  //   • counterWindow 10 / counterBonus 1 — after a parry, a counter strike within 10 ticks scores
  //     an extra yuko (≈ waza-ari, 2 total). 10 ≥ startup(7)+2, so a startup-7 counter lands in time.
  //   • cancelWindow 6 — a connect (hit/block) opens a 6-tick window to cancel recovery into a
  //     `cancelInto` follow-up; reaches into recovery so the rekka hit-confirms.
  parryWindow: 2,
  parryRecovery: 12,
  counterWindow: 10,
  counterBonus: 1,
  cancelWindow: 6,
  // The throw triangle (C7) — the anti-turtle option, on the same startup-7 timing:
  //   • startup 7 = lAct (6) + 1 ⇒ the grab tell is reactable: a read throw-break escapes
  //     it, but only just (symmetric with the strike's read game). One tick faster ⇒ unbreakable.
  //   • active 2 — a 2-tick grab window (forgiving enough to catch a step-in); the FIRST
  //     active frame still governs the break edge, so it does not soften the read.
  //   • recovery 14 ≥ lAct (6) + strike.startup (7) ⇒ a whiffed (or stuffed) grab is
  //     punishable — one tick past the strike's exact-13 edge, as a whiffed grab is the
  //     bigger commitment.
  //   • reach 120000 < strike.reach (240000) ⇒ a grab is close-range (the reach hierarchy
  //     throw < sweep < strike; the sweep fills the gap in a later slice).
  //   • score 3 — a clean throw is the WKF ippon.
  // knockdownDuration 30: a ~half-second knockdown; the okizeme finish / i-frame split is
  // carved out of it in a later slice.
  throw: { startup: 7, active: 2, recovery: 14, reach: 120000, score: 3 },
  knockdownDuration: 30,
  // The perception keystone (C2): position lags 1 tick, the action tell lags 6, with
  // ±1 seeded jitter. lAct 6 with strike.startup 7 puts the read on the knife-edge
  // (S ≥ lAct + 1 holds with equality), so jitter + sharp timing decide the exchange.
  perception: { lPos: 1, lAct: 6, jitter: 1 },
};
