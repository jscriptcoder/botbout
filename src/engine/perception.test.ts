import { describe, it, expect } from "vitest";
import { runFight, type FightConfig, type FightEvent } from "./sim.js";
import { validate, type BotDoc, type BoolExpr, type FieldPath } from "./dsl.js";
import type { Rules, Action, Band } from "./types.js";

// ─── factories ───────────────────────────────────────────────────────────────
const bot = (rules: BotDoc["rules"], dflt: Action): BotDoc => ({
  version: 1,
  name: "b",
  rules,
  default: dflt,
});

// B marches toward A every tick, closing the gap by walkSpeed each tick.
const ADVANCER = bot([], { type: "move", dir: 1 });

// A holds still and raises a guard the instant it PERCEIVES the gap reach
// `threshold`. Block has no positional effect, so A never moves — the gap is
// driven purely by B, and the tick A first guards is a clean read of *when A
// perceived* the gap cross the threshold.
const reactiveBlocker = (threshold: number): BotDoc =>
  bot(
    [
      {
        when: {
          op: "lte",
          args: [
            { op: "field", path: "opponent.distance" },
            { op: "const", value: threshold },
          ],
        },
        do: { type: "block", band: "mid" },
      },
    ],
    { type: "idle" },
  );

const getMockRules = (o: Partial<Rules> = {}): Rules => ({
  tickRate: 60,
  walkSpeed: 4000,
  ring: { width: 600000 },
  startGap: 200000,
  moves: {
    strike: { startup: 4, active: 2, recovery: 6, score: 1, reach: 250000 },
  },
  ...o,
});

// Start gap is 200000, closing 4000/tick ⇒ perceived gap reaches 180000 (≤) at
// the 5th tick of perception. L_pos shifts that perception later by its value.
const getMockConfig = (o: Partial<FightConfig> = {}): FightConfig => ({
  rules: getMockRules(),
  botA: reactiveBlocker(180000),
  botB: ADVANCER,
  maxTicks: 20,
  seed: 1,
  ...o,
});

const withLPos = (lPos: number): FightConfig =>
  getMockConfig({ rules: getMockRules({ perception: { lPos } }) });

const firstBlockTick = (events: FightEvent[]): number | undefined =>
  events.find((e) => e.a.action.type === "block")?.tick;

describe("perception latency — delayed opponent position (L_pos)", () => {
  it("delays the reaction to the opponent's approach by exactly L_pos ticks", () => {
    // Live (L_pos = 0): the guard goes up the tick the true gap reaches 180000.
    expect(firstBlockTick(runFight(withLPos(0)).events)).toBe(5);
    // Each extra tick of latency delays that same reaction by exactly one tick.
    expect(firstBlockTick(runFight(withLPos(1)).events)).toBe(6);
    expect(firstBlockTick(runFight(withLPos(2)).events)).toBe(7);
    // L_pos = 3 also exercises the start-of-fight clamp (ticks 0–2 read the
    // initial frame, so A must NOT guard early).
    expect(firstBlockTick(runFight(withLPos(3)).events)).toBe(8);
  });

  it("treats absent perception config as L_pos = 0 (forward-compatible)", () => {
    const absent = runFight(getMockConfig()); // no `perception` field at all
    const zero = runFight(withLPos(0));

    expect(absent.events).toEqual(zero.events);
    expect(firstBlockTick(absent.events)).toBe(5);
  });
});

// ─── slice 2: delayed action perception (L_act) and the master inequality ─────

// Attacks exactly once (tick 0), then idles — so there is a single active frame.
const ATTACK_ONCE: BotDoc = {
  version: 1,
  name: "atk",
  memory: { fired: 0 },
  rules: [
    {
      when: {
        op: "eq",
        args: [
          { op: "mem", cell: "fired" },
          { op: "const", value: 0 },
        ],
      },
      set: [{ cell: "fired", to: { op: "const", value: 1 } }],
      do: { type: "attack", move: "strike", band: "mid" },
    },
  ],
  default: { type: "idle" },
};

// Raises a guard the instant it PERCEIVES the opponent attacking.
const REACTIVE_BLOCKER: BotDoc = bot(
  [
    {
      when: {
        op: "eq",
        args: [
          { op: "field", path: "opponent.attacking" },
          { op: "const", value: 1 },
        ],
      },
      do: { type: "block", band: "mid" },
    },
  ],
  { type: "idle" },
);

// Defender A reacts to attacker B; both stand still, in reach (gap 200000 ≤ reach
// 250000). The strike's startup and the latencies are the only variables. Single
// active frame ⇒ a crisp block-or-hit boundary.
const inequalityConfig = (
  lPos: number,
  lAct: number,
  startup: number,
): FightConfig =>
  getMockConfig({
    botA: REACTIVE_BLOCKER,
    botB: ATTACK_ONCE,
    rules: getMockRules({
      perception: { lPos, lAct },
      moves: {
        strike: { startup, active: 1, recovery: 6, score: 1, reach: 250000 },
      },
    }),
    maxTicks: 30,
  });

describe("perception latency — delayed action perception (L_act)", () => {
  it("lets a reaction-blocker negate a strike only when startup ≥ L_act + 1", () => {
    const L = 6;
    // The attack tell only appears one tick after commit, so the guard is up by
    // the active frame iff startup exceeds L_act by at least 1.
    expect(runFight(inequalityConfig(0, L, L + 1)).scores.b).toBe(0); // blocked
    expect(runFight(inequalityConfig(0, L, L)).scores.b).toBe(1); // lands
  });

  it("delays the attack tell by L_act independent of L_pos (coherent split snapshot)", () => {
    const L = 6;
    // L_pos differs from L_act; the boundary still tracks L_act, proving the
    // attacking flag is read from the t−L_act frame, not the t−L_pos one.
    expect(runFight(inequalityConfig(2, L, L + 1)).scores.b).toBe(0); // blocked
    expect(runFight(inequalityConfig(2, L, L)).scores.b).toBe(1); // lands
  });

  it("accepts a bot that reads opponent.attacking (additive to the allowlist)", () => {
    expect(validate(REACTIVE_BLOCKER).ok).toBe(true);
  });
});

// ─── slice 3: dead-reckoned predictedDistance ─────────────────────────────────

// Strikes the instant a chosen perceived distance falls to `threshold`.
const strikeWhen = (
  path: "opponent.distance" | "opponent.predictedDistance",
  threshold: number,
): BotDoc =>
  bot(
    [
      {
        when: {
          op: "lte",
          args: [
            { op: "field", path },
            { op: "const", value: threshold },
          ],
        },
        do: { type: "attack", move: "strike", band: "mid" },
      },
    ],
    { type: "idle" },
  );

const STRIKE_REACH = 100000;
const STRIKE_ON_RAW = strikeWhen("opponent.distance", STRIKE_REACH);

const STRIKE_ON_PREDICTED = strikeWhen(
  "opponent.predictedDistance",
  STRIKE_REACH,
);

// A stands still and strikes on a perceived-distance threshold; B (ADVANCER) closes
// the gap by walkSpeed each tick. The true gap 200000 − 4000·t reaches 100000 at
// t = 25 — far past the latency clamp, so dead reckoning is exact there.
const spacingConfig = (striker: BotDoc, lPos: number): FightConfig =>
  getMockConfig({
    botA: striker,
    botB: ADVANCER,
    rules: getMockRules({ perception: { lPos } }),
    maxTicks: 40,
  });

const firstAttackTick = (events: FightEvent[]): number | undefined =>
  events.find((e) => e.a.action.type === "attack")?.tick;

describe("perception latency — dead-reckoned predictedDistance", () => {
  it("compensates L_pos so predictedDistance tracks the true distance while raw distance lags", () => {
    const k = 3;

    const live = firstAttackTick(
      runFight(spacingConfig(STRIKE_ON_RAW, 0)).events,
    );

    const predicted = firstAttackTick(
      runFight(spacingConfig(STRIKE_ON_PREDICTED, k)).events,
    );

    const rawDelayed = firstAttackTick(
      runFight(spacingConfig(STRIKE_ON_RAW, k)).events,
    );

    expect(live).toBe(25); // sanity: true gap reaches the threshold at tick 25
    expect(predicted).toBe(live); // dead reckoning fully compensates the latency
    expect(rawDelayed).toBe((live ?? 0) + k); // raw delayed distance lags by lPos ticks
  });

  it("dead-reckons whichever fighter is the moving target (symmetric perception)", () => {
    const k = 3;

    // Roles swapped vs above: A advances, B strikes on its predicted read of A. The
    // compensation must use A's perceived velocity, so B still fires at the live
    // tick 25 (not 25 + k) — exercising the other fighter's velocity history.
    const swapped = getMockConfig({
      botA: ADVANCER,
      botB: STRIKE_ON_PREDICTED,
      rules: getMockRules({ perception: { lPos: k } }),
      maxTicks: 40,
    });

    const bAttack = runFight(swapped).events.find(
      (e) => e.b.action.type === "attack",
    )?.tick;

    expect(bAttack).toBe(25);
  });

  it("accepts a bot reading opponent.vx and opponent.predictedDistance (additive allowlist)", () => {
    const reader = bot(
      [
        {
          when: {
            op: "lt",
            args: [
              { op: "field", path: "opponent.vx" },
              { op: "const", value: 0 },
            ],
          },
          do: { type: "idle" },
        },
        {
          when: {
            op: "lte",
            args: [
              { op: "field", path: "opponent.predictedDistance" },
              { op: "const", value: 1 },
            ],
          },
          do: { type: "idle" },
        },
      ],
      { type: "idle" },
    );

    expect(validate(reader).ok).toBe(true);
  });
});

// ─── slice 4: seeded clamped jitter on L ──────────────────────────────────────

// Defender A (REACTIVE_BLOCKER) vs attacker B (ATTACK_ONCE, single active frame),
// both still and in reach. lPos = 0 isolates lAct; `jitter` wobbles the perceived
// lAct by ±j per tick from `seed`. Whether the tick-S active frame is blocked turns
// on A's jittered lAct at that tick — so the boundary moves within its band.
const jitterConfig = (
  seed: number,
  lAct: number,
  jitter: number,
  startup: number,
): FightConfig =>
  getMockConfig({
    botA: REACTIVE_BLOCKER,
    botB: ATTACK_ONCE,
    seed,
    rules: getMockRules({
      perception: { lPos: 0, lAct, jitter },
      moves: {
        strike: { startup, active: 1, recovery: 6, score: 1, reach: 250000 },
      },
    }),
    maxTicks: 30,
  });

describe("perception latency — seeded clamped jitter on L", () => {
  it("stays byte-identical on replay for the same seed even with jitter", () => {
    const cfg = jitterConfig(12345, 6, 2, 7);
    expect(runFight(cfg).events).toEqual(runFight(cfg).events);
  });

  it("clamps to the band: S ≥ L_act+1+j always blocks, S ≤ L_act−j never blocks", () => {
    const lAct = 6;
    const j = 2;

    for (let seed = 1; seed <= 12; seed++) {
      // Jitter can never delay the tell past the active frame.
      expect(runFight(jitterConfig(seed, lAct, j, lAct + 1 + j)).scores.b).toBe(
        0,
      );
      // Jitter can never advance the tell early enough to guard in time.
      expect(runFight(jitterConfig(seed, lAct, j, lAct - j)).scores.b).toBe(1);
    }
  });

  it("varies the outcome by seed at the nominal boundary (anti-frame-counting)", () => {
    const lAct = 6;
    const j = 2;

    // S = L_act + 1 sits inside the jitter band: some seeds lengthen lAct (blocked),
    // others shorten it (lands). Without jitter every seed would give the same result.
    const outcomes = Array.from(
      { length: 20 },
      (_, i) => runFight(jitterConfig(i + 1, lAct, j, lAct + 1)).scores.b,
    );

    expect(outcomes).toContain(0);
    expect(outcomes).toContain(1);
  });
});

// ─── slice C3.2: perceived attack BAND, delayed by L_act ──────────────────────
// The opponent's attack band rides the SAME coherent delayed layer as the
// `attacking` tell (invariant #4), encoded numerically as a height-ordered enum:
// 0 = not attacking, 1 = low, 2 = mid, 3 = high. A counter-bot reads it to raise
// the matching guard — the read/counter game from C3 Slice 1 becomes playable.

// Attacks once at `band` on tick 0, then idles: one committed move ⇒ one tell.
const strikeOnce = (band: Band): BotDoc => ({
  version: 1,
  name: "atk1",
  memory: { fired: 0 },
  rules: [
    {
      when: {
        op: "eq",
        args: [
          { op: "mem", cell: "fired" },
          { op: "const", value: 0 },
        ],
      },
      set: [{ cell: "fired", to: { op: "const", value: 1 } }],
      do: { type: "attack", move: "strike", band },
    },
  ],
  default: { type: "idle" },
});

// Mirrors the PERCEIVED attack band into a same-band guard. The block band that
// surfaces in the event log is therefore a direct read of `opponent.attackBand`
// each tick (3 ⇒ block high, 2 ⇒ mid, 1 ⇒ low; 0 ⇒ idle).
const BAND_MIRROR: BotDoc = bot(
  [
    {
      when: {
        op: "eq",
        args: [
          { op: "field", path: "opponent.attackBand" },
          { op: "const", value: 3 },
        ],
      },
      do: { type: "block", band: "high" },
    },
    {
      when: {
        op: "eq",
        args: [
          { op: "field", path: "opponent.attackBand" },
          { op: "const", value: 2 },
        ],
      },
      do: { type: "block", band: "mid" },
    },
    {
      when: {
        op: "eq",
        args: [
          { op: "field", path: "opponent.attackBand" },
          { op: "const", value: 1 },
        ],
      },
      do: { type: "block", band: "low" },
    },
  ],
  { type: "idle" },
);

describe("perception latency — perceived attack band (L_act, numerically encoded)", () => {
  it("reads 0 until the tell, then the height-encoded band on the L_act layer", () => {
    // lPos ≠ lAct: a wrong read off the positional frame would surface the band
    // early (tick 3, not 7). Out of reach ⇒ a pure perception read, no scoring.
    const probe = (band: Band): FightEvent[] =>
      runFight(
        getMockConfig({
          botA: BAND_MIRROR,
          botB: strikeOnce(band),
          rules: getMockRules({
            startGap: 300000,
            perception: { lPos: 2, lAct: 6 },
          }),
          maxTicks: 12,
        }),
      ).events;

    for (const band of ["high", "mid", "low"] as Band[]) {
      const ev = probe(band);
      // Baseline 0 (idle) right up to the tell; the encoded band appears the next
      // tick — pinning both the off-by-one boundary and the high/mid/low encoding.
      expect(ev[6].a.action).toEqual({ type: "idle" });
      expect(ev[7].a.action).toEqual({ type: "block", band });
    }
  });

  it("lets a band-reading counter block what a fixed-height guard would eat", () => {
    const reactable = getMockRules({
      perception: { lPos: 0, lAct: 6 },
      // startup 7 ≥ L_act + 1 ⇒ the perceived band arrives in time to guard.
      moves: {
        strike: { startup: 7, active: 1, recovery: 6, score: 1, reach: 250000 },
      },
    });

    const counterEats = (band: Band): number =>
      runFight(
        getMockConfig({
          botA: BAND_MIRROR, // reads the incoming band, guards that height
          botB: strikeOnce(band),
          rules: reactable,
          maxTicks: 30,
        }),
      ).scores.b;

    // The counter guards whatever height it reads — both high and low are blocked.
    // No single fixed-height guard could stop both, so the read is load-bearing.
    expect(counterEats("high")).toBe(0);
    expect(counterEats("low")).toBe(0);

    // Contrast: a fixed mid guard cannot read the high strike and eats it.
    const fixedMid = bot([], { type: "block", band: "mid" });

    expect(
      runFight(
        getMockConfig({
          botA: fixedMid,
          botB: strikeOnce("high"),
          rules: reactable,
          maxTicks: 30,
        }),
      ).scores.b,
    ).toBe(1);
  });

  it("perceives the band live at the 0 baseline when perception is absent, replaying byte-identically", () => {
    const cfg = getMockConfig({
      botA: BAND_MIRROR,
      botB: strikeOnce("high"),
      rules: getMockRules({ startGap: 300000 }), // no `perception` field at all
      maxTicks: 12,
    });

    const ev = runFight(cfg).events;
    // Live ⇒ only the structural one-tick observe-after-commit delay remains.
    expect(ev[0].a.action).toEqual({ type: "idle" }); // baseline 0 before the tell
    expect(ev[1].a.action).toEqual({ type: "block", band: "high" });
    // The added field leaves replay byte-identical.
    expect(runFight(cfg).events).toEqual(ev);
  });

  it("exposes the 0 baseline as a literal 0 a bot can test, not a missing value", () => {
    // A non-attacking opponent must read as attackBand === 0 (not undefined): a bot
    // can branch on "no incoming attack". B never attacks, so A advances every tick.
    const onNoAttack = bot(
      [
        {
          when: {
            op: "eq",
            args: [
              { op: "field", path: "opponent.attackBand" },
              { op: "const", value: 0 },
            ],
          },
          do: { type: "move", dir: 1 },
        },
      ],
      { type: "idle" },
    );

    const result = runFight(
      getMockConfig({
        botA: onNoAttack,
        botB: bot([], { type: "idle" }), // never attacks ⇒ band stays 0
        rules: getMockRules({ startGap: 300000 }),
        maxTicks: 3,
      }),
    );

    expect(result.events[0].a.action).toEqual({ type: "move", dir: 1 });
  });

  it("accepts a bot that reads opponent.attackBand (additive to the allowlist)", () => {
    expect(validate(BAND_MIRROR).ok).toBe(true);
  });
});

describe("perception latency — delayed opponent height (L_pos)", () => {
  // A bot that jumps the instant it is free to act, else idles (committed mid-air).
  const jumpWhenFree = bot(
    [
      {
        when: {
          op: "eq",
          args: [
            { op: "field", path: "self.canAct" },
            { op: "const", value: 1 },
          ],
        },
        do: { type: "jump", dir: 0 },
      },
    ],
    { type: "idle" },
  );

  // jumpImpulse 12000 / gravity 4000 ⇒ the opponent's recorded height climbs
  // 0, 12000, 20000, 24000, ... — perceived `L_pos` ticks late.
  const arc = (o: Partial<Rules> = {}): Rules =>
    getMockRules({ jumpImpulse: 12000, gravity: 4000, ...o });

  // A holds still and guards the instant it PERCEIVES the opponent's height reach
  // 20000, so the first block tick is a clean read of *when A perceived* the climb.
  const heightBlocker = bot(
    [
      {
        when: {
          op: "gte",
          args: [
            { op: "field", path: "opponent.y" },
            { op: "const", value: 20000 },
          ],
        },
        do: { type: "block", band: "mid" },
      },
    ],
    { type: "idle" },
  );

  const heightDelay = (lPos: number): FightConfig =>
    getMockConfig({
      rules: arc({ perception: { lPos } }),
      botA: heightBlocker,
      botB: jumpWhenFree,
      maxTicks: 12,
    });

  it("delays the perception of the opponent's height by exactly L_pos ticks", () => {
    // Live (L_pos = 0): the perceived height first reaches 20000 at tick 2.
    expect(firstBlockTick(runFight(heightDelay(0)).events)).toBe(2);
    // Each extra tick of positional latency delays that read by exactly one tick.
    expect(firstBlockTick(runFight(heightDelay(1)).events)).toBe(3);
    expect(firstBlockTick(runFight(heightDelay(2)).events)).toBe(4);
  });

  it("rides the positional (L_pos) layer, not the action (L_act) layer", () => {
    // Only the action layer delayed (L_pos = 0, L_act = 5): the height read stays
    // live ⇒ tick 2, proving opponent.y follows the positional layer.
    const config = getMockConfig({
      rules: arc({ perception: { lPos: 0, lAct: 5 } }),
      botA: heightBlocker,
      botB: jumpWhenFree,
      maxTicks: 12,
    });

    expect(firstBlockTick(runFight(config).events)).toBe(2);
  });

  // A reads the jumper's perceived height and commits a strike at the band that
  // connects. lowClearance 1000 ⇒ any airborne height vacates `low`.
  const antiAir = (band: Band): BotDoc =>
    bot(
      [
        {
          when: {
            op: "gte",
            args: [
              { op: "field", path: "opponent.y" },
              { op: "const", value: 12000 },
            ],
          },
          do: { type: "attack", move: "strike", band },
        },
      ],
      { type: "idle" },
    );

  const antiAirScore = (band: Band): number =>
    runFight(
      getMockConfig({
        rules: arc({ lowClearance: 1000, startGap: 200000 }),
        botA: antiAir(band),
        botB: jumpWhenFree,
        maxTicks: 10,
      }),
    ).scores.a;

  it("lets a height-reading bot anti-air a jumper — mid connects where a fixed sweep whiffs", () => {
    expect(antiAirScore("mid")).toBe(1); // reads the climb, strikes mid ⇒ connects
    expect(antiAirScore("low")).toBe(0); // same read, low ⇒ the sweep passes under
  });

  it("accepts a bot that reads opponent.y (additive to the allowlist)", () => {
    expect(validate(heightBlocker).ok).toBe(true);
  });
});

describe("perception latency — delayed opponent posture (L_act)", () => {
  // B holds a crouch every tick; A reads the (delayed) posture enum.
  const CROUCHER = bot([], { type: "crouch" });

  // A bot that jumps the instant it is free to act, else idles.
  const jumpWhenFree = bot(
    [
      {
        when: {
          op: "eq",
          args: [
            { op: "field", path: "self.canAct" },
            { op: "const", value: 1 },
          ],
        },
        do: { type: "jump", dir: 0 },
      },
    ],
    { type: "idle" },
  );

  // A guards the instant it PERCEIVES posture === code, so firstBlockTick is a
  // clean read of *when A perceived* that stance.
  const blockOnPosture = (code: number): BotDoc =>
    bot(
      [
        {
          when: {
            op: "eq",
            args: [
              { op: "field", path: "opponent.posture" },
              { op: "const", value: code },
            ],
          },
          do: { type: "block", band: "mid" },
        },
      ],
      { type: "idle" },
    );

  const crouchDelay = (perception: {
    lPos?: number;
    lAct?: number;
  }): FightConfig =>
    getMockConfig({
      rules: getMockRules({ perception }),
      botA: blockOnPosture(1), // crouching
      botB: CROUCHER,
      maxTicks: 12,
    });

  it("delays the perception of a crouch by exactly L_act ticks (plus the structural tick)", () => {
    // L_act = 0: the crouch is perceived at tick 1 — the structural observe-after-
    // commit tick (history[0] is the pre-crouch baseline).
    expect(firstBlockTick(runFight(crouchDelay({ lAct: 0 })).events)).toBe(1);
    expect(firstBlockTick(runFight(crouchDelay({ lAct: 1 })).events)).toBe(2);
    expect(firstBlockTick(runFight(crouchDelay({ lAct: 2 })).events)).toBe(3);
  });

  it("rides the action (L_act) layer, not the positional (L_pos) layer", () => {
    // Only the positional layer delayed (L_act = 0, L_pos = 5): the posture read
    // stays live ⇒ tick 1, proving opponent.posture follows the action layer.
    expect(
      firstBlockTick(runFight(crouchDelay({ lPos: 5, lAct: 0 })).events),
    ).toBe(1);
  });

  // A reads the croucher and commits a strike at the band that connects.
  const postureCounter = (band: Band): BotDoc =>
    bot(
      [
        {
          when: {
            op: "eq",
            args: [
              { op: "field", path: "opponent.posture" },
              { op: "const", value: 1 }, // crouching
            ],
          },
          do: { type: "attack", move: "strike", band },
        },
      ],
      { type: "idle" },
    );

  const counterScore = (band: Band): number =>
    runFight(
      getMockConfig({
        rules: getMockRules({ startGap: 200000 }), // within reach (250000)
        botA: postureCounter(band),
        botB: CROUCHER,
        maxTicks: 12,
      }),
    ).scores.a;

  it("lets a posture-reading bot avoid high vs a croucher — mid connects where a fixed high whiffs", () => {
    expect(counterScore("mid")).toBe(1); // reads crouching, strikes mid ⇒ connects
    expect(counterScore("high")).toBe(0); // same read, high ⇒ sails over the croucher
  });

  it("exposes a standing opponent as the literal 0 a bot can branch on", () => {
    // A non-crouching, non-jumping opponent reads posture === 0 (not undefined).
    const onStanding = bot(
      [
        {
          when: {
            op: "eq",
            args: [
              { op: "field", path: "opponent.posture" },
              { op: "const", value: 0 },
            ],
          },
          do: { type: "move", dir: 1 },
        },
      ],
      { type: "idle" },
    );

    const result = runFight(
      getMockConfig({
        botA: onStanding,
        botB: bot([], { type: "idle" }), // never crouches/jumps ⇒ posture stays 0
        rules: getMockRules({ startGap: 300000 }),
        maxTicks: 3,
      }),
    );

    expect(result.events[0].a.action).toEqual({ type: "move", dir: 1 });
  });

  it("distinguishes airborne (2) from crouching (1) — a jumper is not read as a croucher", () => {
    const vsJumper = (code: number): FightConfig =>
      getMockConfig({
        rules: getMockRules({
          jumpImpulse: 12000,
          gravity: 4000,
          lowClearance: 1000,
        }),
        botA: blockOnPosture(code),
        botB: jumpWhenFree,
        maxTicks: 12,
      });

    expect(firstBlockTick(runFight(vsJumper(2)).events)).toBeDefined(); // read as airborne
    expect(firstBlockTick(runFight(vsJumper(1)).events)).toBeUndefined(); // never as crouching
  });

  it("accepts a bot that reads opponent.posture (additive to the allowlist)", () => {
    expect(validate(blockOnPosture(1)).ok).toBe(true);
  });
});

// ─── slice C7.5: perceived incoming THROW, delayed by L_act ────────────────────
// The opponent's throw rides the SAME coherent delayed layer as the `attacking`
// tell (invariant #4), exposed as a bare boolean `opponent.throwing` (1 while the
// perceived opponent is committed to a grab, 0 otherwise). This makes `throw-break`
// a REACTION skill-gradient — a break is in time only when the grab is slow enough
// to perceive (startup ≥ L_act + 1), the keystone inequality applied to throws.
describe("perception latency — delayed incoming throw (L_act)", () => {
  // A long-committed grab so the `throwing` tell stays asserted across the probe
  // window; out of reach in the read-only tests so the grab itself never lands.
  const THROW_FRAMES = {
    startup: 2,
    active: 1,
    recovery: 20,
    reach: 250000,
    score: 3,
  };

  // B starts a grab the instant it is free to act, then stays committed — so the
  // perceived `throwing` flag is continuously true from the tick after it commits.
  const THROWER = bot(
    [
      {
        when: {
          op: "eq",
          args: [
            { op: "field", path: "self.canAct" },
            { op: "const", value: 1 },
          ],
        },
        do: { type: "throw" },
      },
    ],
    { type: "idle" },
  );

  // A guards the instant it PERCEIVES the opponent throwing, so firstBlockTick is a
  // clean read of *when A perceived* the grab start.
  const BLOCK_ON_THROWING = bot(
    [
      {
        when: {
          op: "eq",
          args: [
            { op: "field", path: "opponent.throwing" },
            { op: "const", value: 1 },
          ],
        },
        do: { type: "block", band: "mid" },
      },
    ],
    { type: "idle" },
  );

  // Out of reach (startGap 300000 > reach 250000) ⇒ a pure perception read, no grab.
  const throwDelay = (perception: {
    lPos?: number;
    lAct?: number;
  }): FightConfig =>
    getMockConfig({
      rules: getMockRules({
        startGap: 300000,
        throw: THROW_FRAMES,
        knockdownDuration: 5,
        perception,
      }),
      botA: BLOCK_ON_THROWING,
      botB: THROWER,
      maxTicks: 12,
    });

  it("delays the perception of a throw by exactly L_act ticks (plus the structural tick)", () => {
    // L_act = 0: the grab is perceived at tick 1 — the structural observe-after-
    // commit tick (history[0] is the pre-throw baseline).
    expect(firstBlockTick(runFight(throwDelay({ lAct: 0 })).events)).toBe(1);
    expect(firstBlockTick(runFight(throwDelay({ lAct: 1 })).events)).toBe(2);
    expect(firstBlockTick(runFight(throwDelay({ lAct: 2 })).events)).toBe(3);
  });

  it("rides the action (L_act) layer, not the positional (L_pos) layer", () => {
    // Only the positional layer delayed (L_pos = 5, L_act = 0): the throw read stays
    // live ⇒ tick 1, proving opponent.throwing follows the action layer.
    expect(
      firstBlockTick(runFight(throwDelay({ lPos: 5, lAct: 0 })).events),
    ).toBe(1);
  });

  // ── the headline: throw-break becomes a reaction skill-gradient ──
  // B throws exactly once (a single grab-active window); A breaks the instant it
  // perceives the throw. In reach (200000 ≤ 250000) so the grab can land OR be broken.
  const THROW_ONCE: BotDoc = {
    version: 1,
    name: "thr1",
    memory: { fired: 0 },
    rules: [
      {
        when: {
          op: "eq",
          args: [
            { op: "mem", cell: "fired" },
            { op: "const", value: 0 },
          ],
        },
        set: [{ cell: "fired", to: { op: "const", value: 1 } }],
        do: { type: "throw" },
      },
    ],
    default: { type: "idle" },
  };

  // Returns throw-break the instant it perceives the opponent throwing.
  const REACTIVE_BREAKER = bot(
    [
      {
        when: {
          op: "eq",
          args: [
            { op: "field", path: "opponent.throwing" },
            { op: "const", value: 1 },
          ],
        },
        do: { type: "throw-break" },
      },
    ],
    { type: "idle" },
  );

  const breakInequality = (lAct: number, startup: number): FightConfig =>
    getMockConfig({
      botA: REACTIVE_BREAKER,
      botB: THROW_ONCE,
      rules: getMockRules({
        perception: { lPos: 0, lAct },
        throw: { startup, active: 1, recovery: 6, reach: 250000, score: 3 },
        knockdownDuration: 5,
      }),
      maxTicks: 30,
    });

  it("lets a reaction-breaker escape a throw only when startup ≥ L_act + 1", () => {
    const L = 6;
    // The throw tell appears one tick after commit, so the break is up by the grab
    // frame iff startup exceeds L_act by at least 1 — the keystone inequality for throws.
    expect(runFight(breakInequality(L, L + 1)).scores.b).toBe(0); // broken
    expect(runFight(breakInequality(L, L)).scores.b).toBe(3); // grabs (too fast)
  });

  it("perceives the throw live (structural one-tick delay) when perception is absent, replaying byte-identically", () => {
    const cfg = getMockConfig({
      rules: getMockRules({
        startGap: 300000,
        throw: THROW_FRAMES,
        knockdownDuration: 5,
      }), // no `perception` field at all
      botA: BLOCK_ON_THROWING,
      botB: THROWER,
      maxTicks: 12,
    });

    const ev = runFight(cfg).events;
    // Live ⇒ only the structural one-tick observe-after-commit delay remains.
    expect(ev[0].a.action).toEqual({ type: "idle" }); // baseline 0 before the tell
    expect(ev[1].a.action).toEqual({ type: "block", band: "mid" });
    // The added field leaves replay byte-identical.
    expect(runFight(cfg).events).toEqual(ev);
  });

  it("exposes a non-throwing opponent as the literal 0 a bot can branch on", () => {
    // A non-throwing opponent must read as throwing === 0 (not undefined): a bot can
    // branch on "no incoming grab". B never throws, so A advances every tick.
    const onNotThrowing = bot(
      [
        {
          when: {
            op: "eq",
            args: [
              { op: "field", path: "opponent.throwing" },
              { op: "const", value: 0 },
            ],
          },
          do: { type: "move", dir: 1 },
        },
      ],
      { type: "idle" },
    );

    const result = runFight(
      getMockConfig({
        botA: onNotThrowing,
        botB: bot([], { type: "idle" }), // never throws ⇒ throwing stays 0
        rules: getMockRules({ startGap: 300000 }),
        maxTicks: 3,
      }),
    );

    expect(result.events[0].a.action).toEqual({ type: "move", dir: 1 });
  });

  it("accepts a bot that reads opponent.throwing (additive to the allowlist)", () => {
    expect(validate(REACTIVE_BREAKER).ok).toBe(true);
  });
});

// ─── slice C8.4: perceived opponent KNOCKDOWN, delayed by L_act ─────────────────
// A grounded opponent rides the SAME coherent delayed action layer as the
// `attacking`/`throwing` tells (invariant #4), exposed as a bare boolean
// `opponent.knockdown` (1 while the perceived opponent is downed, 0 otherwise — for
// the WHOLE knockdown, finish window AND i-frame tail). Paired with the live
// `self.finishWindow` it expresses the full okizeme read: knockdown ∧ finishWindow>0
// ⇒ go for the finish; knockdown ∧ finishWindow==0 ⇒ reset against an invulnerable foe.
describe("perception latency — delayed opponent knockdown (L_act)", () => {
  const eqField = (path: FieldPath, n: number): BoolExpr => ({
    op: "eq",
    args: [
      { op: "field", path },
      { op: "const", value: n },
    ],
  });

  // A fast sweep so A is free again the tick after it downs B (recovery 0 ⇒ total 2,
  // active at elapsed 1) — A's commitment never masks the knockdown-perception lag.
  const SWEEP = {
    startup: 1,
    active: 1,
    recovery: 0,
    score: 0,
    reach: 250000,
    knockdown: true,
  };

  // A sweeps B down at tick 0, then BLOCKS the instant it PERCEIVES the knockdown —
  // so the first `block` tick is a clean read of *when A perceived* B go down.
  const SWEEP_THEN_BLOCK = bot(
    [
      { when: eqField("clock.tick", 0), do: { type: "sweep" } },
      {
        when: eqField("opponent.knockdown", 1),
        do: { type: "block", band: "mid" },
      },
    ],
    { type: "idle" },
  );

  // B (idle, standing, in sweep reach) gets swept and stays down (knockdownDuration 10).
  const knockdownDelay = (perception: {
    lPos?: number;
    lAct?: number;
  }): FightConfig =>
    getMockConfig({
      rules: getMockRules({
        startGap: 200000, // within sweep reach (250000)
        moves: { strike: getMockRules().moves.strike, sweep: SWEEP },
        knockdownDuration: 10,
        perception,
      }),
      botA: SWEEP_THEN_BLOCK,
      botB: bot([], { type: "idle" }),
      maxTicks: 12,
    });

  it("delays the perception of a knockdown by exactly L_act ticks (plus the structural tick)", () => {
    // B is swept on tick 1 and enters A's history downed on tick 2, so at L_act = 0 the
    // knockdown is perceived on tick 2 (the structural observe-after-commit tick); each
    // extra tick of action latency pushes that read one tick later.
    expect(firstBlockTick(runFight(knockdownDelay({ lAct: 0 })).events)).toBe(
      2,
    );
    expect(firstBlockTick(runFight(knockdownDelay({ lAct: 1 })).events)).toBe(
      3,
    );
    expect(firstBlockTick(runFight(knockdownDelay({ lAct: 2 })).events)).toBe(
      4,
    );
  });

  it("rides the action (L_act) layer, not the positional (L_pos) layer", () => {
    // Only the positional layer delayed (L_pos = 5, L_act = 0): the knockdown read stays
    // live ⇒ tick 2, proving opponent.knockdown follows the action layer.
    expect(
      firstBlockTick(runFight(knockdownDelay({ lPos: 5, lAct: 0 })).events),
    ).toBe(2);
  });

  it("exposes a standing opponent as the literal 0 a bot can branch on", () => {
    // A non-downed opponent must read as knockdown === 0 (not undefined): a bot can branch
    // on "the foe is upright". B never goes down, so A advances every tick.
    const onStanding = bot(
      [
        {
          when: eqField("opponent.knockdown", 0),
          do: { type: "move", dir: 1 },
        },
      ],
      { type: "idle" },
    );

    const result = runFight(
      getMockConfig({
        botA: onStanding,
        botB: bot([], { type: "idle" }), // never downed ⇒ knockdown stays 0
        rules: getMockRules({ startGap: 300000 }),
        maxTicks: 3,
      }),
    );

    expect(result.events[0].a.action).toEqual({ type: "move", dir: 1 });
  });

  it("perceives the knockdown live (structural delay only) when perception is absent, replaying byte-identically", () => {
    const cfg = getMockConfig({
      rules: getMockRules({
        startGap: 200000,
        moves: { strike: getMockRules().moves.strike, sweep: SWEEP },
        knockdownDuration: 10,
      }), // no `perception` field at all
      botA: SWEEP_THEN_BLOCK,
      botB: bot([], { type: "idle" }),
      maxTicks: 12,
    });

    // Live ⇒ only the structural delay remains (perceived the tick after it enters history).
    expect(firstBlockTick(runFight(cfg).events)).toBe(2);
    // The added field leaves replay byte-identical (additive + deterministic).
    expect(runFight(cfg).events).toEqual(runFight(cfg).events);
  });

  it("accepts a bot that reads opponent.knockdown (additive to the allowlist)", () => {
    expect(validate(SWEEP_THEN_BLOCK).ok).toBe(true);
  });
});

// ─── slice C10.4a: perceived opponent STAMINA, delayed by L_act ─────────────────
// The opponent's stamina rides the SAME coherent delayed action layer as the
// attacking/throwing/posture/knockdown tells (invariant #4), exposed as the raw number
// `opponent.stamina`. A bot reads the DELAYED conditioning to pace against a tiring foe
// — the self-side economy (C10 Stories 1–3) becomes a two-player read game.
describe("perception latency — delayed opponent stamina (L_act)", () => {
  // A drain strike: one big on-commit cost with a long recovery, so the spender stays
  // committed (no regen) across the probe and its stamina holds at the post-spend value.
  const DRAIN_STRIKE = {
    startup: 1,
    active: 1,
    recovery: 30,
    score: 1,
    reach: 250000,
    staminaCost: 30,
  };

  // B spends once on tick 0 (a single committed strike) ⇒ a deterministic stamina drop
  // (max 50 → 20) that then holds (no regen while committed, and no regen configured).
  const SPEND_ONCE: BotDoc = {
    version: 1,
    name: "spend1",
    memory: { fired: 0 },
    rules: [
      {
        when: {
          op: "eq",
          args: [
            { op: "mem", cell: "fired" },
            { op: "const", value: 0 },
          ],
        },
        set: [{ cell: "fired", to: { op: "const", value: 1 } }],
        do: { type: "attack", move: "strike", band: "mid" },
      },
    ],
    default: { type: "idle" },
  };

  // A guards the instant it PERCEIVES opponent.stamina ≤ 40 — between max (50) and the
  // post-spend value (20) — so the first block tick is a clean read of *when A perceived*
  // the drain.
  const BLOCK_ON_LOW_STAMINA = bot(
    [
      {
        when: {
          op: "lte",
          args: [
            { op: "field", path: "opponent.stamina" },
            { op: "const", value: 40 },
          ],
        },
        do: { type: "block", band: "mid" },
      },
    ],
    { type: "idle" },
  );

  // Out of reach (startGap 300000 > reach 250000) ⇒ a pure perception read, no scoring.
  const staminaDelay = (perception: {
    lPos?: number;
    lAct?: number;
  }): FightConfig =>
    getMockConfig({
      rules: getMockRules({
        startGap: 300000,
        stamina: { max: 50 },
        moves: { strike: DRAIN_STRIKE },
        perception,
      }),
      botA: BLOCK_ON_LOW_STAMINA,
      botB: SPEND_ONCE,
      maxTicks: 12,
    });

  it("delays the perception of a stamina drain by exactly L_act ticks (plus the structural tick)", () => {
    // L_act = 0: the spend on tick 0 enters B's history on tick 1, so the drop is
    // perceived at tick 1 — the structural observe-after-commit tick (history[0] is the
    // pre-spend baseline at max). Each extra tick of action latency pushes it one later.
    expect(firstBlockTick(runFight(staminaDelay({ lAct: 0 })).events)).toBe(1);
    expect(firstBlockTick(runFight(staminaDelay({ lAct: 1 })).events)).toBe(2);
    expect(firstBlockTick(runFight(staminaDelay({ lAct: 2 })).events)).toBe(3);
  });

  it("rides the action (L_act) layer, not the positional (L_pos) layer", () => {
    // Only the positional layer delayed (L_pos = 5, L_act = 0): the stamina read stays
    // live ⇒ tick 1, proving opponent.stamina follows the action layer (read off oppAct,
    // not oppPos — a positional read would surface the drain at tick 6, not 1).
    expect(
      firstBlockTick(runFight(staminaDelay({ lPos: 5, lAct: 0 })).events),
    ).toBe(1);
  });

  it("perceives stamina live (structural delay only) when perception is absent, replaying byte-identically", () => {
    const cfg = getMockConfig({
      rules: getMockRules({
        startGap: 300000,
        stamina: { max: 50 },
        moves: { strike: DRAIN_STRIKE },
      }), // no `perception` field at all
      botA: BLOCK_ON_LOW_STAMINA,
      botB: SPEND_ONCE,
      maxTicks: 12,
    });

    // Live ⇒ only the structural one-tick observe-after-commit delay remains.
    expect(firstBlockTick(runFight(cfg).events)).toBe(1);
    // The added field leaves replay byte-identical (additive + deterministic).
    expect(runFight(cfg).events).toEqual(runFight(cfg).events);
  });

  it("reads the inert sentinel 0 when no stamina is configured, a bot can branch on it", () => {
    // With no Rules.stamina, opponent.stamina reads the sentinel 0 (not undefined): a bot
    // can branch on it. No meter ⇒ stamina stays 0, so A advances every tick (0 ≤ 0).
    const onZero = bot(
      [
        {
          when: {
            op: "lte",
            args: [
              { op: "field", path: "opponent.stamina" },
              { op: "const", value: 0 },
            ],
          },
          do: { type: "move", dir: 1 },
        },
      ],
      { type: "idle" },
    );

    const result = runFight(
      getMockConfig({
        botA: onZero,
        botB: bot([], { type: "idle" }), // no meter configured ⇒ stamina sentinel 0
        rules: getMockRules({ startGap: 300000 }),
        maxTicks: 3,
      }),
    );

    expect(result.events[0].a.action).toEqual({ type: "move", dir: 1 });
  });

  it("accepts a bot that reads opponent.stamina (additive to the allowlist)", () => {
    expect(validate(BLOCK_ON_LOW_STAMINA).ok).toBe(true);
  });
});

// ─── slice C10.4b: perceived opponent GASSED, delayed by L_act ──────────────────
// opponent.gassed is the L_act-delayed gas tell: 1 iff the DELAYED opponent stamina ≤
// the shared gasThreshold (a static Rules constant), else 0. It derives from the already-
// delayed opponent.stamina (4a), so it rides the same action layer — the punish-signal
// for a gassed foe, on the coherent delayed snapshot (invariant #4).
describe("perception latency — delayed opponent gassed (L_act)", () => {
  // A drain strike: one big on-commit cost with a long recovery, so the spender stays
  // committed (no regen) across the probe and its stamina holds at the post-spend value.
  const DRAIN_STRIKE = {
    startup: 1,
    active: 1,
    recovery: 30,
    score: 1,
    reach: 250000,
    staminaCost: 30,
  };

  // B spends once on tick 0 ⇒ a deterministic stamina drop (max 50 → 20) that holds.
  const SPEND_ONCE: BotDoc = {
    version: 1,
    name: "spend1",
    memory: { fired: 0 },
    rules: [
      {
        when: {
          op: "eq",
          args: [
            { op: "mem", cell: "fired" },
            { op: "const", value: 0 },
          ],
        },
        set: [{ cell: "fired", to: { op: "const", value: 1 } }],
        do: { type: "attack", move: "strike", band: "mid" },
      },
    ],
    default: { type: "idle" },
  };

  // A guards the instant it PERCEIVES opponent.gassed === 1, so the first block tick is a
  // clean read of *when A perceived* the foe cross the gas line.
  const BLOCK_ON_GASSED = bot(
    [
      {
        when: {
          op: "eq",
          args: [
            { op: "field", path: "opponent.gassed" },
            { op: "const", value: 1 },
          ],
        },
        do: { type: "block", band: "mid" },
      },
    ],
    { type: "idle" },
  );

  // Out of reach ⇒ a pure perception read. gasThreshold 40 sits between max (50) and the
  // post-spend value (20), so the spend flips gassed.
  const gassedDelay = (perception: {
    lPos?: number;
    lAct?: number;
  }): FightConfig =>
    getMockConfig({
      rules: getMockRules({
        startGap: 300000,
        stamina: { max: 50, gasThreshold: 40 },
        moves: { strike: DRAIN_STRIKE },
        perception,
      }),
      botA: BLOCK_ON_GASSED,
      botB: SPEND_ONCE,
      maxTicks: 12,
    });

  it("delays the perception of the gas line by exactly L_act ticks (plus the structural tick)", () => {
    // L_act = 0: the spend on tick 0 enters B's history gassed on tick 1, so it's perceived
    // at tick 1 (history[0] is the pre-spend baseline, not gassed). Each tick of action
    // latency pushes that read one tick later.
    expect(firstBlockTick(runFight(gassedDelay({ lAct: 0 })).events)).toBe(1);
    expect(firstBlockTick(runFight(gassedDelay({ lAct: 1 })).events)).toBe(2);
    expect(firstBlockTick(runFight(gassedDelay({ lAct: 2 })).events)).toBe(3);
  });

  it("rides the action (L_act) layer, not the positional (L_pos) layer", () => {
    // Only the positional layer delayed (L_pos = 5, L_act = 0): the gas read stays live ⇒
    // tick 1, proving opponent.gassed derives from the delayed-action stamina (oppAct).
    expect(
      firstBlockTick(runFight(gassedDelay({ lPos: 5, lAct: 0 })).events),
    ).toBe(1);
  });

  it("flips at the gas line on the ≤ boundary (delayed stamina == threshold is gassed, +1 is not)", () => {
    // Hold the post-spend stamina at 20 (max 50, cost 30); vary only gasThreshold.
    const atThreshold = (gasThreshold: number): FightConfig =>
      getMockConfig({
        rules: getMockRules({
          startGap: 300000,
          stamina: { max: 50, gasThreshold },
          moves: { strike: DRAIN_STRIKE },
        }),
        botA: BLOCK_ON_GASSED,
        botB: SPEND_ONCE,
        maxTicks: 12,
      });

    // stamina 20 == threshold 20 ⇒ gassed (≤) ⇒ A perceives it and blocks (tick 1).
    expect(firstBlockTick(runFight(atThreshold(20)).events)).toBe(1);
    // stamina 20 > threshold 19 ⇒ NOT gassed ⇒ A never blocks.
    expect(firstBlockTick(runFight(atThreshold(19)).events)).toBeUndefined();
  });

  it("perceives the gas tell live (structural delay only) when perception is absent, replaying byte-identically", () => {
    const cfg = getMockConfig({
      rules: getMockRules({
        startGap: 300000,
        stamina: { max: 50, gasThreshold: 40 },
        moves: { strike: DRAIN_STRIKE },
      }), // no `perception` field at all
      botA: BLOCK_ON_GASSED,
      botB: SPEND_ONCE,
      maxTicks: 12,
    });

    // Live ⇒ only the structural one-tick observe-after-commit delay remains.
    expect(firstBlockTick(runFight(cfg).events)).toBe(1);
    // The added field leaves replay byte-identical (additive + deterministic).
    expect(runFight(cfg).events).toEqual(runFight(cfg).events);
  });

  it("reads 0 when the meter has no gasThreshold — a low-stamina foe is never gassed (additive guard)", () => {
    // Meter present, NO gasThreshold: the opponent drains to 20 but opponent.gassed stays 0
    // (consistent with self's "absent threshold ⇒ never gassed"), so A never blocks.
    const cfg = getMockConfig({
      rules: getMockRules({
        startGap: 300000,
        stamina: { max: 50 }, // no gasThreshold
        moves: { strike: DRAIN_STRIKE },
      }),
      botA: BLOCK_ON_GASSED,
      botB: SPEND_ONCE,
      maxTicks: 12,
    });

    expect(firstBlockTick(runFight(cfg).events)).toBeUndefined();
  });

  it("accepts a bot that reads opponent.gassed (additive to the allowlist)", () => {
    expect(validate(BLOCK_ON_GASSED).ok).toBe(true);
  });
});
