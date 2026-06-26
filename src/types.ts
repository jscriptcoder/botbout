// ============================================================================
// The engine's data contract — the single source of truth for the per-fighter
// State the interpreter reads and the Action a bot returns. Do NOT redeclare
// these elsewhere. (The Rules frame table joins this file in a later slice.)
//
// Skeleton scope: the minimal read surface plan slices 1–5 need; it grows
// ADDITIVELY (adding a field never invalidates a previously valid bot).
// ============================================================================

export type Facing = -1 | 1;
export type Band = "high" | "mid" | "low";
export type MoveId = "strike";

// ─── Action grammar — a bot returns exactly ONE per tick ─────────────────────
// `dir` is RELATIVE to facing: +1 = toward opponent, -1 = away, 0 = hold.
export type Action =
  | { type: "idle" }
  | { type: "move"; dir: -1 | 0 | 1 }
  | { type: "block"; band: Band }
  | { type: "crouch" } // grounded posture: vacates the `high` band (a high strike whiffs)
  | { type: "jump"; dir: -1 | 0 | 1 } // gravity arc; airborne ⇒ committed (`dir` reserved, vertical-only for now)
  | { type: "attack"; move: MoveId; band: Band };

// ─── State: self is live (skeleton has no perception latency yet) ────────────
export type SelfState = {
  x: number;
  facing: Facing;
  points: number;
  canAct: boolean;
  phaseRemaining: number;
  counterWindow: number; // post-parry counter-window ticks left (live; 0 = closed)
};

export type OpponentState = {
  x: number;
  y: number; // perceived height (sub-units) — positional ⇒ L_pos-delayed
  facing: Facing;
  distance: number; // raw (delayed) gap to live self
  attacking: boolean; // is the (perceived) opponent committed to a move?
  attackBand: number; // height-ordered enum of the perceived attack: 0 none, 1 low, 2 mid, 3 high
  posture: number; // perceived stance enum: 0 standing, 1 crouching, 2 airborne (action ⇒ L_act-delayed)
  vx: number; // perceived horizontal velocity (sub-units/tick), for dead-reckoning
  predictedDistance: number; // distance dead-reckoned forward over the L_pos gap
};

export type RingState = { width: number };
export type ClockState = { tick: number; ticksRemaining: number };

export type State = {
  self: SelfState;
  opponent: OpponentState;
  ring: RingState;
  clock: ClockState;
};

// ─── Rules: the immutable frame table (never changes during a fight) ─────────
// Skeleton scope: movement + one strike. All quantities are integer sub-units
// (SCALE = 1000 sub-units per world unit). Grows with the deep frame table.

// One technique's frame data (skeleton: just what scoring needs).
export type MoveSpec = {
  startup: number; // ticks before the active window opens
  active: number; // ticks the strike can connect
  recovery: number; // ticks after the active window, still committed
  score: number; // WKF points awarded on hit (0–3)
  reach: number; // horizontal reach in sub-units
};

export type Rules = {
  tickRate: number; // ticks per second (60)
  walkSpeed: number; // sub-units travelled per tick while moving
  ring: { width: number }; // ring width in sub-units
  startGap: number; // initial separation between the two fighters (sub-units)
  moves: Record<MoveId, MoveSpec>; // the frame table
  // Vertical axis (C4). Both absent ⇒ inert (a `jump` launches no arc) ⇒
  // byte-identical to the pre-vertical engine. `jumpImpulse` is the initial
  // upward velocity (sub-units/tick); `gravity` is the per-tick downward delta
  // applied to that velocity. Integer sub-units only — the arc is replay-stable.
  jumpImpulse?: number;
  gravity?: number;
  // The height (sub-units) at/above which an airborne fighter vacates the `low`
  // band — a sweep passes under it. Absent ⇒ `low` is never vacated ⇒ an airborne
  // fighter stays hittable everywhere (byte-identical to the pre-vacate engine).
  lowClearance?: number;
  // Parry window (C5). The first `parryWindow` ticks of a CONTINUOUS matching-band
  // guard (guard-age 1..parryWindow) DEFLECT an absorbed active strike instead of
  // merely blocking it: the attacker is thrown into `parryRecovery` extra recovery
  // ticks (frame disadvantage). Both absent ⇒ a matching guard always blocks ⇒
  // byte-identical to the pre-parry (C4) engine.
  parryWindow?: number;
  parryRecovery?: number;
  // Parry counter window (C5). After a parry, the parrying fighter holds a counter
  // window for `counterWindow` ticks; a strike it lands while the window is open scores
  // an extra `counterBonus` points (the deflect's payoff). Both absent ⇒ no counter
  // bonus ⇒ byte-identical to the deflect-only (C5 slice 1) engine.
  counterWindow?: number;
  counterBonus?: number;
  // Opponent perception latency (ticks). Self is always live. Absent (or any
  // field absent) ⇒ 0 ⇒ that layer is perceived live (forward-compatible with
  // the L=0 skeleton). Positional fields lag by lPos; action fields by lAct.
  // `jitter` (amplitude j ≥ 0) wobbles each perceived latency by a seeded integer
  // in [−j, +j] per tick (clamped at 0); 0 ⇒ no jitter, no PRNG draws.
  perception?: { lPos?: number; lAct?: number; jitter?: number };
};
