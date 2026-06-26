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
// Scope so far: movement + one strike with WKF point scoring, on-contact
// COMMITMENT (a started move runs startup→active→recovery; actions issued while
// committed are ignored), HEIGHT-BANDED guard/block (a strike is blocked only by a
// guard at its own band; a wrong-height guard — or none — is hit), and PERCEPTION
// LATENCY — the opponent is a coherent delayed snapshot (positional fields — x, y —
// by lPos, action fields — attacking, attackBand, posture — by lAct) with
// dead-reckoned predictedDistance and seeded, clamped per-tick jitter on the
// latencies (the sim's first PRNG consumer). A bot reads the incoming attack's
// height (attackBand) and the opponent's stance (posture) on the action layer, and
// the opponent's height (y) on the positional layer. VERTICAL AXIS: a `crouch`
// vacates the `high` band, and an airborne fighter (jump arc, committed: canAct=0
// until it lands at y=0) vacates `low` once past `lowClearance` — so a high strike
// whiffs a croucher and a sweep whiffs a jumper (the §11.3 step-3 occupancy gate,
// no longer hardwired open). The arc is fixed-point (y += vy; vy -= gravity). PARRY:
// the opening `parryWindow` ticks of a matching-band guard DEFLECT an absorbed strike
// (no score) and throw the attacker into `parryRecovery` extra recovery, where a guard
// held past the window only blocks; a parry also opens a COUNTER WINDOW — a strike the
// parrying fighter lands within `counterWindow` ticks scores an extra `counterBonus`.
// Strikes resolve via the §11 compute-then-apply union (both outcomes computed from the
// frozen snapshot, then applied) so the counter's cross-fighter effect stays
// swap-symmetric. THROW: a committed grab (startup → grab-active → recovery) GRABS a
// grounded defender in reach — beating any guard/parry (it is unbanded) — scoring and
// knocking them DOWN (canAct=0, untargetable) for knockdownDuration ticks. The §11.4
// precedence strike > throw is resolved in the same union: a fighter is open while
// throwing, so an opposing active in-range strike (a HIT) STUFFS the throw — the grab is
// voided and the throw marked resolved (it cannot grab on a later frame), but the thrower
// stays committed through its recovery (punishable). Still pending: perceiving the counter
// window (self.counterWindow) and the incoming throw (opponent.throwing); throw-break; throw clash.
// ============================================================================
import type {
  State,
  Action,
  Rules,
  Facing,
  MoveId,
  MoveSpec,
  OpponentState,
  Band,
} from "./types.js";
import { runTick, type BotDoc } from "./dsl.js";
import { mulberry32 } from "./prng.js";

export type FighterFrame = {
  x: number;
  y: number;
  action: Action;
  points: number;
};
export type FightEvent = { tick: number; a: FighterFrame; b: FighterFrame };

export type FightConfig = {
  rules: Rules;
  botA: BotDoc;
  botB: BotDoc;
  maxTicks: number;
  seed: number; // replay-identity key; seeds the PRNG that drives perception jitter
};

export type FightResult = {
  winner: "A" | "B" | "draw";
  ticks: number;
  scores: { a: number; b: number };
  events: FightEvent[];
};

// A fighter is either free to act (neutral) or locked into a committed move —
// striking, throwing, airborne in a gravity arc (carrying its vertical velocity `vy`),
// or knocked DOWN after being thrown (committed, untargetable, until it wakes).
type MoveState =
  | { kind: "neutral" }
  | {
      kind: "attacking";
      move: MoveId;
      band: Band;
      elapsed: number;
      scored: boolean; // terminal flag: the strike has resolved (scored OR was deflected)
      extra: number; // extra recovery ticks added when this strike is parried (§5 deflect)
    }
  | { kind: "airborne"; vy: number }
  | { kind: "throwing"; elapsed: number; stuffed: boolean } // committed grab; `stuffed` once a strike beats it (§11.4) ⇒ cannot grab
  | { kind: "downed"; elapsed: number }; // knocked down for rules.knockdownDuration ticks

type Fighter = {
  x: number;
  y: number;
  facing: Facing;
  mem: Record<string, number>;
  points: number;
  state: MoveState;
  posture: Posture; // last resolved stance, recorded into history for perception
  guardBand: Band | null; // band guarded last tick (null = open), for parry-window age
  guardAge: number; // consecutive ticks the current guard has been held (0 = open)
  counterRemaining: number; // post-parry counter-window ticks left (0 = closed)
  cancelRemaining: number; // on-contact cancel-window ticks left after a connect (0 = closed)
};

// The perceived-attack-band encoding (invariant #4 layer): height-ordered so a
// bot can compare numerically — 0 = not attacking, then low < mid < high.
const BAND_CODE: Record<Band, number> = { low: 1, mid: 2, high: 3 };

// The perceived-posture encoding (invariant #4 layer): a height-ordered-ish stance
// enum — 0 standing, 1 crouching, 2 airborne — matching attackBand's "0 = neutral"
// convention so a bot can branch on a literal.
const POSTURE_CODE: Record<Posture, number> = {
  standing: 0,
  crouching: 1,
  airborne: 2,
};

// One tick's outward facts, recorded into a fighter's history so the OPPONENT can
// perceive them delayed (invariant #4: a coherent delayed snapshot). Positional
// fields (x, facing, vx) and the action fields (attacking, attackBand) carry
// independent latencies. `vx` is the displacement since the previous frame (0 on
// the first). `attackBand` rides the same action layer as `attacking`.
type Frame = {
  x: number;
  y: number;
  facing: Facing;
  attacking: boolean;
  attackBand: number;
  posture: number;
  vx: number;
};

const frameOf = (f: Fighter, prev: Frame | undefined): Frame => ({
  x: f.x,
  y: f.y,
  facing: f.facing,
  attacking: f.state.kind === "attacking",
  attackBand: f.state.kind === "attacking" ? BAND_CODE[f.state.band] : 0,
  posture: POSTURE_CODE[f.posture],
  vx: prev ? f.x - prev.x : 0,
});

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

// The opponent frame a fighter perceives this tick: its history `lPos` ticks ago,
// clamped to the start of the fight (the first lPos ticks read the opening frame).
const perceivedFrame = (history: Frame[], tick: number, lPos: number): Frame =>
  history[Math.max(0, tick - lPos)];

// The opponent a fighter perceives this tick: positional fields from the lPos-delayed
// frame, action fields from the lAct-delayed frame (a coherent split snapshot).
// `distance` is the raw delayed gap to live self; `predictedDistance` dead-reckons
// the delayed position forward over the lPos gap (oppPos.x + oppPos.vx · lPos) so a
// constant-velocity opponent reads at its true current distance.
const perceiveOpponent = (
  selfX: number,
  oppPos: Frame,
  oppAct: Frame,
  lPos: number,
): OpponentState => {
  const predictedX = oppPos.x + oppPos.vx * lPos;

  return {
    x: oppPos.x,
    y: oppPos.y,
    facing: oppPos.facing,
    distance: Math.abs(oppPos.x - selfX),
    attacking: oppAct.attacking,
    attackBand: oppAct.attackBand,
    posture: oppAct.posture,
    vx: oppPos.vx,
    predictedDistance: Math.abs(predictedX - selfX),
  };
};

// Build one fighter's view of tick T: self is live; the opponent is its already-
// perceived (delayed) snapshot.
const viewFor = (
  self: Fighter,
  opponent: OpponentState,
  rules: Rules,
  tick: number,
  maxTicks: number,
): State => {
  const st = self.state;

  // Ticks until the committed move completes. NB: this does not yet fold in a strike's
  // parry `extra` recovery — phaseRemaining's parry-awareness is deferred to its first
  // consumer; commitment itself is authoritatively signalled by `canAct`.
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
      counterWindow: self.counterRemaining, // live — self is always perceived live
      cancelWindow: self.cancelRemaining, // live — the attacker's open cancel window
    },
    opponent,
    ring: { width: rules.ring.width },
    clock: { tick, ticksRemaining: maxTicks - tick },
  };
};

// A fresh attacking move: startup begins now (elapsed 0), nothing resolved yet, no
// parry-extended recovery. The single source for "start an attack" — used both when a
// neutral fighter strikes and when an on-contact cancel interrupts into a follow-up.
const startAttack = (move: MoveId, band: Band): MoveState => ({
  kind: "attacking",
  move,
  band,
  elapsed: 0,
  scored: false,
  extra: 0,
});

// Honour a neutral fighter's action (start a move, or step). A committed fighter
// ignores its action — the move it is locked into continues.
const intake = (f: Fighter, action: Action, rules: Rules): void => {
  if (f.state.kind !== "neutral") {
    // Cancel (§3 / §11.3 `CancelEnable`): a committed, cancelable fighter may interrupt the
    // rest of its move into a follow-up listed in its current move's `cancelInto`. This is
    // the one deliberate exception to commitment — every other locked-in action is ignored.
    if (
      f.state.kind === "attacking" &&
      f.cancelRemaining > 0 &&
      action.type === "attack" &&
      (rules.moves[f.state.move].cancelInto ?? []).includes(action.move)
    ) {
      f.state = startAttack(action.move, action.band);
      f.cancelRemaining = 0; // the fresh move re-opens the window only when IT connects
    }

    return;
  }

  if (action.type === "attack") {
    f.state = startAttack(action.move, action.band);
  } else if (action.type === "move") {
    f.x = clamp(
      f.x + action.dir * f.facing * rules.walkSpeed,
      0,
      rules.ring.width,
    );
  } else if (action.type === "jump") {
    // Launch: commit to a gravity arc with the initial upward velocity. `y` rises
    // in `advance`; `dir` is reserved (vertical-only for now). Absent impulse ⇒ 0
    // ⇒ an inert jump that lands the same tick (forward-compatible with no-y rules).
    f.state = { kind: "airborne", vy: rules.jumpImpulse ?? 0 };
  } else if (action.type === "throw" && rules.throw !== undefined) {
    // Commit to a grab (startup → grab-active → recovery). Without a throw frame table
    // the action is inert (no state change) ⇒ byte-identical to the pre-throw engine.
    f.state = { kind: "throwing", elapsed: 0, stuffed: false };
  }
  // idle / block / crouch (or throw with no frame table): no positional effect.
};

// The height band a fighter guards this tick, or null if it is open. A fighter
// guards only when free to act (neutral) and choosing `block`; a committed
// fighter cannot guard. (The free-to-act predicate widens with later states.)
const guardBandOf = (fighter: Fighter, action: Action): Band | null =>
  fighter.state.kind === "neutral" && action.type === "block"
    ? action.band
    : null;

// How many consecutive ticks (including this one) the fighter has held its current
// guard: a fresh raise — or a switch to a different band — is age 1; holding the same
// band ages it up; not guarding is 0. Read from the fighter's persisted guard from
// last tick, so it must be computed before the new guard is recorded. Drives the
// parry window: a guard is "fresh" (parries) while its age is within `parryWindow`.
const guardAgeOf = (fighter: Fighter, band: Band | null): number =>
  band === null ? 0 : band === fighter.guardBand ? fighter.guardAge + 1 : 1;

// A fighter's vertical posture this tick. `crouch` is a free per-tick posture
// (like `block`): a fighter crouches only when free to act and choosing it.
// `airborne` is the committed jump arc, but only once it has cleared
// `lowClearance` — below that height (just after launch / before landing) it is
// still grounded for occupancy. Absent `lowClearance` ⇒ never airborne-vacating.
type Posture = "standing" | "crouching" | "airborne";

const postureOf = (fighter: Fighter, action: Action, rules: Rules): Posture =>
  fighter.state.kind === "airborne"
    ? rules.lowClearance !== undefined && fighter.y >= rules.lowClearance
      ? "airborne"
      : "standing"
    : fighter.state.kind === "neutral" && action.type === "crouch"
      ? "crouching"
      : "standing";

// Which bands a posture's hurtbox occupies (§2 / §11.3 step 3). Each posture
// vacates at most one band — a croucher vacates `high` (a high strike sails over
// it), an airborne fighter vacates `low` (a sweep passes under it); `mid` is
// always occupied. A strike connects only if the defender occupies the attacked
// band.
const VACATED_BAND: Record<Posture, Band | null> = {
  standing: null,
  crouching: "high",
  airborne: "low",
};

const occupies = (posture: Posture, band: Band): boolean =>
  VACATED_BAND[posture] !== band;

// The effect of one strike att→def, computed PURELY from the frozen pre-apply
// snapshot (§11 compute-then-apply). `null` ⇒ no effect this tick (not active, out of
// reach, vacated band, already resolved, or a whiff). A `hit` adds points to the
// attacker; a `parry` deflects — extra recovery on the attacker AND a counter window on
// the defender; a `block` scores nothing but, like a hit, opens the attacker's on-contact
// cancel window (C6 — block is a first-class connect alongside hit, §11.3).
type StrikeOutcome =
  | { result: "hit"; points: number; cancel: number }
  | { result: "parry"; extra: number; counter: number }
  | { result: "block"; cancel: number };

// Classify the strike att→def from the frozen snapshot. Gate order is §11.3: active →
// reach → occupancy → guard, then within guard: parry (fresh) vs block (stale). The
// HIT score folds in the attacker's own counter bonus if its window is open. Pure —
// reads only; the caller applies the outcome.
const computeStrike = (
  att: Fighter,
  def: Fighter,
  rules: Rules,
  guardBand: Band | null,
  guardAge: number,
  defPosture: Posture,
): StrikeOutcome | null => {
  const st = att.state;
  if (st.kind !== "attacking" || st.scored) return null;
  const spec = rules.moves[st.move];

  const inActiveWindow =
    st.elapsed >= spec.startup && st.elapsed < spec.startup + spec.active;

  if (!inActiveWindow) return null;
  if (Math.abs(def.x - att.x) > spec.reach) return null;
  if (def.state.kind === "downed") return null; // a downed fighter vacates all bands ⇒ untargetable
  if (!occupies(defPosture, st.band)) return null; // vacated band ⇒ whiff (over/under)

  if (guardBand === st.band) {
    // Matching-height guard: a fresh guard (age within the window) parries; a stale guard
    // blocks. guardAge is ≥ 1 here (the defender guards st.band), so `guardAge <= window`
    // already makes an absent/zero parry window inert. A block scores nothing but opens the
    // cancel window (cancel 0 when unconfigured ⇒ a no-op ⇒ byte-identical to the C5 block).
    return guardAge <= (rules.parryWindow ?? 0)
      ? {
          result: "parry",
          extra: rules.parryRecovery ?? 0,
          counter: rules.counterWindow ?? 0,
        }
      : { result: "block", cancel: rules.cancelWindow ?? 0 };
  }

  // HIT — base score plus a counter bonus if this attacker's counter window is open. A hit
  // also opens the on-contact cancel window (C6); absent config ⇒ 0 ⇒ no cancel.
  const bonus = att.counterRemaining > 0 ? (rules.counterBonus ?? 0) : 0;

  return {
    result: "hit",
    points: spec.score + bonus,
    cancel: rules.cancelWindow ?? 0,
  };
};

// Apply one strike outcome. A `hit` scores on the attacker; a `parry` lands its
// CROSS-FIGHTER effect — extra recovery on the attacker, a counter window on the
// defender. Both directions' outcomes are computed before any are applied, so this
// stays swap-symmetric even though the parry mutates the other fighter (§11.1).
const applyStrike = (
  att: Fighter,
  def: Fighter,
  outcome: StrikeOutcome | null,
): void => {
  if (outcome === null) return;
  const st = att.state;
  if (st.kind !== "attacking") return; // always true when outcome ≠ null

  if (outcome.result === "hit") {
    att.points += outcome.points;
    st.scored = true;
    att.cancelRemaining = outcome.cancel; // a connect opens the cancel window on the attacker

    return;
  }

  if (outcome.result === "block") {
    // A block scores nothing and is NOT marked resolved (the strike's later active frames
    // still resolve normally — preserving the block-then-guard-drop behaviour); it only
    // opens the cancel window. cancel 0 (unconfigured) ⇒ a no-op ⇒ byte-identical to C5.
    att.cancelRemaining = outcome.cancel;

    return;
  }

  if (outcome.result === "parry") {
    st.extra = outcome.extra;
    st.scored = true; // resolved (deflected) — do not re-process while still active
    def.counterRemaining = outcome.counter;
  }
};

// The effect of one throw att→def, computed PURELY from the frozen pre-apply snapshot
// (§11 compute-then-apply). `null` ⇒ no grab this tick (not throwing, already grabbed,
// outside the grab-active window, out of reach, or the defender is not grabbable). A
// grab scores on the attacker AND knocks the defender down (a cross-fighter effect).
type ThrowOutcome = { score: number };

// Classify a throw att→def from the frozen snapshot. A throw beats any guard (it is not
// height-banded), so there is no guard/band gate — only: grab-active → reach → the
// defender is GROUNDED and free (a `neutral` state). An airborne, downed, or committed
// defender cannot be grabbed. Pure — reads only; the caller applies the outcome.
const computeThrow = (
  att: Fighter,
  def: Fighter,
  rules: Rules,
): ThrowOutcome | null => {
  const st = att.state;
  if (st.kind !== "throwing") return null;
  if (st.stuffed) return null; // a strike-beaten throw is resolved (§11.4) — it cannot grab
  const spec = rules.throw;
  if (spec === undefined) return null; // inert without a throw frame table

  const inGrabWindow =
    st.elapsed >= spec.startup && st.elapsed < spec.startup + spec.active;

  if (!inGrabWindow) return null;
  if (Math.abs(def.x - att.x) > spec.reach) return null;
  // Grabbable iff GROUNDED: open / guarding / crouching (neutral) or mid-strike (attacking).
  // An airborne (jumper), downed (no pile-on), or throwing (clash → later slice) defender cannot
  // be grabbed. An active in-range strike beats the grab — that is the §11.4 precedence resolved
  // in runFight (a grab computed here is voided there), NOT by treating a striker as ungrabbable.
  if (def.state.kind !== "neutral" && def.state.kind !== "attacking")
    return null;

  return { score: spec.score };
};

// Apply one throw outcome. A grab scores on the attacker and lands its CROSS-FIGHTER effect
// — the defender is knocked DOWN (its clock runs in `advance`). The grab is single-shot
// without a flag: the knockdown makes the defender untargetable, so a multi-tick grab window
// cannot re-grab. Both directions' outcomes are computed from the frozen snapshot before any
// are applied, so this stays swap-symmetric (§11.1).
const applyThrow = (
  att: Fighter,
  def: Fighter,
  outcome: ThrowOutcome | null,
): void => {
  if (outcome === null) return;
  const st = att.state;
  if (st.kind !== "throwing") return; // a throw outcome only applies to the throwing fighter

  att.points += outcome.score;
  def.state = { kind: "downed", elapsed: 0 };
};

// §11.4 precedence — strike > throw. A fighter is OPEN while throwing, so an opposing active
// in-range strike (a HIT from computeStrike) STUFFS the throw: this marks the throwing move
// resolved (`stuffed` ⇒ it cannot grab on a later active frame) and returns true so the caller
// voids the grab outcome. The thrower still runs out its recovery — a stuffed throw is
// punishable. Reads only the frozen pre-apply strike outcome, so resolution stays swap-symmetric.
const stuffIfStruck = (f: Fighter, incoming: StrikeOutcome | null): boolean => {
  if (f.state.kind !== "throwing") return false;
  if (incoming?.result !== "hit") return false;
  f.state.stuffed = true;

  return true;
};

// Advance a committed fighter's clock. A strike ticks its move frames; an
// airborne fighter integrates the gravity arc (y += vy, then vy -= gravity) and
// lands — clamped to exactly y=0 — once the arc returns to (or past) the ground.
const advance = (f: Fighter, rules: Rules): void => {
  const st = f.state;

  if (st.kind === "attacking") {
    const next = st.elapsed + 1;
    if (next >= totalFrames(rules.moves[st.move]) + st.extra)
      f.state = { kind: "neutral" };
    else st.elapsed = next;

    return;
  }

  if (st.kind === "airborne") {
    f.y += st.vy;

    if (f.y <= 0) {
      f.y = 0;
      f.state = { kind: "neutral" };
    } else {
      st.vy -= rules.gravity ?? 0;
    }

    return;
  }

  if (st.kind === "throwing") {
    const spec = rules.throw;
    const total = spec ? spec.startup + spec.active + spec.recovery : 0;
    const next = st.elapsed + 1;
    if (next >= total) f.state = { kind: "neutral" };
    else st.elapsed = next;

    return;
  }

  if (st.kind === "downed") {
    // Stay down for knockdownDuration ticks, then wake to neutral.
    const next = st.elapsed + 1;
    if (next >= (rules.knockdownDuration ?? 0)) f.state = { kind: "neutral" };
    else st.elapsed = next;
  }
};

export function runFight(cfg: FightConfig): FightResult {
  const { rules, botA, botB, maxTicks } = cfg;

  const a: Fighter = {
    x: Math.trunc((rules.ring.width - rules.startGap) / 2),
    y: 0,
    facing: 1,
    mem: initMem(botA),
    points: 0,
    state: { kind: "neutral" },
    posture: "standing",
    guardBand: null,
    guardAge: 0,
    counterRemaining: 0,
    cancelRemaining: 0,
  };

  const b: Fighter = {
    x: Math.trunc((rules.ring.width + rules.startGap) / 2),
    y: 0,
    facing: 1,
    mem: initMem(botB),
    points: 0,
    state: { kind: "neutral" },
    posture: "standing",
    guardBand: null,
    guardAge: 0,
    counterRemaining: 0,
    cancelRemaining: 0,
  };

  const events: FightEvent[] = [];
  const lPos = rules.perception?.lPos ?? 0;
  const lAct = rules.perception?.lAct ?? 0;
  const jitter = rules.perception?.jitter ?? 0;
  const histA: Frame[] = [];
  const histB: Frame[] = [];

  // The single seeded PRNG that threads the whole sim. Wobble a latency by a
  // seeded integer in [−jitter, +jitter], clamped at 0, consuming one draw. When
  // jitter is off no draw happens, so jitter = 0 is byte-identical to no PRNG.
  const rng = mulberry32(cfg.seed);

  const jittered = (base: number): number =>
    jitter > 0 ? Math.max(0, base + (rng() % (2 * jitter + 1)) - jitter) : base;

  for (let tick = 0; tick < maxTicks; tick++) {
    // 1. Auto-face from pre-tick positions.
    a.facing = facingToward(a.x, b.x);
    b.facing = facingToward(b.x, a.x);

    // 1b. Record each fighter's pre-tick frame, then read the opponent split into
    //     two coherent delayed layers: positional (lPos) and action (lAct). At
    //     L = 0 both resolve to this tick's frame ⇒ live perception.
    histA.push(frameOf(a, histA[tick - 1]));
    histB.push(frameOf(b, histB[tick - 1]));

    // Per-tick jittered latencies, drawn in a FIXED order (A.lPos, A.lAct, B.lPos,
    // B.lAct) — this order is part of the replay contract.
    const aLPos = jittered(lPos);
    const aLAct = jittered(lAct);
    const bLPos = jittered(lPos);
    const bLAct = jittered(lAct);

    const aOpp = perceiveOpponent(
      a.x,
      perceivedFrame(histB, tick, aLPos),
      perceivedFrame(histB, tick, aLAct),
      aLPos,
    );

    const bOpp = perceiveOpponent(
      b.x,
      perceivedFrame(histA, tick, bLPos),
      perceivedFrame(histA, tick, bLAct),
      bLPos,
    );

    // 2. Both fighters decide against one immutable pre-tick snapshot.
    const aAction = runTick(
      botA,
      viewFor(a, aOpp, rules, tick, maxTicks),
      a.mem,
    );

    const bAction = runTick(
      botB,
      viewFor(b, bOpp, rules, tick, maxTicks),
      b.mem,
    );

    // 3. Resolve together: read each fighter's guard band and posture from its
    //    pre-intake state, honour/ignore intake, then resolve strikes via the §11
    //    compute-then-apply union — both directions' outcomes are COMPUTED from the
    //    frozen snapshot before either is APPLIED, so cross-fighter effects (a parry
    //    sets the OTHER fighter's counter window) stay swap-symmetric. Then advance
    //    clocks and decrement counter windows.
    const aGuardBand = guardBandOf(a, aAction);
    const bGuardBand = guardBandOf(b, bAction);
    // Guard age reads each fighter's guard from LAST tick, so compute it before
    // recording this tick's guard.
    const aGuardAge = guardAgeOf(a, aGuardBand);
    const bGuardAge = guardAgeOf(b, bGuardBand);
    const aPosture = postureOf(a, aAction, rules);
    const bPosture = postureOf(b, bAction, rules);
    // Record the resolved stance + guard so next tick can serve them — crouch and
    // guard are per-tick, pre-action, so they must be carried here.
    a.posture = aPosture;
    b.posture = bPosture;
    a.guardBand = aGuardBand;
    a.guardAge = aGuardAge;
    b.guardBand = bGuardBand;
    b.guardAge = bGuardAge;
    intake(a, aAction, rules);
    intake(b, bAction, rules);

    // Compute both outcomes from the frozen post-intake snapshot, THEN apply both.
    const aOutcome = computeStrike(
      a,
      b,
      rules,
      bGuardBand,
      bGuardAge,
      bPosture,
    );

    const bOutcome = computeStrike(
      b,
      a,
      rules,
      aGuardBand,
      aGuardAge,
      aPosture,
    );

    // Throws are computed from the same frozen snapshot (a throw beats any guard, so it
    // has no band gate). The §11.4 precedence strike > throw is then applied: an opposing
    // active in-range strike (a HIT) STUFFS a throw — void the grab and mark it resolved
    // (it cannot grab on a later frame), leaving the thrower committed through its recovery
    // (punishable). Both decisions read the frozen snapshot before any apply ⇒ swap-symmetric.
    const aThrow = computeThrow(a, b, rules);
    const bThrow = computeThrow(b, a, rules);
    const aThrowFinal = stuffIfStruck(a, bOutcome) ? null : aThrow;
    const bThrowFinal = stuffIfStruck(b, aOutcome) ? null : bThrow;

    applyStrike(a, b, aOutcome);
    applyStrike(b, a, bOutcome);
    applyThrow(a, b, aThrowFinal);
    applyThrow(b, a, bThrowFinal);
    advance(a, rules);
    advance(b, rules);
    // A counter window ticks down once per tick (clamped at 0) after it has been read.
    a.counterRemaining = Math.max(0, a.counterRemaining - 1);
    b.counterRemaining = Math.max(0, b.counterRemaining - 1);
    // The cancel window likewise ticks down (set this tick on a connect ⇒ readable next tick).
    a.cancelRemaining = Math.max(0, a.cancelRemaining - 1);
    b.cancelRemaining = Math.max(0, b.cancelRemaining - 1);

    // 4. Record the integer event (the bot's RETURNED action, honoured or not).
    events.push({
      tick,
      a: { x: a.x, y: a.y, action: aAction, points: a.points },
      b: { x: b.x, y: b.y, action: bAction, points: b.points },
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
