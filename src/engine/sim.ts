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
// stays committed through its recovery (punishable). A defender's THROW-BREAK on a grab-active
// tick defeats the grab the same way (throw-break > throw); a break is a per-tick action (no
// commitment) and NOT a guard, so a strike still hits it. Two live grabs CLASH (both grab-active
// in reach ⇒ both whiff, the §11.4 symmetric outcome). The incoming grab is PERCEIVED as a delayed
// boolean tell — opponent.throwing on the lAct action layer (like attacking/attackBand/posture) —
// so throw-break is a reaction skill-gradient: escapable iff startup ≥ lAct + 1. SWEEP: a low-band
// strike (reusing the strike union) that knocks DOWN instead of scoring — all precedence is
// emergent ("a sweep is a strike"). OKIZEME: the opening finishWindow ticks of ANY knockdown
// (throw or sweep) are a guaranteed FINISH window — an opposing active in-range strike scores once,
// ignoring band/guard/occupancy (the target is prone), then the window closes (exactly one finish;
// never re-downs or extends the knockdown). The untargetable tail is the wake-up i-frames. The
// okizeme read is split across the two layers: the finish window is read LIVE as self.finishWindow
// (self-proprioception), while the grounded state is PERCEIVED as a delayed boolean tell —
// opponent.knockdown on the lAct action layer (like attacking/throwing), 1 for the whole knockdown.
// ============================================================================
import type {
  State,
  Action,
  Rules,
  Facing,
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
  stamina: number; // C10 meter at end of tick; 0 every frame when no meter is configured
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
      spec: MoveSpec; // the resolved frame data, captured at intake — so no site re-indexes the (optionally-sweep) moves table by a union key
      band: Band;
      elapsed: number;
      scored: boolean; // terminal flag: the strike has resolved (scored OR was deflected)
      extra: number; // extra recovery ticks added when this strike is parried (§5 deflect)
    }
  | { kind: "airborne"; vy: number }
  | { kind: "throwing"; elapsed: number; stuffed: boolean } // committed grab; `stuffed` once a strike beats it (§11.4) ⇒ cannot grab
  | { kind: "downed"; elapsed: number; finish: number }; // knocked down for rules.knockdownDuration ticks; `finish` = remaining okizeme finish-window ticks (C8, counts down to 0 ⇒ wake-up i-frames)

// The committed-attack variant of MoveState — the type `startAttack` always returns. Naming it
// lets a caller read the fresh move's `extra` (recovery accumulator) without re-narrowing.
type AttackingState = Extract<MoveState, { kind: "attacking" }>;

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
  stamina: number; // C10 conditioning meter; init to rules.stamina.max (0 when unconfigured)
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
  throwing: boolean;
  knockdown: boolean;
  vx: number;
  stamina: number; // conditioning meter (C10 Story 4) — an action-layer tell (L_act)
};

const frameOf = (f: Fighter, prev: Frame | undefined): Frame => ({
  x: f.x,
  y: f.y,
  facing: f.facing,
  attacking: f.state.kind === "attacking",
  attackBand: f.state.kind === "attacking" ? BAND_CODE[f.state.band] : 0,
  posture: POSTURE_CODE[f.posture],
  throwing: f.state.kind === "throwing",
  knockdown: f.state.kind === "downed",
  vx: prev ? f.x - prev.x : 0,
  stamina: f.stamina,
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
  rules: Rules,
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
    throwing: oppAct.throwing,
    knockdown: oppAct.knockdown,
    vx: oppPos.vx,
    predictedDistance: Math.abs(predictedX - selfX),
    stamina: oppAct.stamina, // C10 Story 4: rides the action layer (L_act), like attacking
    gassed: isGassedAt(oppAct.stamina, rules), // C10 Story 4b: gas line on the DELAYED stamina
  };
};

// Build one fighter's view of tick T: self is live; the opponent is its already-
// perceived (delayed) snapshot. `oppLive` is the opponent's TRUE pre-tick state — used only
// for `self.finishWindow`, which is live self-proprioception (the design's deliberate
// asymmetry with the delayed `opponent.knockdown` tell).
const viewFor = (
  self: Fighter,
  opponent: OpponentState,
  oppLive: Fighter,
  rules: Rules,
  tick: number,
  maxTicks: number,
): State => {
  const st = self.state;

  // Ticks until the committed move completes. NB: this does not yet fold in a strike's
  // parry `extra` recovery — phaseRemaining's parry-awareness is deferred to its first
  // consumer; commitment itself is authoritatively signalled by `canAct`.
  const phaseRemaining =
    st.kind === "attacking" ? totalFrames(st.spec) - st.elapsed : 0;

  // The okizeme finish window self can act on RIGHT NOW: the live opponent's remaining
  // finish-window ticks while it is downed-finishable, else 0 (not downed, or in i-frames).
  // Read LIVE (zero latency), like the counter/cancel windows — self knows its guaranteed
  // finish precisely; whether the foe is down is the separately-delayed perception (C8 slice 4).
  const finishWindow =
    oppLive.state.kind === "downed" ? oppLive.state.finish : 0;

  return {
    self: {
      x: self.x,
      facing: self.facing,
      points: self.points,
      canAct: st.kind === "neutral",
      phaseRemaining,
      counterWindow: self.counterRemaining, // live — self is always perceived live
      cancelWindow: self.cancelRemaining, // live — the attacker's open cancel window
      finishWindow, // live — the okizeme finish window on the foe's knockdown (C8)
      stamina: self.stamina, // live — the conditioning meter is self-proprioception (C10)
      gassed: gassed(self, rules) ? 1 : 0, // live — the derived gas tell (C10 Story 3): 1 iff at/below the gas line
    },
    opponent,
    ring: { width: rules.ring.width },
    clock: { tick, ticksRemaining: maxTicks - tick },
  };
};

// A fresh attacking move: startup begins now (elapsed 0), nothing resolved yet, no
// parry-extended recovery. The single source for "start an attack" — used both when a
// neutral fighter strikes and when an on-contact cancel interrupts into a follow-up.
const startAttack = (spec: MoveSpec, band: Band): AttackingState => ({
  kind: "attacking",
  spec,
  band,
  elapsed: 0,
  scored: false,
  extra: 0,
});

// Drain a committed move's stamina cost (C10), on commit, whiff or not. Charged ONLY
// when a meter is configured (`rules.stamina` present) — absent ⇒ no meter simulated ⇒
// no charge (byte-identical). A move with no `staminaCost` is free (`?? 0`). No floor
// here: Slice 2's affordability gate guarantees stamina never goes negative.
const spend = (
  f: Fighter,
  spec: { staminaCost?: number },
  rules: Rules,
): void => {
  if (rules.stamina !== undefined) f.stamina -= spec.staminaCost ?? 0;
};

// Whether a fighter can afford to commit a costed move (C10 affordability gate). With no
// meter configured there is no gate — always affordable ⇒ byte-identical. Otherwise a move
// is affordable IFF `stamina ≥ cost`: the last affordable move empties to exactly 0; one
// short is rejected, so the action degrades to idle (no spend, no startup). The `≥` is also
// what keeps stamina from ever going negative — the [0] lower bound Slice 1 deferred to here.
const affordable = (
  f: Fighter,
  spec: { staminaCost?: number },
  rules: Rules,
): boolean =>
  rules.stamina === undefined || f.stamina >= (spec.staminaCost ?? 0);

// Recover stamina for an UNCOMMITTED fighter (C10 regen). Only when a meter is configured,
// and only while the fighter is free to act (neutral) and NOT guarding — so a fighter that
// committed a move or raised a block this tick recovers nothing (a crouch/idle/step does).
// Evaluated POST-INTAKE and BEFORE `advance`, so a commit tick nets exactly −cost and a
// move's final recovery frame (still attacking until `advance` frees it) does not regen.
// Clamped to `max` so it never overfills. Absent meter / regen ⇒ no recovery (byte-identical).
const regen = (f: Fighter, rules: Rules): void => {
  if (
    rules.stamina !== undefined &&
    f.state.kind === "neutral" &&
    f.guardBand === null
  ) {
    f.stamina = Math.min(
      rules.stamina.max,
      f.stamina + (rules.stamina.regen ?? 0),
    );
  }
};

// Draw a guard's stamina chip from the DEFENDER on contact (C10 Story 2), floored at 0.
// Both a block and a (larger) parry bleed via this one rule — a defender cannot decline
// the hit, so unlike a costed commit (guarded by affordability) the chip needs the [0]
// floor. `chip` carries the unconfigured-meter/absent-chip 0 ⇒ a no-op (byte-identical).
const drawChip = (def: Fighter, chip: number): void => {
  def.stamina = Math.max(0, def.stamina - chip);
};

// The gas-line predicate (C10): a stamina value is GASSED when at/below the stepped
// `gasThreshold`. The SINGLE source of the gas line — shared by the self meter (`gassed`,
// below) and the L_act-delayed opponent tell (`perceiveOpponent`, Story 4b), which reads
// it on the DELAYED opponent stamina. Absent `gasThreshold` (or no meter) ⇒ never gassed
// ⇒ byte-identical.
const isGassedAt = (stamina: number, rules: Rules): boolean =>
  rules.stamina?.gasThreshold !== undefined &&
  stamina <= rules.stamina.gasThreshold;

// Whether a fighter is GASSED (C10 Story 3): the gas-line predicate on its CURRENT
// (post-spend) stamina. Feeds the recovery penalty (`gasRecovery`) and the live
// `self.gassed` read.
const gassed = (f: Fighter, rules: Rules): boolean =>
  isGassedAt(f.stamina, rules);

// The recovery a fresh commit eats for being GASSED (C10 Story 3): `gasRecoveryPenalty` when
// at/below the gas line, else 0. The caller adds it to the just-started move's `extra` (the
// shared recovery accumulator — recovery-only, since `extra` only delays the neutral transition
// in `advance`; composes additively with a parry's extra). Read POST-SPEND, so the commit that
// drops you to the line eats the penalty itself. 0 when not gassed / no penalty ⇒ byte-identical.
const gasRecovery = (f: Fighter, rules: Rules): number =>
  gassed(f, rules) ? (rules.stamina?.gasRecoveryPenalty ?? 0) : 0;

// Whether a move may legally strike `band` (C9 §P7 band-legality gate). ABSENT `bands`
// ⇒ unrestricted (legal at every band — byte-identical to the pre-arsenal engine);
// otherwise the band must be listed (an empty `[]` ⇒ no legal band). An `attack` whose
// resolved band fails this never starts — it degrades to `idle` (no startup / spend / score).
const bandLegal = (spec: { bands?: Band[] }, band: Band): boolean =>
  spec.bands === undefined || spec.bands.includes(band);

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
      action.type === "attack"
    ) {
      const spec = rules.moves[action.move]; // C9: undefined ⇒ move not configured ⇒ no cancel

      if (
        spec !== undefined &&
        (f.state.spec.cancelInto ?? []).includes(action.move) &&
        bandLegal(spec, action.band) // C9: an out-of-band cancel is refused
      ) {
        f.state = startAttack(spec, action.band);
        f.cancelRemaining = 0; // the fresh move re-opens the window only when IT connects
      }
    }

    return;
  }

  if (action.type === "attack") {
    const spec = rules.moves[action.move]; // C9: undefined ⇒ move not configured ⇒ idle (inert)

    if (
      spec !== undefined &&
      bandLegal(spec, action.band) && // C9: an out-of-band attack degrades to idle
      affordable(f, spec, rules)
    ) {
      const move = startAttack(spec, action.band);
      f.state = move;
      spend(f, spec, rules); // C10: a costed move drains stamina on commit
      move.extra += gasRecovery(f, rules); // C10 Story 3: a commit into the gas line recovers slower
    }
  } else if (
    action.type === "sweep" &&
    rules.moves.sweep !== undefined &&
    affordable(f, rules.moves.sweep, rules)
  ) {
    // Sweep (C8): a low-band knockdown strike. Commit to an attacking move at band `low`
    // reading the optional `moves.sweep` spec. Without the spec the action is inert (no state
    // change) ⇒ byte-identical to the pre-sweep engine. An unaffordable sweep degrades to idle.
    const move = startAttack(rules.moves.sweep, "low");
    f.state = move;
    spend(f, rules.moves.sweep, rules);
    move.extra += gasRecovery(f, rules); // C10 Story 3: a gassed sweep also recovers slower
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
  } else if (
    action.type === "throw" &&
    rules.throw !== undefined &&
    affordable(f, rules.throw, rules)
  ) {
    // Commit to a grab (startup → grab-active → recovery). Without a throw frame table
    // the action is inert (no state change) ⇒ byte-identical to the pre-throw engine. An
    // unaffordable grab degrades to idle.
    f.state = { kind: "throwing", elapsed: 0, stuffed: false };
    spend(f, rules.throw, rules);
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
// cancel window (C6 — block is a first-class connect alongside hit, §11.3). A `finish` is the
// okizeme strike on a DOWNED defender during its finish window (C8): it scores and closes the
// window (its cross-fighter effect is zeroing the defender's finish counter). On a `hit`,
// `finish` carries the finish window to grant IF it knocks down (like `cancel` carries the
// cancel window) — read only when `knockdown` is true.
type StrikeOutcome =
  | {
      result: "hit";
      points: number;
      cancel: number;
      knockdown: boolean;
      finish: number;
    }
  | { result: "parry"; extra: number; counter: number; chip: number }
  | { result: "block"; cancel: number; chip: number }
  | { result: "finish"; points: number };

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
  const spec = st.spec;

  const inActiveWindow =
    st.elapsed >= spec.startup && st.elapsed < spec.startup + spec.active;

  if (!inActiveWindow) return null;
  if (Math.abs(def.x - att.x) > spec.reach) return null;

  if (def.state.kind === "downed") {
    // Okizeme (C8): a downed fighter is targetable ONLY during its finish window, and then by
    // active + reach alone — band, guard, and occupancy are ignored (the target is prone). The
    // finish pays a fixed ippon `finishScore` when configured, else the finishing strike's own
    // `spec.score` (absent ⇒ byte-identical). Once the window closes (finish == 0) it is in
    // wake-up i-frames ⇒ untargetable (the C7 behavior).
    return def.state.finish > 0
      ? { result: "finish", points: rules.finishScore ?? spec.score }
      : null;
  }

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
          // C10 Story 2: the LARGER guard chip a parry draws from the DEFENDER on the deflect.
          // Unconfigured meter / absent chip ⇒ 0 ⇒ no draw (byte-identical). The deflect resolves
          // the strike (`scored`), so this chips once — vs a block's per-contact-tick draw.
          chip: rules.stamina?.parryChip ?? 0,
        }
      : {
          result: "block",
          cancel: rules.cancelWindow ?? 0,
          // C10 Story 2: the guard stamina chip a block draws from the DEFENDER on contact.
          // Unconfigured meter / absent chip ⇒ 0 ⇒ no draw (byte-identical). The draw lands
          // in applyStrike (cross-fighter), clamped at 0.
          chip: rules.stamina?.blockChip ?? 0,
        };
  }

  // HIT — base score plus a counter bonus if this attacker's counter window is open. A hit
  // also opens the on-contact cancel window (C6); absent config ⇒ 0 ⇒ no cancel.
  // C9: band-dependent score — `scoreByBand[band]` overrides the flat `score`, missing ⇒ falls
  // back to it (absent `scoreByBand` ⇒ flat `score` everywhere ⇒ byte-identical). The okizeme
  // finish above stays band-agnostic and is deliberately NOT band-resolved.
  const baseScore = spec.scoreByBand?.[st.band] ?? spec.score;
  const bonus = att.counterRemaining > 0 ? (rules.counterBonus ?? 0) : 0;

  return {
    result: "hit",
    points: baseScore + bonus,
    cancel: rules.cancelWindow ?? 0,
    knockdown: spec.knockdown ?? false,
    finish: rules.finishWindow ?? 0, // the finish window to grant if this hit knocks down (C8)
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

  // Score + cross-fighter effects apply from the FROZEN outcome regardless of whether `att` was
  // itself knocked down by the OTHER direction's apply this same tick (a mutual sweep, or a
  // sweep∥strike trade). Reading these off the precomputed outcome — not live state — is what
  // keeps the §11 union order-independent now that a HIT can change a fighter's `state.kind`.
  if (outcome.result === "hit") {
    att.points += outcome.points;
    att.cancelRemaining = outcome.cancel; // a connect opens the cancel window on the attacker
    // A knockdown move (a sweep) downs the defender instead of leaving it standing (C8), opening
    // its okizeme finish window (`finish` ticks). A standing defender is the only HIT target —
    // a downed one is handled by the `finish` branch — so no re-down guard is needed here.
    if (outcome.knockdown)
      def.state = { kind: "downed", elapsed: 0, finish: outcome.finish };
  } else if (outcome.result === "finish") {
    // Okizeme finish (C8): score and CLOSE the window (finish → 0) so a knockdown is finishable
    // exactly once. It does NOT re-down or extend the knockdown — elapsed and knockdownDuration
    // are untouched, so the defender wakes on the same tick it would have anyway.
    att.points += outcome.points;
    if (def.state.kind === "downed")
      def.state = { kind: "downed", elapsed: def.state.elapsed, finish: 0 };
  } else if (outcome.result === "block") {
    // A block scores nothing and only opens the cancel window; cancel 0 (unconfigured) ⇒ a no-op.
    att.cancelRemaining = outcome.cancel;
    drawChip(def, outcome.chip); // C10 Story 2: the absorbing guard bleeds stamina on the DEFENDER
  } else {
    def.counterRemaining = outcome.counter; // parry: the counter window lands on the defender
    drawChip(def, outcome.chip); // C10 Story 2: the deflect bleeds MORE than a block (parryChip > blockChip)
  }

  // Attacker move-state flags apply only while `att` is still attacking — a mutual knockdown can
  // have downed it this very tick, leaving no move to flag. A BLOCK never marks the strike
  // resolved (preserving the block-then-guard-drop edge); a HIT or PARRY resolves it (no re-process
  // while still active), and a PARRY also adds the deflect's extra recovery. A FINISH likewise
  // leaves `scored` untouched — its exactly-once is enforced by the defender's finish → 0, not here.
  const st = att.state;
  if (st.kind !== "attacking") return;
  if (outcome.result === "hit" || outcome.result === "parry") st.scored = true;
  if (outcome.result === "parry") st.extra = outcome.extra;
};

// The effect of one throw att→def, computed PURELY from the frozen pre-apply snapshot
// (§11 compute-then-apply). `null` ⇒ no grab this tick (not throwing, already grabbed,
// outside the grab-active window, out of reach, or the defender is not grabbable). A
// grab scores on the attacker AND knocks the defender down (a cross-fighter effect). `finish`
// carries the okizeme finish window to grant the knockdown (C8), like the hit outcome's `finish`.
type ThrowOutcome = { score: number; finish: number };

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
  // Grabbable iff GROUNDED and not already down: open / guarding / crouching (neutral),
  // mid-strike (attacking), or mid-throw (throwing). An airborne (jumper) or downed (no
  // pile-on) defender cannot be grabbed. The grab can still be DEFEATED in runFight's §11.4
  // resolver — beaten by an opposing active strike, escaped by a throw-break, or mutually
  // cancelled when both throws are live (a clash) — none of which is a grabbability concern here.
  if (def.state.kind === "airborne" || def.state.kind === "downed") return null;

  return { score: spec.score, finish: rules.finishWindow ?? 0 };
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
  def.state = { kind: "downed", elapsed: 0, finish: outcome.finish }; // opens the okizeme finish window (C8)
};

// §11.4 precedence — a throw is DEFEATED this tick by either leg of the triangle:
//   • strike > throw — the defender lands an active in-range strike (a HIT from computeStrike)
//     on the OPEN thrower. Works in any throw phase, so it also INTERRUPTS a throw still in
//     startup.
//   • throw-break > throw — on a GRAB-ACTIVE tick (`grabActive`) the defender returns
//     `throw-break`. A break mistimed to startup/recovery is wasted (single-tick coincidence).
// Either defeat marks the throwing move resolved (`stuffed` ⇒ it cannot grab on a later active
// frame) and returns true so the caller voids the grab; the thrower still runs out its recovery
// (punishable). Reads only the frozen pre-apply snapshot, so resolution stays swap-symmetric.
const stuffIfDefeated = (
  att: Fighter,
  incoming: StrikeOutcome | null,
  defAction: Action,
  grabActive: boolean,
): boolean => {
  if (att.state.kind !== "throwing") return false;

  const defeated =
    incoming?.result === "hit" ||
    (grabActive && defAction.type === "throw-break");

  if (defeated) att.state.stuffed = true;

  return defeated;
};

// Advance a committed fighter's clock. A strike ticks its move frames; an
// airborne fighter integrates the gravity arc (y += vy, then vy -= gravity) and
// lands — clamped to exactly y=0 — once the arc returns to (or past) the ground.
const advance = (f: Fighter, rules: Rules): void => {
  const st = f.state;

  if (st.kind === "attacking") {
    const next = st.elapsed + 1;
    if (next >= totalFrames(st.spec) + st.extra) f.state = { kind: "neutral" };
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
    // Stay down for knockdownDuration ticks, then wake to neutral. The okizeme finish window
    // counts down each tick AFTER the landing tick (elapsed 0) — so a finishWindow of F grants
    // exactly F finishable ticks (and F = 1 grants one, not zero), flooring at 0 (the i-frame tail).
    const next = st.elapsed + 1;

    if (next >= (rules.knockdownDuration ?? 0)) f.state = { kind: "neutral" };
    else {
      if (st.elapsed > 0) st.finish = Math.max(0, st.finish - 1);
      st.elapsed = next;
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
    posture: "standing",
    guardBand: null,
    guardAge: 0,
    counterRemaining: 0,
    cancelRemaining: 0,
    stamina: rules.stamina?.max ?? 0,
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
    stamina: rules.stamina?.max ?? 0,
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
      rules,
    );

    const bOpp = perceiveOpponent(
      b.x,
      perceivedFrame(histA, tick, bLPos),
      perceivedFrame(histA, tick, bLAct),
      bLPos,
      rules,
    );

    // 2. Both fighters decide against one immutable pre-tick snapshot.
    const aAction = runTick(
      botA,
      viewFor(a, aOpp, b, rules, tick, maxTicks),
      a.mem,
    );

    const bAction = runTick(
      botB,
      viewFor(b, bOpp, a, rules, tick, maxTicks),
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

    // Throws are computed from the same frozen snapshot (a throw beats any guard, so it has no
    // band gate). The §11.4 precedence is then applied: a throw is DEFEATED — voided and marked
    // resolved, the thrower left committed (punishable) — by the opponent's active in-range strike
    // (strike > throw, even mid-startup) or, on a grab-active tick, the opponent's throw-break
    // (throw-break > throw). All decisions read the frozen snapshot before any apply ⇒ swap-symmetric.
    const aThrow = computeThrow(a, b, rules);
    const bThrow = computeThrow(b, a, rules);
    const aDefeated = stuffIfDefeated(a, bOutcome, bAction, aThrow !== null);
    const bDefeated = stuffIfDefeated(b, aOutcome, aAction, bThrow !== null);
    // Throw CLASH: two live grabs (both grab-active + in reach of each other) mutually whiff —
    // neither scores nor downs. One of only two swap-symmetric outcomes in §11.4 (the other is
    // the strike∥strike trade). A lone live grab is NOT a clash — it lands on the (grounded,
    // possibly throwing) opponent.
    const clash = aThrow !== null && bThrow !== null;
    const aThrowFinal = aDefeated || clash ? null : aThrow;
    const bThrowFinal = bDefeated || clash ? null : bThrow;

    applyStrike(a, b, aOutcome);
    applyStrike(b, a, bOutcome);
    applyThrow(a, b, aThrowFinal);
    applyThrow(b, a, bThrowFinal);
    // Regen (C10) on the fully-resolved post-intake state, BEFORE advance frees a finishing
    // move — so a commit / guard / in-move / knocked-down tick recovers nothing (B2).
    regen(a, rules);
    regen(b, rules);
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
      a: {
        x: a.x,
        y: a.y,
        action: aAction,
        points: a.points,
        stamina: a.stamina,
      },
      b: {
        x: b.x,
        y: b.y,
        action: bAction,
        points: b.points,
        stamina: b.stamina,
      },
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
