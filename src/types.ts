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
  | { type: "attack"; move: MoveId; band: Band }
  | { type: "sweep" } // ashi-barai: a low-band strike that knocks down (no score) on hit. Blockable/parryable at `low`, whiffs a jumper. Inert without a `moves.sweep` spec.
  | { type: "throw" } // grapple: beats any guard, grabs a grounded defender ⇒ scores + knockdown
  | { type: "throw-break" }; // per-tick grab escape: voids an opponent's grab-active throw. No commitment, NOT a guard (open to strikes)

// ─── State: self is live (skeleton has no perception latency yet) ────────────
export type SelfState = {
  x: number;
  facing: Facing;
  points: number;
  canAct: boolean;
  phaseRemaining: number;
  counterWindow: number; // post-parry counter-window ticks left (live; 0 = closed)
  cancelWindow: number; // on-contact cancel-window ticks left after a connect (live; 0 = closed)
  finishWindow: number; // okizeme finish-window ticks left on the LIVE opponent's knockdown (C8; live, 0 = can't finish — not downed, or in i-frames)
};

export type OpponentState = {
  x: number;
  y: number; // perceived height (sub-units) — positional ⇒ L_pos-delayed
  facing: Facing;
  distance: number; // raw (delayed) gap to live self
  attacking: boolean; // is the (perceived) opponent committed to a move?
  attackBand: number; // height-ordered enum of the perceived attack: 0 none, 1 low, 2 mid, 3 high
  posture: number; // perceived stance enum: 0 standing, 1 crouching, 2 airborne (action ⇒ L_act-delayed)
  throwing: boolean; // is the (perceived) opponent committed to a grab? (action ⇒ L_act-delayed)
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
  // On-contact cancel routes (C6). The moves this move may cancel INTO once it
  // connects (hit, later also block — §3 / §11.3 `CancelEnable`). A committed
  // fighter whose move is cancelable may start a follow-up listed here, skipping
  // the rest of its recovery. Absent/empty ⇒ no routes ⇒ this move cannot cancel.
  cancelInto?: MoveId[];
  // On a HIT, knock the defender DOWN (canAct=0 for knockdownDuration) instead of
  // scoring (C8 — the §11.4 `onHit.knockdown` flag). A sweep sets this with `score: 0`.
  // Absent/false ⇒ a hit scores as usual (byte-identical to the pre-knockdown engine).
  knockdown?: boolean;
};

// One throw/grapple's frame data (C7). A throw is NOT height-banded — it beats any
// guard (and parry) at any band. `active` is the grab-active window; the throw
// connects (grabs) only during it, and only on a GROUNDED, non-downed defender in
// `reach`. A clean grab scores `score` (the design's "scores 3").
export type ThrowSpec = {
  startup: number; // ticks before the grab becomes active
  active: number; // ticks the grab can connect
  recovery: number; // ticks after the grab window, still committed
  reach: number; // horizontal grab range in sub-units
  score: number; // WKF points awarded on a clean throw
};

export type Rules = {
  tickRate: number; // ticks per second (60)
  walkSpeed: number; // sub-units travelled per tick while moving
  ring: { width: number }; // ring width in sub-units
  startGap: number; // initial separation between the two fighters (sub-units)
  // The frame table. `strike` is the base move; `sweep` (C8) is an OPTIONAL low-band
  // knockdown move — absent ⇒ a `sweep` action is inert ⇒ byte-identical to the
  // pre-sweep engine. Keyed concretely (not `Record<MoveId, …>`) so `sweep` stays optional.
  moves: { strike: MoveSpec; sweep?: MoveSpec };
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
  // On-contact cancel window (C6). When a strike CONNECTS (hit; later also block),
  // its attacker may cancel into a follow-up move (one listed in the striking move's
  // `cancelInto`) for the next `cancelWindow` ticks — interrupting the rest of its
  // recovery. A whiff or a parry never opens the window (the no-feint property, §3).
  // Absent/`0` ⇒ no cancel ⇒ byte-identical to the pre-cancel (C5) engine.
  cancelWindow?: number;
  // Throw / grapple (C7). The throw triangle's anti-guard option: a `throw` action
  // starts this committed move; during its grab-active window it GRABS a grounded,
  // non-downed defender in `reach` — beating any guard (and parry) — scoring `throw.score`
  // and knocking the defender DOWN for `knockdownDuration` ticks (canAct=0). Both absent
  // ⇒ a `throw` action is inert ⇒ byte-identical to the pre-throw (C6) engine.
  throw?: ThrowSpec;
  knockdownDuration?: number;
  // Okizeme finish window (C8). The first `finishWindow` ticks of ANY knockdown (throw
  // or sweep) are a guaranteed FINISH window: an opposing strike that is active + in
  // reach during it scores `spec.score` once — band, guard, and occupancy ignored (the
  // target is prone) — then the window closes (exactly one finish; never re-downs or
  // extends `knockdownDuration`). The untargetable tail of the knockdown is the wake-up
  // i-frames. Absent ⇒ 0 ⇒ no finish for any knockdown ⇒ byte-identical to the pre-finish
  // (C7) engine (a downed fighter is untargetable for its whole knockdown).
  finishWindow?: number;
  // Opponent perception latency (ticks). Self is always live. Absent (or any
  // field absent) ⇒ 0 ⇒ that layer is perceived live (forward-compatible with
  // the L=0 skeleton). Positional fields lag by lPos; action fields by lAct.
  // `jitter` (amplitude j ≥ 0) wobbles each perceived latency by a seeded integer
  // in [−j, +j] per tick (clamped at 0); 0 ⇒ no jitter, no PRNG draws.
  perception?: { lPos?: number; lAct?: number; jitter?: number };
};
