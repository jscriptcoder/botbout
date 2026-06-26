import { describe, it, expect } from "vitest";
import { runFight, type FightConfig } from "./sim.js";
import type { BotDoc } from "./dsl.js";
import type { Rules, Action } from "./types.js";

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

const aStartX = (r: Rules): number => Math.trunc((r.ring.width - r.startGap) / 2);
const bStartX = (r: Rules): number => Math.trunc((r.ring.width + r.startGap) / 2);

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
    const result = runFight(getMockConfig({ botA: AGGRESSOR, botB: IDLE, maxTicks: 1 }));
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
    const result = runFight(getMockConfig({ rules, botA: AGGRESSOR, botB: IDLE, maxTicks: 1 }));
    expect(result.events[0].a.x).toBe(aStartX(rules) + rules.walkSpeed);
  });

  it("leaves an idle fighter in place", () => {
    const rules = getMockRules();
    const result = runFight(getMockConfig({ rules, botA: AGGRESSOR, botB: IDLE, maxTicks: 1 }));
    expect(result.events[0].b.x).toBe(bStartX(rules));
  });

  it("clamps movement at the left ring edge", () => {
    const rules = getMockRules();
    const result = runFight(getMockConfig({ rules, botA: RETREATER, botB: IDLE, maxTicks: 60 }));
    const last = result.events[result.events.length - 1];
    expect(last.a.x).toBe(0);
  });

  it("clamps movement at the right ring edge", () => {
    const rules = getMockRules();
    const result = runFight(getMockConfig({ rules, botA: IDLE, botB: RETREATER, maxTicks: 60 }));
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
          when: { op: "eq", args: [{ op: "field", path: "opponent.distance" }, { op: "const", value: rules.startGap }] },
          do: { type: "move", dir: 1 },
        },
      ],
      { type: "idle" },
    );
    const result = runFight(getMockConfig({ rules, botA: AGGRESSOR, botB: mirror, maxTicks: 1 }));
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
      rules: [{ when: { op: "eq", args: [{ op: "mem", cell: "go" }, { op: "const", value: 1 }] }, do: { type: "move", dir: 1 } }],
      default: { type: "idle" },
    };
    const result = runFight(getMockConfig({ botA: armed, botB: IDLE, maxTicks: 1 }));
    expect(result.events[0].a.action).toEqual({ type: "move", dir: 1 });
  });

  it("breaks a facing tie toward +1 when fighters share a position", () => {
    const rules = getMockRules({ startGap: 0 });
    const center = Math.trunc(rules.ring.width / 2);
    const result = runFight(getMockConfig({ rules, botA: AGGRESSOR, botB: IDLE, maxTicks: 1 }));
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
              { op: "eq", args: [{ op: "field", path: "self.x" }, { op: "const", value: start }] },
              { op: "eq", args: [{ op: "field", path: "ring.width" }, { op: "const", value: rules.ring.width }] },
              { op: "eq", args: [{ op: "field", path: "self.canAct" }, { op: "const", value: 1 }] },
              { op: "eq", args: [{ op: "field", path: "clock.tick" }, { op: "const", value: 0 }] },
            ],
          },
          do: { type: "move", dir: 1 },
        },
      ],
      { type: "idle" },
    );
    const result = runFight(getMockConfig({ rules, botA: diag, botB: IDLE, maxTicks: 1 }));
    expect(result.events[0].a.action).toEqual({ type: "move", dir: 1 });
  });

  it("derives ticksRemaining as maxTicks minus the current tick", () => {
    const endBot = bot(
      [{ when: { op: "eq", args: [{ op: "field", path: "clock.ticksRemaining" }, { op: "const", value: 1 }] }, do: { type: "move", dir: 1 } }],
      { type: "idle" },
    );
    const result = runFight(getMockConfig({ botA: endBot, botB: IDLE, maxTicks: 3 }));
    expect(result.events[0].a.action).toEqual({ type: "idle" });
    expect(result.events[2].a.action).toEqual({ type: "move", dir: 1 });
  });
});
