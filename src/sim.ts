// ============================================================================
// Deterministic fight loop. Runs two ALREADY-VALIDATED bots against each other
// and emits a bit-reproducible integer event log. The engine is the loop; bots
// never loop.
//
// Determinism rests on: fixed timestep; one runTick per fighter per tick;
// integer / fixed-point math only (sub-units, SCALE = 1000); and the
// same-pre-tick-snapshot rule — both fighters decide against tick T's state,
// then both actions resolve together. No Math.random / Date.now / wall-clock.
//
// Skeleton scope (plan Slices 3–4): movement + one strike with WKF point
// scoring and on-contact COMMITMENT (a started move runs startup→active→
// recovery; actions issued while committed are ignored). No perception latency
// (opponent is live, L = 0), no blocking/parry, no PRNG yet (nothing consumes
// randomness — it arrives with jitter). Each joins in a later slice.
// ============================================================================
import type {
  State,
  Action,
  Rules,
  Facing,
  MoveId,
  MoveSpec,
} from "./types.js";
import { runTick, type BotDoc } from "./dsl.js";

export type FighterFrame = { x: number; action: Action; points: number };
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
  scores: { a: number; b: number };
  events: FightEvent[];
};

// A fighter is either free to act (neutral) or locked into a committed move.
type MoveState =
  | { kind: "neutral" }
  | { kind: "attacking"; move: MoveId; elapsed: number; scored: boolean };

type Fighter = {
  x: number;
  facing: Facing;
  mem: Record<string, number>;
  points: number;
  state: MoveState;
};

const initMem = (bot: BotDoc): Record<string, number> => ({
  ...(bot.memory ?? {}),
});

// Auto-facing: always turn toward the opponent (ties resolve to +1, deterministic).
const facingToward = (selfX: number, otherX: number): Facing =>
  otherX >= selfX ? 1 : -1;

const clamp = (v: number, lo: number, hi: number): number =>
  Math.max(lo, Math.min(hi, v));

const totalFrames = (spec: MoveSpec): number =>
  spec.startup + spec.active + spec.recovery;

// Build one fighter's view of tick T: self is live; opponent is live too (L = 0).
const viewFor = (
  self: Fighter,
  other: Fighter,
  rules: Rules,
  tick: number,
  maxTicks: number,
): State => {
  const st = self.state;

  const phaseRemaining =
    st.kind === "attacking"
      ? totalFrames(rules.moves[st.move]) - st.elapsed
      : 0;

  return {
    self: {
      x: self.x,
      facing: self.facing,
      points: self.points,
      canAct: st.kind === "neutral",
      phaseRemaining,
    },
    opponent: {
      x: other.x,
      facing: other.facing,
      distance: Math.abs(other.x - self.x),
    },
    ring: { width: rules.ring.width },
    clock: { tick, ticksRemaining: maxTicks - tick },
  };
};

// Honour a neutral fighter's action (start a move, or step). A committed fighter
// ignores its action — the move it is locked into continues.
const intake = (f: Fighter, action: Action, rules: Rules): void => {
  if (f.state.kind !== "neutral") return;

  if (action.type === "attack") {
    f.state = {
      kind: "attacking",
      move: action.move,
      elapsed: 0,
      scored: false,
    };
  } else if (action.type === "move") {
    f.x = clamp(
      f.x + action.dir * f.facing * rules.walkSpeed,
      0,
      rules.ring.width,
    );
  }
  // idle / block: no positional effect in this slice.
};

// During its active window, a strike in reach scores once (per activation) —
// unless the defender is guarding this tick, in which case it is blocked.
const resolveHit = (
  att: Fighter,
  def: Fighter,
  rules: Rules,
  defGuarding: boolean,
): void => {
  const st = att.state;
  if (st.kind !== "attacking" || st.scored) return;
  const spec = rules.moves[st.move];

  const inActiveWindow =
    st.elapsed >= spec.startup && st.elapsed < spec.startup + spec.active;

  if (!inActiveWindow) return;
  if (Math.abs(def.x - att.x) > spec.reach) return;
  if (defGuarding) return; // blocked — no score
  att.points += spec.score;
  st.scored = true;
};

// Advance a committed fighter's move clock; return to neutral when it completes.
const advance = (f: Fighter, rules: Rules): void => {
  const st = f.state;
  if (st.kind !== "attacking") return;
  const next = st.elapsed + 1;
  if (next >= totalFrames(rules.moves[st.move])) f.state = { kind: "neutral" };
  else st.elapsed = next;
};

export function runFight(cfg: FightConfig): FightResult {
  const { rules, botA, botB, maxTicks } = cfg;

  const a: Fighter = {
    x: Math.trunc((rules.ring.width - rules.startGap) / 2),
    facing: 1,
    mem: initMem(botA),
    points: 0,
    state: { kind: "neutral" },
  };

  const b: Fighter = {
    x: Math.trunc((rules.ring.width + rules.startGap) / 2),
    facing: 1,
    mem: initMem(botB),
    points: 0,
    state: { kind: "neutral" },
  };

  const events: FightEvent[] = [];

  for (let tick = 0; tick < maxTicks; tick++) {
    // 1. Auto-face from pre-tick positions.
    a.facing = facingToward(a.x, b.x);
    b.facing = facingToward(b.x, a.x);

    // 2. Both fighters decide against one immutable pre-tick snapshot.
    const aAction = runTick(botA, viewFor(a, b, rules, tick, maxTicks), a.mem);
    const bAction = runTick(botB, viewFor(b, a, rules, tick, maxTicks), b.mem);

    // 3. Resolve together: honour/ignore intake, then hits, then advance clocks.
    //    A fighter guards this tick only if it was free to act and chose `block`
    //    (a committed fighter cannot guard). Simultaneous strikes both score —
    //    each resolveHit touches only its own fighter, so it is order-independent.
    const aGuarding = a.state.kind === "neutral" && aAction.type === "block";
    const bGuarding = b.state.kind === "neutral" && bAction.type === "block";
    intake(a, aAction, rules);
    intake(b, bAction, rules);
    resolveHit(a, b, rules, bGuarding);
    resolveHit(b, a, rules, aGuarding);
    advance(a, rules);
    advance(b, rules);

    // 4. Record the integer event (the bot's RETURNED action, honoured or not).
    events.push({
      tick,
      a: { x: a.x, action: aAction, points: a.points },
      b: { x: b.x, action: bAction, points: b.points },
    });
  }

  const winner = a.points > b.points ? "A" : b.points > a.points ? "B" : "draw";

  return {
    winner,
    ticks: maxTicks,
    scores: { a: a.points, b: b.points },
    events,
  };
}
