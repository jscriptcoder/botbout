# BotBout — Claude Code context

A platform where LLMs author fighters that battle in a deterministic stickman
ring. An LLM reads the spec + frame table, emits a **JSON bot document** (a DSL,
not code), submits it through a validator gate, and the engine runs it against a
prior winner. Fights are fast and **bit-reproducible** so they can be replayed.

## Non-negotiable invariants

These protect determinism, replay, and security. Do not violate them when
generating code; flag any change that would.

1. **Determinism.** Fixed timestep; one `runTick` per fighter per tick. A single
   **seeded PRNG** threads the whole sim — no `Math.random`, no `Date.now`, no
   wall-clock. **Integer / fixed-point math only** in anything that affects
   outcomes (position, velocity, hp, stamina). Floats in the outcome path break
   cross-platform replay.
2. **Security / TCB.** Untrusted bots are **data, never code.** Never run
   LLM-authored JS. The trusted computing base is `packages/engine/src/dsl.ts`
   (validator + interpreter). Never add a DSL op that can touch the host,
   network, filesystem, time, or randomness. The allowlists in that file ARE the
   security boundary. Validate before run; reject with structured errors.
3. **Bot DSL is bounded.** Loop-free and recursion-free ⇒ worst-case cost is
   bounded by document size, enforced by `LIMITS` at validation time. No
   instruction metering needed. Keep it that way.
4. **Same pre-tick snapshot.** Both fighters' `runTick` read one immutable
   snapshot of tick T; resolve both actions together afterward. Perception
   latency is served from a per-fighter history ring buffer as a single coherent
   delayed snapshot (never mix fresh + stale fields).

## Architecture

- `packages/engine` (TypeScript) — the deterministic core. Pure, no I/O.
  - `src/types.ts` — shared contract: state schema, action grammar, Rules. Single
    source of truth; do not redeclare these types elsewhere.
  - `src/dsl.ts` — **the TCB.** Bot AST, validator, interpreter (`validate`,
    `runTick`, `safeParse`, `LIMITS`).
  - `src/rules.ts` — `DEFAULT_RULES` frame table (L=6 "Footsies" tuning).
  - `src/sim.ts` — deterministic fight loop. **STUB — next task.** Invariants are
    documented at the top of the file.
- `services/api` (Python / FastAPI) — orchestration, not yet built. Endpoints:
  `POST /fighter` (validate + store), `POST /fight`, `GET /replay/:id`,
  `GET /spec`. Calls the TS engine as a child service (the untrusted-bot
  interpreter lives where JS lives).
- `tools/frame-lab` — React tuner for frame-data vs perception-latency. Dev tool.
- `scripts/selftest.mjs` — zero-dependency smoke test of validator + interpreter.

## Stack & conventions

- Engine: TypeScript, ESM (`NodeNext`), strict mode, no runtime deps. Tests via
  vitest.
- Backend: Python + FastAPI (planned). Frontend/replay viewer: TypeScript/React
  (planned).
- Prefer pure functions in the engine. Keep the DSL vocabulary small.

## Status

- DONE: state schema + action grammar (`types.ts`), DSL validator + interpreter
  (`dsl.ts`, verified), default frame table (`rules.ts`), example bot
  (`examples/footsie-spacer.json`), frame-data tuner (`tools/frame-lab`).
- NEXT: implement `src/sim.ts` (deterministic loop + replay), then the telemetry
  result object, then the FastAPI submission pipeline.

## Commands

```bash
node scripts/selftest.mjs              # zero-install smoke test
cd packages/engine && npm install      # then:
npm run build                          # tsc
npm test                               # vitest
```

See `docs/DESIGN.md` for the combat model + the two master inequalities, and
`docs/BOT-DSL.md` for the bot authoring grammar (also usable as LLM prompt context).
