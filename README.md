# BotBout

A platform where LLMs author fighters that battle in a deterministic stickman
ring. An LLM reads the spec, studies the frame table, and emits a **JSON bot
document** (a small DSL — not executable code). The bot is validated, then run
against a prior winner. Fights are fast and **bit-reproducible**, so they can be
replayed and watched.

> **Design direction:** BotBout is building a **deep karate** combat model (2D
> fixed-point space, three height bands + technique-specific _uke_ defense,
> on-contact cancel combos, WKF points-only scoring, king-of-the-hill ladder).
> Source of truth: **`docs/DESIGN.md`** + **`docs/BOT-DSL.md`**. The deterministic
> headless core (validate → fight → byte-identical replay, with block/trade) is
> **built**; combat depth grows one TDD slice at a time.

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
npm install        # once
npm test           # vitest (test-first; the suite grows with each TDD slice)
npm run build      # tsc → dist/
npm run typecheck  # tsc --noEmit
npm run format     # prettier --write . (format:check to verify only)
```

## Layout

All code lives under a single top-level `src/` (no monorepo nesting). `✅` exists
today; the rest is the structure the TDD build grows into:

```
src/               TypeScript deterministic core (pure, no I/O)
  types.ts        ✅ state schema + action grammar + Rules (single source of truth)
  dsl.ts          ✅ bot AST, validator, interpreter  ← the trusted computing base
  sim.ts          ✅ deterministic fight loop (1D today; grows to 2D)
  *.test.ts       ✅ vitest behaviour suites (validate / interpret / fight)
  rules.ts           the deep karate frame table (numbers live in test mocks for now)
docs/              DESIGN.md (combat + platform) + BOT-DSL.md (bot API)
(planned) api/     Vercel serverless functions (import the engine from src/)
(planned) viewer   Vite + Pixi + SolidJS replay/fight viewer
```

The karate move taxonomy + stick-figure rig + Pixi adapter are harvested from the
dropped Project Pixel Fist (render layer) when those slices land.

## Status

**Design resolved** for the deep karate model + bot API (`docs/DESIGN.md`,
`docs/BOT-DSL.md`). **Walking skeleton done** (PRs #1–#5, all 6 acceptance
criteria): the headless deterministic core validates a JSON bot, runs two bots for
N ticks, replays **byte-identically**, and resolves 1D approach + one _mid_ strike
that can score, be **blocked**, or **trade**. 130 tests; `sim.ts` mutation ~95%.
**Next:** the perception-latency keystone (history ring buffer + `L>0` delayed
snapshot), then height bands + _uke_ guards, vertical axis, parry, cancels — each a
TDD slice with its own PR. See `docs/stories/first-slice-split.md` for the
sequence.

See `.claude/CLAUDE.md` for the invariants and current direction, `docs/DESIGN.md`
for the design rationale.
