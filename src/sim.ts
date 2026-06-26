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
// LATENCY — the opponent is a coherent delayed snapshot (positional fields by lPos,
// action fields — attacking + attackBand — by lAct) with dead-reckoned
// predictedDistance and seeded, clamped per-tick jitter on the latencies (the sim's
// first PRNG consumer). A bot can now read the incoming attack's height (attackBand)
// on the same delayed layer as the attacking tell. VERTICAL AXIS has begun: a
// `crouch` posture vacates the `high` band, so a high strike whiffs a croucher (the
// §11.3 step-3 occupancy gate, no longer hardwired open); and a `jump` launches a
// fixed-point gravity arc (y += vy; vy -= gravity) that is committed while airborne
// (canAct=0 until it lands at y=0). Still pending: airborne occupancy (an airborne
// fighter vacating `low` so a sweep whiffs it) and parry.
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
// striking, or airborne in a gravity arc (carrying its vertical velocity `vy`).
type MoveState =
  | { kind: "neutral" }
  | {
      kind: "attacking";
      move: MoveId;
      band: Band;
      elapsed: number;
      scored: boolean;
    }
  | { kind: "airborne"; vy: number };

type Fighter = {
  x: number;
  y: number;
  facing: Facing;
  mem: Record<string, number>;
  points: number;
  state: MoveState;
};

// The perceived-attack-band encoding (invariant #4 layer): height-ordered so a
// bot can compare numerically — 0 = not attacking, then low < mid < high.
const BAND_CODE: Record<Band, number> = { low: 1, mid: 2, high: 3 };

// One tick's outward facts, recorded into a fighter's history so the OPPONENT can
// perceive them delayed (invariant #4: a coherent delayed snapshot). Positional
// fields (x, facing, vx) and the action fields (attacking, attackBand) carry
// independent latencies. `vx` is the displacement since the previous frame (0 on
// the first). `attackBand` rides the same action layer as `attacking`.
type Frame = {
  x: number;
  facing: Facing;
  attacking: boolean;
  attackBand: number;
  vx: number;
};

const frameOf = (f: Fighter, prev: Frame | undefined): Frame => ({
  x: f.x,
  facing: f.facing,
  attacking: f.state.kind === "attacking",
  attackBand: f.state.kind === "attacking" ? BAND_CODE[f.state.band] : 0,
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
    facing: oppPos.facing,
    distance: Math.abs(oppPos.x - selfX),
    attacking: oppAct.attacking,
    attackBand: oppAct.attackBand,
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
    opponent,
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
      band: action.band,
      elapsed: 0,
      scored: false,
    };
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
  }
  // idle / block / crouch: no positional effect in this slice.
};

// The height band a fighter guards this tick, or null if it is open. A fighter
// guards only when free to act (neutral) and choosing `block`; a committed
// fighter cannot guard. (The free-to-act predicate widens with later states.)
const guardBandOf = (fighter: Fighter, action: Action): Band | null =>
  fighter.state.kind === "neutral" && action.type === "block"
    ? action.band
    : null;

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

// During its active window, a strike in reach scores once (per activation) —
// unless the defender's hurtbox does NOT occupy the attacked band (it whiffs on
// posture, e.g. a high strike over a croucher) or the defender guards the SAME
// height band (blocked). Gate order is §11.3: active → reach → occupancy → guard.
const resolveHit = (
  att: Fighter,
  def: Fighter,
  rules: Rules,
  guardBand: Band | null,
  defPosture: Posture,
): void => {
  const st = att.state;
  if (st.kind !== "attacking" || st.scored) return;
  const spec = rules.moves[st.move];

  const inActiveWindow =
    st.elapsed >= spec.startup && st.elapsed < spec.startup + spec.active;

  if (!inActiveWindow) return;
  if (Math.abs(def.x - att.x) > spec.reach) return;
  if (!occupies(defPosture, st.band)) return; // vacated band ⇒ whiff (over/under)
  if (guardBand === st.band) return; // matching-height guard ⇒ blocked, no score
  att.points += spec.score;
  st.scored = true;
};

// Advance a committed fighter's clock. A strike ticks its move frames; an
// airborne fighter integrates the gravity arc (y += vy, then vy -= gravity) and
// lands — clamped to exactly y=0 — once the arc returns to (or past) the ground.
const advance = (f: Fighter, rules: Rules): void => {
  const st = f.state;

  if (st.kind === "attacking") {
    const next = st.elapsed + 1;
    if (next >= totalFrames(rules.moves[st.move]))
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
  };

  const b: Fighter = {
    x: Math.trunc((rules.ring.width + rules.startGap) / 2),
    y: 0,
    facing: 1,
    mem: initMem(botB),
    points: 0,
    state: { kind: "neutral" },
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
    //    pre-intake state, then honour/ignore intake, then hits, then advance
    //    clocks. A strike whiffs on a vacated band and is blocked only by a guard
    //    at its own band. Simultaneous strikes both score — each resolveHit
    //    touches only its own fighter, so it is order-independent.
    const aGuardBand = guardBandOf(a, aAction);
    const bGuardBand = guardBandOf(b, bAction);
    const aPosture = postureOf(a, aAction, rules);
    const bPosture = postureOf(b, bAction, rules);
    intake(a, aAction, rules);
    intake(b, bAction, rules);
    resolveHit(a, b, rules, bGuardBand, bPosture);
    resolveHit(b, a, rules, aGuardBand, aPosture);
    advance(a, rules);
    advance(b, rules);

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
