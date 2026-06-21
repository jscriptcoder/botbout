// ============================================================================
// Shared contract types — the single source of truth for the state schema,
// action grammar, and rules. Both the simulation engine and the DSL interpreter
// import from here. Do NOT redeclare these elsewhere.
// ============================================================================

export type Phase =
  | "idle"      // free to act
  | "startup"   // winding up an attack — COMMITTED
  | "active"    // attack hitbox is live — COMMITTED
  | "recovery"  // recovering after an attack — COMMITTED and vulnerable
  | "blocking"  // guard held up
  | "stunned"   // in hitstun, cannot act
  | "dodging";  // mid-dodge, i-frames per RULES

export type MoveName = "punch" | "kick" | "grab" | "dodge";
export type MoveStat =
  | "startup" | "active" | "recovery"
  | "damage" | "staminaCost" | "range" | "onBlock";

// ─── Action grammar — a bot returns exactly ONE per tick ─────────────────────
// `dir` is RELATIVE to facing: +1 = toward opponent, -1 = away, 0 = hold.
export type Action =
  | { type: "idle" }
  | { type: "move"; dir: -1 | 0 | 1 }
  | { type: "block" }
  | { type: "dodge"; dir: -1 | 1 }
  | { type: "punch" | "kick" | "grab" };

// ─── State: self is live; opponent is a delayed, coherent snapshot ───────────
export interface SelfState {
  hp: number;
  maxHp: number;
  stamina: number;
  maxStamina: number;
  x: number;                 // 1D ring position (fixed-point integer)
  facing: -1 | 1;            // auto-managed; always faces opponent
  phase: Phase;
  currentMove: MoveName | null;
  phaseRemaining: number;    // ticks until current phase ends
  canAct: boolean;           // true iff a new action may be issued now
}

export interface OpponentState {
  x: number;                  // delayed by RULES.latency.position
  vx: number;                 // velocity at the snapshot — integrate to dead-reckon
  facing: -1 | 1;
  distance: number;           // |opp.x - self.x| from the delayed x
  predictedDistance: number;  // DERIVED: engine dead-reckons opp.x + opp.vx*staleness
  hp: number;
  stamina: number;
  phase: Phase;               // delayed by RULES.latency.action
  move: MoveName | null;      // transparent in v1
  phaseElapsed: number;       // ticks since this perceived phase began
  moveRecoveryRemaining: number; // DERIVED: perceived recovery frames left (0 if n/a)
  staleness: number;          // = RULES.latency.action — how old this read is
}

export interface RingState { leftEdge: number; rightEdge: number; width: number; }
export interface Clock { tick: number; maxTicks: number; ticksRemaining: number; }

export interface State {
  self: SelfState;
  opponent: OpponentState;
  ring: RingState;
  clock: Clock;
}

// ─── Rules: the immutable frame table (never changes during a fight) ─────────
export interface MoveSpec {
  startup: number;
  active: number;
  recovery: number;
  damage: number;
  staminaCost: number;
  range: number;
  onBlock: number;
  unblockable?: boolean;
  invuln?: [number, number];
}

export interface Rules {
  tickRate: number;
  moves: Record<MoveName, MoveSpec>;
  latency: { position: number; action: number };
  walkSpeed: number;
  block: { raise: number; staminaPerHit: number; chipDamage: number };
  stamina: { regenPerTick: number };
  ring: { width: number };
  maxHp: number;
  maxStamina: number;
}

// Whitelisted numeric state leaves the DSL may read. canAct is exposed as 1/0.
export type AllowedField =
  | "self.hp" | "self.stamina" | "self.x" | "self.facing"
  | "self.phaseRemaining" | "self.canAct"
  | "opponent.x" | "opponent.vx" | "opponent.distance" | "opponent.predictedDistance"
  | "opponent.hp" | "opponent.stamina" | "opponent.facing"
  | "opponent.staleness" | "opponent.phaseElapsed" | "opponent.moveRecoveryRemaining"
  | "ring.width" | "clock.tick" | "clock.ticksRemaining";
