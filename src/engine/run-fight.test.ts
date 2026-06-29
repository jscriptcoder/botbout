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

describe("runFight — stamina meter (a costed move spends stamina on commit)", () => {
  const STRIKER = bot([], { type: "attack", move: "strike", band: "mid" });
  const THROWER = bot([], { type: "throw" });
  const SWEEPER = bot([], { type: "sweep" });

  // Attacks while fresh, but idles once stamina drops below 80 — proving it reads the
  // live self.stamina field and changes behaviour on it (not a hardcoded view).
  const PACER = bot(
    [
      {
        when: {
          op: "lt",
          args: [
            { op: "field", path: "self.stamina" },
            { op: "const", value: 80 },
          ],
        },
        do: { type: "idle" },
      },
    ],
    { type: "attack", move: "strike", band: "mid" },
  );

  it("spends a strike's staminaCost on commit (even on a whiff), holds it through the move, then steps down on re-commit", () => {
    const rules = getMockRules({
      startGap: 300000, // beyond reach (250000) ⇒ the strike whiffs
      stamina: { max: 100 },
      moves: {
        strike: {
          startup: 4,
          active: 2,
          recovery: 6,
          score: 1,
          reach: 250000,
          staminaCost: 30,
        },
      },
    });

    const result = runFight(
      getMockConfig({ rules, botA: STRIKER, botB: IDLE, maxTicks: 13 }),
    );

    expect(result.scores.a).toBe(0); // the strike whiffed ...
    expect(result.events[0].a.stamina).toBe(70); // ... but the commit still cost 30
    expect(result.events[5].a.stamina).toBe(70); // unchanged mid-move (spend is on commit, not per-frame)
    expect(result.events[12].a.stamina).toBe(40); // re-commit at tick 12 steps down again (real subtraction)
  });

  it("spends a throw's staminaCost on commit", () => {
    const rules = getMockRules({
      stamina: { max: 100 },
      throw: {
        startup: 2,
        active: 2,
        recovery: 4,
        reach: 120000,
        score: 3,
        staminaCost: 40,
      },
    });

    const result = runFight(
      getMockConfig({ rules, botA: THROWER, botB: IDLE, maxTicks: 1 }),
    );

    expect(result.events[0].a.stamina).toBe(60);
  });

  it("spends a sweep's staminaCost on commit", () => {
    const rules = getMockRules({
      stamina: { max: 100 },
      moves: {
        strike: { startup: 4, active: 2, recovery: 6, score: 1, reach: 250000 },
        sweep: {
          startup: 4,
          active: 2,
          recovery: 6,
          score: 0,
          reach: 180000,
          knockdown: true,
          staminaCost: 20,
        },
      },
    });

    const result = runFight(
      getMockConfig({ rules, botA: SWEEPER, botB: IDLE, maxTicks: 1 }),
    );

    expect(result.events[0].a.stamina).toBe(80);
  });

  it("spends nothing for a configured move that declares no staminaCost", () => {
    const rules = getMockRules({
      stamina: { max: 100 },
      // strike carries NO staminaCost ⇒ a commit costs 0 (the meter is configured, this move is free)
    });

    const result = runFight(
      getMockConfig({ rules, botA: STRIKER, botB: IDLE, maxTicks: 1 }),
    );

    expect(result.events[0].a.stamina).toBe(100);
  });

  it("lets a bot pace itself by reading the live self.stamina field", () => {
    const rules = getMockRules({
      startGap: 200000, // within reach ⇒ a clean strike scores
      stamina: { max: 100 },
      moves: {
        strike: {
          startup: 4,
          active: 2,
          recovery: 6,
          score: 1,
          reach: 250000,
          staminaCost: 30,
        },
      },
    });

    // PACER strikes once at tick 0 (stamina 100), spending to 70; when next neutral
    // (tick 12) it reads 70 < 80 and holds fire — so it scores exactly once.
    const result = runFight(
      getMockConfig({ rules, botA: PACER, botB: IDLE, maxTicks: 24 }),
    );

    expect(result.scores.a).toBe(1); // a single strike — it read itself low and stopped
    expect(result.events[12].a.action.type).toBe("idle"); // neutral at 70 (<80) ⇒ holds fire
  });

  it("simulates no meter when Rules.stamina is absent — a declared staminaCost is never charged (byte-identical)", () => {
    const rules = getMockRules({
      startGap: 200000,
      // NO `stamina` block ⇒ the meter is not simulated ...
      moves: {
        strike: {
          startup: 4,
          active: 2,
          recovery: 6,
          score: 1,
          reach: 250000,
          staminaCost: 30, // ... so even a declared cost is never charged
        },
      },
    });

    const result = runFight(
      getMockConfig({ rules, botA: STRIKER, botB: IDLE, maxTicks: 5 }),
    );

    for (const e of result.events) {
      expect(e.a.stamina).toBe(0); // inert sentinel, never deducted
      expect(e.b.stamina).toBe(0);
    }

    expect(result.events[4].a.points).toBe(1); // the strike still scores ⇒ resolution unchanged
  });
});

describe("runFight — band-legality gate (an out-of-band attack degrades to idle)", () => {
  // A bot that attacks `strike` at `band` every tick.
  const attackingAt = (band: Band): BotDoc =>
    bot([], { type: "attack", move: "strike", band });

  // A bot that strikes at the given (tick, band) entries, idling otherwise — so an
  // opener and a later in-recovery CANCEL attempt can target DIFFERENT bands.
  const strikeAt = (entries: { t: number; band: Band }[]): BotDoc =>
    bot(
      entries.map(({ t, band }) => ({
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

  it("degrades an out-of-band attack to idle (no spend, no score) while the SAME in-band attack commits", () => {
    const mk = (): Rules =>
      getMockRules({
        startGap: 200000, // within strike reach (250000) ⇒ an in-band strike connects
        stamina: { max: 50 },
        moves: {
          strike: {
            startup: 4,
            active: 2,
            recovery: 6,
            score: 1,
            reach: 250000,
            bands: ["high", "mid"], // `low` is out of band
            staminaCost: 30,
          },
        },
      });

    // `low` ∉ ["high","mid"] ⇒ the move never starts: no commit, no spend, no score.
    const outOfBand = runFight(
      getMockConfig({
        rules: mk(),
        botA: attackingAt("low"),
        botB: IDLE,
        maxTicks: 12,
      }),
    );

    expect(outOfBand.scores.a).toBe(0);
    expect(outOfBand.events[0].a.stamina).toBe(50); // unchanged ⇒ never committed

    // `mid` ∈ bands ⇒ the SAME move at the SAME range commits + connects (rules out "out of range").
    const inBand = runFight(
      getMockConfig({
        rules: mk(),
        botA: attackingAt("mid"),
        botB: IDLE,
        maxTicks: 12,
      }),
    );

    expect(inBand.scores.a).toBe(1);
    expect(inBand.events[0].a.stamina).toBe(20); // spent 30 on commit
  });

  it("treats a move with no declared bands as legal at every band (absent ⇒ unrestricted ⇒ byte-identical)", () => {
    // The default mock `strike` declares no `bands`; a `low` attack must still commit +
    // score, exactly as before the gate existed.
    const result = runFight(
      getMockConfig({
        rules: getMockRules({ startGap: 200000 }),
        botA: attackingAt("low"),
        botB: IDLE,
        maxTicks: 12,
      }),
    );

    expect(result.scores.a).toBe(1);
  });

  it("guards the cancel path too: an out-of-band cancel is refused (only the opener scores)", () => {
    const rules = getMockRules({
      startGap: 200000,
      cancelWindow: 10,
      moves: {
        strike: {
          startup: 4,
          active: 2,
          recovery: 6,
          score: 1,
          reach: 250000,
          cancelInto: ["strike"],
          bands: ["mid"], // `low` is out of band
        },
      },
    });

    // Opener MID at tick 0 (connects tick 4, opens the cancel window); cancel attempt at tick 6.
    // A LOW cancel is out of band ⇒ refused ⇒ opener only. A MID cancel is honoured ⇒ +follow-up.
    const lowCancel = runFight(
      getMockConfig({
        rules,
        botA: strikeAt([
          { t: 0, band: "mid" },
          { t: 6, band: "low" },
        ]),
        botB: IDLE,
        maxTicks: 16,
      }),
    );

    const midCancel = runFight(
      getMockConfig({
        rules,
        botA: strikeAt([
          { t: 0, band: "mid" },
          { t: 6, band: "mid" },
        ]),
        botB: IDLE,
        maxTicks: 16,
      }),
    );

    expect(lowCancel.scores.a).toBe(1); // out-of-band cancel refused ⇒ opener only
    expect(midCancel.scores.a).toBe(2); // in-band cancel honoured ⇒ opener + cancelled follow-up
  });
});

describe("runFight — kizami-zuki (the jab: a short-reach high·mid technique)", () => {
  // A ruleset configuring the jab alongside the (longer-reach) strike. The jab's distinct
  // traits are its SHORTER reach (150000 < strike's 250000) and its high·mid legal bands.
  const jabRules = (o: Partial<Rules> = {}): Rules =>
    getMockRules({
      startGap: 120000, // within jab reach (150000)
      moves: {
        strike: { startup: 4, active: 2, recovery: 6, score: 1, reach: 250000 },
        "kizami-zuki": {
          startup: 4,
          active: 2,
          recovery: 6,
          score: 1,
          reach: 150000,
          bands: ["high", "mid"],
        },
      },
      ...o,
    });

  const jabAt = (band: Band): BotDoc =>
    bot([], { type: "attack", move: "kizami-zuki", band });

  it("scores 1 when a legal in-reach jab connects at mid", () => {
    const result = runFight(
      getMockConfig({
        rules: jabRules(),
        botA: jabAt("mid"),
        botB: IDLE,
        maxTicks: 12,
      }),
    );

    expect(result.scores.a).toBe(1);
  });

  it("fizzles to idle at low — the jab strikes only high·mid (the band gate)", () => {
    const result = runFight(
      getMockConfig({
        rules: jabRules(),
        botA: jabAt("low"),
        botB: IDLE,
        maxTicks: 12,
      }),
    );

    expect(result.scores.a).toBe(0);
  });

  it("whiffs beyond its (short) reach — at a gap a strike would reach but the jab cannot", () => {
    // startGap 200000: beyond jab reach (150000), still within strike reach (250000).
    const result = runFight(
      getMockConfig({
        rules: jabRules({ startGap: 200000 }),
        botA: jabAt("mid"),
        botB: IDLE,
        maxTicks: 12,
      }),
    );

    expect(result.scores.a).toBe(0);
  });

  it("is inert when the move id is unconfigured in this Rules (degrades to idle, like sweep/throw)", () => {
    // A strike-only ruleset (no `kizami-zuki` key); a jab attack references an unconfigured
    // move ⇒ no spec ⇒ idle ⇒ no score (the `spec !== undefined` guard).
    const result = runFight(
      getMockConfig({
        rules: getMockRules({ startGap: 120000 }),
        botA: jabAt("mid"),
        botB: IDLE,
        maxTicks: 12,
      }),
    );

    expect(result.scores.a).toBe(0);
  });

  it("is inert as a cancel target when unconfigured — a cancel into an unconfigured move is refused", () => {
    // `strike` may cancel INTO `kizami-zuki`, but this ruleset does not configure the jab.
    const rules = getMockRules({
      startGap: 120000,
      cancelWindow: 10,
      moves: {
        strike: {
          startup: 4,
          active: 2,
          recovery: 6,
          score: 1,
          reach: 250000,
          cancelInto: ["kizami-zuki"],
        },
      },
    });

    // Opener `strike` at tick 0 (connects tick 4, opens the cancel window); a cancel into the
    // unconfigured `kizami-zuki` at tick 6 ⇒ no spec ⇒ refused (the cancel-path `spec !==
    // undefined` guard) ⇒ the fighter finishes its recovery ⇒ opener only.
    const opener = bot(
      [
        {
          when: {
            op: "eq",
            args: [
              { op: "field", path: "clock.tick" },
              { op: "const", value: 0 },
            ],
          },
          do: { type: "attack", move: "strike", band: "mid" },
        },
        {
          when: {
            op: "eq",
            args: [
              { op: "field", path: "clock.tick" },
              { op: "const", value: 6 },
            ],
          },
          do: { type: "attack", move: "kizami-zuki", band: "mid" },
        },
      ],
      { type: "idle" },
    );

    const result = runFight(
      getMockConfig({ rules, botA: opener, botB: IDLE, maxTicks: 16 }),
    );

    expect(result.scores.a).toBe(1);
  });
});

describe("runFight — stamina affordability (an unaffordable move degrades to idle)", () => {
  const STRIKER = bot([], { type: "attack", move: "strike", band: "mid" });
  const THROWER = bot([], { type: "throw" });
  const SWEEPER = bot([], { type: "sweep" });

  it("commits the last affordable strike to exactly 0, but degrades a strike one short to idle (B1)", () => {
    const mk = (max: number) =>
      getMockRules({
        startGap: 200000, // within reach (250000) ⇒ a committed strike connects
        stamina: { max },
        moves: {
          strike: {
            startup: 4,
            active: 2,
            recovery: 6,
            score: 1,
            reach: 250000,
            staminaCost: 30,
          },
        },
      });

    // stamina == cost (affordable iff stamina ≥ cost): the move commits and empties to exactly 0 ...
    const affordable = runFight(
      getMockConfig({ rules: mk(30), botA: STRIKER, botB: IDLE, maxTicks: 12 }),
    );

    expect(affordable.events[0].a.stamina).toBe(0); // spent to exactly 0
    expect(affordable.scores.a).toBe(1); // ... and it connected (it really started)

    // stamina == cost − 1: one short ⇒ degrades to idle — no spend, no startup, no score.
    const short = runFight(
      getMockConfig({ rules: mk(29), botA: STRIKER, botB: IDLE, maxTicks: 12 }),
    );

    expect(short.events[0].a.stamina).toBe(29); // unchanged — no spend ...
    expect(short.scores.a).toBe(0); // ... and the strike never started
  });

  it("degrades an unaffordable throw to idle (no grab, no spend)", () => {
    const rules = getMockRules({
      startGap: 100000, // within throw reach (120000) ⇒ an affordable grab would score 3
      stamina: { max: 29 },
      throw: {
        startup: 2,
        active: 2,
        recovery: 4,
        reach: 120000,
        score: 3,
        staminaCost: 30,
      },
    });

    const result = runFight(
      getMockConfig({ rules, botA: THROWER, botB: IDLE, maxTicks: 6 }),
    );

    expect(result.events[0].a.stamina).toBe(29); // no spend
    expect(result.scores.a).toBe(0); // no grab — it idled instead of committing
  });

  it("degrades an unaffordable sweep to idle (no commit, no spend)", () => {
    const rules = getMockRules({
      startGap: 150000, // within sweep reach (180000)
      stamina: { max: 19 },
      moves: {
        strike: { startup: 4, active: 2, recovery: 6, score: 1, reach: 250000 },
        sweep: {
          startup: 4,
          active: 2,
          recovery: 6,
          score: 0,
          reach: 180000,
          knockdown: true,
          staminaCost: 20,
        },
      },
    });

    const result = runFight(
      getMockConfig({ rules, botA: SWEEPER, botB: IDLE, maxTicks: 6 }),
    );

    // A committed sweep spends 20; an unchanged meter proves it never committed (⇒ idled).
    for (const e of result.events) expect(e.a.stamina).toBe(19);
  });

  it("stops committing once a spam-attacker drops below cost — stamina floors flat and never negative", () => {
    const rules = getMockRules({
      startGap: 200000, // in reach ⇒ each committed strike scores
      stamina: { max: 100 },
      moves: {
        strike: {
          startup: 4,
          active: 2,
          recovery: 6,
          score: 1,
          reach: 250000,
          staminaCost: 30,
        },
      },
    });

    // Commits at ticks 0/12/24 (100→70→40→10), then 10 < 30 ⇒ every later attack idles.
    const result = runFight(
      getMockConfig({ rules, botA: STRIKER, botB: IDLE, maxTicks: 48 }),
    );

    expect(result.scores.a).toBe(3); // exactly three strikes landed before it ran dry
    expect(result.events[47].a.stamina).toBe(10); // settled flat at its last affordable remainder
    for (const e of result.events)
      expect(e.a.stamina).toBeGreaterThanOrEqual(0); // the [0] lower bound
  });
});

describe("runFight — stamina regen (an uncommitted fighter recovers; a committed/guarding one does not)", () => {
  // Strikes once on tick 0 (clock.tick reads 0), then falls through to its default action
  // for the rest of the fight — letting us watch the meter recover (or not) afterwards.
  const oneShotThen = (rest: Action): BotDoc =>
    bot(
      [
        {
          when: {
            op: "eq",
            args: [
              { op: "field", path: "clock.tick" },
              { op: "const", value: 0 },
            ],
          },
          do: { type: "attack", move: "strike", band: "mid" },
        },
      ],
      rest,
    );

  const regenRules = (o: Partial<Rules> = {}) =>
    getMockRules({
      startGap: 300000, // out of reach — the lone strike whiffs; we only care about the meter
      stamina: { max: 100, regen: 5 },
      moves: {
        strike: {
          startup: 4,
          active: 2,
          recovery: 6,
          score: 1,
          reach: 250000,
          staminaCost: 30,
        },
      },
      ...o,
    });

  it("regens only while uncommitted — not on the commit tick, not mid-move, not on the last recovery tick (B2) — then climbs and clamps at max", () => {
    const result = runFight(
      getMockConfig({
        rules: regenRules(),
        botA: oneShotThen({ type: "idle" }),
        botB: IDLE,
        maxTicks: 30,
      }),
    );

    // The strike (total 12 frames) commits at tick 0 and holds the fighter through tick 11.
    expect(result.events[0].a.stamina).toBe(70); // commit tick: spent 30, no regen (net −cost)
    expect(result.events[5].a.stamina).toBe(70); // mid-move: committed ⇒ no regen
    expect(result.events[11].a.stamina).toBe(70); // last recovery tick: still committed ⇒ no regen (placement)
    // Neutral from tick 12 onward ⇒ regen resumes at +5/tick.
    expect(result.events[12].a.stamina).toBe(75); // first uncommitted tick
    expect(result.events[14].a.stamina).toBe(85); // climbing at +regen
    expect(result.events[17].a.stamina).toBe(100); // reached max (70 + 6·5)
    expect(result.events[18].a.stamina).toBe(100); // clamped — never overfills past max
    for (const e of result.events) expect(e.a.stamina).toBeLessThanOrEqual(100);
  });

  it("does not regen while guarding — a held block blocks recovery", () => {
    const result = runFight(
      getMockConfig({
        rules: regenRules(),
        botA: oneShotThen({ type: "block", band: "mid" }),
        botB: IDLE,
        maxTicks: 14,
      }),
    );

    // Neutral but guarding from tick 12: the meter stays at its spent value, no recovery.
    expect(result.events[12].a.stamina).toBe(70);
    expect(result.events[13].a.stamina).toBe(70);
  });

  it("does regen while crouching — a crouch is uncommitted, not a guard", () => {
    const result = runFight(
      getMockConfig({
        rules: regenRules(),
        botA: oneShotThen({ type: "crouch" }),
        botB: IDLE,
        maxTicks: 14,
      }),
    );

    // A croucher is neutral ∧ not guarding ⇒ it recovers, exactly like an idler.
    expect(result.events[12].a.stamina).toBe(75);
    expect(result.events[13].a.stamina).toBe(80);
  });

  it("defaults regen to 0 when the meter declares no regen — configured but no recovery", () => {
    const result = runFight(
      getMockConfig({
        rules: regenRules({ stamina: { max: 100 } }), // no regen field
        botA: oneShotThen({ type: "idle" }),
        botB: IDLE,
        maxTicks: 20,
      }),
    );

    // Idle from tick 12 with regen unset ⇒ the meter holds flat at its spent value.
    expect(result.events[19].a.stamina).toBe(70);
  });
});

describe("runFight — guard stamina chip (a block bleeds the defender's stamina on contact)", () => {
  const ATTACKER = bot([], { type: "attack", move: "strike", band: "mid" });
  const BLOCKER = bot([], { type: "block", band: "mid" });

  // In range (200000 < reach 250000) ⇒ a mid strike contacts a held mid guard. The strike
  // (startup 4, active 2) is active on ticks 4 and 5; an unconfigured parryWindow ⇒ a guard
  // held since tick 0 is STALE ⇒ a block (not a parry). The blocker is botB throughout.
  const chipRules = (o: Partial<Rules> = {}): Rules =>
    getMockRules({ startGap: 200000, ...o });

  it("draws blockChip from the defender on each contact tick, then stops when the active window closes", () => {
    const result = runFight(
      getMockConfig({
        rules: chipRules({ stamina: { max: 100, blockChip: 10 } }),
        botA: ATTACKER,
        botB: BLOCKER,
        maxTicks: 8,
      }),
    );

    expect(result.scores.a).toBe(0); // the guard still negates the strike (resolution unchanged)
    expect(result.events[3].b.stamina).toBe(100); // pre-active: no contact yet ⇒ full
    expect(result.events[4].b.stamina).toBe(90); // first active/contact tick ⇒ −blockChip
    expect(result.events[5].b.stamina).toBe(80); // second active/contact tick ⇒ −blockChip again (per contact)
    expect(result.events[6].b.stamina).toBe(80); // active window closed ⇒ no more chip; guarding ⇒ no regen
  });

  it("draws nothing while a guard is held but never contacted (contact is the trigger, not guarding)", () => {
    const result = runFight(
      getMockConfig({
        rules: chipRules({
          startGap: 300000, // beyond reach ⇒ the strike is active but never reaches the guard
          stamina: { max: 100, blockChip: 10 },
        }),
        botA: ATTACKER,
        botB: BLOCKER,
        maxTicks: 8,
      }),
    );

    for (const e of result.events) expect(e.b.stamina).toBe(100); // guard held, no contact ⇒ no chip
  });

  it("floors the chipped meter at exactly 0 — a chip larger than current stamina cannot go negative", () => {
    const result = runFight(
      getMockConfig({
        rules: chipRules({ stamina: { max: 5, blockChip: 10 } }), // chip exceeds the whole meter
        botA: ATTACKER,
        botB: BLOCKER,
        maxTicks: 8,
      }),
    );

    expect(result.events[3].b.stamina).toBe(5); // pre-contact: the small meter is full
    expect(result.events[4].b.stamina).toBe(0); // chip 10 on stamina 5 ⇒ floors at 0, not −5
    for (const e of result.events)
      expect(e.b.stamina).toBeGreaterThanOrEqual(0);
  });

  it("draws nothing when the meter is configured without a blockChip (byte-identical to the Story 1 meter)", () => {
    const result = runFight(
      getMockConfig({
        rules: chipRules({ stamina: { max: 100 } }), // meter on, but no chip declared
        botA: ATTACKER,
        botB: BLOCKER,
        maxTicks: 8,
      }),
    );

    for (const e of result.events) expect(e.b.stamina).toBe(100); // configured but no chip ⇒ no draw
    expect(result.scores.a).toBe(0); // block still negates ⇒ resolution unchanged
  });

  it("draws nothing and reads the sentinel 0 when no meter is configured (byte-identical to the pre-stamina engine)", () => {
    const result = runFight(
      getMockConfig({
        rules: chipRules(), // NO stamina block ⇒ the meter is not simulated
        botA: ATTACKER,
        botB: BLOCKER,
        maxTicks: 8,
      }),
    );

    for (const e of result.events) {
      expect(e.b.stamina).toBe(0); // inert sentinel
      expect(e.a.stamina).toBe(0);
    }

    expect(result.scores.a).toBe(0); // block negates the strike ⇒ resolution unchanged
  });
});

describe("runFight — parry stamina chip (a deflect bleeds MORE than a block)", () => {
  const ATTACKER = bot([], { type: "attack", move: "strike", band: "mid" });

  // A defender that idles until tick `from`, then holds a `band` guard — so its guard's age
  // when the strike's first active frame lands (tick 4) is `5 − from`. guardFrom(4) ⇒ age 1
  // (fresh, within parryWindow 2) ⇒ PARRY; guardFrom(0) ⇒ age 5 (past the window) ⇒ BLOCK.
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

  // parryWindow 2 ⇒ a guard of age 1–2 deflects. The defender is botB throughout.
  const parryChipRules = (o: Partial<Rules> = {}): Rules =>
    getMockRules({
      startGap: 200000,
      parryWindow: 2,
      parryRecovery: 8,
      ...o,
    });

  it("draws parryChip from the defender once on the deflect tick (a parry resolves the strike)", () => {
    const result = runFight(
      getMockConfig({
        rules: parryChipRules({ stamina: { max: 100, parryChip: 20 } }),
        botA: ATTACKER, // strike active at tick 4
        botB: guardFrom(4, "mid"), // fresh guard at tick 4 ⇒ age 1 ⇒ PARRY
        maxTicks: 8,
      }),
    );

    expect(result.scores.a).toBe(0); // deflected ⇒ never scored
    expect(result.events[3].b.stamina).toBe(100); // pre-parry: idle, no contact ⇒ full
    expect(result.events[4].b.stamina).toBe(80); // deflect tick ⇒ −parryChip
    expect(result.events[5].b.stamina).toBe(80); // parry resolved the strike ⇒ no second chip
  });

  it("draws a STRICTLY LARGER chip than a block does under the same strike (parryChip > blockChip)", () => {
    // Same rules, same attacker — only the defender's guard freshness differs, so the only
    // variable is parry-vs-block. Compare the drop on the shared contact tick (4): a deeper
    // drop there means the parry chip exceeds the block chip, with no literal on either amount.
    const rules = parryChipRules({
      stamina: { max: 100, blockChip: 10, parryChip: 20 },
    });

    const parried = runFight(
      getMockConfig({
        rules,
        botA: ATTACKER,
        botB: guardFrom(4, "mid"), // fresh ⇒ PARRY
        maxTicks: 8,
      }),
    );

    const blocked = runFight(
      getMockConfig({
        rules,
        botA: ATTACKER,
        botB: guardFrom(0, "mid"), // stale (age 5) ⇒ BLOCK
        maxTicks: 8,
      }),
    );

    expect(blocked.events[4].b.stamina).toBeLessThan(100); // the block drew a chip ...
    expect(parried.events[4].b.stamina).toBeLessThan(
      blocked.events[4].b.stamina,
    ); // ... and the parry drew MORE (parryChip > blockChip)
  });

  it("floors the chipped meter at exactly 0 — a parry chip larger than current stamina cannot go negative", () => {
    const result = runFight(
      getMockConfig({
        rules: parryChipRules({ stamina: { max: 5, parryChip: 20 } }),
        botA: ATTACKER,
        botB: guardFrom(4, "mid"), // PARRY
        maxTicks: 8,
      }),
    );

    expect(result.events[3].b.stamina).toBe(5); // pre-parry: the small meter is full
    expect(result.events[4].b.stamina).toBe(0); // chip 20 on stamina 5 ⇒ floors at 0, not −15
    for (const e of result.events)
      expect(e.b.stamina).toBeGreaterThanOrEqual(0);
  });

  it("draws nothing when the meter is configured without a parryChip (byte-identical to Slice 2a)", () => {
    const result = runFight(
      getMockConfig({
        rules: parryChipRules({ stamina: { max: 100 } }), // meter on, no parryChip declared
        botA: ATTACKER,
        botB: guardFrom(4, "mid"), // still a PARRY ...
        maxTicks: 8,
      }),
    );

    for (const e of result.events) expect(e.b.stamina).toBe(100); // ... but no chip ⇒ no draw
    expect(result.scores.a).toBe(0); // the deflect still works ⇒ resolution unchanged
  });
});

describe("runFight — gassing penalty (a gassed fighter's committed move recovers slower)", () => {
  const STRIKER = bot([], { type: "attack", move: "strike", band: "mid" });

  // A strike on the standard 4/2/6 timing (total 12), with a small on-commit cost so we can
  // drive a fighter to/below a gas line and watch when it next re-commits (the next step-down).
  const gasRules = (
    stamina: NonNullable<Rules["stamina"]>,
    startGap = 200000,
  ): Rules =>
    getMockRules({
      startGap,
      stamina,
      moves: {
        strike: {
          startup: 4,
          active: 2,
          recovery: 6,
          score: 1,
          reach: 250000,
          staminaCost: 10,
        },
      },
    });

  it("extends a gassed strike's recovery (recovery-only): same active onset, later re-commit", () => {
    // Both spend to 45 on the tick-0 commit; gassed (45 ≤ 50) ⇒ recovery +5 ⇒ total 17.
    const gassed = runFight(
      getMockConfig({
        rules: gasRules({ max: 55, gasThreshold: 50, gasRecoveryPenalty: 5 }),
        botA: STRIKER,
        botB: IDLE,
        maxTicks: 20,
      }),
    );

    // No gasThreshold ⇒ never gassed ⇒ normal recovery (total 12).
    const control = runFight(
      getMockConfig({
        rules: gasRules({ max: 55 }),
        botA: STRIKER,
        botB: IDLE,
        maxTicks: 20,
      }),
    );

    // recovery-ONLY: the gassed strike still becomes active on the same tick — startup/active
    // are untouched, so it scores at tick 4 exactly like the control (only the tail is longer).
    expect(gassed.events[3].a.points).toBe(0); // tick 3: still in startup
    expect(gassed.events[4].a.points).toBe(1); // tick 4: active ⇒ scores
    expect(control.events[4].a.points).toBe(1); // ... identical active onset

    // RECOVERY extended: the control re-commits on schedule at tick 12 (45→35); the gassed
    // fighter is still recovering then and does not re-commit until 12 + gasRecoveryPenalty.
    expect(control.events[12].a.stamina).toBe(35); // control re-committed on schedule
    expect(gassed.events[12].a.stamina).toBe(45); // gassed: still recovering — the extension
    expect(gassed.events[17].a.stamina).toBe(35); // re-commits exactly at 12 + penalty (5)
  });

  it("gasses exactly at the threshold (≤): a commit landing on the line is slowed, one above it is not", () => {
    // cost 10, threshold 50. max 60 ⇒ post-commit 50 (== threshold) ⇒ gassed; max 61 ⇒ 51 ⇒ not.
    const onLine = runFight(
      getMockConfig({
        rules: gasRules(
          { max: 60, gasThreshold: 50, gasRecoveryPenalty: 5 },
          300000, // beyond reach ⇒ whiff; timing only, no scoring noise
        ),
        botA: STRIKER,
        botB: IDLE,
        maxTicks: 14,
      }),
    );

    const above = runFight(
      getMockConfig({
        rules: gasRules(
          { max: 61, gasThreshold: 50, gasRecoveryPenalty: 5 },
          300000,
        ),
        botA: STRIKER,
        botB: IDLE,
        maxTicks: 14,
      }),
    );

    expect(above.events[12].a.stamina).toBe(41); // 51 > 50 ⇒ not gassed ⇒ re-commits at tick 12
    expect(onLine.events[12].a.stamina).toBe(50); // 50 ≤ 50 ⇒ gassed ⇒ extended, not yet re-committed
  });

  it("never gasses without a gasThreshold — a declared gasRecoveryPenalty stays inert (byte-identical to Story 2)", () => {
    const withPenaltyNoThreshold = runFight(
      getMockConfig({
        rules: gasRules({ max: 55, gasRecoveryPenalty: 5 }), // penalty present, NO threshold
        botA: STRIKER,
        botB: IDLE,
        maxTicks: 20,
      }),
    );

    const plainMeter = runFight(
      getMockConfig({
        rules: gasRules({ max: 55 }), // just the meter
        botA: STRIKER,
        botB: IDLE,
        maxTicks: 20,
      }),
    );

    // identical event streams ⇒ the penalty does nothing unless a gasThreshold gates it
    expect(withPenaltyNoThreshold.events).toEqual(plainMeter.events);
  });
});

describe("runFight — self.gassed (a bot reads its own live gas tell)", () => {
  const STRIKER = bot([], { type: "attack", move: "strike", band: "mid" });

  // Attacks while fresh, but idles the moment it reads itself GASSED — proving it reads the
  // live self.gassed field and flips on it (1 iff stamina ≤ gasThreshold), not a constant.
  const GASS_PACER = bot(
    [
      {
        when: {
          op: "eq",
          args: [
            { op: "field", path: "self.gassed" },
            { op: "const", value: 1 },
          ],
        },
        do: { type: "idle" },
      },
    ],
    { type: "attack", move: "strike", band: "mid" },
  );

  const gasReadRules = (stamina: NonNullable<Rules["stamina"]>): Rules =>
    getMockRules({
      startGap: 200000, // within reach (250000) ⇒ a clean strike scores
      stamina,
      moves: {
        strike: {
          startup: 4,
          active: 2,
          recovery: 6,
          score: 1,
          reach: 250000,
          staminaCost: 10,
        },
      },
    });

  it("flips a bot's action at the gas line: attacks while fresh, idles once gassed", () => {
    // No gasRecoveryPenalty ⇒ recovery stays 12, isolating the READ. tick 0: stamina 55 > 50 ⇒
    // gassed 0 ⇒ attack (spends to 45). At tick 12 (neutral again): 45 ≤ 50 ⇒ gassed 1 ⇒ idle.
    const result = runFight(
      getMockConfig({
        rules: gasReadRules({ max: 55, gasThreshold: 50 }),
        botA: GASS_PACER,
        botB: IDLE,
        maxTicks: 20,
      }),
    );

    expect(result.events[0].a.action.type).toBe("attack"); // fresh (55 > 50) ⇒ gassed 0 ⇒ attacks
    expect(result.events[12].a.action.type).toBe("idle"); // gassed (45 ≤ 50) ⇒ reads 1 ⇒ holds fire
    expect(result.scores.a).toBe(1); // one strike landed, then it read itself gassed and stopped
  });

  it("reads the sentinel 0 when no stamina is configured — the read is inert (byte-identical)", () => {
    // With no meter, self.gassed reads 0, so the pacer never idles — identical to plain spamming.
    const rules = getMockRules({
      startGap: 200000,
      moves: {
        strike: { startup: 4, active: 2, recovery: 6, score: 1, reach: 250000 },
      },
    });

    const reads = runFight(
      getMockConfig({ rules, botA: GASS_PACER, botB: IDLE, maxTicks: 18 }),
    );

    const plain = runFight(
      getMockConfig({ rules, botA: STRIKER, botB: IDLE, maxTicks: 18 }),
    );

    expect(reads.events).toEqual(plain.events); // self.gassed = 0 ⇒ no divergence
  });
});

describe("runFight — gassed special-lockout (emergent: specialCost > gasThreshold ≥ basicCost)", () => {
  const STRIKER = bot([], { type: "attack", move: "strike", band: "mid" });
  const THROWER = bot([], { type: "throw" });
  const SWEEPER = bot([], { type: "sweep" });

  // The lockout of throw/sweep while gassed is NOT a new mechanic — it falls out of Story 1's
  // affordability gate the moment the canonical numbers satisfy specialCost > gasThreshold ≥
  // basicCost. These are guarantee tests pinning that emergent relationship; the numbers live
  // in the fixture (CANONICAL_RULES promotion is the deferred consolidated-wiring slice).
  const BASIC = 10;
  const GAS = 20;
  const SPECIAL = 30;

  const lockoutRules = (max: number): Rules =>
    getMockRules({
      startGap: 100000, // within throw (120000) / sweep (180000) / strike (250000) reach
      stamina: { max, gasThreshold: GAS },
      moves: {
        strike: {
          startup: 4,
          active: 2,
          recovery: 6,
          score: 1,
          reach: 250000,
          staminaCost: BASIC,
        },
        sweep: {
          startup: 4,
          active: 2,
          recovery: 6,
          score: 0,
          reach: 180000,
          knockdown: true,
          staminaCost: SPECIAL,
        },
      },
      throw: {
        startup: 2,
        active: 2,
        recovery: 4,
        reach: 120000,
        score: 3,
        staminaCost: SPECIAL,
      },
      knockdownDuration: 30, // a clean grab downs the foe ⇒ one grab scores once (no re-grab on the 2nd active frame)
    });

  it("locks a gassed fighter out of throw and sweep while its basic strike still commits", () => {
    // The inequality the emergent lockout rests on — asserted structurally, not assumed.
    expect(SPECIAL).toBeGreaterThan(GAS);
    expect(GAS).toBeGreaterThanOrEqual(BASIC);

    // max 15 ⇒ born gassed (15 ≤ gasThreshold 20), with 15 ≥ basic (10) but 15 < special (30).
    const rules = lockoutRules(15);

    const striker = runFight(
      getMockConfig({ rules, botA: STRIKER, botB: IDLE, maxTicks: 6 }),
    );

    const thrower = runFight(
      getMockConfig({ rules, botA: THROWER, botB: IDLE, maxTicks: 6 }),
    );

    const sweeper = runFight(
      getMockConfig({ rules, botA: SWEEPER, botB: IDLE, maxTicks: 6 }),
    );

    // the basic poke still commits while gassed: it spends (15 → 5) and connects.
    expect(striker.events[0].a.stamina).toBe(5);
    expect(striker.scores.a).toBe(1);

    // throw and sweep are LOCKED OUT — both degrade to idle: no spend (flat 15), no grab/score.
    expect(thrower.events[0].a.stamina).toBe(15);
    expect(thrower.scores.a).toBe(0);
    expect(sweeper.events[0].a.stamina).toBe(15);
    expect(sweeper.scores.a).toBe(0);
  });

  it("a FRESH fighter affords the same throw the gassed one cannot — the lockout is the gas, not the move", () => {
    // Only `max` differs: fresh (100 > special 30) vs gassed (15 < 30); same throw spec & reach.
    const fresh = runFight(
      getMockConfig({
        rules: lockoutRules(100),
        botA: THROWER,
        botB: IDLE,
        maxTicks: 6,
      }),
    );

    const gassed = runFight(
      getMockConfig({
        rules: lockoutRules(15),
        botA: THROWER,
        botB: IDLE,
        maxTicks: 6,
      }),
    );

    expect(fresh.scores.a).toBe(3); // affords the grab ⇒ the WKF ippon
    expect(gassed.scores.a).toBe(0); // cannot afford it ⇒ idle, no grab
    expect(fresh.scores.a).toBeGreaterThan(gassed.scores.a); // the relationship: same move, gated by gas
  });
});
