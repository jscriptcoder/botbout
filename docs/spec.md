# ModelKombat — Bot authoring spec

> **GENERATED — do not edit by hand.** Regenerate with `npm run gen:spec`.
> Every allowlist, limit, and frame-table number below is read directly from
> the engine, so this document cannot lie about how a fight resolves.

- **Benchmark version:** `v2` — a score is comparable only against another at the same version.
- **Input hash:** `093e03b2fff0dc3ab6ac1a5124e4fd3403a34f71f189d9a921d00e2fdb930bb5` (pins the scoring inputs: rules + gauntlet + run params).

A bot is a **JSON document, not code**: no I/O, no loops, no recursion. It is
validated once against the allowlists below (the security boundary), then run
unchanged. The engine calls it **once per tick**; rules are evaluated
top-to-bottom against one coherent (latency-delayed) snapshot, and the first
rule whose `when` holds and that carries a `do` returns the tick's `Action`.

## Limits

Hard caps enforced at validation time — a document that exceeds any of these
is rejected. The engine needs no instruction metering: worst-case cost is
bounded by document size. Every expression node (numeric or boolean) counts
against `maxNodes` and nesting against `maxDepth`.

- `maxBytes` — 32768
- `maxNodes` — 4000
- `maxDepth` — 32
- `maxRules` — 96
- `maxCells` — 24
- `intMin` — -2147483648
- `intMax` — 2147483647

## Document shape

```jsonc
{
  "version": 1,
  "name": "string (1..64 chars)",
  "memory": { "cellName": 0 },   // optional: declared int cells, persist across ticks within a fight
  "rules": [ <Rule>, ... ],      // priority-ordered; first matching `do` wins
  "default": <Action>            // taken when no rule fires
}
```

```jsonc
// Rule: if `when` holds, apply `set` writes; a `do` (if present) is the terminal action.
// A rule with no `do` is a TRACKER (updates memory, evaluation continues).
{ "when": <BoolExpr>, "set": [ { "cell": "name", "to": <NumExpr> } ], "do": <Action> }
```

## Expressions

All values are **fixed-point integers**. Arithmetic is **int32-saturating**:
every op clamps its result to [`-2147483648`, `2147483647`];
`div` truncates toward zero and division by zero yields `0`. These rules make
every evaluation bit-reproducible across platforms.

**Numeric expressions** (`NumExpr`):

- leaves: `const` (`{op:"const",value}`), `field` (`{op:"field",path}`), `mem` (`{op:"mem",cell}`), `rule` (`{op:"rule",path}`)
- all `op` tags (leaves + arithmetic): `const`, `field`, `mem`, `rule`, `add`, `sub`, `mul`, `div`, `min`, `max`, `neg`, `abs`

**Boolean expressions** (`BoolExpr`):

- operators: `gt`, `lt`, `gte`, `lte`, `eq`, `neq`, `and`, `or`, `not`

## State read surface (`field`)

The whitelisted state leaves a bot may read via `{op:"field",path}`. Opponent
fields are served from a latency-delayed snapshot (see the perception
constants in the frame table); `opponent.points` is a live scoreboard read.

- `self.x`
- `self.facing`
- `self.points`
- `self.canAct`
- `self.phaseRemaining`
- `self.counterWindow`
- `self.cancelWindow`
- `self.finishWindow`
- `self.stamina`
- `self.gassed`
- `opponent.x`
- `opponent.y`
- `opponent.facing`
- `opponent.distance`
- `opponent.attacking`
- `opponent.attackBand`
- `opponent.posture`
- `opponent.throwing`
- `opponent.knockdown`
- `opponent.vx`
- `opponent.predictedDistance`
- `opponent.stamina`
- `opponent.gassed`
- `opponent.points`
- `ring.width`
- `clock.tick`
- `clock.ticksRemaining`

## Ruleset read surface (`rule`)

The frozen frame-table constants a bot may read symbolically via
`{op:"rule",path}` — e.g. `rule("moves.mae-geri.reach")` instead of the literal.
An unconfigured constant reads the sentinel `0`. Their current values are in
the frame table below.

- `tickRate`
- `walkSpeed`
- `ring.width`
- `startGap`
- `moves.gyaku-zuki.startup`
- `moves.gyaku-zuki.active`
- `moves.gyaku-zuki.recovery`
- `moves.gyaku-zuki.score`
- `moves.gyaku-zuki.reach`
- `moves.gyaku-zuki.staminaCost`
- `moves.sweep.startup`
- `moves.sweep.active`
- `moves.sweep.recovery`
- `moves.sweep.score`
- `moves.sweep.reach`
- `moves.sweep.staminaCost`
- `moves.kizami-zuki.startup`
- `moves.kizami-zuki.active`
- `moves.kizami-zuki.recovery`
- `moves.kizami-zuki.score`
- `moves.kizami-zuki.reach`
- `moves.kizami-zuki.staminaCost`
- `moves.mae-geri.startup`
- `moves.mae-geri.active`
- `moves.mae-geri.recovery`
- `moves.mae-geri.score`
- `moves.mae-geri.reach`
- `moves.mae-geri.staminaCost`
- `moves.mawashi-geri.startup`
- `moves.mawashi-geri.active`
- `moves.mawashi-geri.recovery`
- `moves.mawashi-geri.score`
- `moves.mawashi-geri.reach`
- `moves.mawashi-geri.staminaCost`
- `moves.mawashi-geri.scoreByBand.high`
- `throw.startup`
- `throw.active`
- `throw.recovery`
- `throw.reach`
- `throw.score`
- `throw.staminaCost`
- `jumpImpulse`
- `gravity`
- `lowClearance`
- `parryWindow`
- `parryRecovery`
- `counterWindow`
- `counterBonus`
- `cancelWindow`
- `knockdownDuration`
- `finishWindow`
- `finishScore`
- `perception.lPos`
- `perception.lAct`
- `perception.jitter`
- `stamina.max`
- `stamina.regen`
- `stamina.blockChip`
- `stamina.parryChip`
- `stamina.gasThreshold`
- `stamina.gasRecoveryPenalty`

## Action grammar

A bot returns exactly **one** action per tick. `dir` is relative to facing:
`+1` toward the opponent, `-1` away, `0` hold.

- action types: `idle`, `move`, `block`, `crouch`, `jump`, `attack`, `sweep`, `throw`, `throw-break`
- `attack` takes a `move` and a `band`.
- attack moves: `kizami-zuki`, `gyaku-zuki`, `mae-geri`, `mawashi-geri`
- bands: `high`, `mid`, `low`

## Frame table

The authoritative numbers the platform fights on (`CANONICAL_RULES`).

### Techniques

`cancels into` — on a CONNECT (hit/block), a move can cancel its recovery into
one of these follow-ups within `cancelWindow` ticks (see the primer). A sweep's
cancel into a strike during the foe's `finishWindow` is the okizeme finish.

| technique | startup | active | recovery | score | reach | cost | bands | cancels into |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `sweep` | 7 | 2 | 13 | 0 | 180000 | 40 | — | gyaku-zuki |
| `kizami-zuki` | 7 | 2 | 13 | 1 | 210000 | 15 | high/mid | gyaku-zuki |
| `gyaku-zuki` | 7 | 3 | 14 | 1 | 240000 | 20 | high/mid | mae-geri / mawashi-geri |
| `mae-geri` | 9 | 3 | 16 | 2 | 270000 | 35 | mid | gyaku-zuki |
| `mawashi-geri` | 11 | 3 | 18 | 2 | 300000 | 45 | high/mid | gyaku-zuki |

### Global constants

- `tickRate` — 60
- `walkSpeed` — 4000
- `ring.width` — 600000
- `startGap` — 300000
- `throw.startup` — 7
- `throw.active` — 2
- `throw.recovery` — 14
- `throw.reach` — 120000
- `throw.score` — 3
- `throw.staminaCost` — 40
- `jumpImpulse` — 12000
- `gravity` — 4000
- `lowClearance` — 8000
- `parryWindow` — 2
- `parryRecovery` — 12
- `counterWindow` — 10
- `counterBonus` — 1
- `cancelWindow` — 6
- `knockdownDuration` — 30
- `finishWindow` — 10
- `finishScore` — 3
- `perception.lPos` — 1
- `perception.lAct` — 6
- `perception.jitter` — 1
- `stamina.max` — 100
- `stamina.regen` — 10
- `stamina.blockChip` — 5
- `stamina.parryChip` — 15
- `stamina.gasThreshold` — 30
- `stamina.gasRecoveryPenalty` — 6

## Validation-error catalog

A rejected document reports structured `{ path, reason }` issues. The reason
families an author hits:

- **node budget exceeded** — the document has more expression nodes than `maxNodes`.
- **too deeply nested** — an expression exceeds `maxDepth`.
- **field not allowed** / **rule not allowed** — a `field`/`rule` path outside the read surface.
- **unknown move** / **unknown band** — an `attack` naming a move/band outside the allowlist.
- **undeclared cell** — a `mem` read or `set` write to a cell not declared in `memory`.
- **unknown numeric/boolean op** — an unrecognised expression operator.

## JSON Schema

A draft-07 JSON Schema for the bot document — a permissive structural
over-approximation of the validator (enum membership sourced from the same
allowlists above). It enforces shape, the allowlists, and expression arities,
but CANNOT encode the node budget, max nesting depth, the byte cap, or
declared-before-use cells — the `validate()` gate remains the authority.

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "$ref": "#/definitions/BotDoc",
  "definitions": {
    "BotDoc": {
      "type": "object",
      "required": [
        "version",
        "name",
        "rules",
        "default"
      ],
      "properties": {
        "version": {
          "const": 1
        },
        "name": {
          "type": "string",
          "minLength": 1,
          "maxLength": 64
        },
        "memory": {
          "type": "object",
          "maxProperties": 24,
          "propertyNames": {
            "pattern": "^[a-zA-Z][a-zA-Z0-9_]{0,31}$"
          },
          "additionalProperties": {
            "type": "integer"
          }
        },
        "rules": {
          "type": "array",
          "maxItems": 96,
          "items": {
            "$ref": "#/definitions/Rule"
          }
        },
        "default": {
          "$ref": "#/definitions/Action"
        }
      }
    },
    "Rule": {
      "type": "object",
      "required": [
        "when"
      ],
      "properties": {
        "when": {
          "$ref": "#/definitions/BoolExpr"
        },
        "set": {
          "type": "array",
          "items": {
            "type": "object",
            "required": [
              "cell",
              "to"
            ],
            "properties": {
              "cell": {
                "type": "string"
              },
              "to": {
                "$ref": "#/definitions/NumExpr"
              }
            }
          }
        },
        "do": {
          "$ref": "#/definitions/Action"
        }
      }
    },
    "fieldPath": {
      "type": "string",
      "enum": [
        "self.x",
        "self.facing",
        "self.points",
        "self.canAct",
        "self.phaseRemaining",
        "self.counterWindow",
        "self.cancelWindow",
        "self.finishWindow",
        "self.stamina",
        "self.gassed",
        "opponent.x",
        "opponent.y",
        "opponent.facing",
        "opponent.distance",
        "opponent.attacking",
        "opponent.attackBand",
        "opponent.posture",
        "opponent.throwing",
        "opponent.knockdown",
        "opponent.vx",
        "opponent.predictedDistance",
        "opponent.stamina",
        "opponent.gassed",
        "opponent.points",
        "ring.width",
        "clock.tick",
        "clock.ticksRemaining"
      ]
    },
    "rulePath": {
      "type": "string",
      "enum": [
        "tickRate",
        "walkSpeed",
        "ring.width",
        "startGap",
        "moves.gyaku-zuki.startup",
        "moves.gyaku-zuki.active",
        "moves.gyaku-zuki.recovery",
        "moves.gyaku-zuki.score",
        "moves.gyaku-zuki.reach",
        "moves.gyaku-zuki.staminaCost",
        "moves.sweep.startup",
        "moves.sweep.active",
        "moves.sweep.recovery",
        "moves.sweep.score",
        "moves.sweep.reach",
        "moves.sweep.staminaCost",
        "moves.kizami-zuki.startup",
        "moves.kizami-zuki.active",
        "moves.kizami-zuki.recovery",
        "moves.kizami-zuki.score",
        "moves.kizami-zuki.reach",
        "moves.kizami-zuki.staminaCost",
        "moves.mae-geri.startup",
        "moves.mae-geri.active",
        "moves.mae-geri.recovery",
        "moves.mae-geri.score",
        "moves.mae-geri.reach",
        "moves.mae-geri.staminaCost",
        "moves.mawashi-geri.startup",
        "moves.mawashi-geri.active",
        "moves.mawashi-geri.recovery",
        "moves.mawashi-geri.score",
        "moves.mawashi-geri.reach",
        "moves.mawashi-geri.staminaCost",
        "moves.mawashi-geri.scoreByBand.high",
        "throw.startup",
        "throw.active",
        "throw.recovery",
        "throw.reach",
        "throw.score",
        "throw.staminaCost",
        "jumpImpulse",
        "gravity",
        "lowClearance",
        "parryWindow",
        "parryRecovery",
        "counterWindow",
        "counterBonus",
        "cancelWindow",
        "knockdownDuration",
        "finishWindow",
        "finishScore",
        "perception.lPos",
        "perception.lAct",
        "perception.jitter",
        "stamina.max",
        "stamina.regen",
        "stamina.blockChip",
        "stamina.parryChip",
        "stamina.gasThreshold",
        "stamina.gasRecoveryPenalty"
      ]
    },
    "move": {
      "type": "string",
      "enum": [
        "kizami-zuki",
        "gyaku-zuki",
        "mae-geri",
        "mawashi-geri"
      ]
    },
    "band": {
      "type": "string",
      "enum": [
        "high",
        "mid",
        "low"
      ]
    },
    "NumExpr": {
      "oneOf": [
        {
          "type": "object",
          "required": [
            "op",
            "value"
          ],
          "properties": {
            "op": {
              "const": "const"
            },
            "value": {
              "type": "integer",
              "minimum": -2147483648,
              "maximum": 2147483647
            }
          }
        },
        {
          "type": "object",
          "required": [
            "op",
            "path"
          ],
          "properties": {
            "op": {
              "const": "field"
            },
            "path": {
              "$ref": "#/definitions/fieldPath"
            }
          }
        },
        {
          "type": "object",
          "required": [
            "op",
            "cell"
          ],
          "properties": {
            "op": {
              "const": "mem"
            },
            "cell": {
              "type": "string"
            }
          }
        },
        {
          "type": "object",
          "required": [
            "op",
            "path"
          ],
          "properties": {
            "op": {
              "const": "rule"
            },
            "path": {
              "$ref": "#/definitions/rulePath"
            }
          }
        },
        {
          "type": "object",
          "required": [
            "op",
            "args"
          ],
          "properties": {
            "op": {
              "enum": [
                "add",
                "mul",
                "min",
                "max"
              ]
            },
            "args": {
              "type": "array",
              "minItems": 1,
              "items": {
                "$ref": "#/definitions/NumExpr"
              }
            }
          }
        },
        {
          "type": "object",
          "required": [
            "op",
            "args"
          ],
          "properties": {
            "op": {
              "enum": [
                "sub",
                "div"
              ]
            },
            "args": {
              "type": "array",
              "minItems": 2,
              "maxItems": 2,
              "items": {
                "$ref": "#/definitions/NumExpr"
              }
            }
          }
        },
        {
          "type": "object",
          "required": [
            "op",
            "arg"
          ],
          "properties": {
            "op": {
              "enum": [
                "neg",
                "abs"
              ]
            },
            "arg": {
              "$ref": "#/definitions/NumExpr"
            }
          }
        }
      ]
    },
    "BoolExpr": {
      "oneOf": [
        {
          "type": "object",
          "required": [
            "op",
            "args"
          ],
          "properties": {
            "op": {
              "enum": [
                "gt",
                "lt",
                "gte",
                "lte",
                "eq",
                "neq"
              ]
            },
            "args": {
              "type": "array",
              "minItems": 2,
              "maxItems": 2,
              "items": {
                "$ref": "#/definitions/NumExpr"
              }
            }
          }
        },
        {
          "type": "object",
          "required": [
            "op",
            "args"
          ],
          "properties": {
            "op": {
              "enum": [
                "and",
                "or"
              ]
            },
            "args": {
              "type": "array",
              "minItems": 1,
              "items": {
                "$ref": "#/definitions/BoolExpr"
              }
            }
          }
        },
        {
          "type": "object",
          "required": [
            "op",
            "arg"
          ],
          "properties": {
            "op": {
              "const": "not"
            },
            "arg": {
              "$ref": "#/definitions/BoolExpr"
            }
          }
        }
      ]
    },
    "Action": {
      "oneOf": [
        {
          "type": "object",
          "required": [
            "type"
          ],
          "properties": {
            "type": {
              "const": "idle"
            }
          }
        },
        {
          "type": "object",
          "required": [
            "type",
            "dir"
          ],
          "properties": {
            "type": {
              "const": "move"
            },
            "dir": {
              "enum": [
                -1,
                0,
                1
              ]
            }
          }
        },
        {
          "type": "object",
          "required": [
            "type",
            "band"
          ],
          "properties": {
            "type": {
              "const": "block"
            },
            "band": {
              "$ref": "#/definitions/band"
            }
          }
        },
        {
          "type": "object",
          "required": [
            "type"
          ],
          "properties": {
            "type": {
              "const": "crouch"
            }
          }
        },
        {
          "type": "object",
          "required": [
            "type",
            "dir"
          ],
          "properties": {
            "type": {
              "const": "jump"
            },
            "dir": {
              "enum": [
                -1,
                0,
                1
              ]
            }
          }
        },
        {
          "type": "object",
          "required": [
            "type",
            "move",
            "band"
          ],
          "properties": {
            "type": {
              "const": "attack"
            },
            "move": {
              "$ref": "#/definitions/move"
            },
            "band": {
              "$ref": "#/definitions/band"
            }
          }
        },
        {
          "type": "object",
          "required": [
            "type"
          ],
          "properties": {
            "type": {
              "const": "sweep"
            }
          }
        },
        {
          "type": "object",
          "required": [
            "type"
          ],
          "properties": {
            "type": {
              "const": "throw"
            }
          }
        },
        {
          "type": "object",
          "required": [
            "type"
          ],
          "properties": {
            "type": {
              "const": "throw-break"
            }
          }
        }
      ]
    }
  }
}
```

## Strategy primer

How to WIN, not merely pass validation. Every number here is read from the
frame table above, so a rules retune updates this prose.

- **Perception (the master inequality).** Positional fields lag `lPos` = `1` tick(s); the action tell (`opponent.attacking` / `attackBand` / `throwing` / `knockdown`) lags `lAct` = `6`. A committed move is **reactable iff** its startup `S ≥ lAct + 1` = `7` (the `+1` is the structural observe-after-commit tick); ±`1` seeded jitter swings the knife-edge.
- **The triangle `strike > throw > guard`.** A strike stuffs a throw; a throw beats a guard (it is **unbanded** — guarding cannot stop it); a guard beats a strike at the **matching band**. Reach orders the options close-to-far: throw `120000` < sweep `180000` < jab `210000` < reverse `240000` < front `270000` < roundhouse `300000`.
- **Height & occupancy.** A `crouch` vacates the `high` band (a high strike whiffs a croucher); an airborne fighter vacates `low` once past `lowClearance` = `8000` (a sweep whiffs a well-timed jump). The arc is integer `y += vy; vy -= gravity` from `jumpImpulse` = `12000` / `gravity` = `4000`.
- **Parry, counter, cancel.** A matching guard's first `parryWindow` = `2` ticks **DEFLECT** (a parry: no score, +`12` attacker recovery) rather than merely block — reaction-precise defense out-rewards a pre-emptive hold. A parry opens a `counterWindow` = `10`-tick window worth +`1`. A strike that **CONNECTS** (hit or block) opens a `cancelWindow` = `6`-tick window to cancel recovery into a `cancelInto` follow-up (the rekka hit-confirm).
- **Okizeme (the knockdown game).** A throw or sweep knocks the foe **down** for `knockdownDuration` = `30` ticks; the first `finishWindow` = `10` are a guaranteed **FINISH** worth `finishScore` = `3` (ignoring band / guard / occupancy — the foe is prone); the rest are wake-up **i-frames**. Read the window live as `self.finishWindow`.
- **Stamina & gas.** Start at `stamina.max` = `100`; an UNCOMMITTED fighter (neutral, not guarding) regens +`10`/tick. A guard bleeds `blockChip` = `5` per contact tick (a fresh parry draws `parryChip` = `15` once). At or below `gasThreshold` = `30` a fighter is **GASSED**: every commit eats +`6` recovery, and any move costing more than `30` stamina (the kicks / throw / sweep) degrades to idle while the cheaper punches still commit — the emergent special-lockout. PACE your offense: spend only what regen can refill.

## Example bots

Three validated bots spanning the strategic axes. Copy the **shape**, not the
numbers — read those via `rule(...)` so a bot survives a frame-table retune.

### `jabber` — the minimal poke — walk into jab range, then `kizami-zuki`; the leading `self.canAct == 0` rule is the commitment guard every bot needs.

```json
{
  "version": 1,
  "name": "jabber",
  "rules": [
    {
      "when": {
        "op": "eq",
        "args": [
          { "op": "field", "path": "self.canAct" },
          { "op": "const", "value": 0 }
        ]
      },
      "do": { "type": "idle" }
    },
    {
      "when": {
        "op": "lte",
        "args": [
          { "op": "field", "path": "opponent.distance" },
          { "op": "const", "value": 210000 }
        ]
      },
      "do": { "type": "attack", "move": "kizami-zuki", "band": "mid" }
    }
  ],
  "default": { "type": "move", "dir": 1 }
}
```

### `vulture` — a reactive defender — break a read `throw`, punish a gassed foe with the roundhouse, else raise the guard matching the perceived `opponent.attackBand`.

```json
{
  "version": 1,
  "name": "vulture",
  "rules": [
    {
      "when": {
        "op": "eq",
        "args": [
          { "op": "field", "path": "self.canAct" },
          { "op": "const", "value": 0 }
        ]
      },
      "do": { "type": "idle" }
    },
    {
      "when": {
        "op": "eq",
        "args": [
          { "op": "field", "path": "opponent.throwing" },
          { "op": "const", "value": 1 }
        ]
      },
      "do": { "type": "throw-break" }
    },
    {
      "when": {
        "op": "and",
        "args": [
          {
            "op": "eq",
            "args": [
              { "op": "field", "path": "opponent.gassed" },
              { "op": "const", "value": 1 }
            ]
          },
          {
            "op": "lte",
            "args": [
              { "op": "field", "path": "opponent.distance" },
              { "op": "const", "value": 300000 }
            ]
          }
        ]
      },
      "do": { "type": "attack", "move": "mawashi-geri", "band": "high" }
    },
    {
      "when": {
        "op": "eq",
        "args": [
          { "op": "field", "path": "opponent.attackBand" },
          { "op": "const", "value": 3 }
        ]
      },
      "do": { "type": "block", "band": "high" }
    },
    {
      "when": {
        "op": "eq",
        "args": [
          { "op": "field", "path": "opponent.attackBand" },
          { "op": "const", "value": 2 }
        ]
      },
      "do": { "type": "block", "band": "mid" }
    },
    {
      "when": {
        "op": "eq",
        "args": [
          { "op": "field", "path": "opponent.attackBand" },
          { "op": "const", "value": 1 }
        ]
      },
      "do": { "type": "block", "band": "low" }
    }
  ],
  "default": { "type": "move", "dir": 1 }
}
```

### `rekka` — a memory-driven cancel chain — hit-confirm `kizami-zuki → gyaku-zuki → mawashi-geri` off `self.cancelWindow`, tracking progress in a `stage` memory cell.

```json
{
  "version": 1,
  "name": "rekka",
  "memory": { "stage": 0 },
  "rules": [
    {
      "when": {
        "op": "and",
        "args": [
          {
            "op": "eq",
            "args": [
              { "op": "field", "path": "self.canAct" },
              { "op": "const", "value": 0 }
            ]
          },
          {
            "op": "eq",
            "args": [
              { "op": "field", "path": "self.cancelWindow" },
              { "op": "const", "value": 0 }
            ]
          }
        ]
      },
      "do": { "type": "idle" }
    },
    {
      "when": {
        "op": "and",
        "args": [
          {
            "op": "eq",
            "args": [
              { "op": "field", "path": "self.canAct" },
              { "op": "const", "value": 1 }
            ]
          },
          {
            "op": "eq",
            "args": [
              { "op": "field", "path": "self.cancelWindow" },
              { "op": "const", "value": 0 }
            ]
          }
        ]
      },
      "set": [{ "cell": "stage", "to": { "op": "const", "value": 0 } }]
    },
    {
      "when": {
        "op": "and",
        "args": [
          {
            "op": "gt",
            "args": [
              { "op": "field", "path": "self.cancelWindow" },
              { "op": "const", "value": 0 }
            ]
          },
          {
            "op": "eq",
            "args": [
              { "op": "mem", "cell": "stage" },
              { "op": "const", "value": 3 }
            ]
          }
        ]
      },
      "set": [{ "cell": "stage", "to": { "op": "const", "value": 4 } }],
      "do": { "type": "attack", "move": "gyaku-zuki", "band": "mid" }
    },
    {
      "when": {
        "op": "and",
        "args": [
          {
            "op": "gt",
            "args": [
              { "op": "field", "path": "self.cancelWindow" },
              { "op": "const", "value": 0 }
            ]
          },
          {
            "op": "eq",
            "args": [
              { "op": "mem", "cell": "stage" },
              { "op": "const", "value": 2 }
            ]
          }
        ]
      },
      "set": [{ "cell": "stage", "to": { "op": "const", "value": 3 } }],
      "do": { "type": "attack", "move": "mawashi-geri", "band": "high" }
    },
    {
      "when": {
        "op": "and",
        "args": [
          {
            "op": "gt",
            "args": [
              { "op": "field", "path": "self.cancelWindow" },
              { "op": "const", "value": 0 }
            ]
          },
          {
            "op": "eq",
            "args": [
              { "op": "mem", "cell": "stage" },
              { "op": "const", "value": 1 }
            ]
          }
        ]
      },
      "set": [{ "cell": "stage", "to": { "op": "const", "value": 2 } }],
      "do": { "type": "attack", "move": "gyaku-zuki", "band": "mid" }
    },
    {
      "when": {
        "op": "and",
        "args": [
          {
            "op": "eq",
            "args": [
              { "op": "field", "path": "self.canAct" },
              { "op": "const", "value": 1 }
            ]
          },
          {
            "op": "lte",
            "args": [
              { "op": "field", "path": "opponent.distance" },
              { "op": "const", "value": 210000 }
            ]
          }
        ]
      },
      "set": [{ "cell": "stage", "to": { "op": "const", "value": 1 } }],
      "do": { "type": "attack", "move": "kizami-zuki", "band": "mid" }
    }
  ],
  "default": { "type": "move", "dir": 1 }
}
```

## Benchmark rules

A submitted bot is scored deterministically against a frozen, versioned
gauntlet — the spec is the only input; there is no feedback loop.

- `metric` — Σ net-points over every (opponent × seed × side) fight; win-rate breaks ties.
- `seeds` — 1..10 (10 seeds), each matchup played twice (bot as A and as B).
- `maxTicks` — 600
- gauntlet opponents:
  - `jabber`
  - `rekka`
  - `zoner`
  - `grappler`
  - `sweeper`
  - `vulture`
