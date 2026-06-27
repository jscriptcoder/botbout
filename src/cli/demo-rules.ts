// ============================================================================
// PROVISIONAL demo frame table for the CLI fight runner — NOT the canonical
// frame table. The real, balanced frame table is a future TDD capability (see
// `docs/DESIGN.md` and CLAUDE.md "NEXT"); these numbers exist only to make the
// runner produce a legible, mechanically-rich demo fight. They mirror the shape
// of the test mocks. Tune freely — nothing in the engine depends on them.
//
// Units: integer sub-units, SCALE = 1000 sub-units / world unit. The ring is
// 600 units wide; fighters start 300 units apart; a strike reaches 220 units.
// ============================================================================
import type { Rules } from "../engine/types.js";

export const DEMO_RULES: Rules = {
  tickRate: 60,
  walkSpeed: 4000, // 4 units/tick
  ring: { width: 600000 }, // 600 units
  startGap: 300000, // 300 units apart — must close ~80 units to reach
  moves: {
    // The base strike. cancelInto:["strike"] lets a confirmed hit rekka into a
    // follow-up (C6) — the only move available to self-cancel into right now.
    strike: {
      startup: 4,
      active: 2,
      recovery: 8,
      score: 1,
      reach: 220000,
      cancelInto: ["strike"],
    },
    // Ashi-barai: a low knockdown strike (C8). score 0 + knockdown:true ⇒ a hit
    // downs instead of scoring; the okizeme finish is where the points come from.
    sweep: {
      startup: 6,
      active: 2,
      recovery: 12,
      score: 0,
      reach: 200000,
      knockdown: true,
    },
  },
  // The throw triangle's anti-guard option (C7): beats any guard, grabs a
  // grounded foe in close range for 3, and knocks them down.
  throw: { startup: 3, active: 2, recovery: 14, reach: 130000, score: 3 },
  knockdownDuration: 40,
  finishWindow: 10, // okizeme: 10-tick guaranteed finish on any knockdown (C8)
  // Defensive depth (C5): the first 3 ticks of a matching-band guard parry
  // (deflect + punish), and a parry opens an 8-tick counter worth +2.
  parryWindow: 3,
  parryRecovery: 10,
  counterWindow: 8,
  counterBonus: 2,
  cancelWindow: 6, // on-contact cancel window after a connect (C6)
  // The perception keystone (C2): position lags 1 tick, the action tell lags 2,
  // with ±1 seeded jitter — so a reactive guard against a startup-4 strike is on
  // the designed knife-edge (S ≥ lAct + 1) and the seed actually matters.
  perception: { lPos: 1, lAct: 2, jitter: 1 },
};
