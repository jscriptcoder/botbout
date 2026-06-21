# BotBout — Bot DSL (deep karate)

> **Status:** The canonical bot API, synthesized from `docs/DESIGN.md` (PROPOSED
> sections there may still shift the schema). Doubles as the **prompt context**
> handed to an LLM to author a bot. **Last updated:** 2026-06-21

A bot is a **JSON document, not code** (the non-negotiable TCB rule). It cannot
express I/O, loops, or recursion → safe by construction, cost bounded by document
size, integer-only. The engine calls the bot **once per tick**: rules evaluate
top-to-bottom against one coherent (latency-delayed) snapshot, and the first rule
whose `when` holds and that carries a `do` returns the tick's single `Action`.

## Document shape

```jsonc
{
  "version": 1,
  "name": "string (<= 64 chars)",
  "memory": { "cellName": 0 },        // optional: declared int cells, persist across ticks within a fight
  "let":  [                            // optional: named sub-expressions (a DAG), eval once/tick before rules
    { "name": "predDist", "expr": <NumExpr> }
  ],
  "rules": [ <Rule>, ... ],            // priority-ordered
  "default": <Action>                  // taken when no rule fires
}
```

```jsonc
// Rule: if `when` holds, apply `set` writes; if `do` present it's the action (terminal).
// A rule with no `do` is a TRACKER (updates memory, evaluation continues).
{ "when": <BoolExpr>, "set": [ { "cell": "name", "to": <NumExpr> } ], "do": <Action> }
```

## Action grammar (one per tick)

`dir` is **relative to facing**: `+1` toward opponent, `-1` away, `0` hold.

```jsonc
{ "type": "idle" }
{ "type": "move",        "dir": -1|0|1 }
{ "type": "dash",        "dir": -1|1 }
{ "type": "backstep" }
{ "type": "crouch" }                                  // posture: vacates the high band, lowers reach
{ "type": "jump",        "dir": -1|0|1 }              // gravity arc; vacates low, enters airborne band
{ "type": "block",       "band": "high"|"mid"|"low" } // timing decides block vs parry (engine, not bot)
{ "type": "throw-break" }                             // escape an incoming throw
{ "type": "attack",      "move": "<moveId>", "band": "high"|"mid"|"low" }  // strikes, kicks, specials, throw, sweep
```

- **All offense is `attack`** with a frame-table `moveId`; `band` selects the
  target zone for multi-band moves (ignored for fixed-band moves like a sweep).
  Throw (`family: throw`, unblockable) and sweep (`family: sweep`, low + knockdown)
  are `attack` moves — their special resolution comes from their family, not a
  bespoke action type.
- **Cancels are implicit.** Returning an `attack` while `self.canCancel == 1` and
  the move is in the current move's `cancelInto` set performs the cancel; the
  engine validates the window. No "cancel" action exists — combos are just
  reactive, hit-confirmed attacks across ticks.
- **Failure is telemetry, never a crash.** Illegal / unaffordable (stamina) /
  out-of-window / locked (`canAct == 0`) actions degrade to `idle` + a logged
  event the author reads after the fight.

## Numeric expressions (`NumExpr`) — fixed-point integers

```jsonc
{ "op": "const",   "value": <int> }
{ "op": "field",   "path": "<AllowedField>" }         // read a whitelisted state leaf (bool → 1/0)
{ "op": "mem",     "cell": "name" }                   // read a memory cell (default 0)
{ "op": "let",     "name": "predDist" }               // read a named sub-expression (this tick)
{ "op": "rule",    "move": "<moveId>", "stat": "<MoveStat>" }   // read frame-table data (transparent)
{ "op": "latency", "of": "action"|"position" }
{ "op": "add"|"sub"|"mul"|"min"|"max", "args": [ <NumExpr>, ... ] }
{ "op": "div",     "args": [ <NumExpr>, <NumExpr> ] } // ÷0 := 0, truncate toward zero
{ "op": "neg"|"abs", "arg": <NumExpr> }
```

`MoveStat` ∈ `startup | active | recovery | score | staminaCost | reach | onBlock`.

## Boolean expressions (`BoolExpr`)

```jsonc
{ "op": "gt"|"lt"|"gte"|"lte"|"eq"|"neq", "args": [ <NumExpr>, <NumExpr> ] }
{ "op": "and"|"or", "args": [ <BoolExpr>, ... ] }
{ "op": "not", "arg": <BoolExpr> }
{ "op": "phase",    "who": "self"|"opponent", "is": "<Phase>" }
{ "op": "move_is",  "who": "self"|"opponent", "move": "<moveId>"|null }
{ "op": "band_is",  "who": "self"|"opponent", "band": "high"|"mid"|"low" }   // perceived attack band
{ "op": "posture_is","who": "self"|"opponent", "is": "standing"|"crouching"|"airborne" }
```

`Phase` ∈ `idle | startup | active | recovery | blocking | parrying | stunned |
dodging | airborne | knockdown | wakeup`.

## State schema (the read surface — also the DSL `field` allowlist)

**`self` (live, perfect proprioception):**
`points`, `stamina`, `x`, `y`, `vx`, `vy`, `facing`, `phaseRemaining`,
`canAct` (1/0), `canCancel` (1/0), `cancelWindowRemaining`, `comboHits`
(landed this exchange), `wakeupRemaining`, `edgeDistance` (to nearer ring edge).
Categorical self-state read via predicates: `phase`, `move_is`, `posture_is`,
`band_is` (own current attack's band).

**`opponent` (coherent delayed snapshot):**
- positional (delayed by `L_pos`): `x`, `y`, `vx`, `vy`, `facing`, `distance`,
  `edgeDistance`.
- derived (engine dead-reckons over staleness): `predictedDistance`, `predictedY`.
- action/intent (delayed by `L_act`): perceived via `phase`/`move_is`/`band_is`/
  `posture_is`; numeric `phaseElapsed`, `moveRecoveryRemaining` (derived),
  `staleness` (= `L_act`).
- status: `points`, `stamina`.

**`ring`:** `width`, `leftEdge`, `rightEdge`.
**`clock` / `match`:** `clock.tick`, `clock.ticksRemaining`, `match.scoreGap`
(`self.points - opponent.points`), `match.exchangeActive` (1/0; 0 during a *yame*
reset).

> **Coherence rule (engine invariant):** the opponent snapshot is one real frame
> from the past per latency class — never a mix of fresh and stale fields.

## Static limits (each a security boundary — tune during build)

`maxBytes` 32_768 · `maxNodes` 4_000 · `maxDepth` 32 · `maxRules` 96 ·
`maxCells` 24 · `maxLets` 32 · int range = int32. Cell/let names match
`^[a-zA-Z][a-zA-Z0-9_]{0,31}$`. Prototype-pollution-safe parse rejects
`__proto__`/`constructor`/`prototype`. Validator rejects: unknown ops, fields not
on the allowlist, unknown move ids, illegal band-for-move, undeclared cells/lets,
`let` referencing a later/forward definition (must be a DAG), and over-budget docs
— each with a structured, fixable error.

## Worked fragment (illustrative)

Reaction-block a *reactable* high attack by band, else whiff-punish a recovering
move in range, else hit-confirm a punch→kick cancel:

```jsonc
{
  "version": 1,
  "name": "band-reader",
  "memory": { "lastHit": 0 },
  "let": [
    { "name": "predDist", "expr": { "op": "abs", "arg": { "op": "sub", "args": [
        { "op": "add", "args": [ { "op": "field", "path": "opponent.x" },
          { "op": "mul", "args": [ { "op": "field", "path": "opponent.vx" },
                                   { "op": "field", "path": "opponent.staleness" } ] } ] },
        { "op": "field", "path": "self.x" } ] } } },
    { "name": "reactable", "expr": { "op": "sub", "args": [
        { "op": "rule", "move": "kick", "stat": "startup" },
        { "op": "add", "args": [ { "op": "latency", "of": "action" }, { "op": "const", "value": 2 } ] } ] } }
  ],
  "rules": [
    { "when": { "op": "lte", "args": [ { "op": "field", "path": "self.canAct" }, { "op": "const", "value": 0 } ] },
      "do": { "type": "idle" } },

    { "when": { "op": "and", "args": [
        { "op": "band_is", "who": "opponent", "band": "high" },
        { "op": "phase",   "who": "opponent", "is": "startup" },
        { "op": "gte", "args": [ { "op": "let", "name": "reactable" }, { "op": "const", "value": 0 } ] } ] },
      "do": { "type": "block", "band": "high" } },

    { "when": { "op": "and", "args": [
        { "op": "eq",  "args": [ { "op": "field", "path": "self.canCancel" }, { "op": "const", "value": 1 } ] },
        { "op": "eq",  "args": [ { "op": "mem",   "cell": "lastHit" },        { "op": "const", "value": 1 } ] } ] },
      "do": { "type": "attack", "move": "roundhouse", "band": "mid" } },

    { "when": { "op": "and", "args": [
        { "op": "phase", "who": "opponent", "is": "recovery" },
        { "op": "gt", "args": [ { "op": "field", "path": "opponent.moveRecoveryRemaining" },
            { "op": "add", "args": [ { "op": "latency", "of": "action" },
                                     { "op": "rule", "move": "jab", "stat": "startup" } ] } ] },
        { "op": "lte", "args": [ { "op": "let", "name": "predDist" }, { "op": "rule", "move": "jab", "stat": "reach" } ] } ] },
      "set": [ { "cell": "lastHit", "to": { "op": "const", "value": 1 } } ],
      "do": { "type": "attack", "move": "jab", "band": "mid" } }
  ],
  "default": { "type": "move", "dir": 1 }
}
```

> Note `lastHit` here is illustrative; the real engine should expose a **hit-confirm
> signal** (e.g. `self.lastAttackConnected`) so authors don't hand-roll it — to be
> finalized with the telemetry/result object.
