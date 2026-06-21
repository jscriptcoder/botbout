# Bot DSL — authoring reference

A fighter is a JSON document. It is **data, not code**: no loops, recursion, or
I/O. The engine calls it every tick; you author the decision logic once.
Canonical grammar + validator + interpreter live in `packages/engine/src/dsl.ts`.

This file is also suitable to drop into an LLM prompt as the authoring spec.

## Document shape

```jsonc
{
  "version": 1,
  "name": "my-fighter",
  "memory": { "cellA": 0 },     // optional: declared integer cells, persist per fight
  "rules": [ /* Rule[] */ ],    // evaluated top-to-bottom each tick
  "default": { "type": "move", "dir": 1 }   // action if no rule fires
}
```

## Rules

Each tick, rules are evaluated in order. A rule whose `when` is true applies its
`set` memory writes; if it also has a `do`, that action is returned and
evaluation stops (first match wins). A rule with **no `do`** is a *tracker* — it
updates memory and evaluation continues.

```jsonc
{ "when": <BoolExpr>, "set": [{ "cell": "cellA", "to": <NumExpr> }], "do": <Action> }
```

## Actions (return exactly one)

`dir` is **relative to facing**: `+1` toward opponent, `-1` away, `0` hold.

```jsonc
{ "type": "idle" }
{ "type": "move",  "dir": -1 | 0 | 1 }
{ "type": "block" }                 // re-issue each tick to hold guard
{ "type": "dodge", "dir": -1 | 1 }
{ "type": "punch" } | { "type": "kick" } | { "type": "grab" }
```
Returning an unaffordable, locked, or unknown action ⇒ treated as `idle` + logged.

## Numeric expressions (integers / fixed-point)

```jsonc
{ "op": "const", "value": 12 }
{ "op": "field", "path": "<AllowedField>" }        // read a state leaf (canAct ⇒ 1/0)
{ "op": "mem",   "cell": "cellA" }                 // read a declared memory cell
{ "op": "rule",  "move": "punch", "stat": "range" }// read the frame table
{ "op": "latency", "of": "action" | "position" }
{ "op": "add"|"sub"|"mul"|"min"|"max", "args": [ ... ] }
{ "op": "div", "args": [a, b] }                    // ÷0 := 0
{ "op": "neg"|"abs", "arg": a }
```

## Boolean expressions

```jsonc
{ "op": "gt"|"lt"|"gte"|"lte"|"eq"|"neq", "args": [a, b] }
{ "op": "and"|"or", "args": [ ... ] }
{ "op": "not", "arg": p }
{ "op": "phase",   "who": "self"|"opponent", "is": "<Phase>" }
{ "op": "move_is", "who": "self"|"opponent", "move": "punch"|...|null }
```

## Readable state fields (`field.path`)

Self (live): `self.hp`, `self.stamina`, `self.x`, `self.facing`,
`self.phaseRemaining`, `self.canAct`.

Opponent (delayed snapshot): `opponent.x`, `opponent.vx`, `opponent.distance`,
`opponent.predictedDistance` (engine-dead-reckoned), `opponent.hp`,
`opponent.stamina`, `opponent.facing`, `opponent.staleness`,
`opponent.phaseElapsed`, `opponent.moveRecoveryRemaining` (engine-derived).

Ring/clock: `ring.width`, `clock.tick`, `clock.ticksRemaining`.

Enums (`phase`, `move`) are read via the `phase` / `move_is` boolean ops, not `field`.

Phases: `idle`, `startup`, `active`, `recovery`, `blocking`, `stunned`, `dodging`.
Move stats: `startup`, `active`, `recovery`, `damage`, `staminaCost`, `range`, `onBlock`.

## Static limits (enforced at submission)

≤ 16 KB · ≤ 2000 AST nodes · ≤ 32 nesting depth · ≤ 64 rules · ≤ 16 memory cells ·
int32 constants. Exceeding any ⇒ rejection with a structured `{path, reason}` error.

## Patterns

- **Dead-reckon distance:** `abs(sub(add(opponent.x, mul(opponent.vx,
  opponent.staleness)), self.x))`. (Or just read `opponent.predictedDistance`.)
- **Whiff-punish gate:** `opponent.moveRecoveryRemaining > latency.action +
  rule(punch, startup)` while `phase opponent recovery`.
- **Reaction-block gate:** only block moves with `startup ≥ latency.action +
  block.raise` (e.g. kick at L=6).
- **Edge-triggered tracking:** increment a cell when `phase opponent active` and
  `opponent.phaseElapsed == 0` so it fires once per move.

See `packages/engine/examples/footsie-spacer.json` for a complete worked bot.
