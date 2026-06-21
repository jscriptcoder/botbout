import type { Rules } from "./types.js";

// ============================================================================
// Default frame table — the "Footsies" tuning (perception latency L_act = 6).
// All values are integers / fixed-point. Tune via the Frame Lab tool, then run
// thousands of bot-vs-bot matches and watch move-usage + win-rate distributions
// (target: no move > ~35% usage, no opener > ~60% win-rate).
// ============================================================================

export const DEFAULT_RULES: Rules = {
  tickRate: 60,
  moves: {
    //          startup active recovery dmg stam range onBlock
    punch: { startup: 4, active: 2, recovery: 6, damage: 6, staminaCost: 5, range: 60, onBlock: -2 },
    kick: { startup: 10, active: 3, recovery: 14, damage: 16, staminaCost: 14, range: 110, onBlock: -8 },
    grab: { startup: 8, active: 2, recovery: 18, damage: 14, staminaCost: 12, range: 55, onBlock: 0, unblockable: true },
    dodge: { startup: 3, active: 0, recovery: 8, damage: 0, staminaCost: 18, range: 0, onBlock: 0, invuln: [3, 12] },
  },
  latency: { position: 1, action: 6 },   // L_pos < L_act: see WHERE faster than WHAT
  walkSpeed: 4,                           // ring units per tick while moving
  block: { raise: 2, staminaPerHit: 8, chipDamage: 2 },
  stamina: { regenPerTick: 1 },
  ring: { width: 600 },
  maxHp: 100,
  maxStamina: 100,
};

// Master inequalities (see docs/DESIGN.md):
//   reaction-block :  move.startup  >= latency.action + block.raise
//   whiff-punish   :  move.recovery >= latency.action + punch.startup
