# BotBout — Claude Code context

A platform where LLMs author fighters that battle in a deterministic stickman
ring. An LLM reads the spec + frame table, emits a **JSON bot document** (a DSL,
not code), submits it through a validator gate, and the engine runs it against a
prior winner. Fights are fast and **bit-reproducible** so they can be replayed.

## Current design direction (READ FIRST)

The project is the **"go deep" karate** design. The canonical design lives in
**`docs/DESIGN.md`** (combat + platform — 2D fixed-point space, 3 height bands +
technique-specific *uke* defense, on-contact cancel combos, WKF **points-only**
scoring with *yame* resets, king-of-the-hill ladder, all-TS platform) and
**`docs/BOT-DSL.md`** (the bot API). All engine code is built **from the resolved
design via TDD** under a single top-level **`src/`** (no `packages/` nesting). The
**walking skeleton is done** (headless validate → fight → byte-identical replay,
with 1D approach + one *mid* strike that can score / block / trade); combat depth
now grows one capability slice at a time. See **Status** below.

## Non-negotiable invariants

These protect determinism, replay, and security. Do not violate them when
generating code; flag any change that would.

1. **Determinism.** Fixed timestep; one `runTick` per fighter per tick. A single
   **seeded PRNG** threads the whole sim — no `Math.random`, no `Date.now`, no
   wall-clock. **Integer / fixed-point math only** in anything that affects
   outcomes (position, velocity, stamina, score). Floats in the outcome path break
   cross-platform replay. Trig/FK and ragdoll are **render-layer only** (the
   non-authoritative side of the seam).
2. **Security / TCB.** Untrusted bots are **data, never code.** Never run
   LLM-authored JS. The trusted computing base is `src/dsl.ts`
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

## Stack & conventions

- Engine: TypeScript, ESM (`NodeNext`), strict mode, no runtime deps. Tests via
  vitest. Prefer pure functions; keep the DSL vocabulary small. All code lives
  under a single top-level **`src/`**.
- **Platform: all-TypeScript.** The API is **Vercel serverless functions** that
  import the engine directly from `src/` (shared `validate`/`runFight` + contract
  types end-to-end — no cross-language drift). Viewer: Vite + Pixi + SolidJS.
  Deploys on Vercel.
- `src/types.ts` is the **single source of truth** for the state / action /
  `Rules` contract — don't redeclare it elsewhere.
- Repo layout: see `README.md`. Component & platform decisions: `docs/DESIGN.md`.

## Status

- DONE (design): the deep-karate combat tree + bot API resolved →
  `docs/DESIGN.md`, `docs/BOT-DSL.md`.
- DONE (walking skeleton — PRs #1–#5, all 6 ACs): the headless deterministic core.
  `src/dsl.ts` (validator + interpreter — the TCB), `src/types.ts`
  (`State`/`Action`/`Rules` contract), `src/sim.ts` (fixed-timestep `runFight`
  loop). It validates a JSON bot, runs two bots for N ticks, replays
  **byte-identically**, and resolves 1D approach + one *mid* strike that can score,
  be **blocked** (guard negates; a committed fighter can't guard), or **trade**
  (simultaneous in-range strikes both score, swap-symmetric). 130 tests; `sim.ts`
  mutation ~95%, `dsl.ts` interpreter 100%. The five-slice plan is done and its file
  deleted (per the planning workflow); the record lives in git history (PRs #1–#5).
- NOT YET BUILT (later slices): no PRNG is consumed yet (no jitter); no real frame
  table (concrete move numbers live only in test mocks); perception latency is at
  `L=0` (opponent read live); no 2D/vertical axis, height bands, *uke* guards,
  parry, cancels, *yame*/match structure, telemetry object, Vercel API, or Pixi
  viewer.
- NEXT: the **perception-latency keystone** — the per-fighter history ring buffer +
  `L>0` delayed snapshot (invariant #4), the next capability per
  `docs/stories/first-slice-split.md`. Then height bands + 3 *uke* guards, vertical
  axis, parry, cancel combos. Flow: `story-splitting`/`planning` → TDD, **PR per
  slice**.

## Commands

```bash
npm install        # once
npm test           # vitest (test-first; the suite grows with each TDD slice)
npm run build      # tsc → dist/
npm run typecheck  # tsc --noEmit
npm run format     # prettier --write .  (format:check verifies without writing)
npm run lint       # eslint .  (lint:fix auto-fixes; inserts blank-line block spacing)
```

**Design source of truth:** `docs/DESIGN.md` (combat + platform; control model,
perception keystone + master inequalities, all locked decisions) and
`docs/BOT-DSL.md` (bot API / LLM prompt context).

---

# Development Guidelines for Claude

## Core Philosophy

**TEST-DRIVEN DEVELOPMENT IS NON-NEGOTIABLE.** Every single line of production code must be written in response to a failing test. No exceptions. This is not a suggestion or a preference - it is the fundamental practice that enables all other principles in this document.

I follow Test-Driven Development (TDD) with a strong emphasis on behavior-driven testing and functional programming principles. All work should be done in small, incremental changes that maintain a working state throughout development.

## Quick Reference

**Key Principles:**

- Write tests first (TDD)
- Test behavior, not implementation
- No `any` types or type assertions
- Immutable data only
- Small, pure functions
- TypeScript strict mode always
- Use real schemas/types in tests, never redefine them

**Preferred Tools:**

- **Language**: TypeScript (strict mode)
- **Testing**: Vitest (prefer Browser Mode for UI tests) + Testing Library
- **State Management**: Prefer immutable patterns

## Testing Principles

**Core principle**: Test behavior, not implementation. 100% coverage through business behavior.

**Quick reference:**
- Write tests first (TDD non-negotiable)
- Test through public API exclusively
- Use factory functions for test data (no `let`/`beforeEach`)
- Tests must document expected business behavior
- No 1:1 mapping between test files and implementation files

For detailed testing patterns and examples, load the `testing` skill.
For verifying test effectiveness through mutation analysis, load the `mutation-testing` skill.

## TypeScript Guidelines

**Core principle**: Strict mode always. Schema-first at trust boundaries, types for internal logic.

**Quick reference:**
- No `any` types - ever (use `unknown` if type truly unknown)
- No type assertions without justification
- Always prefer `type` over `interface`
- Define schemas first, derive types from them (Zod/Standard Schema)
- Use schemas at trust boundaries, plain types for internal logic

For detailed TypeScript patterns and rationale, load the `typescript-strict` skill.
For API and interface design patterns, load the `api-design` skill.

## Code Style

**Core principle**: Functional programming with immutable data. Self-documenting code.

**Quick reference:**
- No data mutation - immutable data structures only
- Pure functions wherever possible
- No nested if/else - use early returns or composition
- Comments only for complex/non-obvious logic
- Prefer options objects over positional parameters
- Use array methods (`map`, `filter`, `reduce`) over loops

For detailed patterns and examples, load the `functional` skill.

## Development Workflow

**Core principle**: RED-GREEN-MUTATE-KILL MUTANTS-REFACTOR in small, known-good increments. TDD is the fundamental practice.

**Quick reference:**
- RED: Write failing test first (NO production code without failing test)
- GREEN: Write MINIMUM code to pass test
- MUTATE: Run mutation testing to verify test effectiveness, produce a report
- KILL MUTANTS: Address surviving mutants (ask human when value is ambiguous)
- REFACTOR: Assess improvement opportunities (only refactor if adds value)
- **Wait for commit approval** before every commit
- Each increment leaves codebase in working state
For detailed TDD workflow, load the `tdd` skill.
For implementation of any planned slice, load `tdd`, `testing`, `mutation-testing`, and `refactoring` before code changes begin.
For refactoring methodology, load the `refactoring` skill.
For fuzzy product/design decisions, load `grill-me` to pressure-test the decision tree before writing stories or plans.
For broad stories, epics, features, or backlog items, load `story-splitting` to create child stories before planning.
For tightening an existing story, plan, acceptance criteria set, or mock spec, load `find-gaps` to write confirmed answers back into the artifact.
For significant implementation work, load `planning` to turn one selected child story or narrow capability into PR-sized plans in `plans/`.
For CI failure diagnosis, load the `ci-debugging` skill.
For hexagonal architecture projects, load the `hexagonal-architecture` skill.
For Domain-Driven Design projects, load the `domain-driven-design` skill.
For 12-factor service projects, load the `twelve-factor` skill.
For CLI tool design (stream separation, format flags, exit codes, composability), load the `cli-design` skill.
For designing or auditing source trees (where files belong, feature folders, import boundaries), load the `folder-structure` skill.
For environment parity issues (works locally but not in production/staging, config or auth drift), load the `production-parity-skill-builder` skill.
For making untestable code testable, load the `finding-seams` skill.
For documenting existing behavior before changes, load the `characterisation-tests` skill.
For multi-surface design audits before code (embed every mock in a scope on one reviewable page with flow diagram + gap cards + per-mock audit checklists), load the `storyboard` skill.
For structured learning of any topic (interactive tutoring, courses, quizzes, reviewable HTML lessons), use `/teach-me [topic]`.
For discovering and installing agent skills from the open ecosystem (`npx skills`), load the `find-skills` skill.
For adversarial review of plans, acceptance criteria, stories, or design mocks — one question at a time, turning each answer into a new AC / plan paragraph / mock-state spec written back to the source of truth — load the `find-gaps` skill.
For relentless decision-tree interrogation before story splitting, planning, or implementation — one question at a time, with recommended answers and codebase exploration where useful — load the `grill-me` skill.

**Project onboarding:** Run `/setup` in any new project to detect its tech stack and generate project-level CLAUDE.md, hooks, commands, and PR review agent in one shot. This replaces the need for `/init`.

**Project-level hooks:** Projects should add a PostToolUse hook in `.claude/settings.json` to run typecheck after Write/Edit on .ts/.tsx files. Use `/setup` to generate this automatically, or use the prettier/eslint hook in this repo's `claude/.claude/settings.json` as a template (note: the curl installer does not install settings.json — only the stow-based install does).

## Output Guardrails

- **Write to files, not chat** — When asked to produce a plan, document, or artifact, always persist it to a file. You may also present it inline for approval, but the file is the source of truth.
- **Plan-only mode** — When asked for a plan, design, or document only, produce ONLY that artifact. Do not write production code, test code, or make any implementation changes unless explicitly asked.
- **Incremental output** — When exploring a codebase, produce a first draft of output within 3-4 tool calls. Refine iteratively rather than front-loading all exploration before producing anything.

## Working with Claude

**Core principle**: Think deeply, follow TDD strictly, capture learnings while context is fresh.

**Quick reference:**
- ALWAYS FOLLOW TDD - no production code without failing test
- Assess refactoring after every green (but only if adds value)
- Update this CLAUDE.md when introducing meaningful changes
- Ask "What do I wish I'd known at the start?" after significant changes
- Document gotchas, patterns, decisions, edge cases while context is fresh

For detailed TDD workflow, load the `tdd` skill.
For refactoring methodology, load the `refactoring` skill.
For detailed guidance on expectations and documentation, load the `expectations` skill.

## Browser Automation

Prefer `agent-browser` for web automation. If it is not installed, fall back to other available tools (e.g. `WebFetch`, `curl`, or MCP browser tools). Always try `agent-browser` first.

`agent-browser` core workflow:
1. `agent-browser open <url>` - Navigate to page
2. `agent-browser snapshot -i` - Get interactive elements with refs (@e1, @e2)
3. `agent-browser click @e1` / `fill @e2 "text"` - Interact using refs
4. Re-snapshot after page changes

Run `agent-browser --help` for all commands.

## Resources and References

- [TypeScript Handbook](https://www.typescriptlang.org/docs/handbook/intro.html)
- [Testing Library Principles](https://testing-library.com/docs/guiding-principles)
- [Kent C. Dodds Testing JavaScript](https://testingjavascript.com/)
- [Functional Programming in TypeScript](https://gcanti.github.io/fp-ts/)

## Summary

The key is to write clean, testable, functional code that evolves through small, safe increments. Every change should be driven by a test that describes the desired behavior, and the implementation should be the simplest thing that makes that test pass. When in doubt, favor simplicity and readability over cleverness.
