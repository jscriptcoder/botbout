import { describe, it, expect } from "vitest";
import { runFight, type FightConfig, type FightEvent } from "./sim.js";
import { validate, type BotDoc } from "./dsl.js";
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
