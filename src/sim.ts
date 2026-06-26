// ============================================================================
// Deterministic fight loop. Runs two ALREADY-VALIDATED bots against each other
// and emits a bit-reproducible integer event log. The engine is the loop; bots
// never loop.
//
// Determinism rests on: fixed timestep; one runTick per fighter per tick;
// integer / fixed-point math only (sub-units, SCALE = 1000); and the
// same-pre-tick-snapshot rule — both fighters decide against tick T's positions,
// then both actions resolve together. No Math.random / Date.now / wall-clock.
//
// Skeleton scope (plan Slice 3): movement only. No scoring (winner is always
// "draw"), no commitment (canAct is always 1), no perception latency (opponent
// is live, L = 0), no PRNG yet (nothing consumes randomness — it arrives with
// jitter). Each of those joins in a later slice.
// ============================================================================
import type { State, Action, Rules, Facing } from "./types.js";
import { runTick, type BotDoc } from "./dsl.js";

export type FighterFrame = { x: number; action: Action };
export type FightEvent = { tick: number; a: FighterFrame; b: FighterFrame };

export type FightConfig = {
  rules: Rules;
  botA: BotDoc;
  botB: BotDoc;
  maxTicks: number;
  seed: number; // replay-identity key; unused until a PRNG (jitter) consumes it
};

export type FightResult = {
  winner: "A" | "B" | "draw";
  ticks: number;
  events: FightEvent[];
};

type Fighter = { x: number; facing: Facing; mem: Record<string, number> };

const initMem = (bot: BotDoc): Record<string, number> => ({ ...(bot.memory ?? {}) });

// Auto-facing: always turn toward the opponent (ties resolve to +1, deterministic).
const facingToward = (selfX: number, otherX: number): Facing => (otherX >= selfX ? 1 : -1);

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

// Build one fighter's view of tick T: self is live; opponent is live too (L = 0).
const viewFor = (self: Fighter, other: Fighter, rules: Rules, tick: number, maxTicks: number): State => ({
  self: { x: self.x, facing: self.facing, points: 0, canAct: true, phaseRemaining: 0 },
  opponent: { x: other.x, facing: other.facing, distance: Math.abs(other.x - self.x) },
  ring: { width: rules.ring.width },
  clock: { tick, ticksRemaining: maxTicks - tick },
});

const applyMove = (x: number, facing: Facing, action: Action, rules: Rules): number => {
  if (action.type !== "move") return x;
  return clamp(x + action.dir * facing * rules.walkSpeed, 0, rules.ring.width);
};

export function runFight(cfg: FightConfig): FightResult {
  const { rules, botA, botB, maxTicks } = cfg;

  const a: Fighter = { x: Math.trunc((rules.ring.width - rules.startGap) / 2), facing: 1, mem: initMem(botA) };
  const b: Fighter = { x: Math.trunc((rules.ring.width + rules.startGap) / 2), facing: 1, mem: initMem(botB) };
  const events: FightEvent[] = [];

  for (let tick = 0; tick < maxTicks; tick++) {
    // 1. Auto-face from pre-tick positions.
    a.facing = facingToward(a.x, b.x);
    b.facing = facingToward(b.x, a.x);

    // 2. Both fighters decide against one immutable pre-tick snapshot.
    const aAction = runTick(botA, viewFor(a, b, rules, tick, maxTicks), a.mem);
    const bAction = runTick(botB, viewFor(b, a, rules, tick, maxTicks), b.mem);

    // 3. Resolve both actions together (each from its own pre-tick position).
    const aNext = applyMove(a.x, a.facing, aAction, rules);
    const bNext = applyMove(b.x, b.facing, bAction, rules);
    a.x = aNext;
    b.x = bNext;

    // 4. Record the integer event.
    events.push({ tick, a: { x: a.x, action: aAction }, b: { x: b.x, action: bAction } });
  }

  return { winner: "draw", ticks: maxTicks, events };
}
