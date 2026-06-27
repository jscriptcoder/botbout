// ============================================================================
// Pretty-printer for a FightResult — the CLI fight runner's output layer. PURE:
// (result, options) → string, no I/O. The runner (fight.ts) owns stdout/stderr.
//
// Two views of the same event log:
//   • "changes" (default) — one row only when an action or a score changes from
//     the previously shown row, so a long approach/commit run collapses to its
//     turning points (the fight reads as a storyboard).
//   • "full" — one row per tick.
// ============================================================================
import type { FightResult, FightEvent, FighterFrame } from "../engine/sim.js";
import type { Action } from "../engine/types.js";

export type FormatMode = "changes" | "full";
export type FormatOptions = { seed: number; mode?: FormatMode };

// A signed dir reads "+1" / "0" / "-1" (the sign makes "toward / hold / away"
// legible at a glance).
const signed = (n: number): string => (n > 0 ? `+${n}` : `${n}`);

/** One action as a short, fixed-vocabulary label. */
export const formatAction = (a: Action): string => {
  switch (a.type) {
    case "idle":
      return "idle";
    case "move":
      return `move ${signed(a.dir)}`;
    case "block":
      return `block ${a.band}`;
    case "crouch":
      return "crouch";
    case "jump":
      return `jump ${signed(a.dir)}`;
    case "attack":
      return `${a.move} ${a.band}`;
    case "sweep":
      return "sweep";
    case "throw":
      return "throw";
    case "throw-break":
      return "break";
  }
};

// Whether a row differs from the previously shown one in any column a reader
// cares about: either fighter's action, or either fighter's score. Position
// drifts every tick during a walk, so it is deliberately NOT part of the test —
// otherwise nothing would ever collapse.
const changed = (curr: FightEvent, prev: FightEvent): boolean =>
  formatAction(curr.a.action) !== formatAction(prev.a.action) ||
  formatAction(curr.b.action) !== formatAction(prev.b.action) ||
  curr.a.points !== prev.a.points ||
  curr.b.points !== prev.b.points;

const selectRows = (events: FightEvent[], mode: FormatMode): FightEvent[] => {
  if (mode === "full") return events;

  return events.filter((e, i) => i === 0 || changed(e, events[i - 1]));
};

type Row = [string, string, string, string, string, string, string];

const rowOf = (e: FightEvent): Row => [
  `${e.tick}`,
  `${e.a.x}`,
  `${e.b.x}`,
  formatAction(e.a.action),
  formatAction(e.b.action),
  `${e.a.points}`,
  `${e.b.points}`,
];

const HEADERS: Row = ["tick", "A.x", "B.x", "A act", "B act", "A", "B"];

// Numbers right-align, action labels left-align; column widths fit the content.
const ALIGN_RIGHT = [true, true, true, false, false, true, true] as const;

const render = (rows: Row[]): string => {
  const widths = HEADERS.map((_, col) =>
    Math.max(...rows.map((r) => r[col].length)),
  );

  const line = (r: Row): string =>
    r
      .map((cell, col) =>
        ALIGN_RIGHT[col]
          ? cell.padStart(widths[col])
          : cell.padEnd(widths[col]),
      )
      .join("  ")
      .trimEnd();

  return rows.map(line).join("\n");
};

const winnerLine = (result: FightResult, seed: number): string => {
  const tag = result.winner === "draw" ? "draw" : result.winner;

  return `WINNER: ${tag}  (${result.scores.a}-${result.scores.b})  seed=${seed}  ticks=${result.ticks}`;
};

export const formatFight = (
  result: FightResult,
  opts: FormatOptions,
): string => {
  const shown = selectRows(result.events, opts.mode ?? "changes");
  const table = render([HEADERS, ...shown.map(rowOf)]);

  return `${table}\n\n${winnerLine(result, opts.seed)}`;
};

// Re-exported so the runner can hand back a typed frame in its own glue without
// re-importing sim's shape.
export type { FighterFrame };
