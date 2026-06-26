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

export type Band = "high" | "mid" | "low";
export type MoveId = "strike";

// ─── Numeric expressions (values are fixed-point integers) ───────────────────
export type NumExpr =
  | { op: "const"; value: number }
  | { op: "field"; path: string }
  | { op: "mem"; cell: string };

// ─── Boolean expressions ─────────────────────────────────────────────────────
export type BoolExpr =
  | { op: "gt" | "lt" | "gte" | "lte" | "eq" | "neq"; args: [NumExpr, NumExpr] }
  | { op: "and" | "or"; args: BoolExpr[] }
  | { op: "not"; arg: BoolExpr };

// ─── Action grammar — a bot returns exactly ONE per tick ─────────────────────
// `dir` is RELATIVE to facing: +1 = toward opponent, -1 = away, 0 = hold.
export type Action =
  | { type: "idle" }
  | { type: "move"; dir: -1 | 0 | 1 }
  | { type: "block"; band: Band }
  | { type: "attack"; move: MoveId; band: Band };

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
const ALLOWED_FIELDS: ReadonlySet<string> = new Set([
  "self.x", "self.facing", "self.points", "self.canAct", "self.phaseRemaining",
  "opponent.x", "opponent.facing", "opponent.distance",
  "ring.width", "clock.tick", "clock.ticksRemaining",
]);
const MOVES: ReadonlySet<string> = new Set<MoveId>(["strike"]);
const BANDS: ReadonlySet<string> = new Set<Band>(["high", "mid", "low"]);
const CELL_RE = /^[a-zA-Z][a-zA-Z0-9_]{0,31}$/;
const FORBIDDEN_KEYS: ReadonlySet<string> = new Set(["__proto__", "constructor", "prototype"]);

const isInt = (x: unknown): x is number => Number.isInteger(x);
const asRecord = (x: unknown): Record<string, unknown> =>
  x != null && typeof x === "object" ? (x as Record<string, unknown>) : {};

// ─── Structured validation result ────────────────────────────────────────────
export type ValidationIssue = { path: string; reason: string };
export type ValidationResult = { ok: boolean; issues: ValidationIssue[]; nodeCount: number };

export class ValidationError extends Error {
  constructor(public readonly issues: ValidationIssue[]) {
    super(issues.map((i) => `${i.path}: ${i.reason}`).join("; "));
    this.name = "ValidationError";
  }
}

/** Prototype-pollution-safe JSON intake. Reject oversize docs and dangerous keys. */
export function safeParse(text: string): unknown {
  if (text.length > LIMITS.maxBytes) {
    throw new ValidationError([{ path: "$", reason: `document exceeds ${LIMITS.maxBytes} bytes` }]);
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
  const fail = (path: string, reason: string): void => { issues.push({ path, reason }); };
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
      if (keys.length > LIMITS.maxCells) fail("memory", `more than ${LIMITS.maxCells} cells`);
      for (const k of keys) {
        if (!CELL_RE.test(k)) fail(`memory.${k}`, "invalid cell name");
        if (!isInt(mem[k])) fail(`memory.${k}`, "initial value must be an integer");
        cells.add(k);
      }
    }
  }

  const num = (n: unknown, path: string, depth: number): void => {
    if (++nodeCount > LIMITS.maxNodes) return fail(path, "node budget exceeded");
    if (depth > LIMITS.maxDepth) return fail(path, "expression too deeply nested");
    if (n == null || typeof n !== "object") return fail(path, "expected a numeric expression");
    const e = n as Record<string, unknown>;
    switch (e.op) {
      case "const": {
        const v = e.value;
        if (!isInt(v)) fail(path, "const must be an integer");
        else if (v < LIMITS.intMin || v > LIMITS.intMax) fail(path, "const out of int32 range");
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
    if (++nodeCount > LIMITS.maxNodes) return fail(path, "node budget exceeded");
    if (depth > LIMITS.maxDepth) return fail(path, "condition too deeply nested");
    if (n == null || typeof n !== "object") return fail(path, "expected a condition");
    const e = n as Record<string, unknown>;
    switch (e.op) {
      case "gt": case "lt": case "gte": case "lte": case "eq": case "neq":
        if (!Array.isArray(e.args) || e.args.length !== 2) fail(path, `${String(e.op)} needs 2 operands`);
        else e.args.forEach((a, i) => num(a, `${path}.${String(e.op)}[${i}]`, depth + 1));
        break;
      case "and": case "or":
        if (!Array.isArray(e.args) || e.args.length < 1) fail(path, `${String(e.op)} needs at least one operand`);
        else e.args.forEach((a, i) => bool(a, `${path}.${String(e.op)}[${i}]`, depth + 1));
        break;
      case "not":
        bool(e.arg, `${path}.not`, depth + 1);
        break;
      default:
        fail(path, `unknown boolean op: ${String(e.op)}`);
    }
  };

  const action = (a: unknown, path: string): void => {
    if (a == null || typeof a !== "object") return fail(path, "expected an action");
    const e = a as Record<string, unknown>;
    switch (e.type) {
      case "idle":
        break;
      case "move":
        if (e.dir !== -1 && e.dir !== 0 && e.dir !== 1) fail(path, "move dir must be -1, 0, or 1");
        break;
      case "block":
        if (typeof e.band !== "string" || !BANDS.has(e.band)) fail(path, `unknown band: ${String(e.band)}`);
        break;
      case "attack":
        if (typeof e.move !== "string" || !MOVES.has(e.move)) fail(path, `unknown move: ${String(e.move)}`);
        if (typeof e.band !== "string" || !BANDS.has(e.band)) fail(path, `unknown band: ${String(e.band)}`);
        break;
      default:
        fail(path, `unknown action: ${String(e.type)}`);
    }
  };

  if (!Array.isArray(d.rules)) {
    fail("rules", "must be an array");
  } else {
    if (d.rules.length > LIMITS.maxRules) fail("rules", `more than ${LIMITS.maxRules} rules`);
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
              fail(`rules[${i}].set[${j}].cell`, `undeclared cell: ${String(w.cell)}`);
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
