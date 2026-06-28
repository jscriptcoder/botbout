import { describe, it, expect } from "vitest";
import { runFight, type FightConfig } from "./sim.js";
import type { BotDoc, BoolExpr, FieldPath } from "./dsl.js";
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

describe("runFight — airborne occupancy (a jumper vacates the low band)", () => {
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

  // jumpImpulse 12000 / gravity 4000 ⇒ the arc holds its apex at y=24000; the
  // striker's single active frame (startup 4, active 1) resolves on the tick the
  // defender sits at exactly 24000, so the sweep meets a defender at that height.
  const sweepRules = (lowClearance?: number): Rules =>
    getMockRules({
      jumpImpulse: 12000,
      gravity: 4000,
      startGap: 200000, // within reach (250000)
      lowClearance,
      moves: {
        strike: { startup: 4, active: 1, recovery: 6, score: 1, reach: 250000 },
      },
    });

  // A strikes `band` into a jumper (B jumps at tick 0); report A's score.
  const sweepScore = (band: Band, lowClearance?: number): number =>
    runFight(
      getMockConfig({
        rules: sweepRules(lowClearance),
        botA: bot([], { type: "attack", move: "strike", band }),
        botB: jumpWhenFree,
        maxTicks: 8,
      }),
    ).scores.a;

  it("a low strike (sweep) whiffs an airborne fighter at/above clearance, but mid and high connect (anti-air)", () => {
    expect(sweepScore("low", 24000)).toBe(0); // the sweep passes under the jumper
    expect(sweepScore("mid", 24000)).toBe(1); // mid still occupied ⇒ anti-air lands
    expect(sweepScore("high", 24000)).toBe(1); // high still occupied ⇒ anti-air lands
  });

  it("the boundary is y ≥ lowClearance: a sweep lands when the jumper is just below clearance", () => {
    // Same geometry (defender at y=24000), threshold one sub-unit higher ⇒ low is
    // still occupied ⇒ the sweep connects. Pins `>=` (not `>`) — the timing window.
    expect(sweepScore("low", 24001)).toBe(1);
  });

  it("with no lowClearance an airborne fighter is hittable everywhere (byte-identical to the pre-vacate engine)", () => {
    expect(sweepScore("low")).toBe(1); // absent ⇒ low never vacated ⇒ sweep lands
  });

  it("resolves airborne occupancy identically from either slot (swap-symmetric)", () => {
    const striker = bot([], { type: "attack", move: "strike", band: "low" });

    const jumperAsB = runFight(
      getMockConfig({
        rules: sweepRules(24000),
        botA: striker,
        botB: jumpWhenFree,
        maxTicks: 8,
      }),
    );

    const jumperAsA = runFight(
      getMockConfig({
        rules: sweepRules(24000),
        botA: jumpWhenFree,
        botB: striker,
        maxTicks: 8,
      }),
    );

    expect(jumperAsB.scores.a).toBe(0); // striker (A) whiffs the airborne defender (B)
    expect(jumperAsA.scores.b).toBe(0); // striker (B) whiffs the airborne defender (A)
  });
});

describe("runFight — parry windows (a freshly-raised matching guard deflects the attacker)", () => {
  // A defender that raises a `band` guard from tick `from` onward (open/idle before).
  // The guard's *age* at any tick is how many consecutive ticks it has been held, so
  // starting later means a fresher guard when the strike's active frame arrives.
  const guardFrom = (from: number, band: Band): BotDoc =>
    bot(
      [
        {
          when: {
            op: "gte",
            args: [
              { op: "field", path: "clock.tick" },
              { op: "const", value: from },
            ],
          },
          do: { type: "block", band },
        },
      ],
      { type: "idle" },
    );

  // A bot that strikes `band` whenever free to act — so it re-strikes the instant its
  // move (and any parry-extended recovery) ends; idles while committed.
  const restrikeWhenFree = (band: Band): BotDoc =>
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
          do: { type: "attack", move: "strike", band },
        },
      ],
      { type: "idle" },
    );

  // The ticks on which `side` started a fresh move — for restrikeWhenFree these are
  // exactly its neutral ticks, so the gap between them is its recovery length.
  const attackTicks = (
    events: { a: { action: Action }; b: { action: Action } }[],
    side: "a" | "b",
  ): number[] =>
    events.flatMap((e, t) => (e[side].action.type === "attack" ? [t] : []));

  // Default strike: startup 4, active 2 ⇒ its first active frame lands at tick 4; total
  // 12 ticks. parryWindow 2 (guard-age 1–2 parries); parryRecovery 8 ⇒ a parried move
  // runs 20 ticks, so the attacker's next strike starts 8 ticks later than after a block.
  const parryRules = (o: Partial<Rules> = {}): Rules =>
    getMockRules({ startGap: 200000, parryWindow: 2, parryRecovery: 8, ...o });

  it("a fresh matching guard parries: the attacker is thrown into extra recovery", () => {
    const result = runFight(
      getMockConfig({
        rules: parryRules(),
        botA: restrikeWhenFree("mid"), // strike active at tick 4
        botB: guardFrom(4, "mid"), // guard raised at tick 4 ⇒ age 1 (within window) ⇒ PARRY
        maxTicks: 24,
      }),
    );

    // Parry ⇒ no score AND +8 recovery ⇒ the move runs 20 ticks ⇒ next strike at tick 20.
    expect(attackTicks(result.events, "a")).toEqual([0, 20]);
    expect(result.scores.a).toBe(0); // deflected, never scored
  });

  it("the same guard held past the window only blocks: the attacker recovers normally", () => {
    const result = runFight(
      getMockConfig({
        rules: parryRules(),
        botA: restrikeWhenFree("mid"),
        botB: guardFrom(0, "mid"), // held since tick 0 ⇒ age 5 at tick 4 (past window) ⇒ BLOCK
        maxTicks: 24,
      }),
    );

    // Block ⇒ no extra recovery ⇒ normal 12-tick move ⇒ next strike at tick 12.
    expect(attackTicks(result.events, "a")).toEqual([0, 12]);
    expect(result.scores.a).toBe(0);
  });

  it("the parry window boundary is guard-age ≤ parryWindow", () => {
    // The strike is active at tick 4, so a guard raised at tick `from` has age 5 − from.
    const secondStrikeTick = (from: number): number =>
      attackTicks(
        runFight(
          getMockConfig({
            rules: parryRules(), // parryWindow 2
            botA: restrikeWhenFree("mid"),
            botB: guardFrom(from, "mid"),
            maxTicks: 24,
          }),
        ).events,
        "a",
      )[1];

    expect(secondStrikeTick(3)).toBe(20); // age 2 == parryWindow ⇒ PARRY (extra recovery)
    expect(secondStrikeTick(2)).toBe(12); // age 3 == parryWindow + 1 ⇒ BLOCK (normal recovery)
  });

  it("resolves the parry identically from either slot (swap-symmetric)", () => {
    const attacker = restrikeWhenFree("mid");
    const defender = guardFrom(4, "mid");

    const asA = runFight(
      getMockConfig({
        rules: parryRules(),
        botA: attacker,
        botB: defender,
        maxTicks: 24,
      }),
    ).events;

    const asB = runFight(
      getMockConfig({
        rules: parryRules(),
        botA: defender,
        botB: attacker,
        maxTicks: 24,
      }),
    ).events;

    // The attacker's parry-extended recovery is slot-independent: its 2nd strike lands
    // at tick 20 whether it is fighter A or fighter B.
    expect(attackTicks(asA, "a")).toEqual([0, 20]);
    expect(attackTicks(asB, "b")).toEqual([0, 20]);
  });

  it("with no parry config a matching guard only blocks (byte-identical to the pre-parry engine)", () => {
    const result = runFight(
      getMockConfig({
        rules: getMockRules({ startGap: 200000 }), // no parryWindow / parryRecovery
        botA: restrikeWhenFree("mid"),
        botB: guardFrom(4, "mid"), // a fresh matching guard, but parry is unconfigured
        maxTicks: 24,
      }),
    );

    // Inert ⇒ the fresh matching guard just blocks ⇒ normal recovery ⇒ next strike at tick 12.
    expect(attackTicks(result.events, "a")).toEqual([0, 12]);
  });

  it("a parried strike resolves once: it does not re-connect later in its active window if the guard drops", () => {
    // The strike is active for two ticks (4 and 5). The defender raises a fresh mid
    // guard only on tick 4 (parry), then opens on tick 5. The deflect must consume the
    // strike, so the open tick-5 frame does NOT land a hit.
    const guardOnlyAtTick4 = bot(
      [
        {
          when: {
            op: "eq",
            args: [
              { op: "field", path: "clock.tick" },
              { op: "const", value: 4 },
            ],
          },
          do: { type: "block", band: "mid" },
        },
      ],
      { type: "idle" },
    );

    const result = runFight(
      getMockConfig({
        rules: parryRules(), // default strike is active 2 ticks (4 & 5)
        botA: restrikeWhenFree("mid"),
        botB: guardOnlyAtTick4,
        maxTicks: 8,
      }),
    );

    expect(result.scores.a).toBe(0); // deflected on tick 4 ⇒ no late hit on tick 5
  });

  it("a guard freshly switched to the attack's band parries (the window measures continuous same-band hold)", () => {
    // The defender holds a low guard (wrong band) through tick 3, then switches to mid
    // exactly as the strike turns active at tick 4. Switching bands resets the guard's
    // age to 1, so the mid guard is fresh ⇒ PARRY (not a stale block).
    const switchToMidAtTick4 = bot(
      [
        {
          when: {
            op: "lt",
            args: [
              { op: "field", path: "clock.tick" },
              { op: "const", value: 4 },
            ],
          },
          do: { type: "block", band: "low" },
        },
        {
          when: {
            op: "gte",
            args: [
              { op: "field", path: "clock.tick" },
              { op: "const", value: 4 },
            ],
          },
          do: { type: "block", band: "mid" },
        },
      ],
      { type: "idle" },
    );

    const result = runFight(
      getMockConfig({
        rules: parryRules(),
        botA: restrikeWhenFree("mid"),
        botB: switchToMidAtTick4,
        maxTicks: 24,
      }),
    );

    // Fresh switched-to guard ⇒ parry ⇒ +8 recovery ⇒ next strike at tick 20 (not 12).
    expect(attackTicks(result.events, "a")).toEqual([0, 20]);
  });
});

describe("runFight — parry counter window (the deflect pays off)", () => {
  // Strikes mid every neutral tick; struck once at tick 0, it is parried at tick 4 and
  // stays committed (parryRecovery 8 ⇒ open through tick 19), a hittable target.
  const STRIKER = bot([], { type: "attack", move: "strike", band: "mid" });

  // Parries a mid strike (fresh mid guard at tick 4), then throws a counter mid strike
  // at tick 5 — its active frame lands at tick 9, while the parried attacker is still
  // committed/open. The counter scores the bonus iff the window is still open then.
  const parryThenCounter = bot(
    [
      {
        when: {
          op: "eq",
          args: [
            { op: "field", path: "clock.tick" },
            { op: "const", value: 4 },
          ],
        },
        do: { type: "block", band: "mid" },
      },
      {
        when: {
          op: "eq",
          args: [
            { op: "field", path: "clock.tick" },
            { op: "const", value: 5 },
          ],
        },
        do: { type: "attack", move: "strike", band: "mid" },
      },
    ],
    { type: "idle" },
  );

  // Base strike scores 1; the counter adds counterBonus 2. The counter strike connects
  // at tick 9, by which point the window (set on the tick-4 parry, decremented each
  // tick) has lost 5 ticks — so it is still open iff counterWindow ≥ 6.
  const counterRules = (counterWindow?: number): Rules =>
    getMockRules({
      startGap: 200000, // within reach (250000)
      parryWindow: 2,
      parryRecovery: 8,
      counterWindow,
      counterBonus: 2,
    });

  it("a counter strike landing in the open window scores the bonus", () => {
    const result = runFight(
      getMockConfig({
        rules: counterRules(10), // window wide open at the tick-9 connect
        botA: STRIKER,
        botB: parryThenCounter,
        maxTicks: 12,
      }),
    );

    expect(result.scores).toEqual({ a: 0, b: 3 }); // base 1 + counterBonus 2
  });

  it("the counter window has a pinned length: open at counterWindow 6, expired at 5 (either slot)", () => {
    // The parrying fighter occupies `slot`; report its score. Asserted from both slots
    // so the per-fighter counter-window countdown is pinned on each side.
    const counterScore = (counterWindow: number, slot: "a" | "b"): number =>
      runFight(
        getMockConfig({
          rules: counterRules(counterWindow),
          botA: slot === "a" ? parryThenCounter : STRIKER,
          botB: slot === "b" ? parryThenCounter : STRIKER,
          maxTicks: 12,
        }),
      ).scores[slot];

    expect(counterScore(6, "b")).toBe(3); // window still open at tick 9 ⇒ base + bonus
    expect(counterScore(5, "b")).toBe(1); // window expired by tick 9 ⇒ base only
    expect(counterScore(6, "a")).toBe(3); // same countdown when the counter is fighter A
    expect(counterScore(5, "a")).toBe(1);
  });

  it("with no counter config a connecting counter scores base only (byte-identical to slice 1)", () => {
    const result = runFight(
      getMockConfig({
        rules: getMockRules({
          startGap: 200000,
          parryWindow: 2,
          parryRecovery: 8,
        }), // parry but no counterWindow / counterBonus
        botA: STRIKER,
        botB: parryThenCounter,
        maxTicks: 12,
      }),
    );

    expect(result.scores).toEqual({ a: 0, b: 1 }); // parry deflect, but no counter bonus
  });

  it("resolves the counter identically from either slot (swap-symmetric)", () => {
    const asB = runFight(
      getMockConfig({
        rules: counterRules(10),
        botA: STRIKER,
        botB: parryThenCounter,
        maxTicks: 12,
      }),
    );

    const asA = runFight(
      getMockConfig({
        rules: counterRules(10),
        botA: parryThenCounter,
        botB: STRIKER,
        maxTicks: 12,
      }),
    );

    // The parrying fighter earns base + bonus whichever slot it occupies; the deflected
    // striker scores nothing.
    expect(asB.scores).toEqual({ a: 0, b: 3 });
    expect(asA.scores).toEqual({ a: 3, b: 0 });
  });

  // Parries at tick 4, then throws its counter purely by READING self.counterWindow —
  // it attacks only while its window is open (no hard-coded counter tick).
  const counterGatedBot = bot(
    [
      {
        when: {
          op: "eq",
          args: [
            { op: "field", path: "clock.tick" },
            { op: "const", value: 4 },
          ],
        },
        do: { type: "block", band: "mid" },
      },
      {
        when: {
          op: "gt",
          args: [
            { op: "field", path: "self.counterWindow" },
            { op: "const", value: 0 },
          ],
        },
        do: { type: "attack", move: "strike", band: "mid" },
      },
    ],
    { type: "idle" },
  );

  it("a bot reads its live self.counterWindow and fires the counter after a parry", () => {
    const result = runFight(
      getMockConfig({
        rules: counterRules(10),
        botA: STRIKER,
        botB: counterGatedBot,
        maxTicks: 12,
      }),
    );

    // The window opens on the tick-4 parry; the self.counterWindow > 0 rule then fires
    // the counter, which lands for base + bonus.
    expect(result.scores).toEqual({ a: 0, b: 3 });
  });

  it("the self.counterWindow gate reads 0 with no parry, so the counter never fires", () => {
    const result = runFight(
      getMockConfig({
        rules: counterRules(10),
        botA: counterGatedBot,
        botB: IDLE, // nothing to parry ⇒ the window never opens ⇒ self.counterWindow stays 0
        maxTicks: 12,
      }),
    );

    expect(result.scores.a).toBe(0); // gate stays shut ⇒ no counter thrown
  });
});

describe("runFight — on-contact cancel combos (a connecting strike can cancel into a follow-up)", () => {
  // A bot that returns `attack` at exactly the given ticks (idle otherwise), so its
  // move-starts and cancel attempts land at known, bounded ticks. The first entry (tick 0)
  // is the opener (started while neutral); a later entry fires while the fighter is still
  // committed — a CANCEL ATTEMPT the engine honours only if the move is cancelable.
  const strikeAtTicks = (ticks: number[], band: Band): BotDoc =>
    bot(
      ticks.map((t) => ({
        when: {
          op: "eq",
          args: [
            { op: "field", path: "clock.tick" },
            { op: "const", value: t },
          ],
        },
        do: { type: "attack", move: "strike", band },
      })),
      { type: "idle" },
    );

  // Crouches (vacating the `high` band) while tick < until, then stands. Used to whiff a
  // high opener during its active frame while standing again later, so a (wrongly enabled)
  // cancelled re-strike WOULD land — proving it does not.
  const crouchUntil = (until: number): BotDoc =>
    bot(
      [
        {
          when: {
            op: "lt",
            args: [
              { op: "field", path: "clock.tick" },
              { op: "const", value: until },
            ],
          },
          do: { type: "crouch" },
        },
      ],
      { type: "idle" },
    );

  // Raises a `band` guard only on ticks [from, until); open otherwise. A fresh guard on the
  // opener's active frame PARRIES it, while being open later so a re-strike could connect.
  const guardWindow = (from: number, until: number, band: Band): BotDoc =>
    bot(
      [
        {
          when: {
            op: "and",
            args: [
              {
                op: "gte",
                args: [
                  { op: "field", path: "clock.tick" },
                  { op: "const", value: from },
                ],
              },
              {
                op: "lt",
                args: [
                  { op: "field", path: "clock.tick" },
                  { op: "const", value: until },
                ],
              },
            ],
          },
          do: { type: "block", band },
        },
      ],
      { type: "idle" },
    );

  // strike: startup 4, active 2 (active frames at elapsed 4–5) ⇒ a fresh opener connects at
  // tick 4; total 12 ticks ⇒ a non-cancelled re-strike could not start before tick 12. The
  // move cancels into itself; cancelWindow 10 is wide (its exact length is pinned separately).
  const cancelRules = (o: Partial<Rules> = {}): Rules =>
    getMockRules({
      startGap: 200000, // within reach (250000)
      cancelWindow: 10,
      moves: {
        strike: {
          startup: 4,
          active: 2,
          recovery: 6,
          score: 1,
          reach: 250000,
          cancelInto: ["strike"],
        },
      },
      ...o,
    });

  it("a connecting (HIT) strike cancels into a follow-up that lands during its recovery", () => {
    // Opener strikes at tick 0 (connects tick 4); a second `attack` at tick 6 (move 1 now in
    // recovery, the cancel window open) cancels into move 2, whose active frame lands at tick
    // 10 — far earlier than a fresh re-strike, which could not start until tick 12 (landing 16).
    const result = runFight(
      getMockConfig({
        rules: cancelRules(),
        botA: strikeAtTicks([0, 6], "mid"),
        botB: IDLE, // open, in range ⇒ both strikes connect
        maxTicks: 16,
      }),
    );

    expect(result.events[10].a.points).toBe(2); // the cancelled 2nd hit has already landed
    expect(result.scores.a).toBe(2); // opener + cancelled follow-up (within-exchange escalation)
  });

  it("a strike that WHIFFS does not become cancelable — the follow-up is ignored", () => {
    // Same opener+cancel-attempt bot, but striking HIGH into a croucher: the opener whiffs (a
    // croucher vacates `high`) on its active frame (ticks 4–5), so no cancel window opens. The
    // opponent stands from tick 6, so a wrongly-enabled cancel's re-strike would hit at tick 10.
    const result = runFight(
      getMockConfig({
        rules: cancelRules(),
        botA: strikeAtTicks([0, 6], "high"),
        botB: crouchUntil(6),
        maxTicks: 16,
      }),
    );

    expect(result.scores.a).toBe(0); // whiffed opener never connected ⇒ no cancel ⇒ no follow-up
  });

  it("a PARRIED strike does not become cancelable — the deflect is not rescued", () => {
    // The opener is parried (a fresh mid guard on its active frame). A parry never opens the
    // cancel window — only a hit does (block arrives in slice 2). The opponent opens from tick
    // 6, so a wrongly-enabled cancel's re-strike would hit at tick 10.
    const result = runFight(
      getMockConfig({
        rules: cancelRules({ parryWindow: 2, parryRecovery: 8 }),
        botA: strikeAtTicks([0, 6], "mid"),
        botB: guardWindow(4, 6, "mid"),
        maxTicks: 16,
      }),
    );

    expect(result.scores.a).toBe(0); // parried ⇒ no cancel ⇒ the tick-6 follow-up is ignored
  });

  it("an empty cancel-route list blocks the cancel even on a clean hit", () => {
    // The opener connects (tick 4) and the window opens, but `strike` lists NO routes, so the
    // tick-6 follow-up is rejected — proving the route membership check is a live gate.
    const result = runFight(
      getMockConfig({
        rules: cancelRules({
          moves: {
            strike: {
              startup: 4,
              active: 2,
              recovery: 6,
              score: 1,
              reach: 250000,
              cancelInto: [],
            },
          },
        }),
        botA: strikeAtTicks([0, 6], "mid"),
        botB: IDLE,
        maxTicks: 16,
      }),
    );

    expect(result.scores.a).toBe(1); // connected, but no legal route ⇒ no cancel ⇒ opener only
  });

  it("with no cancelWindow the follow-up is ignored (byte-identical to the pre-cancel engine)", () => {
    const result = runFight(
      getMockConfig({
        rules: getMockRules({ startGap: 200000 }), // no cancelWindow / cancelInto
        botA: strikeAtTicks([0, 6], "mid"),
        botB: IDLE,
        maxTicks: 16,
      }),
    );

    expect(result.events[10].a.points).toBe(1); // no early 2nd hit
    expect(result.scores.a).toBe(1); // the tick-6 cancel attempt is inert
  });

  it("resolves the cancel identically from either slot (swap-symmetric)", () => {
    const attacker = strikeAtTicks([0, 6], "mid");

    const asA = runFight(
      getMockConfig({
        rules: cancelRules(),
        botA: attacker,
        botB: IDLE,
        maxTicks: 16,
      }),
    );

    const asB = runFight(
      getMockConfig({
        rules: cancelRules(),
        botA: IDLE,
        botB: attacker,
        maxTicks: 16,
      }),
    );

    expect(asA.scores.a).toBe(2);
    expect(asB.scores.b).toBe(2);
  });

  it("the cancel window has a pinned length: open at cancelWindow 5, expired at 4 (either slot)", () => {
    // The opener connects at tick 4; a cancel attempt at tick 8 is honoured iff the window
    // (set to cancelWindow at the connect, decremented each tick) is still open then — i.e.
    // iff cancelWindow ≥ 5. The cancelled follow-up then lands a 2nd hit (score 2). Asserted
    // from both slots so the per-fighter countdown is pinned on each side.
    const cancelScore = (cancelWindow: number, slot: "a" | "b"): number => {
      const attacker = strikeAtTicks([0, 8], "mid");

      return runFight(
        getMockConfig({
          rules: cancelRules({ cancelWindow }),
          botA: slot === "a" ? attacker : IDLE,
          botB: slot === "b" ? attacker : IDLE,
          maxTicks: 16,
        }),
      ).scores[slot];
    };

    expect(cancelScore(5, "a")).toBe(2); // window still open at tick 8 ⇒ cancel ⇒ 2nd hit
    expect(cancelScore(4, "a")).toBe(1); // window expired by tick 8 ⇒ no cancel ⇒ opener only
    expect(cancelScore(5, "b")).toBe(2); // same countdown when the canceller is fighter B
    expect(cancelScore(4, "b")).toBe(1);
  });

  it("a move with no cancel routes cannot cancel, even with a global cancelWindow", () => {
    // The opener connects and the window opens, but `strike` declares no `cancelInto` at all
    // (per-move opt-out), so the tick-6 follow-up is rejected.
    const result = runFight(
      getMockConfig({
        rules: getMockRules({
          startGap: 200000,
          cancelWindow: 10,
          moves: {
            strike: {
              startup: 4,
              active: 2,
              recovery: 6,
              score: 1,
              reach: 250000,
            },
          },
        }),
        botA: strikeAtTicks([0, 6], "mid"),
        botB: IDLE,
        maxTicks: 16,
      }),
    );

    expect(result.scores.a).toBe(1); // connected, window open, but no routes ⇒ no cancel
  });

  // Holds a `band` guard continuously from tick 0 while tick < until (so by the opener's
  // active frame it is STALE ⇒ a block, not a parry), then opens — so a cancelled follow-up
  // can connect on the now-open opponent.
  const guardThenOpen = (until: number, band: Band): BotDoc =>
    bot(
      [
        {
          when: {
            op: "lt",
            args: [
              { op: "field", path: "clock.tick" },
              { op: "const", value: until },
            ],
          },
          do: { type: "block", band },
        },
      ],
      { type: "idle" },
    );

  it("a BLOCKed strike opens the cancel window, but a PARRIED one does not", () => {
    // Opener strikes mid (active ticks 4–5); a tick-6 follow-up attempts a cancel. The defender
    // either holds a STALE mid guard (block) or a FRESH one (parry), then opens at tick 6 so a
    // cancelled follow-up would connect at tick 10.
    const scoreAfter = (defender: BotDoc): number =>
      runFight(
        getMockConfig({
          rules: cancelRules({ parryWindow: 2, parryRecovery: 8 }),
          botA: strikeAtTicks([0, 6], "mid"),
          botB: defender,
          maxTicks: 16,
        }),
      ).scores.a;

    expect(scoreAfter(guardThenOpen(6, "mid"))).toBe(1); // stale guard ⇒ BLOCK ⇒ cancel ⇒ hit
    expect(scoreAfter(guardWindow(4, 6, "mid"))).toBe(0); // fresh guard ⇒ PARRY ⇒ no cancel
  });

  it("with no cancelWindow a BLOCKed strike does not open the window (byte-identical to C5)", () => {
    const result = runFight(
      getMockConfig({
        rules: getMockRules({
          startGap: 200000,
          parryWindow: 2,
          parryRecovery: 8,
        }), // block is configured, but no cancelWindow / cancelInto
        botA: strikeAtTicks([0, 6], "mid"),
        botB: guardThenOpen(6, "mid"),
        maxTicks: 16,
      }),
    );

    expect(result.scores.a).toBe(0); // blocked, but no cancel config ⇒ the follow-up is ignored
  });

  it("resolves the block-cancel identically from either slot (swap-symmetric)", () => {
    const attacker = strikeAtTicks([0, 6], "mid");
    const defender = guardThenOpen(6, "mid");

    const asA = runFight(
      getMockConfig({
        rules: cancelRules({ parryWindow: 2, parryRecovery: 8 }),
        botA: attacker,
        botB: defender,
        maxTicks: 16,
      }),
    ).scores.a;

    const asB = runFight(
      getMockConfig({
        rules: cancelRules({ parryWindow: 2, parryRecovery: 8 }),
        botA: defender,
        botB: attacker,
        maxTicks: 16,
      }),
    ).scores.b;

    expect(asA).toBe(1);
    expect(asB).toBe(1);
  });

  it("a blocked strike does not resolve: a guard dropped mid-active still lets a later frame hit", () => {
    // The strike is active for ticks 4–5. A stale mid guard blocks frame 1 (tick 4); the guard
    // drops on tick 5, so the open frame 2 connects. A block does NOT consume the strike (the
    // inverse of the parry "resolves once" rule) — the C5 behaviour, preserved by opening the
    // cancel window without marking the strike resolved.
    const result = runFight(
      getMockConfig({
        rules: getMockRules({
          startGap: 200000,
          parryWindow: 2,
          parryRecovery: 8,
        }), // no cancel config — the inertness regime
        botA: strikeAtTicks([0], "mid"),
        botB: guardThenOpen(5, "mid"),
        maxTicks: 12,
      }),
    );

    expect(result.scores.a).toBe(1); // frame-2 hit after the drop ⇒ the block did not resolve the strike
  });

  // Strikes when free, then cancels PURELY by reading self.cancelWindow — it throws the
  // follow-up only while its cancel window is open (no hard-coded cancel tick).
  const cancelGatedBot = (band: Band): BotDoc =>
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
          do: { type: "attack", move: "strike", band },
        },
        {
          when: {
            op: "gt",
            args: [
              { op: "field", path: "self.cancelWindow" },
              { op: "const", value: 0 },
            ],
          },
          do: { type: "attack", move: "strike", band },
        },
      ],
      { type: "idle" },
    );

  it("a bot reads its live self.cancelWindow and hit-confirms the cancel", () => {
    const result = runFight(
      getMockConfig({
        rules: cancelRules(),
        botA: cancelGatedBot("mid"),
        botB: IDLE,
        maxTicks: 20,
      }),
    );

    // The window opens on each connect; the self.cancelWindow > 0 rule then cancels into the
    // next strike — chaining hits at ticks 4, 9, 14, 19.
    expect(result.scores.a).toBe(4);
  });

  it("the self.cancelWindow gate reads 0 with no cancel config, so the bot never cancels", () => {
    const result = runFight(
      getMockConfig({
        rules: getMockRules({ startGap: 200000 }), // no cancelWindow ⇒ the window stays 0
        botA: cancelGatedBot("mid"),
        botB: IDLE,
        maxTicks: 20,
      }),
    );

    // Window never opens ⇒ the cancel rule never fires ⇒ it re-strikes only when free (ticks 4, 16).
    expect(result.scores.a).toBe(2);
  });
});

describe("runFight — throws (a throw beats a guard, scores, and knocks down)", () => {
  // Throws every tick; only the neutral-tick throw starts a grab (commitment).
  const THROWER = bot([], { type: "throw" });

  // Throws once at tick 0, then idles — so the thrower stays put while we observe the
  // thrown fighter (no re-grab muddying the knockdown window).
  const throwOnce = bot(
    [
      {
        when: {
          op: "eq",
          args: [
            { op: "field", path: "clock.tick" },
            { op: "const", value: 0 },
          ],
        },
        do: { type: "throw" },
      },
    ],
    { type: "idle" },
  );

  // throw: startup 2, active 1 ⇒ grab-active at elapsed 2 (tick 2 for a throw started at
  // tick 0); recovery 3 ⇒ total 6 ticks. reach matches the strike (250000). A clean grab
  // scores 3 and downs the defender for knockdownDuration ticks.
  const throwRules = (o: Partial<Rules> = {}): Rules =>
    getMockRules({
      startGap: 200000, // within grab reach (250000)
      knockdownDuration: 6,
      throw: { startup: 2, active: 1, recovery: 3, reach: 250000, score: 3 },
      ...o,
    });

  it("connects on an open opponent: scores 3", () => {
    const result = runFight(
      getMockConfig({
        rules: throwRules(),
        botA: throwOnce,
        botB: IDLE,
        maxTicks: 6,
      }),
    );

    expect(result.scores).toEqual({ a: 3, b: 0 });
    expect(result.winner).toBe("A");
  });

  it("beats a guard at any band (throw > guard)", () => {
    const scoreVsGuard = (band: Band): number =>
      runFight(
        getMockConfig({
          rules: throwRules(),
          botA: throwOnce,
          botB: bot([], { type: "block", band }),
          maxTicks: 6,
        }),
      ).scores.a;

    expect(scoreVsGuard("high")).toBe(3);
    expect(scoreVsGuard("mid")).toBe(3);
    expect(scoreVsGuard("low")).toBe(3);
  });

  it("beats a fresh parry-window guard (throw beats parry)", () => {
    // A guard raised on the grab tick (age 1, within the parry window) would DEFLECT a
    // strike — but a throw is not a strike, so the grab still lands for 3.
    const guardFromGrab = bot(
      [
        {
          when: {
            op: "gte",
            args: [
              { op: "field", path: "clock.tick" },
              { op: "const", value: 2 },
            ],
          },
          do: { type: "block", band: "mid" },
        },
      ],
      { type: "idle" },
    );

    const result = runFight(
      getMockConfig({
        rules: throwRules({ parryWindow: 3, parryRecovery: 8 }),
        botA: throwOnce,
        botB: guardFromGrab,
        maxTicks: 6,
      }),
    );

    expect(result.scores.a).toBe(3);
  });

  it("scores on the grab-active frame only (not during startup or recovery)", () => {
    const result = runFight(
      getMockConfig({
        rules: throwRules(),
        botA: throwOnce,
        botB: IDLE,
        maxTicks: 6,
      }),
    );

    expect(result.events[1].a.points).toBe(0); // startup (elapsed 1) — not yet active
    expect(result.events[2].a.points).toBe(3); // grab-active (elapsed 2) — connects
    expect(result.events[5].a.points).toBe(3); // recovery — no second grab
  });

  it("re-throws after recovery: the second grab lands at the throw's full length", () => {
    // throw total = startup 2 + active 1 + recovery 3 = 6; with a short knockdown B is back up
    // by the second grab. THROWER re-throws the instant it is neutral (tick 6), so the second
    // grab connects at tick 8 (6 + startup 2) — pinning the throw's total duration.
    const result = runFight(
      getMockConfig({
        rules: throwRules({ knockdownDuration: 2 }),
        botA: THROWER,
        botB: IDLE,
        maxTicks: 9,
      }),
    );

    expect(result.events[7].a.points).toBe(3); // still only the first grab
    expect(result.events[8].a.points).toBe(6); // second grab lands at exactly tick 8
  });

  it("grabs only within the active window: a defender entering range one tick late is not grabbed", () => {
    // A wider grab window — elapsed [2, 4) ⇒ ticks {2, 3}. B walks toward a stationary thrower,
    // crossing into reach at a tunable tick: entering on tick 3 (last in-window tick) ⇒ grabbed;
    // entering on tick 4 (one tick after the window closes) ⇒ whiff. Pins the window's upper edge.
    const wideThrow = {
      startup: 2,
      active: 2,
      recovery: 3,
      reach: 250000,
      score: 3,
    };

    const scoreEnteringAtGap = (startGap: number): number =>
      runFight(
        getMockConfig({
          rules: throwRules({ startGap, throw: wideThrow }),
          botA: throwOnce, // stationary thrower
          botB: AGGRESSOR, // walks toward A at walkSpeed 4000/tick
          maxTicks: 6,
        }),
      ).scores.a;

    expect(scoreEnteringAtGap(266000)).toBe(3); // in reach by tick 3 (within window) ⇒ grab
    expect(scoreEnteringAtGap(270000)).toBe(0); // in reach only by tick 4 (window closed) ⇒ whiff
  });

  it("whiffs out of range, scoring nothing — at the reach boundary it still grabs", () => {
    const reach = 250000;

    const scoreAtGap = (gap: number): number =>
      runFight(
        getMockConfig({
          rules: throwRules({ startGap: gap }),
          botA: throwOnce,
          botB: IDLE,
          maxTicks: 6,
        }),
      ).scores.a;

    expect(scoreAtGap(reach)).toBe(3); // exactly at reach ⇒ grabs
    expect(scoreAtGap(reach + 1)).toBe(0); // one sub-unit beyond ⇒ whiff
  });

  it("knocks the defender down: its actions are ignored until it recovers, then it acts again", () => {
    // B advances toward A whenever free. Thrown at tick 2 (knockdownDuration 6 ⇒ neutral
    // again at tick 8): its movement is frozen while downed, then resumes.
    const result = runFight(
      getMockConfig({
        rules: throwRules({ knockdownDuration: 6 }),
        botA: throwOnce,
        botB: AGGRESSOR, // moves toward A whenever free
        maxTicks: 10,
      }),
    );

    expect(result.events[7].b.x).toBe(result.events[3].b.x); // downed ticks 3..7 ⇒ frozen
    expect(result.events[8].b.x).not.toBe(result.events[7].b.x); // recovered ⇒ moves again
  });

  it("a downed fighter is not targetable: a strike whiffs while it is down but lands once recovered", () => {
    // A throws B at tick 2, then strikes when free (re-arms at tick 6, strike active at
    // tick 10). A long knockdown leaves B down at tick 10 ⇒ the strike whiffs; a short one
    // lets B recover ⇒ the same strike connects.
    const throwThenStrike = bot(
      [
        {
          when: {
            op: "eq",
            args: [
              { op: "field", path: "clock.tick" },
              { op: "const", value: 0 },
            ],
          },
          do: { type: "throw" },
        },
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
      { type: "idle" },
    );

    const scoreWithKnockdown = (knockdownDuration: number): number =>
      runFight(
        getMockConfig({
          rules: throwRules({ knockdownDuration }),
          botA: throwThenStrike,
          botB: IDLE,
          maxTicks: 12,
        }),
      ).scores.a;

    expect(scoreWithKnockdown(10)).toBe(3); // still down at tick 10 ⇒ strike whiffs ⇒ throw only
    expect(scoreWithKnockdown(2)).toBe(4); // recovered by tick 10 ⇒ strike connects ⇒ throw + hit
  });

  it("cannot grab an airborne fighter (you can't throw a jumper), but grabs a grounded one", () => {
    const jumpRules = throwRules({ jumpImpulse: 12000, gravity: 4000 });

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

    const airborne = runFight(
      getMockConfig({
        rules: jumpRules,
        botA: throwOnce,
        botB: jumpWhenFree, // mid-arc at the grab tick
        maxTicks: 6,
      }),
    ).scores.a;

    const grounded = runFight(
      getMockConfig({
        rules: jumpRules,
        botA: throwOnce,
        botB: IDLE,
        maxTicks: 6,
      }),
    ).scores.a;

    expect(airborne).toBe(0); // a jumper cannot be grabbed
    expect(grounded).toBe(3); // a grounded defender is grabbed
  });

  it("grabs a crouching fighter — crouch does not dodge a throw (grounded, unbanded grab)", () => {
    const CROUCHER = bot([], { type: "crouch" });

    const result = runFight(
      getMockConfig({
        rules: throwRules(),
        botA: throwOnce,
        botB: CROUCHER,
        maxTicks: 6,
      }),
    );

    expect(result.scores.a).toBe(3);
  });

  it("resolves identically regardless of which fighter throws (swap-symmetric)", () => {
    const asA = runFight(
      getMockConfig({
        rules: throwRules(),
        botA: throwOnce,
        botB: IDLE,
        maxTicks: 6,
      }),
    );

    const asB = runFight(
      getMockConfig({
        rules: throwRules(),
        botA: IDLE,
        botB: throwOnce,
        maxTicks: 6,
      }),
    );

    expect(asA.scores).toEqual({ a: 3, b: 0 });
    expect(asB.scores).toEqual({ a: 0, b: 3 });
  });

  it("with no throw config the throw action is inert (byte-identical to the pre-throw engine)", () => {
    const rules = getMockRules({ startGap: 200000 }); // no throw / knockdownDuration

    const result = runFight(
      getMockConfig({ rules, botA: THROWER, botB: IDLE, maxTicks: 6 }),
    );

    expect(result.scores).toEqual({ a: 0, b: 0 });
    // Never committed, never moved — the throw spam does nothing.
    for (const e of result.events) expect(e.a.x).toBe(aStartX(rules));
  });

  it("adding throw config does not perturb a fight where nobody throws (additive)", () => {
    const ATTACKER = bot([], { type: "attack", move: "strike", band: "mid" });

    const without = runFight(
      getMockConfig({
        rules: getMockRules({ startGap: 200000 }),
        botA: ATTACKER,
        botB: IDLE,
        maxTicks: 16,
      }),
    );

    const withThrow = runFight(
      getMockConfig({
        rules: throwRules({ startGap: 200000 }),
        botA: ATTACKER,
        botB: IDLE,
        maxTicks: 16,
      }),
    );

    expect(withThrow.events).toEqual(without.events);
  });
});

describe("runFight — strike beats throw (the §11.4 precedence: strike > throw)", () => {
  const STRIKER = bot([], { type: "attack", move: "strike", band: "mid" });

  // Throws once at tick 0 then idles (commits to the grab at tick 0).
  const throwOnce = bot(
    [
      {
        when: {
          op: "eq",
          args: [
            { op: "field", path: "clock.tick" },
            { op: "const", value: 0 },
          ],
        },
        do: { type: "throw" },
      },
    ],
    { type: "idle" },
  );

  // Default strike: startup 4, active 2 ⇒ active at ticks 4–5. A throw with startup 4, active 1
  // is grab-active at exactly tick 4 — so a throw and a strike both started at tick 0 collide on
  // the strike's first active frame. Both reaches 250000; startGap 200000 ⇒ both connect.
  const collideRules = (o: Partial<Rules> = {}): Rules =>
    getMockRules({
      startGap: 200000,
      knockdownDuration: 6,
      throw: { startup: 4, active: 1, recovery: 3, reach: 250000, score: 3 },
      ...o,
    });

  it("an active in-range strike beats a colliding throw: the strike scores, the throw is voided", () => {
    const result = runFight(
      getMockConfig({
        rules: collideRules(),
        botA: throwOnce, // grab-active at tick 4
        botB: STRIKER, // strike active at tick 4
        maxTicks: 8,
      }),
    );

    // Strike lands (b:1); the throw is voided ⇒ A scores nothing (not 3) and B is not downed.
    expect(result.scores).toEqual({ a: 0, b: 1 });
  });

  it("resolves strike-beats-throw identically from either slot (swap-symmetric)", () => {
    const asA = runFight(
      getMockConfig({
        rules: collideRules(),
        botA: throwOnce,
        botB: STRIKER,
        maxTicks: 8,
      }),
    );

    const asB = runFight(
      getMockConfig({
        rules: collideRules(),
        botA: STRIKER,
        botB: throwOnce,
        maxTicks: 8,
      }),
    );

    expect(asA.scores).toEqual({ a: 0, b: 1 });
    expect(asB.scores).toEqual({ a: 1, b: 0 }); // mirror — the striker always wins the clash
  });

  it("a throw still lands against an opponent whose strike is only in startup (an inactive strike is no threat)", () => {
    // Throw startup 2 ⇒ grab-active at tick 2, while the defender's default strike is still
    // winding up (active only at ticks 4–5). The non-threatening startup does not save it.
    const result = runFight(
      getMockConfig({
        rules: collideRules({
          throw: {
            startup: 2,
            active: 1,
            recovery: 3,
            reach: 250000,
            score: 3,
          },
        }),
        botA: throwOnce, // grab-active at tick 2
        botB: STRIKER, // strike still in startup at tick 2
        maxTicks: 6,
      }),
    );

    expect(result.scores.a).toBe(3); // the grab lands ⇒ B downed before its strike turns active
    expect(result.scores.b).toBe(0);
  });

  it("a throw still lands when the opposing active strike is out of range (beaten only when active AND in range)", () => {
    // Grab reach 300000 > strike reach 250000; at a 280000 gap the grab reaches but the active
    // strike whiffs — so the throw is not beaten and lands.
    const result = runFight(
      getMockConfig({
        rules: collideRules({
          startGap: 280000,
          throw: {
            startup: 4,
            active: 1,
            recovery: 3,
            reach: 300000,
            score: 3,
          },
        }),
        botA: throwOnce, // grab-active at tick 4, reaches 300000
        botB: STRIKER, // strike active at tick 4, but only reaches 250000
        maxTicks: 8,
      }),
    );

    expect(result.scores.a).toBe(3); // out-of-range strike is no threat ⇒ the grab lands
    expect(result.scores.b).toBe(0); // and the strike whiffed
  });

  it("an active strike during throw startup interrupts it: the throw cannot grab on a later frame", () => {
    // Throw startup 6 ⇒ still winding up when the strike is active (ticks 4–5). The strike hits
    // the open thrower at tick 4; the throw — now stuffed — reaches its grab-active frame at tick
    // 6 but does NOT grab (the defender is in strike recovery and grabbable, so only the
    // interrupt explains the miss).
    const result = runFight(
      getMockConfig({
        rules: collideRules({
          throw: {
            startup: 6,
            active: 1,
            recovery: 3,
            reach: 250000,
            score: 3,
          },
        }),
        botA: throwOnce, // grab-active at tick 6
        botB: STRIKER, // strike active at tick 4 (during A's throw startup)
        maxTicks: 8,
      }),
    );

    expect(result.scores.a).toBe(0); // throw interrupted ⇒ it never grabs
    expect(result.scores.b).toBe(1); // the strike hit the winding-up thrower
  });

  it("a stuffed throw stays committed through its recovery (punishable) — it is not cancelled to neutral", () => {
    // The tick-4 collision stuffs A's throw (total 8 ⇒ committed through tick 7). A would step
    // forward the instant it is neutral; while committed the step is ignored, so A's x is frozen
    // until the throw fully recovers at tick 8 — proving the stuffed throw is not cut short.
    const throwThenStep = bot(
      [
        {
          when: {
            op: "eq",
            args: [
              { op: "field", path: "clock.tick" },
              { op: "const", value: 0 },
            ],
          },
          do: { type: "throw" },
        },
      ],
      { type: "move", dir: 1 },
    );

    const rules = collideRules();

    const result = runFight(
      getMockConfig({
        rules,
        botA: throwThenStep,
        botB: STRIKER,
        maxTicks: 10,
      }),
    );

    const startX = aStartX(rules);
    expect(result.events[7].a.x).toBe(startX); // still committed in throw recovery ⇒ step ignored
    expect(result.events[8].a.x).toBe(startX + rules.walkSpeed); // neutral at tick 8 ⇒ steps
    expect(result.scores.a).toBe(0); // the stuffed throw never scored
  });
});

describe("runFight — throw-break (the §11.4 third leg: throw-break > throw)", () => {
  const STRIKER = bot([], { type: "attack", move: "strike", band: "mid" });

  // Throws once at tick 0 then idles (commits at tick 0 ⇒ grab-active at tick 2).
  const throwOnce = bot(
    [
      {
        when: {
          op: "eq",
          args: [
            { op: "field", path: "clock.tick" },
            { op: "const", value: 0 },
          ],
        },
        do: { type: "throw" },
      },
    ],
    { type: "idle" },
  );

  // Returns `throw-break` on exactly tick `t` (idle otherwise).
  const breakAt = (t: number): BotDoc =>
    bot(
      [
        {
          when: {
            op: "eq",
            args: [
              { op: "field", path: "clock.tick" },
              { op: "const", value: t },
            ],
          },
          do: { type: "throw-break" },
        },
      ],
      { type: "idle" },
    );

  // Returns `action` from tick `from` onward (idle before). For comparing a continuous
  // throw-break (open) against a continuous guard (negates) across a strike's active window.
  const from = (start: number, action: Action): BotDoc =>
    bot(
      [
        {
          when: {
            op: "gte",
            args: [
              { op: "field", path: "clock.tick" },
              { op: "const", value: start },
            ],
          },
          do: action,
        },
      ],
      { type: "idle" },
    );

  // throw: startup 2, active 1 ⇒ grab-active at tick 2; reach 250000, score 3; knockdown 6.
  const throwRules = (o: Partial<Rules> = {}): Rules =>
    getMockRules({
      startGap: 200000, // within grab reach (250000)
      knockdownDuration: 6,
      throw: { startup: 2, active: 1, recovery: 3, reach: 250000, score: 3 },
      ...o,
    });

  it("a throw-break on the grab-active tick escapes the grab; a break mistimed to startup is wasted (either slot)", () => {
    // The thrower occupies `slot`; report its score. Asserted from both slots so the grab-active
    // gate on the break is pinned for each fighter (not just when fighter A throws).
    const throwerScore = (breakTick: number, slot: "a" | "b"): number =>
      runFight(
        getMockConfig({
          rules: throwRules(), // grab-active at tick 2
          botA: slot === "a" ? throwOnce : breakAt(breakTick),
          botB: slot === "b" ? throwOnce : breakAt(breakTick),
          maxTicks: 6,
        }),
      ).scores[slot];

    expect(throwerScore(2, "a")).toBe(0); // break coincides with grab-active ⇒ escaped
    expect(throwerScore(1, "a")).toBe(3); // break one tick early (throw startup) ⇒ wasted ⇒ grab lands
    expect(throwerScore(2, "b")).toBe(0); // mirror — on-time break escapes when fighter B throws
    expect(throwerScore(1, "b")).toBe(3); // mirror — a break in B's throw startup is wasted
  });

  it("an escaped throw scores nothing AND does not knock down (the broken defender stays free)", () => {
    // B breaks the grab at tick 2, then steps the next tick — a downed fighter could not. Pins the
    // PAIRED escape effect (neither score nor knockdown).
    const breakThenStep = bot(
      [
        {
          when: {
            op: "eq",
            args: [
              { op: "field", path: "clock.tick" },
              { op: "const", value: 2 },
            ],
          },
          do: { type: "throw-break" },
        },
      ],
      { type: "move", dir: 1 },
    );

    const result = runFight(
      getMockConfig({
        rules: throwRules(),
        botA: throwOnce,
        botB: breakThenStep,
        maxTicks: 6,
      }),
    );

    expect(result.scores.a).toBe(0); // no score
    expect(result.events[3].b.x).not.toBe(result.events[2].b.x); // free at tick 3 ⇒ not downed
  });

  it("a throw-break resolves the throw — it cannot re-grab on a later active frame", () => {
    // Wide grab window (active 2 ⇒ grab-active ticks 2,3). B breaks only on the first active tick;
    // the break resolves the throw, so the now-open second frame does NOT grab.
    const wideThrow = {
      startup: 2,
      active: 2,
      recovery: 3,
      reach: 250000,
      score: 3,
    };

    const result = runFight(
      getMockConfig({
        rules: throwRules({ throw: wideThrow }),
        botA: throwOnce,
        botB: breakAt(2), // breaks tick 2 only, open at tick 3
        maxTicks: 6,
      }),
    );

    expect(result.scores.a).toBe(0); // resolved by the tick-2 break ⇒ no grab on tick 3
  });

  it("a fighter inputting throw-break is open to strikes (strike > throw-break, the anti-spam balance)", () => {
    // Break is not a guard: an active in-range strike HITs the breaker, where a real guard negates
    // it. STRIKER's strike is active at ticks 4–5, so the defender breaks/guards from tick 4 on.
    const vsBreak = runFight(
      getMockConfig({
        rules: throwRules(),
        botA: STRIKER,
        botB: from(4, { type: "throw-break" }),
        maxTicks: 8,
      }),
    ).scores.a;

    const vsBlock = runFight(
      getMockConfig({
        rules: throwRules(),
        botA: STRIKER,
        botB: from(4, { type: "block", band: "mid" }),
        maxTicks: 8,
      }),
    ).scores.a;

    expect(vsBreak).toBe(1); // break is open ⇒ the strike lands
    expect(vsBlock).toBe(0); // a matching guard negates it
  });

  it("a lone throw-break is inert and uncommitted — free to act the next tick, nothing scored", () => {
    // A breaks at tick 0 with no incoming grab (B idle): it does nothing AND does not commit A,
    // so A's default step lands the very next tick.
    const breakThenStep = bot(
      [
        {
          when: {
            op: "eq",
            args: [
              { op: "field", path: "clock.tick" },
              { op: "const", value: 0 },
            ],
          },
          do: { type: "throw-break" },
        },
      ],
      { type: "move", dir: 1 },
    );

    const rules = throwRules();

    const result = runFight(
      getMockConfig({
        rules,
        botA: breakThenStep,
        botB: IDLE,
        maxTicks: 4,
      }),
    );

    const startX = aStartX(rules);
    expect(result.events[0].a.x).toBe(startX); // tick 0: broke (no step), but not committed
    expect(result.events[1].a.x).toBe(startX + rules.walkSpeed); // free the next tick ⇒ steps
    expect(result.scores).toEqual({ a: 0, b: 0 }); // inert
  });

  it("resolves the throw-break escape identically from either slot (swap-symmetric)", () => {
    const asA = runFight(
      getMockConfig({
        rules: throwRules(),
        botA: throwOnce,
        botB: breakAt(2),
        maxTicks: 6,
      }),
    );

    const asB = runFight(
      getMockConfig({
        rules: throwRules(),
        botA: breakAt(2),
        botB: throwOnce,
        maxTicks: 6,
      }),
    );

    expect(asA.scores).toEqual({ a: 0, b: 0 });
    expect(asB.scores).toEqual({ a: 0, b: 0 });
  });

  it("with no throw config a throw-break is inert (byte-identical physics to idling)", () => {
    const BREAKER = bot([], { type: "throw-break" });
    const rules = getMockRules({ startGap: 200000 }); // no throw config

    const result = runFight(
      getMockConfig({ rules, botA: BREAKER, botB: IDLE, maxTicks: 6 }),
    );

    expect(result.scores).toEqual({ a: 0, b: 0 });
    for (const e of result.events) expect(e.a.x).toBe(aStartX(rules)); // never moved / committed
  });
});

describe("runFight — throw clash (the §11.4 symmetric outcome: throw ∥ throw)", () => {
  // Throws on exactly tick `t` then idles.
  const throwAtTick = (t: number): BotDoc =>
    bot(
      [
        {
          when: {
            op: "eq",
            args: [
              { op: "field", path: "clock.tick" },
              { op: "const", value: t },
            ],
          },
          do: { type: "throw" },
        },
      ],
      { type: "idle" },
    );

  const THROWER = bot([], { type: "throw" }); // throws every neutral tick

  // throw: startup 2, active 1 ⇒ grab-active at tick 2 for a throw started at tick 0.
  const throwRules = (o: Partial<Rules> = {}): Rules =>
    getMockRules({
      startGap: 200000, // within grab reach (250000)
      knockdownDuration: 6,
      throw: { startup: 2, active: 1, recovery: 3, reach: 250000, score: 3 },
      ...o,
    });

  it("two grab-active throws in range clash: neither scores, neither is downed", () => {
    // Both commit a throw at tick 0 ⇒ both grab-active at tick 2 ⇒ mutual clash. Each steps the
    // instant it recovers (tick 6); a downed fighter could not, so the step proves neither was
    // grabbed (no one-sided grab slipped through).
    const throwThenStep = bot(
      [
        {
          when: {
            op: "eq",
            args: [
              { op: "field", path: "clock.tick" },
              { op: "const", value: 0 },
            ],
          },
          do: { type: "throw" },
        },
      ],
      { type: "move", dir: 1 },
    );

    const rules = throwRules();

    const result = runFight(
      getMockConfig({
        rules,
        botA: throwThenStep,
        botB: throwThenStep,
        maxTicks: 8,
      }),
    );

    expect(result.scores).toEqual({ a: 0, b: 0 }); // mutual whiff ⇒ neither scores
    expect(result.events[6].a.x).not.toBe(aStartX(rules)); // free at tick 6 ⇒ A not downed
    expect(result.events[6].b.x).not.toBe(bStartX(rules)); // free at tick 6 ⇒ B not downed
  });

  it("only one grab live ⇒ it lands on the throwing opponent — no clash (swap-symmetric)", () => {
    // The thrower at tick 0 is grab-active at tick 2; the other only STARTS its throw at tick 2
    // (grab not yet live). Just one live grab ⇒ no clash ⇒ the live grab lands on the committed
    // (throwing) opponent and downs it. Asserted from both slots.
    const scores = (earlySlot: "a" | "b"): { a: number; b: number } =>
      runFight(
        getMockConfig({
          rules: throwRules(),
          botA: earlySlot === "a" ? throwAtTick(0) : throwAtTick(2),
          botB: earlySlot === "b" ? throwAtTick(0) : throwAtTick(2),
          maxTicks: 6,
        }),
      ).scores;

    expect(scores("a")).toEqual({ a: 3, b: 0 }); // A's earlier grab lands on the winding-up B
    expect(scores("b")).toEqual({ a: 0, b: 3 }); // mirror — the early thrower wins from either slot
  });

  it("a throw cannot re-grab a downed opponent (no pile-on via throw either)", () => {
    // A grabs B at tick 2 (knockdown 10), re-arms at tick 6, and its second grab is active at tick
    // 8 — while B is still down. A downed fighter vacates all bands to throws too, so the re-grab
    // whiffs: A keeps just the first 3.
    const result = runFight(
      getMockConfig({
        rules: throwRules({ knockdownDuration: 10 }),
        botA: THROWER,
        botB: IDLE,
        maxTicks: 9,
      }),
    );

    expect(result.events[8].a.points).toBe(3); // second grab (tick 8) whiffs the still-downed B
  });
});

describe("runFight — sweeps (a low-band strike that knocks down on hit, no score)", () => {
  // A sweep: startup 1, active 1 ⇒ active at elapsed 1 (tick 1 for a sweep started at tick 0);
  // recovery 2 ⇒ total 4. score 0 + knockdown ⇒ a clean hit downs the defender for
  // knockdownDuration ticks and scores nothing. Reach matches the strike (250000).
  const sweepRules = (o: Partial<Rules> = {}): Rules =>
    getMockRules({
      startGap: 200000, // within sweep reach (250000)
      knockdownDuration: 6,
      moves: {
        strike: { startup: 4, active: 2, recovery: 6, score: 1, reach: 250000 },
        sweep: {
          startup: 1,
          active: 1,
          recovery: 2,
          score: 0,
          reach: 250000,
          knockdown: true,
        },
      },
      ...o,
    });

  const atTick = (n: number): BoolExpr => ({
    op: "eq",
    args: [
      { op: "field", path: "clock.tick" },
      { op: "const", value: n },
    ],
  });

  // Sweeps once at tick 0, then idles — the sweeper stays put while we observe the downed fighter.
  const sweepOnce = bot([{ when: atTick(0), do: { type: "sweep" } }], {
    type: "idle",
  });

  it("downs an open opponent and scores nothing", () => {
    // B advances toward A whenever free; once swept (tick 1, knockdownDuration 6) its movement
    // freezes for the knockdown, then resumes. The sweep itself scores 0.
    const result = runFight(
      getMockConfig({
        rules: sweepRules(),
        botA: sweepOnce,
        botB: AGGRESSOR,
        maxTicks: 8,
      }),
    );

    expect(result.scores).toEqual({ a: 0, b: 0 });
    expect(result.events[6].b.x).toBe(result.events[2].b.x); // downed ticks 2..6 ⇒ frozen
    expect(result.events[7].b.x).not.toBe(result.events[6].b.x); // wakes ⇒ moves again
  });

  it("is blocked by a matching low guard (no knockdown) but sweeps a wrong-height guard", () => {
    // B guards `band` over the active frame (ticks 0–1), then advances when free. A low guard
    // blocks the sweep ⇒ B is free to move immediately; a high guard is the wrong height ⇒ B is
    // swept and frozen for the knockdown.
    const guardThenAdvance = (band: Band): BotDoc =>
      bot(
        [
          {
            when: {
              op: "lte",
              args: [
                { op: "field", path: "clock.tick" },
                { op: "const", value: 1 },
              ],
            },
            do: { type: "block", band },
          },
        ],
        { type: "move", dir: 1 },
      );

    const probeX = (band: Band): number =>
      runFight(
        getMockConfig({
          rules: sweepRules(),
          botA: sweepOnce,
          botB: guardThenAdvance(band),
          maxTicks: 6,
        }),
      ).events[4].b.x;

    expect(probeX("low")).not.toBe(bStartX(sweepRules())); // blocked ⇒ not downed ⇒ moves
    expect(probeX("high")).toBe(bStartX(sweepRules())); // wrong height ⇒ swept ⇒ downed ⇒ frozen
  });

  it("sweeps a crouching fighter (crouch occupies low ⇒ no dodge)", () => {
    const crouchThenAdvance = bot(
      [
        {
          when: {
            op: "lte",
            args: [
              { op: "field", path: "clock.tick" },
              { op: "const", value: 1 },
            ],
          },
          do: { type: "crouch" },
        },
      ],
      { type: "move", dir: 1 },
    );

    const result = runFight(
      getMockConfig({
        rules: sweepRules(),
        botA: sweepOnce,
        botB: crouchThenAdvance,
        maxTicks: 8,
      }),
    );

    expect(result.events[6].b.x).toBe(result.events[2].b.x); // downed ⇒ frozen
    expect(result.events[7].b.x).not.toBe(result.events[6].b.x); // wakes ⇒ moves
  });

  it("whiffs a jumper (airborne vacates low) yet downs a grounded fighter under the same rules", () => {
    const rules = sweepRules({
      jumpImpulse: 8000,
      gravity: 4000,
      lowClearance: 4000,
    });

    const jumpOnceThenAdvance = bot(
      [{ when: atTick(0), do: { type: "jump", dir: 0 } }],
      { type: "move", dir: 1 },
    );

    const jumper = runFight(
      getMockConfig({
        rules,
        botA: sweepOnce,
        botB: jumpOnceThenAdvance,
        maxTicks: 8,
      }),
    );

    const grounded = runFight(
      getMockConfig({ rules, botA: sweepOnce, botB: AGGRESSOR, maxTicks: 8 }),
    );

    // Jumper: airborne at the active frame ⇒ the sweep passes under ⇒ never downed; its arc
    // completes (lands at y=0) and it moves again.
    expect(jumper.events[5].b.y).toBe(0);
    expect(jumper.events[5].b.x).not.toBe(jumper.events[4].b.x);
    // Grounded: swept ⇒ downed ⇒ frozen during the knockdown.
    expect(grounded.events[6].b.x).toBe(grounded.events[2].b.x);
  });

  it("stuffs a throw — a sweep is a strike, and strike beats throw (§11.4)", () => {
    const throwOnce = bot([{ when: atTick(0), do: { type: "throw" } }], {
      type: "idle",
    });

    const rules = sweepRules({
      throw: { startup: 2, active: 1, recovery: 3, reach: 250000, score: 3 },
    });

    const scoreBvs = (botA: BotDoc): number =>
      runFight(getMockConfig({ rules, botA, botB: throwOnce, maxTicks: 6 }))
        .scores.b;

    expect(scoreBvs(IDLE)).toBe(3); // unobstructed grab ⇒ B scores 3
    expect(scoreBvs(sweepOnce)).toBe(0); // A's sweep hits the winding-up B first ⇒ grab stuffed
  });

  it("trades with a simultaneous strike — the sweep downs, the strike scores", () => {
    const rules = sweepRules({
      moves: {
        strike: { startup: 1, active: 1, recovery: 1, score: 1, reach: 250000 },
        sweep: {
          startup: 1,
          active: 1,
          recovery: 2,
          score: 0,
          reach: 250000,
          knockdown: true,
        },
      },
    });

    const strikeThenAdvance = bot(
      [
        {
          when: atTick(0),
          do: { type: "attack", move: "strike", band: "mid" },
        },
      ],
      { type: "move", dir: 1 },
    );

    const result = runFight(
      getMockConfig({
        rules,
        botA: sweepOnce,
        botB: strikeThenAdvance,
        maxTicks: 8,
      }),
    );

    expect(result.scores).toEqual({ a: 0, b: 1 }); // both connect: sweep 0, strike 1
    expect(result.events[6].b.x).toBe(result.events[2].b.x); // B downed by the sweep ⇒ frozen
    expect(result.events[7].b.x).not.toBe(result.events[6].b.x); // B wakes ⇒ moves
  });

  it("two simultaneous sweeps both knock down (mutual knockdown, swap-symmetric)", () => {
    const sweepThenAdvance = bot([{ when: atTick(0), do: { type: "sweep" } }], {
      type: "move",
      dir: 1,
    });

    const result = runFight(
      getMockConfig({
        rules: sweepRules(),
        botA: sweepThenAdvance,
        botB: sweepThenAdvance,
        maxTicks: 8,
      }),
    );

    expect(result.scores).toEqual({ a: 0, b: 0 });
    expect(result.events[6].a.x).toBe(result.events[2].a.x); // A downed ⇒ frozen
    expect(result.events[6].b.x).toBe(result.events[2].b.x); // B downed ⇒ frozen
    expect(result.events[7].a.x).not.toBe(result.events[6].a.x); // both wake ⇒ move
    expect(result.events[7].b.x).not.toBe(result.events[6].b.x);
  });

  it("with no moves.sweep the sweep action is inert (byte-identical physics to idling)", () => {
    const rules = getMockRules({ startGap: 200000, knockdownDuration: 6 }); // no moves.sweep

    const outcomes = (botA: BotDoc) =>
      runFight(
        getMockConfig({ rules, botA, botB: AGGRESSOR, maxTicks: 8 }),
      ).events.map((e) => ({
        ax: e.a.x,
        bx: e.b.x,
        by: e.b.y,
        ap: e.a.points,
        bp: e.b.points,
      }));

    expect(outcomes(sweepOnce)).toEqual(outcomes(IDLE));
  });
});

describe("runFight — okizeme finish window (a knockdown is finishable exactly once, then i-frames)", () => {
  // A fast knockdown game so the lone non-downed fighter can recover and FINISH within the
  // window. sweep (startup1 active1 recovery1 ⇒ total3): knocks down at tick1 for a sweep started
  // tick0, sweeper neutral at tick3. strike (startup1 active1 recovery1, score1): the finishing
  // poke — neutral fighter strikes at tick T ⇒ active at T+1. Both reach 250000 (= startGap).
  const finishRules = (o: Partial<Rules> = {}): Rules =>
    getMockRules({
      startGap: 200000, // within reach (250000)
      knockdownDuration: 8,
      moves: {
        strike: { startup: 1, active: 1, recovery: 1, score: 1, reach: 250000 },
        sweep: {
          startup: 1,
          active: 1,
          recovery: 1,
          score: 0,
          reach: 250000,
          knockdown: true,
        },
      },
      ...o,
    });

  const atTick = (n: number): BoolExpr => ({
    op: "eq",
    args: [
      { op: "field", path: "clock.tick" },
      { op: "const", value: n },
    ],
  });

  const whenCanAct: BoolExpr = {
    op: "eq",
    args: [
      { op: "field", path: "self.canAct" },
      { op: "const", value: 1 },
    ],
  };

  // Sweeps at tick 0 (knockdown at tick 1) then idles — leaves the downed foe untouched.
  const sweepOnly = bot([{ when: atTick(0), do: { type: "sweep" } }], {
    type: "idle",
  });

  // Sweeps at tick 0 (knockdown at tick 1), then strikes once at `strikeTick` — its active
  // frame lands at `strikeTick + 1`. Stationary otherwise, so the downed foe stays in reach.
  const sweepThenStrikeAt = (strikeTick: number, band: Band): BotDoc =>
    bot(
      [
        { when: atTick(0), do: { type: "sweep" } },
        {
          when: atTick(strikeTick),
          do: { type: "attack", move: "strike", band },
        },
      ],
      { type: "idle" },
    );

  it("a finish scores during the window — band, guard, and occupancy ignored (the target is prone)", () => {
    // Sweep downs B at tick 1; A strikes HIGH at tick 3 ⇒ active at tick 4 (finish countdown
    // 1, still open). A downed fighter vacates every band, so pre-finish ANY band whiffs — the
    // finish overrides band/occupancy/guard and scores the strike's score.
    const scoreA = (o: Partial<Rules>): number =>
      runFight(
        getMockConfig({
          rules: finishRules(o),
          botA: sweepThenStrikeAt(3, "high"),
          botB: IDLE,
          maxTicks: 8,
        }),
      ).scores.a;

    expect(scoreA({ finishWindow: 3 })).toBe(1); // finish lands in-window ⇒ +1 (band ignored)
    expect(scoreA({})).toBe(0); // no window ⇒ downed is untargetable ⇒ high strike whiffs
  });

  it("a knockdown is finishable exactly once — a second finish in the same knockdown scores nothing", () => {
    // Long window (8) so BOTH the tick-4 and tick-7 strikes fall inside it. The first finish
    // (tick 4) zeroes the window; the second (tick 7) finds it closed despite the nominal window
    // still being open — proving the close is the finish itself, not the clock.
    const result = runFight(
      getMockConfig({
        rules: finishRules({ finishWindow: 8, knockdownDuration: 14 }),
        botA: bot(
          [
            { when: atTick(0), do: { type: "sweep" } },
            {
              when: atTick(3),
              do: { type: "attack", move: "strike", band: "mid" },
            },
            {
              when: atTick(6),
              do: { type: "attack", move: "strike", band: "mid" },
            },
          ],
          { type: "idle" },
        ),
        botB: IDLE,
        maxTicks: 14,
      }),
    );

    expect(result.scores.a).toBe(1); // exactly one finish counts, not two
  });

  it("the finish window is exactly the first F ticks — a strike one tick too late hits only i-frames", () => {
    // Fixed finisher: strikes at tick 4 ⇒ active at tick 5 (finish countdown F-3 at that resolve).
    // F=4 ⇒ still open (1) ⇒ lands; F=3 ⇒ closed (0) ⇒ whiff. Pins the window length + off-by-one.
    const scoreWithWindow = (finishWindow: number): number =>
      runFight(
        getMockConfig({
          rules: finishRules({ finishWindow, knockdownDuration: 10 }),
          botA: sweepThenStrikeAt(4, "mid"),
          botB: IDLE,
          maxTicks: 10,
        }),
      ).scores.a;

    expect(scoreWithWindow(4)).toBe(1); // window still open at the active frame ⇒ finish
    expect(scoreWithWindow(3)).toBe(0); // one tick short ⇒ i-frame tail ⇒ whiff
  });

  it("a finish neither re-downs nor extends the knockdown — the fighter wakes on the same tick either way", () => {
    // B advances when free; swept at tick 1 (knockdownDuration 8 ⇒ frozen ticks 2..8, moves tick 9).
    // A finish landing (tick 4) must not move that wake tick or re-freeze B.
    const wakeProbe = (botA: BotDoc) =>
      runFight(
        getMockConfig({
          rules: finishRules({ finishWindow: 4, knockdownDuration: 8 }),
          botA,
          botB: AGGRESSOR,
          maxTicks: 11,
        }),
      );

    const withFinish = wakeProbe(sweepThenStrikeAt(3, "mid")); // strike active tick 4 ⇒ finishes
    const withoutFinish = wakeProbe(sweepOnly);

    expect(withFinish.scores.a).toBe(1); // the finish landed
    expect(withoutFinish.scores.a).toBe(0); // no finish attempted

    for (const r of [withFinish, withoutFinish]) {
      expect(r.events[8].b.x).toBe(r.events[2].b.x); // frozen through the FULL knockdown (tick 8)
      expect(r.events[9].b.x).not.toBe(r.events[8].b.x); // wakes to neutral and moves at tick 9
    }
  });

  it("applies to a throw knockdown too (one uniform finishable lifecycle)", () => {
    // Fast throw (startup1 active1 recovery1): grabs at tick 1 (B down, A +3), thrower neutral at
    // tick 3, strikes HIGH at tick 3 ⇒ active tick 4 ⇒ finish (+1) inside a window of 3.
    const fastThrow = {
      startup: 1,
      active: 1,
      recovery: 1,
      reach: 250000,
      score: 3,
    };

    const throwThenStrikeAt3High = bot(
      [
        { when: atTick(0), do: { type: "throw" } },
        {
          when: atTick(3),
          do: { type: "attack", move: "strike", band: "high" },
        },
      ],
      { type: "idle" },
    );

    const scoreA = (o: Partial<Rules>): number =>
      runFight(
        getMockConfig({
          rules: finishRules({ throw: fastThrow, ...o }),
          botA: throwThenStrikeAt3High,
          botB: IDLE,
          maxTicks: 8,
        }),
      ).scores.a;

    expect(scoreA({ finishWindow: 3 })).toBe(4); // throw 3 + finish 1
    expect(scoreA({})).toBe(3); // no window ⇒ the follow-up strike whiffs ⇒ throw only
  });

  it("with finishWindow absent a knockdown stays untargetable for its whole duration (byte-identical to C7)", () => {
    // A sweeps then strikes every free tick over a long knockdown. Absent the window EVERY strike
    // whiffs (the downed foe is untargetable throughout, exactly C7); set it, exactly one lands.
    const sweepThenStrikeWhenFree = bot(
      [
        { when: atTick(0), do: { type: "sweep" } },
        {
          when: whenCanAct,
          do: { type: "attack", move: "strike", band: "mid" },
        },
      ],
      { type: "idle" },
    );

    // knockdownDuration 20 > maxTicks ⇒ B stays down the whole fight, so a strike landing the
    // instant B woke can never masquerade as a finish.
    const scoreA = (o: Partial<Rules>): number =>
      runFight(
        getMockConfig({
          rules: finishRules({ knockdownDuration: 20, ...o }),
          botA: sweepThenStrikeWhenFree,
          botB: IDLE,
          maxTicks: 12,
        }),
      ).scores.a;

    expect(scoreA({})).toBe(0); // no finish anywhere ⇒ untargetable for the whole knockdown
    expect(scoreA({ finishWindow: 3 })).toBe(1); // a window opens exactly one finish
  });

  it("a finish scores rules.finishScore when set, falling back to the strike's base when absent", () => {
    // The okizeme finish should pay a fixed ippon, decoupled from the finishing poke's base score.
    // finishRules' strike.score is 1 and the sweep scores 0, so the sweep→finish path's WHOLE score
    // is the finish — isolating the awarded value. With finishScore 3 the finish pays the ippon (3),
    // not the poke's 1; with finishScore absent it falls back to the strike's base (1) ⇒ byte-identical.
    const scoreA = (o: Partial<Rules>): number =>
      runFight(
        getMockConfig({
          rules: finishRules({ finishWindow: 3, ...o }),
          botA: sweepThenStrikeAt(3, "high"),
          botB: IDLE,
          maxTicks: 8,
        }),
      ).scores.a;

    expect(scoreA({ finishScore: 3 })).toBe(3); // finish pays the configured ippon, not strike.score
    expect(scoreA({})).toBe(1); // absent ⇒ falls back to the finishing strike's base score
  });
});

describe("runFight — self.finishWindow (live okizeme hit-confirm)", () => {
  // Same fast knockdown game as the okizeme block: sweep downs at tick 1 (sweeper neutral at
  // tick 3), strike is the finishing poke. `self.finishWindow` is the LIVE opponent's downed
  // finish countdown — a bot reads it to hit-confirm the guaranteed finish.
  const SWEEP = {
    startup: 1,
    active: 1,
    recovery: 1,
    score: 0,
    reach: 250000,
    knockdown: true,
  };

  const STRIKE = {
    startup: 1,
    active: 1,
    recovery: 1,
    score: 1,
    reach: 250000,
  };

  const finishRules = (o: Partial<Rules> = {}): Rules =>
    getMockRules({
      startGap: 200000, // within reach (250000)
      knockdownDuration: 10,
      finishWindow: 5,
      moves: { strike: STRIKE, sweep: SWEEP },
      ...o,
    });

  const gtField = (path: FieldPath, n: number): BoolExpr => ({
    op: "gt",
    args: [
      { op: "field", path },
      { op: "const", value: n },
    ],
  });

  const eqField = (path: FieldPath, n: number): BoolExpr => ({
    op: "eq",
    args: [
      { op: "field", path },
      { op: "const", value: n },
    ],
  });

  const STRIKE_WHEN_FINISHABLE: BotDoc["rules"][number] = {
    when: gtField("self.finishWindow", 0),
    do: { type: "attack", move: "strike", band: "mid" },
  };

  // Sweeps the opponent down at tick 0, then strikes ONLY while it can actually finish
  // (self.finishWindow > 0) — a hit-confirmed finish.
  const confirmBot = bot(
    [
      { when: eqField("clock.tick", 0), do: { type: "sweep" } },
      STRIKE_WHEN_FINISHABLE,
    ],
    { type: "idle" },
  );

  it("drives a hit-confirmed finish — a bot strikes only while self.finishWindow > 0", () => {
    // The confirm-bot finishes the knockdown it created. With the field stuck at 0 it would never
    // strike, so the score IS the proof the live window is readable.
    const result = runFight(
      getMockConfig({
        rules: finishRules(),
        botA: confirmBot,
        botB: IDLE,
        maxTicks: 10,
      }),
    );

    expect(result.scores.a).toBe(1); // exactly the one guaranteed finish
  });

  it("reads exactly 0 (a number, not undefined) when the opponent is not downed", () => {
    // The opponent is never downed, so self.finishWindow must be exactly 0. Three bots pin that:
    //  - confirmNoSweep (> 0) never strikes (kills a constant > 0 reading),
    //  - alwaysStrike proves the standing foe is in range and hittable (decoupled sanity),
    //  - pokeWhenNoWindow (== 0) DOES strike ⇒ the value equals 0, not `undefined`/NaN (which
    //    would make `== 0` false — kills reading `.finish` off a non-downed state).
    const confirmNoSweep = bot([STRIKE_WHEN_FINISHABLE], { type: "idle" });

    const alwaysStrike = bot(
      [
        {
          when: eqField("self.canAct", 1),
          do: { type: "attack", move: "strike", band: "mid" },
        },
      ],
      { type: "idle" },
    );

    const pokeWhenNoWindow = bot(
      [
        {
          when: eqField("self.finishWindow", 0),
          do: { type: "attack", move: "strike", band: "mid" },
        },
      ],
      { type: "idle" },
    );

    const scoreOf = (botA: BotDoc): number =>
      runFight(
        getMockConfig({
          rules: finishRules(),
          botA,
          botB: IDLE,
          maxTicks: 10,
        }),
      ).scores.a;

    expect(scoreOf(confirmNoSweep)).toBe(0); // window never opens ⇒ holds fire
    expect(scoreOf(alwaysStrike)).toBeGreaterThan(0); // the standing foe IS hittable
    expect(scoreOf(pokeWhenNoWindow)).toBeGreaterThan(0); // finishWindow == 0 holds ⇒ value is 0
  });

  it("equals the live downed.finish — a bot keyed to an interior value finishes on that exact tick", () => {
    // A startup-0 strike makes the decision tick the active tick, so `finishWindow == 2` finishes
    // iff the live counter is actually 2 at that tick — pinning the value (not a 0/1 boolean or a
    // stuck constant) on top of the okizeme block's window-length tests.
    const valueBot = bot(
      [
        { when: eqField("clock.tick", 0), do: { type: "sweep" } },
        {
          when: eqField("self.finishWindow", 2),
          do: { type: "attack", move: "strike", band: "mid" },
        },
      ],
      { type: "idle" },
    );

    const result = runFight(
      getMockConfig({
        rules: finishRules({
          finishWindow: 4,
          moves: {
            strike: {
              startup: 0,
              active: 1,
              recovery: 1,
              score: 1,
              reach: 250000,
            },
            sweep: SWEEP,
          },
        }),
        botA: valueBot,
        botB: IDLE,
        maxTicks: 10,
      }),
    );

    expect(result.scores.a).toBe(1); // the counter really reaches 2 at that tick ⇒ finish lands
  });

  it("is live — perception latency never delays self.finishWindow", () => {
    // self.finishWindow is self-proprioception (read from the LIVE opponent, not the delayed
    // snapshot), so the confirm-bot finishes identically under heavy action latency. A delayed
    // reading would make it strike late and whiff.
    const scoreUnder = (lAct: number): number =>
      runFight(
        getMockConfig({
          rules: finishRules({ finishWindow: 4, perception: { lAct } }),
          botA: confirmBot,
          botB: IDLE,
          maxTicks: 10,
        }),
      ).scores.a;

    expect(scoreUnder(0)).toBe(1);
    expect(scoreUnder(6)).toBe(1); // identical despite 6-tick action latency ⇒ live
  });

  it("reads 0 in the i-frame tail — the confirm-bot stops once the window closes", () => {
    // A short window (3): the confirm-bot lands its one finish, then self.finishWindow reads 0 for
    // the rest of the knockdown, so when it is next free (tick 6) it idles instead of poking the
    // invulnerable, prone foe.
    const result = runFight(
      getMockConfig({
        rules: finishRules({ finishWindow: 3, knockdownDuration: 12 }),
        botA: confirmBot,
        botB: IDLE,
        maxTicks: 8,
      }),
    );

    expect(result.scores.a).toBe(1); // exactly one finish
    expect(result.events[6].a.action.type).toBe("idle"); // window closed ⇒ holds fire in i-frames
  });
});
