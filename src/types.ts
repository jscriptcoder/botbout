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
  | { type: "attack"; move: MoveId; band: Band };

// ─── State: self is live (skeleton has no perception latency yet) ────────────
export type SelfState = {
  x: number;
  facing: Facing;
  points: number;
  canAct: boolean;
  phaseRemaining: number;
};

export type OpponentState = {
  x: number;
  facing: Facing;
  distance: number;
};

export type RingState = { width: number };
export type ClockState = { tick: number; ticksRemaining: number };

export type State = {
  self: SelfState;
  opponent: OpponentState;
  ring: RingState;
  clock: ClockState;
};
