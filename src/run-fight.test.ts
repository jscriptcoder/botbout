import { describe, it, expect } from "vitest";
import { runFight, type FightConfig } from "./sim.js";
import type { BotDoc } from "./dsl.js";
import type { Rules, Action, Band } from "./types.js";

// ─── factories ───────────────────────────────────────────────────────────────
const bot = (rules: BotDoc["rules"], dflt: Action): BotDoc => ({
  version: 1,
  name: "b",
  rules,
  default: dflt,
});

const AGGRESSOR = bot([], { type: "move", dir: 1 }); // always advance toward opponent
const IDLE = bot([], { type: "idle" });
const RETREATER = bot([], { type: "move", dir: -1 }); // always back away

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

const getMockConfig = (o: Partial<FightConfig> = {}): FightConfig => ({
  rules: getMockRules(),
  botA: AGGRESSOR,
  botB: IDLE,
  maxTicks: 10,
  seed: 1,
  ...o,
});

const aStartX = (r: Rules): number =>
  Math.trunc((r.ring.width - r.startGap) / 2);

const bStartX = (r: Rules): number =>
  Math.trunc((r.ring.width + r.startGap) / 2);

describe("runFight — loop and result", () => {
  it("runs exactly maxTicks and returns a draw with a full event log", () => {
    const result = runFight(getMockConfig({ maxTicks: 10 }));
    expect(result.ticks).toBe(10);
    expect(result.events).toHaveLength(10);
    expect(result.winner).toBe("draw");
    expect(result.events[0].tick).toBe(0);
    expect(result.events[9].tick).toBe(9);
  });

  it("records both fighters' chosen actions each tick", () => {
    const result = runFight(
      getMockConfig({ botA: AGGRESSOR, botB: IDLE, maxTicks: 1 }),
    );

    expect(result.events[0].a.action).toEqual({ type: "move", dir: 1 });
    expect(result.events[0].b.action).toEqual({ type: "idle" });
  });
});

describe("runFight — determinism and replay", () => {
  it("produces byte-identical event logs for the same config", () => {
    const cfg = getMockConfig({ maxTicks: 25 });
    const first = runFight(cfg);
    const second = runFight(cfg);
    expect(first.events).toEqual(second.events);
    expect(JSON.stringify(first.events)).toBe(JSON.stringify(second.events));
  });

  it("keeps every position an integer (no floats in the outcome path)", () => {
    const result = runFight(getMockConfig({ maxTicks: 30 }));

    for (const e of result.events) {
      expect(Number.isInteger(e.a.x)).toBe(true);
      expect(Number.isInteger(e.b.x)).toBe(true);
    }
  });
});

describe("runFight — movement", () => {
  it("advances a moving fighter by walkSpeed toward the opponent", () => {
    const rules = getMockRules();

    const result = runFight(
      getMockConfig({ rules, botA: AGGRESSOR, botB: IDLE, maxTicks: 1 }),
    );

    expect(result.events[0].a.x).toBe(aStartX(rules) + rules.walkSpeed);
  });

  it("leaves an idle fighter in place", () => {
    const rules = getMockRules();

    const result = runFight(
      getMockConfig({ rules, botA: AGGRESSOR, botB: IDLE, maxTicks: 1 }),
    );

    expect(result.events[0].b.x).toBe(bStartX(rules));
  });

  it("clamps movement at the left ring edge", () => {
    const rules = getMockRules();

    const result = runFight(
      getMockConfig({ rules, botA: RETREATER, botB: IDLE, maxTicks: 60 }),
    );

    const last = result.events[result.events.length - 1];
    expect(last.a.x).toBe(0);
  });

  it("clamps movement at the right ring edge", () => {
    const rules = getMockRules();

    const result = runFight(
      getMockConfig({ rules, botA: IDLE, botB: RETREATER, maxTicks: 60 }),
    );

    const last = result.events[result.events.length - 1];
    expect(last.b.x).toBe(rules.ring.width);
  });
});

describe("runFight — same pre-tick snapshot", () => {
  it("decides both fighters against the pre-tick snapshot (no intra-tick leakage)", () => {
    const rules = getMockRules();

    // mirror acts only if the opponent's distance equals the *starting* gap.
    const mirror = bot(
      [
        {
          when: {
            op: "eq",
            args: [
              { op: "field", path: "opponent.distance" },
              { op: "const", value: rules.startGap },
            ],
          },
          do: { type: "move", dir: 1 },
        },
      ],
      { type: "idle" },
    );

    const result = runFight(
      getMockConfig({ rules, botA: AGGRESSOR, botB: mirror, maxTicks: 1 }),
    );

    // On tick 0 the pre-tick distance is exactly startGap, so mirror acts. Had it
    // seen A's post-move distance it would have idled.
    expect(result.events[0].b.action).toEqual({ type: "move", dir: 1 });
  });
});

describe("runFight — view wiring and memory", () => {
  it("seeds a bot's memory from its declared cells", () => {
    const armed: BotDoc = {
      version: 1,
      name: "armed",
      memory: { go: 1 },
      rules: [
        {
          when: {
            op: "eq",
            args: [
              { op: "mem", cell: "go" },
              { op: "const", value: 1 },
            ],
          },
          do: { type: "move", dir: 1 },
        },
      ],
      default: { type: "idle" },
    };

    const result = runFight(
      getMockConfig({ botA: armed, botB: IDLE, maxTicks: 1 }),
    );

    expect(result.events[0].a.action).toEqual({ type: "move", dir: 1 });
  });

  it("breaks a facing tie toward +1 when fighters share a position", () => {
    const rules = getMockRules({ startGap: 0 });
    const center = Math.trunc(rules.ring.width / 2);

    const result = runFight(
      getMockConfig({ rules, botA: AGGRESSOR, botB: IDLE, maxTicks: 1 }),
    );

    expect(result.events[0].a.x).toBe(center + rules.walkSpeed);
  });

  it("populates self, ring, and clock fields in the per-tick view", () => {
    const rules = getMockRules();
    const start = aStartX(rules);

    const diag = bot(
      [
        {
          when: {
            op: "and",
            args: [
              {
                op: "eq",
                args: [
                  { op: "field", path: "self.x" },
                  { op: "const", value: start },
                ],
              },
              {
                op: "eq",
                args: [
                  { op: "field", path: "ring.width" },
                  { op: "const", value: rules.ring.width },
                ],
              },
              {
                op: "eq",
                args: [
                  { op: "field", path: "self.canAct" },
                  { op: "const", value: 1 },
                ],
              },
              {
                op: "eq",
                args: [
                  { op: "field", path: "clock.tick" },
                  { op: "const", value: 0 },
                ],
              },
            ],
          },
          do: { type: "move", dir: 1 },
        },
      ],
      { type: "idle" },
    );

    const result = runFight(
      getMockConfig({ rules, botA: diag, botB: IDLE, maxTicks: 1 }),
    );

    expect(result.events[0].a.action).toEqual({ type: "move", dir: 1 });
  });

  it("derives ticksRemaining as maxTicks minus the current tick", () => {
    const endBot = bot(
      [
        {
          when: {
            op: "eq",
            args: [
              { op: "field", path: "clock.ticksRemaining" },
              { op: "const", value: 1 },
            ],
          },
          do: { type: "move", dir: 1 },
        },
      ],
      { type: "idle" },
    );

    const result = runFight(
      getMockConfig({ botA: endBot, botB: IDLE, maxTicks: 3 }),
    );

    expect(result.events[0].a.action).toEqual({ type: "idle" });
    expect(result.events[2].a.action).toEqual({ type: "move", dir: 1 });
  });
});

describe("runFight — strikes and scoring", () => {
  const ATTACKER = bot([], { type: "attack", move: "strike", band: "mid" }); // strike every tick

  it("scores when an active strike reaches an idle opponent in range", () => {
    const rules = getMockRules({ startGap: 200000 }); // within reach (250000)

    const result = runFight(
      getMockConfig({ rules, botA: ATTACKER, botB: IDLE, maxTicks: 12 }),
    );

    expect(result.scores).toEqual({ a: 1, b: 0 });
    expect(result.winner).toBe("A");
  });

  it("does not score a strike thrown out of range (whiff)", () => {
    const rules = getMockRules({ startGap: 300000 }); // beyond reach

    const result = runFight(
      getMockConfig({ rules, botA: ATTACKER, botB: IDLE, maxTicks: 12 }),
    );

    expect(result.scores).toEqual({ a: 0, b: 0 });
    expect(result.winner).toBe("draw");
  });

  it("scores at exactly the reach boundary but not one sub-unit beyond", () => {
    const reach = getMockRules().moves.strike.reach;

    const atEdge = runFight(
      getMockConfig({
        rules: getMockRules({ startGap: reach }),
        botA: ATTACKER,
        botB: IDLE,
        maxTicks: 12,
      }),
    );

    const beyond = runFight(
      getMockConfig({
        rules: getMockRules({ startGap: reach + 1 }),
        botA: ATTACKER,
        botB: IDLE,
        maxTicks: 12,
      }),
    );

    expect(atEdge.scores.a).toBe(1);
    expect(beyond.scores.a).toBe(0);
  });

  it("scores at most once per activation (a multi-tick active window counts once)", () => {
    const rules = getMockRules({ startGap: 200000 });

    const result = runFight(
      getMockConfig({ rules, botA: ATTACKER, botB: IDLE, maxTicks: 12 }),
    );

    expect(result.scores.a).toBe(1); // active window is 2 ticks, not 2 points
  });

  it("ignores an action issued while committed and re-triggers only when neutral", () => {
    // ATTACKER returns "attack" every tick, but only the neutral-tick attack starts
    // a move. Over two full 12-tick move cycles it scores exactly twice.
    const rules = getMockRules({ startGap: 200000 });

    const result = runFight(
      getMockConfig({ rules, botA: ATTACKER, botB: IDLE, maxTicks: 24 }),
    );

    expect(result.scores.a).toBe(2);
    // tick 1 is mid-startup (committed): the returned attack is logged but starts nothing.
    expect(result.events[1].a.action).toEqual({
      type: "attack",
      move: "strike",
      band: "mid",
    });
    expect(result.events[1].a.points).toBe(0);
  });

  it("awards the win to whoever has more points", () => {
    const rules = getMockRules({ startGap: 200000 });

    const result = runFight(
      getMockConfig({ rules, botA: IDLE, botB: ATTACKER, maxTicks: 12 }),
    );

    expect(result.scores).toEqual({ a: 0, b: 1 });
    expect(result.winner).toBe("B");
  });

  it("declares a draw when neither fighter scores", () => {
    const rules = getMockRules({ startGap: 200000 });

    const result = runFight(
      getMockConfig({ rules, botA: IDLE, botB: IDLE, maxTicks: 12 }),
    );

    expect(result.winner).toBe("draw");
  });

  it("scores on the first active frame and re-arms only after a full move", () => {
    const rules = getMockRules({ startGap: 200000 });

    const result = runFight(
      getMockConfig({ rules, botA: ATTACKER, botB: IDLE, maxTicks: 24 }),
    );

    // startup 4 -> first active frame lands the point at tick 4; the move's total
    // is 12 ticks, so the next strike's active frame lands at tick 16.
    expect(result.events[3].a.points).toBe(0);
    expect(result.events[4].a.points).toBe(1);
    expect(result.events[15].a.points).toBe(1);
    expect(result.events[16].a.points).toBe(2);
  });
});

describe("runFight — block and simultaneity", () => {
  const ATTACKER = bot([], { type: "attack", move: "strike", band: "mid" });
  const BLOCKER = bot([], { type: "block", band: "mid" });

  it("a guarding defender negates the strike", () => {
    const rules = getMockRules({ startGap: 200000 }); // within reach

    const result = runFight(
      getMockConfig({ rules, botA: ATTACKER, botB: BLOCKER, maxTicks: 12 }),
    );

    expect(result.scores.a).toBe(0);
  });

  it("negates the strike from either side", () => {
    const rules = getMockRules({ startGap: 200000 });

    const result = runFight(
      getMockConfig({ rules, botA: BLOCKER, botB: ATTACKER, maxTicks: 12 }),
    );

    expect(result.scores.b).toBe(0); // A's guard negates B's strike
  });

  it("a committed fighter cannot also block", () => {
    const rules = getMockRules({ startGap: 200000 });

    // B strikes when neutral, then its block default is moot while committed.
    const attackThenBlock = bot(
      [
        {
          when: {
            op: "eq",
            args: [
              { op: "field", path: "self.canAct" },
              { op: "const", value: 1 },
            ],
          },
          do: { type: "attack", move: "strike", band: "mid" },
        },
      ],
      { type: "block", band: "mid" },
    );

    // Both strike & are active at tick 4; B is mid-move (committed), so its block
    // cannot save it -> A's active frame still lands.
    const result = runFight(
      getMockConfig({
        rules,
        botA: ATTACKER,
        botB: attackThenBlock,
        maxTicks: 12,
      }),
    );

    expect(result.scores.a).toBe(1);
  });

  it("a committed fighter cannot also block (either side)", () => {
    const rules = getMockRules({ startGap: 200000 });

    const attackThenBlock = bot(
      [
        {
          when: {
            op: "eq",
            args: [
              { op: "field", path: "self.canAct" },
              { op: "const", value: 1 },
            ],
          },
          do: { type: "attack", move: "strike", band: "mid" },
        },
      ],
      { type: "block", band: "mid" },
    );

    // Mirror: A is mid-move (committed) and its block default cannot save it ->
    // B's active frame still lands. Guards only the neutral-tick decision.
    const result = runFight(
      getMockConfig({
        rules,
        botA: attackThenBlock,
        botB: ATTACKER,
        maxTicks: 12,
      }),
    );

    expect(result.scores.b).toBe(1);
  });

  it("simultaneous in-range strikes both score (a trade)", () => {
    const rules = getMockRules({ startGap: 200000 });

    const result = runFight(
      getMockConfig({ rules, botA: ATTACKER, botB: ATTACKER, maxTicks: 12 }),
    );

    expect(result.scores).toEqual({ a: 1, b: 1 });
  });

  it("resolves identically regardless of which fighter is A (swap-symmetric)", () => {
    const rules = getMockRules({ startGap: 200000 });

    const original = runFight(
      getMockConfig({ rules, botA: ATTACKER, botB: IDLE, maxTicks: 12 }),
    );

    const swapped = runFight(
      getMockConfig({ rules, botA: IDLE, botB: ATTACKER, maxTicks: 12 }),
    );

    expect(swapped.scores.a).toBe(original.scores.b);
    expect(swapped.scores.b).toBe(original.scores.a);
    expect(swapped.winner).toBe("B"); // mirror of original "A"
  });
});

describe("runFight — height bands (the guard must match the strike's height)", () => {
  const strikingAt = (band: Band): BotDoc =>
    bot([], { type: "attack", move: "strike", band });

  const guardingAt = (band: Band): BotDoc => bot([], { type: "block", band });

  // A's points after A strikes `attackBand` into B guarding `guardBand`, in reach.
  const scoreOf = (attackBand: Band, guardBand: Band): number =>
    runFight(
      getMockConfig({
        rules: getMockRules({ startGap: 200000 }), // within reach (250000)
        botA: strikingAt(attackBand),
        botB: guardingAt(guardBand),
        maxTicks: 12,
      }),
    ).scores.a;

  it("a high strike beats a mid guard but is stopped by a high guard", () => {
    expect(scoreOf("high", "mid")).toBe(1); // wrong-height guard ⇒ hit
    expect(scoreOf("high", "high")).toBe(0); // matching guard ⇒ blocked
  });

  it("a mid strike beats a high guard but is stopped by a mid guard", () => {
    expect(scoreOf("mid", "high")).toBe(1);
    expect(scoreOf("mid", "mid")).toBe(0);
  });

  it("a low strike beats a mid guard but is stopped by a low guard", () => {
    expect(scoreOf("low", "mid")).toBe(1);
    expect(scoreOf("low", "low")).toBe(0);
  });

  it("hits an open (non-guarding) defender regardless of the strike's band", () => {
    const open = (band: Band): number =>
      runFight(
        getMockConfig({
          rules: getMockRules({ startGap: 200000 }),
          botA: strikingAt(band),
          botB: IDLE,
          maxTicks: 12,
        }),
      ).scores.a;

    expect(open("high")).toBe(1);
    expect(open("mid")).toBe(1);
    expect(open("low")).toBe(1);
  });

  it("two simultaneous strikes at different heights both score (both open)", () => {
    const result = runFight(
      getMockConfig({
        rules: getMockRules({ startGap: 200000 }),
        botA: strikingAt("high"),
        botB: strikingAt("low"),
        maxTicks: 12,
      }),
    );

    expect(result.scores).toEqual({ a: 1, b: 1 });
  });

  // A guard comes only from a `block` action. A fighter that, on its free tick,
  // *attacks* at the same band as an incoming active strike does NOT block it —
  // attacking is open (it cannot guard). Asserted from both sides so neither
  // fighter's guard-band derivation may treat an attack as a guard.
  const strikeHighAtTick4 = bot(
    [
      {
        when: {
          op: "eq",
          args: [
            { op: "field", path: "clock.tick" },
            { op: "const", value: 4 },
          ],
        },
        do: { type: "attack", move: "strike", band: "high" },
      },
    ],
    { type: "idle" },
  );

  it("a defender that attacks (not blocks) at the strike's band is still hit — A side", () => {
    // B strikes high (active ticks 4–5); A is neutral at tick 4 and attacks high.
    // A's attack must NOT act as a high guard, so B's hit lands on tick 4. (If the
    // attack wrongly guarded, B would be blocked at tick 4 and only land on tick 5
    // once A is committed — so we assert the score at tick 4, not the total.)
    const result = runFight(
      getMockConfig({
        rules: getMockRules({ startGap: 200000 }),
        botA: strikeHighAtTick4,
        botB: strikingAt("high"),
        maxTicks: 6,
      }),
    );

    expect(result.events[4].b.points).toBe(1);
  });

  it("a defender that attacks (not blocks) at the strike's band is still hit — B side", () => {
    const result = runFight(
      getMockConfig({
        rules: getMockRules({ startGap: 200000 }),
        botA: strikingAt("high"),
        botB: strikeHighAtTick4,
        maxTicks: 6,
      }),
    );

    expect(result.events[4].a.points).toBe(1);
  });
});

describe("runFight — vertical occupancy (a croucher vacates the high band)", () => {
  const strikingAt = (band: Band): BotDoc =>
    bot([], { type: "attack", move: "strike", band });

  const CROUCHER = bot([], { type: "crouch" }); // a grounded posture, held every tick

  const rules = getMockRules({ startGap: 200000 }); // within reach (250000)

  // A's points after A strikes `band` into the given defender, in reach.
  const scoreVs = (band: Band, defender: BotDoc): number =>
    runFight(
      getMockConfig({
        rules,
        botA: strikingAt(band),
        botB: defender,
        maxTicks: 12,
      }),
    ).scores.a;

  it("a high strike whiffs a croucher but lands on a stander", () => {
    expect(scoreVs("high", CROUCHER)).toBe(0); // crouch vacates high ⇒ the strike sails over
    expect(scoreVs("high", IDLE)).toBe(1); // a stander occupies high ⇒ hit
  });

  it("a croucher still occupies mid and low (only high is vacated)", () => {
    expect(scoreVs("mid", CROUCHER)).toBe(1);
    expect(scoreVs("low", CROUCHER)).toBe(1);
  });

  it("crouch is a posture, not a guard: a mid strike hits a croucher where a mid block negates it", () => {
    const midBlocker = bot([], { type: "block", band: "mid" });
    expect(scoreVs("mid", CROUCHER)).toBe(1); // croucher is open at mid
    expect(scoreVs("mid", midBlocker)).toBe(0); // a guard at mid negates the strike
  });

  it("a committed fighter cannot crouch: its crouch does not vacate high (the strike lands)", () => {
    // Crouch is a free-to-act posture (mirrors C3's "a committed fighter cannot
    // also block"). B commits to a move on its neutral tick, then returns `crouch`
    // while committed — but a committed fighter stands, so A's high strike (active
    // while B is mid-move) is NOT ducked.
    const attackThenCrouch = bot(
      [
        {
          when: {
            op: "eq",
            args: [
              { op: "field", path: "self.canAct" },
              { op: "const", value: 1 },
            ],
          },
          do: { type: "attack", move: "strike", band: "high" },
        },
      ],
      { type: "crouch" },
    );

    const result = runFight(
      getMockConfig({
        rules,
        botA: strikingAt("high"),
        botB: attackThenCrouch,
        maxTicks: 6,
      }),
    );

    expect(result.scores.a).toBe(1);
  });

  it("resolves crouch occupancy identically from either slot (swap-symmetric)", () => {
    const croucherAsB = runFight(
      getMockConfig({
        rules,
        botA: strikingAt("high"),
        botB: CROUCHER,
        maxTicks: 12,
      }),
    );

    const croucherAsA = runFight(
      getMockConfig({
        rules,
        botA: CROUCHER,
        botB: strikingAt("high"),
        maxTicks: 12,
      }),
    );

    expect(croucherAsB.scores.a).toBe(0); // striker (A) whiffs the croucher (B)
    expect(croucherAsA.scores.b).toBe(0); // striker (B) whiffs the croucher (A)
  });
});

describe("runFight — vertical axis (the jump arc)", () => {
  // jumpImpulse 12000, gravity 4000 ⇒ the arc rises and returns to exactly 0:
  // y += vy; vy -= gravity each tick ⇒ 12000, 20000, 24000, 24000, 20000, 12000, 0.
  const jumpRules = getMockRules({ jumpImpulse: 12000, gravity: 4000 });

  // A bot that issues `action` whenever free to act (neutral), else idles.
  const onNeutral = (action: Action): BotDoc =>
    bot(
      [
        {
          when: {
            op: "eq",
            args: [
              { op: "field", path: "self.canAct" },
              { op: "const", value: 1 },
            ],
          },
          do: action,
        },
      ],
      { type: "idle" },
    );

  it("launches a deterministic integer gravity arc that returns to exactly y=0", () => {
    const result = runFight(
      getMockConfig({
        rules: jumpRules,
        botA: onNeutral({ type: "jump", dir: 0 }),
        botB: IDLE,
        maxTicks: 8,
      }),
    );

    // up to a held apex, back down, land at tick 6, then re-arm and jump again.
    expect(result.events.map((e) => e.a.y)).toEqual([
      12000, 20000, 24000, 24000, 20000, 12000, 0, 12000,
    ]);
  });

  it("keeps every y an integer (no floats in the vertical outcome path)", () => {
    const result = runFight(
      getMockConfig({
        rules: jumpRules,
        botA: onNeutral({ type: "jump", dir: 0 }),
        botB: IDLE,
        maxTicks: 20,
      }),
    );

    for (const e of result.events) expect(Number.isInteger(e.a.y)).toBe(true);
  });

  it("is committed while airborne: a returned move is ignored until it lands", () => {
    // A jumps on its neutral tick; its default `move` would advance x, but while
    // airborne it is committed (canAct=0), so x does not change mid-air.
    const jumpThenMove = bot(
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
      { type: "move", dir: 1 },
    );

    const result = runFight(
      getMockConfig({
        rules: jumpRules,
        botA: jumpThenMove,
        botB: IDLE,
        maxTicks: 6,
      }),
    );

    const startX = aStartX(jumpRules);
    expect(result.events[3].a.y).toBeGreaterThan(0); // mid-air at tick 3
    expect(result.events[3].a.x).toBe(startX); // move ignored ⇒ x unchanged
    expect(result.events[5].a.x).toBe(startX);
  });

  it("leaves y at 0 for a fighter that never jumps", () => {
    const result = runFight(
      getMockConfig({
        rules: jumpRules,
        botA: AGGRESSOR,
        botB: IDLE,
        maxTicks: 10,
      }),
    );

    for (const e of result.events) {
      expect(e.a.y).toBe(0);
      expect(e.b.y).toBe(0);
    }
  });
});
