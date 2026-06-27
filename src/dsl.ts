// ============================================================================
// Bot DSL — AST + validator (+ interpreter, later slices). A bot is a JSON
// document, NOT source code: it cannot express I/O, loops, or recursion.
//   • Safe by construction — the vocabulary contains no dangerous ops.
//   • Worst-case cost bounded by document size — no DoS, no metering needed.
//   • Integer / fixed-point arithmetic only — replays are bit-identical.
//
// THIS FILE IS THE TRUSTED COMPUTING BASE. The allowlists + LIMITS below ARE the
// security boundary. Never add an op/field that can touch the host, network,
// filesystem, time, or randomness. Validate before run; reject with structured
// errors.
//
// Scope note (walking skeleton): this is the MINIMAL skeleton vocabulary — only
// what plan slices 1–5 need. It grows ADDITIVELY in later slices (adding an
// op/field/move never rejects a previously valid bot).
// ============================================================================

import type { State, Action, Band, MoveId } from "./types.js";

// The DSL read surface: the whitelisted state leaves a bot may read. This is the
// SINGLE source — the validator's allowlist is derived from FIELD_READERS' keys
// (below) and the interpreter reads through the same map.
export type FieldPath =
  | "self.x"
  | "self.facing"
  | "self.points"
  | "self.canAct"
  | "self.phaseRemaining"
  | "self.counterWindow"
  | "self.cancelWindow"
  | "opponent.x"
  | "opponent.y"
  | "opponent.facing"
  | "opponent.distance"
  | "opponent.attacking"
  | "opponent.attackBand"
  | "opponent.posture"
  | "opponent.vx"
  | "opponent.predictedDistance"
  | "ring.width"
  | "clock.tick"
  | "clock.ticksRemaining";

// ─── Numeric expressions (values are fixed-point integers) ───────────────────
export type NumExpr =
  | { op: "const"; value: number }
  | { op: "field"; path: FieldPath }
  | { op: "mem"; cell: string };

// ─── Boolean expressions ─────────────────────────────────────────────────────
export type BoolExpr =
  | { op: "gt" | "lt" | "gte" | "lte" | "eq" | "neq"; args: [NumExpr, NumExpr] }
  | { op: "and" | "or"; args: BoolExpr[] }
  | { op: "not"; arg: BoolExpr };

export type Rule = {
  when: BoolExpr;
  set?: { cell: string; to: NumExpr }[];
  do?: Action; // absent ⇒ tracker rule (updates memory, evaluation continues)
};

export type BotDoc = {
  version: 1;
  name: string;
  memory?: Record<string, number>;
  rules: Rule[];
  default: Action;
};

// ─── Static limits (each is a security boundary — tune during build) ─────────
export const LIMITS = {
  maxBytes: 32_768,
  maxNodes: 4_000,
  maxDepth: 32,
  maxRules: 96,
  maxCells: 24,
  intMin: -2_147_483_648,
  intMax: 2_147_483_647,
} as const;

// ─── Allowlists (the read surface + grammar the skeleton exposes) ────────────
// Field read surface: path → accessor. Total over FieldPath, so the interpreter
// never needs a fallback branch. The validator's allowlist is exactly its keys.
const FIELD_READERS: Record<FieldPath, (s: State) => number> = {
  "self.x": (s) => s.self.x,
  "self.facing": (s) => s.self.facing,
  "self.points": (s) => s.self.points,
  "self.canAct": (s) => (s.self.canAct ? 1 : 0),
  "self.phaseRemaining": (s) => s.self.phaseRemaining,
  "self.counterWindow": (s) => s.self.counterWindow,
  "self.cancelWindow": (s) => s.self.cancelWindow,
  "opponent.x": (s) => s.opponent.x,
  "opponent.y": (s) => s.opponent.y,
  "opponent.facing": (s) => s.opponent.facing,
  "opponent.distance": (s) => s.opponent.distance,
  "opponent.attacking": (s) => (s.opponent.attacking ? 1 : 0),
  "opponent.attackBand": (s) => s.opponent.attackBand,
  "opponent.posture": (s) => s.opponent.posture,
  "opponent.vx": (s) => s.opponent.vx,
  "opponent.predictedDistance": (s) => s.opponent.predictedDistance,
  "ring.width": (s) => s.ring.width,
  "clock.tick": (s) => s.clock.tick,
  "clock.ticksRemaining": (s) => s.clock.ticksRemaining,
};

const ALLOWED_FIELDS: ReadonlySet<string> = new Set(Object.keys(FIELD_READERS));
const MOVES: ReadonlySet<string> = new Set<MoveId>(["strike"]);
const BANDS: ReadonlySet<string> = new Set<Band>(["high", "mid", "low"]);
const CELL_RE = /^[a-zA-Z][a-zA-Z0-9_]{0,31}$/;

const FORBIDDEN_KEYS: ReadonlySet<string> = new Set([
  "__proto__",
  "constructor",
  "prototype",
]);

const isInt = (x: unknown): x is number => Number.isInteger(x);

const asRecord = (x: unknown): Record<string, unknown> =>
  x != null && typeof x === "object" ? (x as Record<string, unknown>) : {};

// ─── Structured validation result ────────────────────────────────────────────
export type ValidationIssue = { path: string; reason: string };
export type ValidationResult = {
  ok: boolean;
  issues: ValidationIssue[];
  nodeCount: number;
};

export class ValidationError extends Error {
  constructor(public readonly issues: ValidationIssue[]) {
    super(issues.map((i) => `${i.path}: ${i.reason}`).join("; "));
    this.name = "ValidationError";
  }
}

/** Prototype-pollution-safe JSON intake. Reject oversize docs and dangerous keys. */
export function safeParse(text: string): unknown {
  if (text.length > LIMITS.maxBytes) {
    throw new ValidationError([
      { path: "$", reason: `document exceeds ${LIMITS.maxBytes} bytes` },
    ]);
  }

  return JSON.parse(text, (key, value) => {
    if (FORBIDDEN_KEYS.has(key)) {
      throw new ValidationError([{ path: key, reason: "forbidden key" }]);
    }

    return value;
  });
}

// ─── Validator ───────────────────────────────────────────────────────────────
export function validate(doc: unknown): ValidationResult {
  const issues: ValidationIssue[] = [];

  const fail = (path: string, reason: string): void => {
    issues.push({ path, reason });
  };

  let nodeCount = 0;
  const cells = new Set<string>();

  const d = asRecord(doc);

  if (d.version !== 1) fail("version", "must be 1");

  if (typeof d.name !== "string" || d.name.length < 1 || d.name.length > 64) {
    fail("name", "must be a string of 1..64 characters");
  }

  if (d.memory != null) {
    if (typeof d.memory !== "object") {
      fail("memory", "must be an object");
    } else {
      const mem = d.memory as Record<string, unknown>;
      const keys = Object.keys(mem);
      if (keys.length > LIMITS.maxCells)
        fail("memory", `more than ${LIMITS.maxCells} cells`);

      for (const k of keys) {
        if (!CELL_RE.test(k)) fail(`memory.${k}`, "invalid cell name");
        if (!isInt(mem[k]))
          fail(`memory.${k}`, "initial value must be an integer");
        cells.add(k);
      }
    }
  }

  const num = (n: unknown, path: string, depth: number): void => {
    if (++nodeCount > LIMITS.maxNodes)
      return fail(path, "node budget exceeded");
    if (depth > LIMITS.maxDepth)
      return fail(path, "expression too deeply nested");
    if (n == null || typeof n !== "object")
      return fail(path, "expected a numeric expression");
    const e = n as Record<string, unknown>;

    switch (e.op) {
      case "const": {
        const v = e.value;
        if (!isInt(v)) fail(path, "const must be an integer");
        else if (v < LIMITS.intMin || v > LIMITS.intMax)
          fail(path, "const out of int32 range");
        break;
      }

      case "field":
        if (typeof e.path !== "string" || !ALLOWED_FIELDS.has(e.path)) {
          fail(path, `field not allowed: ${String(e.path)}`);
        }

        break;
      case "mem":
        if (typeof e.cell !== "string" || !cells.has(e.cell)) {
          fail(path, `undeclared cell: ${String(e.cell)}`);
        }

        break;
      default:
        fail(path, `unknown numeric op: ${String(e.op)}`);
    }
  };

  const bool = (n: unknown, path: string, depth: number): void => {
    if (++nodeCount > LIMITS.maxNodes)
      return fail(path, "node budget exceeded");
    if (depth > LIMITS.maxDepth)
      return fail(path, "condition too deeply nested");
    if (n == null || typeof n !== "object")
      return fail(path, "expected a condition");
    const e = n as Record<string, unknown>;

    switch (e.op) {
      case "gt":
      case "lt":
      case "gte":
      case "lte":
      case "eq":
      case "neq":
        if (!Array.isArray(e.args) || e.args.length !== 2)
          fail(path, `${String(e.op)} needs 2 operands`);
        else
          e.args.forEach((a, i) =>
            num(a, `${path}.${String(e.op)}[${i}]`, depth + 1),
          );
        break;
      case "and":
      case "or":
        if (!Array.isArray(e.args) || e.args.length < 1)
          fail(path, `${String(e.op)} needs at least one operand`);
        else
          e.args.forEach((a, i) =>
            bool(a, `${path}.${String(e.op)}[${i}]`, depth + 1),
          );
        break;
      case "not":
        bool(e.arg, `${path}.not`, depth + 1);
        break;
      default:
        fail(path, `unknown boolean op: ${String(e.op)}`);
    }
  };

  const action = (a: unknown, path: string): void => {
    if (a == null || typeof a !== "object")
      return fail(path, "expected an action");
    const e = a as Record<string, unknown>;

    switch (e.type) {
      case "idle":
        break;
      case "move":
        if (e.dir !== -1 && e.dir !== 0 && e.dir !== 1)
          fail(path, "move dir must be -1, 0, or 1");
        break;
      case "block":
        if (typeof e.band !== "string" || !BANDS.has(e.band))
          fail(path, `unknown band: ${String(e.band)}`);
        break;
      case "crouch":
        break;
      case "throw":
        break;
      case "throw-break":
        break;
      case "jump":
        if (e.dir !== -1 && e.dir !== 0 && e.dir !== 1)
          fail(path, "jump dir must be -1, 0, or 1");
        break;
      case "attack":
        if (typeof e.move !== "string" || !MOVES.has(e.move))
          fail(path, `unknown move: ${String(e.move)}`);
        if (typeof e.band !== "string" || !BANDS.has(e.band))
          fail(path, `unknown band: ${String(e.band)}`);
        break;
      default:
        fail(path, `unknown action: ${String(e.type)}`);
    }
  };

  if (!Array.isArray(d.rules)) {
    fail("rules", "must be an array");
  } else {
    if (d.rules.length > LIMITS.maxRules)
      fail("rules", `more than ${LIMITS.maxRules} rules`);
    d.rules.forEach((r, i) => {
      const rule = asRecord(r);
      bool(rule.when, `rules[${i}].when`, 0);

      if (rule.set != null) {
        if (!Array.isArray(rule.set)) {
          fail(`rules[${i}].set`, "must be an array");
        } else {
          rule.set.forEach((s, j) => {
            const w = asRecord(s);

            if (typeof w.cell !== "string" || !cells.has(w.cell)) {
              fail(
                `rules[${i}].set[${j}].cell`,
                `undeclared cell: ${String(w.cell)}`,
              );
            }

            num(w.to, `rules[${i}].set[${j}].to`, 0);
          });
        }
      }

      if (rule.do != null) action(rule.do, `rules[${i}].do`);
    });
  }

  action(d.default, "default");

  return { ok: issues.length === 0, issues, nodeCount };
}

// ─── Interpreter ─────────────────────────────────────────────────────────────
// Operates on an ALREADY-VALIDATED BotDoc. Pure w.r.t. (doc, state); the only
// effect is writing the per-fighter `mem` the engine threads across ticks.
function evalNum(
  n: NumExpr,
  state: State,
  mem: Record<string, number>,
): number {
  switch (n.op) {
    case "const":
      return n.value;
    case "field":
      return FIELD_READERS[n.path](state);
    case "mem":
      return mem[n.cell] ?? 0;
  }
}

function evalBool(
  n: BoolExpr,
  state: State,
  mem: Record<string, number>,
): boolean {
  switch (n.op) {
    case "gt":
      return evalNum(n.args[0], state, mem) > evalNum(n.args[1], state, mem);
    case "lt":
      return evalNum(n.args[0], state, mem) < evalNum(n.args[1], state, mem);
    case "gte":
      return evalNum(n.args[0], state, mem) >= evalNum(n.args[1], state, mem);
    case "lte":
      return evalNum(n.args[0], state, mem) <= evalNum(n.args[1], state, mem);
    case "eq":
      return evalNum(n.args[0], state, mem) === evalNum(n.args[1], state, mem);
    case "neq":
      return evalNum(n.args[0], state, mem) !== evalNum(n.args[1], state, mem);
    case "and":
      return n.args.every((a) => evalBool(a, state, mem));
    case "or":
      return n.args.some((a) => evalBool(a, state, mem));
    case "not":
      return !evalBool(n.arg, state, mem);
  }
}

/**
 * Run one tick for one fighter. Rules evaluate top-to-bottom; the first rule
 * whose `when` holds and that carries a `do` returns the tick's Action. A rule
 * with no `do` is a TRACKER: its `set` writes apply and evaluation continues.
 * No rule fires ⇒ `default`. Mutates `mem` in place (the engine owns it).
 */
export function runTick(
  doc: BotDoc,
  state: State,
  mem: Record<string, number>,
): Action {
  for (const rule of doc.rules) {
    if (!evalBool(rule.when, state, mem)) continue;
    if (rule.set)
      for (const w of rule.set) mem[w.cell] = evalNum(w.to, state, mem);
    if (rule.do) return rule.do;
  }

  return doc.default;
}
