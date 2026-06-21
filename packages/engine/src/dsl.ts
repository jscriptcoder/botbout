// ============================================================================
// Bot DSL — AST, validator, interpreter. A bot is a JSON document, NOT source
// code. It cannot express I/O, loops, or recursion. Consequences:
//   • Safe by construction — the vocabulary contains no dangerous ops.
//   • Worst-case cost bounded by document size — no DoS, no metering needed.
//   • Integer/fixed-point arithmetic only — replays are bit-identical.
// THIS FILE IS THE TRUSTED COMPUTING BASE. Never add an op that touches the
// host, the network, the filesystem, time, or randomness.
// ============================================================================
import type { State, Rules, MoveName, MoveStat, Phase, Action, AllowedField } from "./types.js";

// ─── Numeric expressions (values are fixed-point integers) ───────────────────
export type NumExpr =
  | { op: "const"; value: number }
  | { op: "field"; path: AllowedField }
  | { op: "mem"; cell: string }
  | { op: "rule"; move: MoveName; stat: MoveStat }
  | { op: "latency"; of: "action" | "position" }
  | { op: "add" | "sub" | "mul" | "min" | "max"; args: NumExpr[] }
  | { op: "div"; args: [NumExpr, NumExpr] }   // ÷0 := 0
  | { op: "neg" | "abs"; arg: NumExpr };

// ─── Boolean expressions ─────────────────────────────────────────────────────
export type BoolExpr =
  | { op: "gt" | "lt" | "gte" | "lte" | "eq" | "neq"; args: [NumExpr, NumExpr] }
  | { op: "and" | "or"; args: BoolExpr[] }
  | { op: "not"; arg: BoolExpr }
  | { op: "phase"; who: "self" | "opponent"; is: Phase }
  | { op: "move_is"; who: "self" | "opponent"; move: MoveName | null };

export interface Rule {
  when: BoolExpr;
  set?: { cell: string; to: NumExpr }[];
  do?: Action;   // absent ⇒ tracker rule (updates memory, evaluation continues)
}

export interface BotDoc {
  version: 1;
  name: string;
  memory?: Record<string, number>;
  rules: Rule[];
  default: Action;
}

// ─── Allowlists & static limits (each is a security boundary) ────────────────
const ALLOWED_FIELDS = new Set<string>([
  "self.hp", "self.stamina", "self.x", "self.facing", "self.phaseRemaining", "self.canAct",
  "opponent.x", "opponent.vx", "opponent.distance", "opponent.predictedDistance",
  "opponent.hp", "opponent.stamina", "opponent.facing",
  "opponent.staleness", "opponent.phaseElapsed", "opponent.moveRecoveryRemaining",
  "ring.width", "clock.tick", "clock.ticksRemaining",
]);
const MOVES = new Set(["punch", "kick", "grab", "dodge"]);
const MOVE_STATS = new Set(["startup", "active", "recovery", "damage", "staminaCost", "range", "onBlock"]);
const PHASES = new Set(["idle", "startup", "active", "recovery", "blocking", "stunned", "dodging"]);

export const LIMITS = {
  maxBytes: 16_384, maxNodes: 2_000, maxDepth: 32, maxRules: 64, maxCells: 16,
  intMin: -2_147_483_648, intMax: 2_147_483_647,
};
const CELL_RE = /^[a-zA-Z][a-zA-Z0-9_]{0,31}$/;

const isInt = (x: any): x is number => typeof x === "number" && Number.isInteger(x);
const clampInt = (x: number) => Math.max(LIMITS.intMin, Math.min(LIMITS.intMax, Math.trunc(x)));

export interface ValidationIssue { path: string; reason: string; }
export class ValidationError extends Error {
  constructor(public issues: ValidationIssue[]) {
    super(issues.map((i) => `${i.path}: ${i.reason}`).join("; "));
  }
}

/** Prototype-pollution-safe JSON intake. Reject dangerous keys and oversize docs. */
export function safeParse(text: string): unknown {
  if (text.length > LIMITS.maxBytes) {
    throw new ValidationError([{ path: "$", reason: `document exceeds ${LIMITS.maxBytes} bytes` }]);
  }
  return JSON.parse(text, (k, v) => {
    if (k === "__proto__" || k === "constructor" || k === "prototype") {
      throw new ValidationError([{ path: k, reason: "forbidden key" }]);
    }
    return v;
  });
}

// ─── Validator ───────────────────────────────────────────────────────────────
export function validate(doc: any): { ok: boolean; issues: ValidationIssue[]; nodeCount: number } {
  const issues: ValidationIssue[] = [];
  let nodeCount = 0;
  const cells = new Set<string>();
  const fail = (path: string, reason: string): void => { issues.push({ path, reason }); };

  if (doc?.version !== 1) fail("version", "must be 1");
  if (typeof doc?.name !== "string" || doc.name.length > 64) fail("name", "string ≤ 64 chars");

  if (doc?.memory != null) {
    const keys = Object.keys(doc.memory);
    if (keys.length > LIMITS.maxCells) fail("memory", `> ${LIMITS.maxCells} cells`);
    for (const k of keys) {
      if (!CELL_RE.test(k)) fail(`memory.${k}`, "bad cell name");
      if (!isInt(doc.memory[k])) fail(`memory.${k}`, "initial value must be an integer");
      cells.add(k);
    }
  }

  const num = (n: any, path: string, depth: number): void => {
    if (++nodeCount > LIMITS.maxNodes) return fail(path, "node budget exceeded");
    if (depth > LIMITS.maxDepth) return fail(path, "too deeply nested");
    if (!n || typeof n !== "object") return fail(path, "expected expression");
    switch (n.op) {
      case "const":
        if (!isInt(n.value) || n.value < LIMITS.intMin || n.value > LIMITS.intMax) fail(path, "const must be int32");
        break;
      case "field": if (!ALLOWED_FIELDS.has(n.path)) fail(path, `field not allowed: ${n.path}`); break;
      case "mem": if (!cells.has(n.cell)) fail(path, `undeclared cell: ${n.cell}`); break;
      case "rule":
        if (!MOVES.has(n.move)) fail(path, "bad move");
        if (!MOVE_STATS.has(n.stat)) fail(path, "bad stat");
        break;
      case "latency": if (n.of !== "action" && n.of !== "position") fail(path, "bad latency selector"); break;
      case "add": case "sub": case "mul": case "min": case "max":
        if (!Array.isArray(n.args) || n.args.length < 1) fail(path, "needs args");
        else n.args.forEach((a: any, i: number) => num(a, `${path}.${n.op}[${i}]`, depth + 1));
        break;
      case "div":
        if (!Array.isArray(n.args) || n.args.length !== 2) fail(path, "div needs 2 args");
        else n.args.forEach((a: any, i: number) => num(a, `${path}.div[${i}]`, depth + 1));
        break;
      case "neg": case "abs": num(n.arg, `${path}.${n.op}`, depth + 1); break;
      default: fail(path, `unknown numeric op: ${n.op}`);
    }
  };

  const bool = (n: any, path: string, depth: number): void => {
    if (++nodeCount > LIMITS.maxNodes) return fail(path, "node budget exceeded");
    if (depth > LIMITS.maxDepth) return fail(path, "too deeply nested");
    if (!n || typeof n !== "object") return fail(path, "expected condition");
    switch (n.op) {
      case "gt": case "lt": case "gte": case "lte": case "eq": case "neq":
        if (!Array.isArray(n.args) || n.args.length !== 2) fail(path, "needs 2 operands");
        else n.args.forEach((a: any, i: number) => num(a, `${path}.${n.op}[${i}]`, depth + 1));
        break;
      case "and": case "or":
        if (!Array.isArray(n.args) || n.args.length < 1) fail(path, "needs args");
        else n.args.forEach((a: any, i: number) => bool(a, `${path}.${n.op}[${i}]`, depth + 1));
        break;
      case "not": bool(n.arg, `${path}.not`, depth + 1); break;
      case "phase":
        if (n.who !== "self" && n.who !== "opponent") fail(path, "bad who");
        if (!PHASES.has(n.is)) fail(path, "bad phase");
        break;
      case "move_is":
        if (n.who !== "self" && n.who !== "opponent") fail(path, "bad who");
        if (n.move !== null && !MOVES.has(n.move)) fail(path, "bad move");
        break;
      default: fail(path, `unknown boolean op: ${n.op}`);
    }
  };

  const action = (a: any, path: string): void => {
    if (!a || typeof a !== "object") return fail(path, "expected action");
    switch (a.type) {
      case "idle": case "block": case "punch": case "kick": case "grab": break;
      case "move": if (![-1, 0, 1].includes(a.dir)) fail(path, "dir must be -1|0|1"); break;
      case "dodge": if (![-1, 1].includes(a.dir)) fail(path, "dir must be -1|1"); break;
      default: fail(path, `unknown action: ${a.type}`);
    }
  };

  if (!Array.isArray(doc?.rules)) fail("rules", "must be an array");
  else {
    if (doc.rules.length > LIMITS.maxRules) fail("rules", `> ${LIMITS.maxRules} rules`);
    doc.rules.forEach((r: any, i: number) => {
      bool(r?.when, `rules[${i}].when`, 0);
      if (r?.set != null) {
        if (!Array.isArray(r.set)) fail(`rules[${i}].set`, "must be array");
        else r.set.forEach((s: any, j: number) => {
          if (!cells.has(s?.cell)) fail(`rules[${i}].set[${j}].cell`, "undeclared cell");
          num(s?.to, `rules[${i}].set[${j}].to`, 0);
        });
      }
      if (r?.do != null) action(r.do, `rules[${i}].do`);
    });
  }
  action(doc?.default, "default");

  return { ok: issues.length === 0, issues, nodeCount };
}

// ─── Interpreter ─────────────────────────────────────────────────────────────
function readField(state: State, path: string): number {
  const [grp, key] = path.split(".") as [keyof State, string];
  const v = (state[grp] as any)[key];
  if (typeof v === "boolean") return v ? 1 : 0;
  return clampInt(v);
}

function evalNum(n: NumExpr, st: State, R: Rules, mem: Record<string, number>): number {
  switch (n.op) {
    case "const": return n.value;
    case "field": return readField(st, n.path);
    case "mem": return mem[n.cell] ?? 0;
    case "rule": return clampInt(R.moves[n.move][n.stat] as number);
    case "latency": return R.latency[n.of];
    case "add": return clampInt(n.args.reduce((s, a) => s + evalNum(a, st, R, mem), 0));
    case "sub": return clampInt(n.args.slice(1).reduce((s, a) => s - evalNum(a, st, R, mem), evalNum(n.args[0], st, R, mem)));
    case "mul": return clampInt(n.args.reduce((s, a) => s * evalNum(a, st, R, mem), 1));
    case "min": return clampInt(Math.min(...n.args.map((a) => evalNum(a, st, R, mem))));
    case "max": return clampInt(Math.max(...n.args.map((a) => evalNum(a, st, R, mem))));
    case "div": { const b = evalNum(n.args[1], st, R, mem); return b === 0 ? 0 : clampInt(evalNum(n.args[0], st, R, mem) / b); }
    case "neg": return clampInt(-evalNum(n.arg, st, R, mem));
    case "abs": return clampInt(Math.abs(evalNum(n.arg, st, R, mem)));
  }
}

function evalBool(n: BoolExpr, st: State, R: Rules, mem: Record<string, number>): boolean {
  switch (n.op) {
    case "gt": return evalNum(n.args[0], st, R, mem) > evalNum(n.args[1], st, R, mem);
    case "lt": return evalNum(n.args[0], st, R, mem) < evalNum(n.args[1], st, R, mem);
    case "gte": return evalNum(n.args[0], st, R, mem) >= evalNum(n.args[1], st, R, mem);
    case "lte": return evalNum(n.args[0], st, R, mem) <= evalNum(n.args[1], st, R, mem);
    case "eq": return evalNum(n.args[0], st, R, mem) === evalNum(n.args[1], st, R, mem);
    case "neq": return evalNum(n.args[0], st, R, mem) !== evalNum(n.args[1], st, R, mem);
    case "and": return n.args.every((a) => evalBool(a, st, R, mem));
    case "or": return n.args.some((a) => evalBool(a, st, R, mem));
    case "not": return !evalBool(n.arg, st, R, mem);
    case "phase": return (st as any)[n.who].phase === n.is;
    case "move_is": return ((st as any)[n.who].move ?? null) === n.move;
  }
}

/**
 * Run one tick for one fighter. Pure: identical (doc, state, mem) ⇒ identical
 * action and identical mutation of `mem`. The engine must call this for BOTH
 * fighters against the SAME pre-tick snapshot, then resolve actions together.
 */
export function runTick(doc: BotDoc, st: State, R: Rules, mem: Record<string, number>): Action {
  for (const rule of doc.rules) {
    if (!evalBool(rule.when, st, R, mem)) continue;
    if (rule.set) for (const s of rule.set) mem[s.cell] = clampInt(evalNum(s.to, st, R, mem));
    if (rule.do) return rule.do;
  }
  return doc.default;
}
