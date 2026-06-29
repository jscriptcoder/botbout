import { describe, it, expect } from "vitest";
import { formatAction, formatFight } from "./format.js";
import type { FightResult, FightEvent, FighterFrame } from "../engine/sim.js";
import type { Action } from "../engine/types.js";

// ─── factories ───────────────────────────────────────────────────────────────
const frame = (o: Partial<FighterFrame> = {}): FighterFrame => ({
  x: 0,
  y: 0,
  action: { type: "idle" },
  points: 0,
  stamina: 0,
  ...o,
});

const event = (
  tick: number,
  a: Partial<FighterFrame>,
  b: Partial<FighterFrame>,
): FightEvent => ({ tick, a: frame(a), b: frame(b) });

const result = (
  events: FightEvent[],
  o: Partial<FightResult> = {},
): FightResult => ({
  winner: "draw",
  ticks: events.length,
  scores: { a: 0, b: 0 },
  events,
  ...o,
});

// Count rendered fighter rows (a data row starts, once trimmed, with a digit —
// the tick number; the header starts with the word "tick").
const dataRows = (out: string): string[] =>
  out.split("\n").filter((l) => /^\s*\d/.test(l));

describe("formatAction", () => {
  it.each<[Action, string]>([
    [{ type: "idle" }, "idle"],
    [{ type: "move", dir: 1 }, "move +1"],
    [{ type: "move", dir: -1 }, "move -1"],
    [{ type: "move", dir: 0 }, "move 0"],
    [{ type: "block", band: "mid" }, "block mid"],
    [{ type: "block", band: "high" }, "block high"],
    [{ type: "crouch" }, "crouch"],
    [{ type: "jump", dir: 1 }, "jump +1"],
    [{ type: "attack", move: "gyaku-zuki", band: "high" }, "gyaku-zuki high"],
    [{ type: "sweep" }, "sweep"],
    [{ type: "throw" }, "throw"],
    [{ type: "throw-break" }, "break"],
  ])("renders %o as %s", (action, expected) => {
    expect(formatAction(action)).toBe(expected);
  });
});

describe("formatFight — layout", () => {
  it("prints a header row naming the tick and points columns", () => {
    const out = formatFight(result([event(0, {}, {})]), { seed: 1 });
    const header = out.split("\n")[0];
    expect(header).toContain("tick");
    expect(header.toLowerCase()).toContain("a");
    expect(header.toLowerCase()).toContain("b");
  });

  it("ends with a WINNER line carrying the score, seed and tick count", () => {
    const out = formatFight(
      result([event(0, { points: 3 }, { points: 1 })], {
        winner: "A",
        scores: { a: 3, b: 1 },
        ticks: 42,
      }),
      { seed: 7 },
    );

    expect(out).toMatch(/WINNER:\s*A/);
    expect(out).toContain("3-1");
    expect(out).toContain("seed=7");
    expect(out).toContain("ticks=42");
  });

  it("labels a tie as a draw", () => {
    const out = formatFight(result([event(0, {}, {})]), { seed: 1 });
    expect(out.toLowerCase()).toContain("draw");
  });
});

describe("formatFight — full vs changes mode", () => {
  // Three ticks of identical actions, then an action change, then a score change.
  const events: FightEvent[] = [
    event(
      0,
      { action: { type: "move", dir: 1 } },
      { action: { type: "idle" } },
    ),
    event(
      1,
      { action: { type: "move", dir: 1 } },
      { action: { type: "idle" } },
    ),
    event(
      2,
      { action: { type: "move", dir: 1 } },
      { action: { type: "idle" } },
    ),
    event(
      3,
      { action: { type: "attack", move: "gyaku-zuki", band: "high" } },
      { action: { type: "idle" } },
    ),
    event(
      4,
      {
        action: { type: "attack", move: "gyaku-zuki", band: "high" },
        points: 1,
      },
      { action: { type: "idle" } },
    ),
  ];

  it("emits one row per tick in full mode", () => {
    const out = formatFight(result(events), { seed: 1, mode: "full" });
    expect(dataRows(out)).toHaveLength(5);
  });

  it("collapses unchanged ticks in changes mode (the default)", () => {
    const out = formatFight(result(events), { seed: 1 });
    const rows = dataRows(out);
    // tick 0 (first), tick 3 (action change), tick 4 (score change) = 3 rows;
    // ticks 1 and 2 (identical to 0) are collapsed away.
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatch(/^\s*0\b/);
    expect(rows[1]).toMatch(/^\s*3\b/);
    expect(rows[2]).toMatch(/^\s*4\b/);
  });
});
