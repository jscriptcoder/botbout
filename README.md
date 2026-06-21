# BotBout

A platform where LLMs author fighters that battle in a deterministic stickman
ring. An LLM reads the spec, studies the frame table, and emits a **JSON bot
document** (a small DSL — not executable code). The bot is validated, then run
against a prior winner. Fights are fast and **bit-reproducible**, so they can be
replayed and watched.

> **Design direction:** BotBout is building a **deep karate** combat model (2D
> fixed-point space, three height bands + technique-specific *uke* defense,
> on-contact cancel combos, WKF points-only scoring, king-of-the-hill ladder).
> Source of truth: **`docs/DESIGN.md`** + **`docs/BOT-DSL.md`**. The engine code
> below is early scaffold, built out toward that design via TDD slices.

## Why a DSL instead of running the LLM's code

Bots are **data, not code**. The bot language has no loops, recursion, or I/O, so:

- **Safe by construction** — the vocabulary contains no dangerous operations; a
  malicious bot literally cannot express network/file/host access. The trusted
  computing base is one ~250-line interpreter, not a JS engine.
- **No DoS** — loop-free means worst-case cost is bounded by document size,
  checked at validation. No instruction metering needed.
- **Bit-identical replays** — integer/fixed-point arithmetic only.

## Quick start

```bash
node scripts/selftest.mjs          # zero-dependency smoke test (validator + interpreter)

cd packages/engine
npm install
npm run build                      # tsc
npm test                           # vitest
```

## Layout

```
packages/engine/   TypeScript deterministic core (pure, no I/O)
  src/types.ts       state schema + action grammar + Rules (single source of truth)
  src/dsl.ts         bot AST, validator, interpreter  ← the trusted computing base
  src/rules.ts       frame table (scaffold; building out to the deep karate table)
  src/sim.ts         deterministic fight loop  ← stub
  examples/          worked bot documents
services/api/      all-TypeScript orchestration (planned; imports @botbout/engine)
tools/frame-lab/   React frame-data vs perception-latency tuner (dev tool)
docs/              DESIGN.md (combat + platform) + BOT-DSL.md (bot API)
(planned) viewer   Vite + Pixi + SolidJS replay/fight viewer
```

## Status

**Design resolved** for the deep karate model + bot API (`docs/DESIGN.md`,
`docs/BOT-DSL.md`). The engine under `packages/engine` is early scaffold (validator
+ interpreter, frame table, example bot — green), built out toward the design via
TDD. **Next:** story-splitting → planning for the first vertical slice, then the
TDD build (deep frame table + 2D deterministic sim loop + telemetry result object
+ viewer).

See `.claude/CLAUDE.md` for the invariants and current direction, `docs/DESIGN.md`
for the design rationale.
