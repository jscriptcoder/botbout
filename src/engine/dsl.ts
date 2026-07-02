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

import type { State, Action, Band, MoveId, Rules } from "./types.js";

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
  | "self.finishWindow"
  | "self.stamina"
  | "self.gassed"
  | "self.penalties"
  | "self.passivityRemaining"
  | "opponent.x"
  | "opponent.y"
  | "opponent.facing"
  | "opponent.distance"
  | "opponent.attacking"
  | "opponent.attackBand"
  | "opponent.posture"
  | "opponent.throwing"
  | "opponent.knockdown"
  | "opponent.vx"
  | "opponent.predictedDistance"
  | "opponent.stamina"
  | "opponent.gassed"
  | "opponent.points"
  | "opponent.penalties"
  | "opponent.passivityRemaining"
  | "ring.width"
  | "clock.tick"
  | "clock.ticksRemaining"
  | "clock.overtime";

// ─── Numeric expressions (values are fixed-point integers) ───────────────────
// Arithmetic is int32-saturating: every op clamps its result to
// [LIMITS.intMin, LIMITS.intMax]; `div` truncates toward zero and ÷0 := 0.
export type NumExpr =
  | { op: "const"; value: number }
  | { op: "field"; path: FieldPath }
  | { op: "mem"; cell: string }
  | { op: "add" | "mul" | "min" | "max"; args: NumExpr[] }
  | { op: "sub" | "div"; args: [NumExpr, NumExpr] }
  | { op: "neg" | "abs"; arg: NumExpr }
  | { op: "rule"; path: RulePath };

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
  "self.finishWindow": (s) => s.self.finishWindow,
  "self.stamina": (s) => s.self.stamina,
  "self.gassed": (s) => s.self.gassed,
  "self.penalties": (s) => s.self.penalties,
  "self.passivityRemaining": (s) => s.self.passivityRemaining,
  "opponent.x": (s) => s.opponent.x,
  "opponent.y": (s) => s.opponent.y,
  "opponent.facing": (s) => s.opponent.facing,
  "opponent.distance": (s) => s.opponent.distance,
  "opponent.attacking": (s) => (s.opponent.attacking ? 1 : 0),
  "opponent.attackBand": (s) => s.opponent.attackBand,
  "opponent.posture": (s) => s.opponent.posture,
  "opponent.throwing": (s) => (s.opponent.throwing ? 1 : 0),
  "opponent.knockdown": (s) => (s.opponent.knockdown ? 1 : 0),
  "opponent.vx": (s) => s.opponent.vx,
  "opponent.predictedDistance": (s) => s.opponent.predictedDistance,
  "opponent.stamina": (s) => s.opponent.stamina,
  "opponent.gassed": (s) => (s.opponent.gassed ? 1 : 0),
  "opponent.points": (s) => s.opponent.points,
  "opponent.penalties": (s) => s.opponent.penalties,
  "opponent.passivityRemaining": (s) => s.opponent.passivityRemaining,
  "ring.width": (s) => s.ring.width,
  "clock.tick": (s) => s.clock.tick,
  "clock.ticksRemaining": (s) => s.clock.ticksRemaining,
  "clock.overtime": (s) => s.clock.overtime,
};

export const ALLOWED_FIELDS: ReadonlySet<string> = new Set(
  Object.keys(FIELD_READERS),
);

// Rule read surface: the frozen-ruleset constants a bot reads symbolically via
// `rule(path)`. EVERY numeric leaf of the Rules shape ("nothing withheld") — its
// keys ARE the validator allowlist, and the interpreter reads through the same
// map. An optional/unconfigured constant reads the inert sentinel 0 (never
// throws), matching the engine's convention; the validator stays rules-agnostic
// (a path is valid by SHAPE, so validate-once / run-on-any-rules holds). Trusted
// Rules data, not bot input — reads are pure and cannot reach beyond these
// constants. `satisfies` keeps the literal keys so RulePath derives from them.
export const RULE_READERS = {
  tickRate: (r: Rules) => r.tickRate,
  walkSpeed: (r: Rules) => r.walkSpeed,
  "ring.width": (r: Rules) => r.ring.width,
  startGap: (r: Rules) => r.startGap,
  "moves.gyaku-zuki.startup": (r: Rules) => r.moves["gyaku-zuki"].startup,
  "moves.gyaku-zuki.active": (r: Rules) => r.moves["gyaku-zuki"].active,
  "moves.gyaku-zuki.recovery": (r: Rules) => r.moves["gyaku-zuki"].recovery,
  "moves.gyaku-zuki.score": (r: Rules) => r.moves["gyaku-zuki"].score,
  "moves.gyaku-zuki.reach": (r: Rules) => r.moves["gyaku-zuki"].reach,
  "moves.gyaku-zuki.staminaCost": (r: Rules) =>
    r.moves["gyaku-zuki"].staminaCost ?? 0,
  "moves.sweep.startup": (r: Rules) => r.moves.sweep?.startup ?? 0,
  "moves.sweep.active": (r: Rules) => r.moves.sweep?.active ?? 0,
  "moves.sweep.recovery": (r: Rules) => r.moves.sweep?.recovery ?? 0,
  "moves.sweep.score": (r: Rules) => r.moves.sweep?.score ?? 0,
  "moves.sweep.reach": (r: Rules) => r.moves.sweep?.reach ?? 0,
  "moves.sweep.staminaCost": (r: Rules) => r.moves.sweep?.staminaCost ?? 0,
  "moves.kizami-zuki.startup": (r: Rules) =>
    r.moves["kizami-zuki"]?.startup ?? 0,
  "moves.kizami-zuki.active": (r: Rules) => r.moves["kizami-zuki"]?.active ?? 0,
  "moves.kizami-zuki.recovery": (r: Rules) =>
    r.moves["kizami-zuki"]?.recovery ?? 0,
  "moves.kizami-zuki.score": (r: Rules) => r.moves["kizami-zuki"]?.score ?? 0,
  "moves.kizami-zuki.reach": (r: Rules) => r.moves["kizami-zuki"]?.reach ?? 0,
  "moves.kizami-zuki.staminaCost": (r: Rules) =>
    r.moves["kizami-zuki"]?.staminaCost ?? 0,
  "moves.mae-geri.startup": (r: Rules) => r.moves["mae-geri"]?.startup ?? 0,
  "moves.mae-geri.active": (r: Rules) => r.moves["mae-geri"]?.active ?? 0,
  "moves.mae-geri.recovery": (r: Rules) => r.moves["mae-geri"]?.recovery ?? 0,
  "moves.mae-geri.score": (r: Rules) => r.moves["mae-geri"]?.score ?? 0,
  "moves.mae-geri.reach": (r: Rules) => r.moves["mae-geri"]?.reach ?? 0,
  "moves.mae-geri.staminaCost": (r: Rules) =>
    r.moves["mae-geri"]?.staminaCost ?? 0,
  "moves.mawashi-geri.startup": (r: Rules) =>
    r.moves["mawashi-geri"]?.startup ?? 0,
  "moves.mawashi-geri.active": (r: Rules) =>
    r.moves["mawashi-geri"]?.active ?? 0,
  "moves.mawashi-geri.recovery": (r: Rules) =>
    r.moves["mawashi-geri"]?.recovery ?? 0,
  "moves.mawashi-geri.score": (r: Rules) => r.moves["mawashi-geri"]?.score ?? 0,
  "moves.mawashi-geri.reach": (r: Rules) => r.moves["mawashi-geri"]?.reach ?? 0,
  "moves.mawashi-geri.staminaCost": (r: Rules) =>
    r.moves["mawashi-geri"]?.staminaCost ?? 0,
  "moves.mawashi-geri.scoreByBand.high": (r: Rules) =>
    r.moves["mawashi-geri"]?.scoreByBand?.high ?? 0,
  "throw.startup": (r: Rules) => r.throw?.startup ?? 0,
  "throw.active": (r: Rules) => r.throw?.active ?? 0,
  "throw.recovery": (r: Rules) => r.throw?.recovery ?? 0,
  "throw.reach": (r: Rules) => r.throw?.reach ?? 0,
  "throw.score": (r: Rules) => r.throw?.score ?? 0,
  "throw.staminaCost": (r: Rules) => r.throw?.staminaCost ?? 0,
  jumpImpulse: (r: Rules) => r.jumpImpulse ?? 0,
  gravity: (r: Rules) => r.gravity ?? 0,
  lowClearance: (r: Rules) => r.lowClearance ?? 0,
  parryWindow: (r: Rules) => r.parryWindow ?? 0,
  parryRecovery: (r: Rules) => r.parryRecovery ?? 0,
  counterWindow: (r: Rules) => r.counterWindow ?? 0,
  counterBonus: (r: Rules) => r.counterBonus ?? 0,
  cancelWindow: (r: Rules) => r.cancelWindow ?? 0,
  knockdownDuration: (r: Rules) => r.knockdownDuration ?? 0,
  finishWindow: (r: Rules) => r.finishWindow ?? 0,
  finishScore: (r: Rules) => r.finishScore ?? 0,
  "perception.lPos": (r: Rules) => r.perception?.lPos ?? 0,
  "perception.lAct": (r: Rules) => r.perception?.lAct ?? 0,
  "perception.jitter": (r: Rules) => r.perception?.jitter ?? 0,
  "stamina.max": (r: Rules) => r.stamina?.max ?? 0,
  "stamina.regen": (r: Rules) => r.stamina?.regen ?? 0,
  "stamina.blockChip": (r: Rules) => r.stamina?.blockChip ?? 0,
  "stamina.parryChip": (r: Rules) => r.stamina?.parryChip ?? 0,
  "stamina.gasThreshold": (r: Rules) => r.stamina?.gasThreshold ?? 0,
  "stamina.gasRecoveryPenalty": (r: Rules) =>
    r.stamina?.gasRecoveryPenalty ?? 0,
} satisfies Record<string, (r: Rules) => number>;

// The frozen-ruleset read paths — derived from RULE_READERS' keys so the type,
// the allowlist, and the interpreter can never drift.
export type RulePath = keyof typeof RULE_READERS;

export const ALLOWED_RULES: ReadonlySet<string> = new Set(
  Object.keys(RULE_READERS),
);

export const MOVES: ReadonlySet<string> = new Set<MoveId>([
  "kizami-zuki",
  "gyaku-zuki",
  "mae-geri",
  "mawashi-geri",
]);

export const BANDS: ReadonlySet<string> = new Set<Band>(["high", "mid", "low"]);

// ─── Grammar allowlists as runtime arrays (for the spec generator) ───────────
// The validator switches on these op/action discriminants; the spec generator
// renders them. Each list is the keys of a `Record<Union, true>` table, so a
// newly-added op/action is a COMPILE error here until listed (completeness),
// and can never silently drift from the type. Insertion order fixes the order
// the generated spec lists them in.
const NUM_OP_TABLE: Record<NumExpr["op"], true> = {
  const: true,
  field: true,
  mem: true,
  rule: true,
  add: true,
  sub: true,
  mul: true,
  div: true,
  min: true,
  max: true,
  neg: true,
  abs: true,
};

export const NUM_OPS: readonly string[] = Object.keys(NUM_OP_TABLE);

const BOOL_OP_TABLE: Record<BoolExpr["op"], true> = {
  gt: true,
  lt: true,
  gte: true,
  lte: true,
  eq: true,
  neq: true,
  and: true,
  or: true,
  not: true,
};

export const BOOL_OPS: readonly string[] = Object.keys(BOOL_OP_TABLE);

const ACTION_TYPE_TABLE: Record<Action["type"], true> = {
  idle: true,
  move: true,
  block: true,
  crouch: true,
  jump: true,
  attack: true,
  sweep: true,
  throw: true,
  "throw-break": true,
};

export const ACTION_TYPES: readonly string[] = Object.keys(ACTION_TYPE_TABLE);
export const CELL_RE = /^[a-zA-Z][a-zA-Z0-9_]{0,31}$/;

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
      case "add":
      case "mul":
      case "min":
      case "max":
        if (!Array.isArray(e.args) || e.args.length < 1)
          fail(path, `${String(e.op)} needs at least one operand`);
        else
          e.args.forEach((a, i) =>
            num(a, `${path}.${String(e.op)}[${i}]`, depth + 1),
          );
        break;
      case "sub":
      case "div":
        if (!Array.isArray(e.args) || e.args.length !== 2)
          fail(path, `${String(e.op)} needs 2 operands`);
        else
          e.args.forEach((a, i) =>
            num(a, `${path}.${String(e.op)}[${i}]`, depth + 1),
          );
        break;
      case "neg":
      case "abs":
        num(e.arg, `${path}.${String(e.op)}`, depth + 1);
        break;
      case "rule":
        if (typeof e.path !== "string" || !ALLOWED_RULES.has(e.path)) {
          fail(path, `rule not allowed: ${String(e.path)}`);
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
      case "sweep":
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

// Saturate to the int32 range. Operands are always already-saturated int32s, so
// sums/diffs stay exact in IEEE-double and products that exceed it already
// exceed int32 (with correct sign) — the clamped integer is the exact result.
const clampInt32 = (x: number): number =>
  Math.max(LIMITS.intMin, Math.min(LIMITS.intMax, x));

function evalNum(
  n: NumExpr,
  state: State,
  mem: Record<string, number>,
  rules: Rules | undefined,
): number {
  switch (n.op) {
    case "const":
      return n.value;
    case "field":
      return FIELD_READERS[n.path](state);
    case "mem":
      return mem[n.cell] ?? 0;
    case "rule":
      // Trusted frozen-ruleset constant; sentinel 0 when no rules are threaded.
      return rules ? RULE_READERS[n.path](rules) : 0;
    case "add":
      return clampInt32(
        n.args.reduce((acc, a) => acc + evalNum(a, state, mem, rules), 0),
      );
    case "mul":
      return clampInt32(
        n.args.reduce((acc, a) => acc * evalNum(a, state, mem, rules), 1),
      );
    case "min":
      return clampInt32(
        n.args.reduce(
          (acc, a) => Math.min(acc, evalNum(a, state, mem, rules)),
          Infinity,
        ),
      );
    case "max":
      return clampInt32(
        n.args.reduce(
          (acc, a) => Math.max(acc, evalNum(a, state, mem, rules)),
          -Infinity,
        ),
      );
    case "sub":
      return clampInt32(
        evalNum(n.args[0], state, mem, rules) -
          evalNum(n.args[1], state, mem, rules),
      );

    case "div": {
      const divisor = evalNum(n.args[1], state, mem, rules);

      return divisor === 0
        ? 0
        : clampInt32(
            Math.trunc(evalNum(n.args[0], state, mem, rules) / divisor),
          );
    }

    case "neg":
      return clampInt32(-evalNum(n.arg, state, mem, rules));
    case "abs":
      return clampInt32(Math.abs(evalNum(n.arg, state, mem, rules)));
  }
}

function evalBool(
  n: BoolExpr,
  state: State,
  mem: Record<string, number>,
  rules: Rules | undefined,
): boolean {
  switch (n.op) {
    case "gt":
      return (
        evalNum(n.args[0], state, mem, rules) >
        evalNum(n.args[1], state, mem, rules)
      );
    case "lt":
      return (
        evalNum(n.args[0], state, mem, rules) <
        evalNum(n.args[1], state, mem, rules)
      );
    case "gte":
      return (
        evalNum(n.args[0], state, mem, rules) >=
        evalNum(n.args[1], state, mem, rules)
      );
    case "lte":
      return (
        evalNum(n.args[0], state, mem, rules) <=
        evalNum(n.args[1], state, mem, rules)
      );
    case "eq":
      return (
        evalNum(n.args[0], state, mem, rules) ===
        evalNum(n.args[1], state, mem, rules)
      );
    case "neq":
      return (
        evalNum(n.args[0], state, mem, rules) !==
        evalNum(n.args[1], state, mem, rules)
      );
    case "and":
      return n.args.every((a) => evalBool(a, state, mem, rules));
    case "or":
      return n.args.some((a) => evalBool(a, state, mem, rules));
    case "not":
      return !evalBool(n.arg, state, mem, rules);
  }
}

/**
 * Run one tick for one fighter. Rules evaluate top-to-bottom; the first rule
 * whose `when` holds and that carries a `do` returns the tick's Action. A rule
 * with no `do` is a TRACKER: its `set` writes apply and evaluation continues.
 * No rule fires ⇒ `default`. Mutates `mem` in place (the engine owns it).
 *
 * `rules` is the fight's frozen frame table, threaded so `rule(path)` reads
 * resolve; absent (legacy 3-arg callers) ⇒ every `rule(path)` reads the
 * sentinel 0.
 */
export function runTick(
  doc: BotDoc,
  state: State,
  mem: Record<string, number>,
  rules?: Rules,
): Action {
  for (const rule of doc.rules) {
    if (!evalBool(rule.when, state, mem, rules)) continue;
    if (rule.set)
      for (const w of rule.set) mem[w.cell] = evalNum(w.to, state, mem, rules);
    if (rule.do) return rule.do;
  }

  return doc.default;
}
