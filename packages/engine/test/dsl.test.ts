import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { validate, runTick, type BotDoc } from "../src/dsl.js";
import { DEFAULT_RULES } from "../src/rules.js";
import type { State } from "../src/types.js";

const __dir = dirname(fileURLToPath(import.meta.url));
const bot = JSON.parse(
  readFileSync(join(__dir, "../examples/footsie-spacer.json"), "utf8"),
) as BotDoc;

const baseState = (): State => ({
  self: { hp: 100, maxHp: 100, stamina: 100, maxStamina: 100, x: 0, facing: 1, phase: "idle", currentMove: null, phaseRemaining: 0, canAct: true },
  opponent: { x: 50, vx: 0, facing: -1, distance: 50, predictedDistance: 50, hp: 100, stamina: 100, phase: "idle", move: null, phaseElapsed: 0, moveRecoveryRemaining: 0, staleness: 6 },
  ring: { leftEdge: -300, rightEdge: 300, width: 600 },
  clock: { tick: 0, maxTicks: 3600, ticksRemaining: 3600 },
});

describe("footsie-spacer bot", () => {
  let mem: Record<string, number>;
  beforeEach(() => { mem = { oppAttacks: 0 }; });

  const run = (patch: any) => {
    const st = baseState();
    Object.assign(st.self, patch.self ?? {});
    Object.assign(st.opponent, patch.opponent ?? {});
    return runTick(bot, st, DEFAULT_RULES, mem);
  };

  it("validates", () => expect(validate(bot).ok).toBe(true));

  it("grabs a never-attacked opponent in range (turtle-buster)", () =>
    expect(run({}).type).toBe("grab"));

  it("tracks opponent attacks and switches to poke after seeing offense", () => {
    run({ opponent: { move: "kick", phase: "active", phaseElapsed: 0, x: 90, predictedDistance: 90 } });
    expect(mem.oppAttacks).toBe(1);
    expect(run({}).type).toBe("punch");
  });

  it("reaction-blocks a telegraphed kick", () =>
    expect(run({ opponent: { move: "kick", phase: "startup", x: 100, predictedDistance: 100 } }).type).toBe("block"));

  it("whiff-punishes a recovering kick", () =>
    expect(run({ opponent: { phase: "recovery", move: "kick", moveRecoveryRemaining: 12 } }).type).toBe("punch"));

  it("retreats when gassed", () =>
    expect(run({ self: { stamina: 14 } }).type).toBe("move"));
});

describe("validator rejects malicious docs", () => {
  const bad = (doc: any) => expect(validate(doc).ok).toBe(false);
  it("disallowed field", () => bad({ version: 1, name: "x", rules: [{ when: { op: "gt", args: [{ op: "field", path: "process.env" }, { op: "const", value: 0 }] }, do: { type: "idle" } }], default: { type: "idle" } }));
  it("unknown op", () => bad({ version: 1, name: "x", rules: [{ when: { op: "exec", cmd: "rm" }, do: { type: "idle" } }], default: { type: "idle" } }));
  it("bad action", () => bad({ version: 1, name: "x", rules: [], default: { type: "selfdestruct" } }));
});
