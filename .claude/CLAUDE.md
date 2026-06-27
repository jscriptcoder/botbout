# ModelKombat — Claude Code context

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
   LLM-authored JS. The trusted computing base is `src/engine/dsl.ts`
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
- `src/engine/types.ts` is the **single source of truth** for the state / action /
  `Rules` contract — don't redeclare it elsewhere.
- **Source layout:** the deterministic engine + its TCB live under
  `src/engine/` (`types.ts`, `dsl.ts`, `sim.ts`, `prng.ts` + co-located
  `*.test.ts`); the headless **fight runner** (`npm run fight`) lives under
  `src/cli/` and imports the engine from `../engine/`; example bot documents
  live in top-level `bots/`.
- Repo layout: see `README.md`. Component & platform decisions: `docs/DESIGN.md`.

## Status

- DONE (design): the deep-karate combat tree + bot API resolved →
  `docs/DESIGN.md`, `docs/BOT-DSL.md`.
- DONE (walking skeleton — PRs #1–#5, all 6 ACs): the headless deterministic core.
  `src/engine/dsl.ts` (validator + interpreter — the TCB), `src/engine/types.ts`
  (`State`/`Action`/`Rules` contract), `src/engine/sim.ts` (fixed-timestep `runFight`
  loop). It validates a JSON bot, runs two bots for N ticks, replays
  **byte-identically**, and resolves 1D approach + one *mid* strike that can score,
  be **blocked** (guard negates; a committed fighter can't guard), or **trade**
  (simultaneous in-range strikes both score, swap-symmetric). 130 tests; `sim.ts`
  mutation ~95%, `dsl.ts` interpreter 100%. The five-slice plan is done and its file
  deleted (per the planning workflow); the record lives in git history (PRs #1–#5).
- DONE (perception-latency keystone — PRs #7–#10): the distinctive mechanic. The
  opponent is a **coherent delayed snapshot** served from a per-fighter history
  buffer — positional fields by `L_pos`, the `opponent.attacking` tell by `L_act`
  (invariant #4) — with dead-reckoned `opponent.predictedDistance` (+ `opponent.vx`)
  and **seeded, clamped per-tick jitter** on the latencies (mulberry32 in
  `src/engine/prng.ts`, the sim's first PRNG consumer — integer `uint32` only, replay-stable).
  This derives the master inequality **reaction-block iff `S ≥ L_act + 1`** (the `+1`
  is the structural observe-after-commit tick; explicit block startup `B` still
  deferred). 149 tests; `prng.ts` mutation 100%, `sim.ts` ~95%. `perception` is
  optional in `Rules`; absent ⇒ `L=0` ⇒ **byte-identical** to the skeleton.
- DONE (height bands — C3, PRs #15–#16): the core read/counter game. A strike
  carries a `high/mid/low` **band**; a guard blocks **only** at its own band — a
  wrong-height guard (or none) is hit (Slice 1). The opponent's incoming band is
  perceivable as **`opponent.attackBand`** — a height-ordered numeric enum
  (`0` none, `1` low, `2` mid, `3` high) on the **same `L_act`-delayed layer** as
  the `attacking` tell (invariant #4) — so a counter-bot can read the height and
  raise the matching guard (Slice 2). 161 tests; `sim.ts` mutation ~95%. The §11
  effects machinery (compute-then-apply union, HIT/BLOCK/WHIFF taxonomy, pre-intake
  frozen snapshot) was deliberately **deferred** to its first consumer (C5 parry /
  throws): C3 stays self-targeted (score on attacker, guard on self), so resolution
  is still trivially order-independent. No per-move legal-band restriction yet.
- DONE (vertical axis + occupancy — C4, PRs #17–#21): the low/high game made physical.
  A `crouch` vacates `high`; a `jump` launches a fixed-point gravity arc (`y += vy;
  vy -= gravity`), committed (`canAct=0`) until it lands at `y=0`, and an airborne fighter
  vacates `low` once past `lowClearance` — so a high strike whiffs a croucher and a sweep
  whiffs a jumper (the §11.3 step-3 **occupancy gate**, no longer hardwired open). Occupancy
  is a `posture→vacated-band` table **read-only on the defender**, so resolution stays
  single-`resolveHit` (the §11 effects machinery still waits for C5). The read game:
  `opponent.y` on the **`L_pos`** layer (anti-air by height) and `opponent.posture`
  (`0` standing, `1` crouching, `2` airborne) on the **`L_act`** layer (read a croucher,
  invisible to the height read). 191 tests; `sim.ts` mutation ~95%.
  `jumpImpulse`/`gravity`/`lowClearance` are optional in `Rules`; all absent ⇒
  **byte-identical** to C3. `self.y`/`self.vy`/`self.posture` deferred (no consumer until
  air-actions); horizontal jump `dir` validated but applies no displacement (vertical-only).
- DONE (parry windows — C5, PRs #23–#25): the predict-vs-react skill gradient. The opening
  `parryWindow` ticks of a matching-band guard **deflect** an absorbed strike (no score) and
  throw the attacker into `parryRecovery` extra recovery, where a guard held past the window
  only **blocks** (Slice 1); a parry also opens a **counter window** on the parrying fighter —
  a strike it lands within `counterWindow` ticks scores an extra `counterBonus` (Slice 2); the
  live window is perceivable as **`self.counterWindow`** so a bot can time its counter (Slice 3).
  This is the **first consumer of the §11 effects machinery**: the counter is the first
  **cross-fighter** effect (it lands on the defender), so resolution graduates to the
  **compute-then-apply union** — `resolveHit` splits into a pure `computeStrike` (returns a
  hit/parry outcome from the frozen snapshot) + `applyStrike` (both directions applied
  atomically), keeping the tick swap-symmetric. Guard age is persisted on the Fighter (like C4's
  posture). 206 tests; `sim.ts` mutation ~97%. `parryWindow`/`parryRecovery`/`counterWindow`/
  `counterBonus` are optional in `Rules`; all absent ⇒ **byte-identical** to C4. **The union is
  adopted deliberately at the first cross-fighter effect — not strictly test-forced** (a guarding
  fighter is never simultaneously attacking, so the counter never collides same-tick; **throws**
  are the union's test-forcing consumer). The frozen snapshot is taken **post-intake**; §11.1's
  pre-intake step-dodge refinement stays deferred, as does parry-aware `phaseRemaining`.
- DONE (on-contact cancel combos — C6, PRs #26–#28): within-exchange score escalation with the
  **no-feint** property. A strike that **connects** opens a cancel window on the attacker;
  returning an `attack` in the striking move's `cancelInto` set within `cancelWindow` ticks
  **interrupts the recovery** into the follow-up (Slice 1 — on **hit**; Slice 2 widens the trigger
  to a stale-guard **block**, a first-class connect alongside hit — **parry and whiff never open
  it**, so you can only cancel something the opponent already perceived connect). The live window is
  perceivable as **`self.cancelWindow`** so a bot can **hit-confirm** (Slice 3). This is the **first
  consumer of the §11.3 `CancelEnable` insertion point** — a **self-targeted** effect on the C5
  compute-then-apply union, so it slots in with **no restructuring**: `intake` gains the one
  deliberate cancel exception to commitment, and a `block` `StrikeOutcome` joins hit/parry — block
  opens the window but is **not** marked resolved, preserving the block-then-guard-drop edge. 222
  tests; `sim.ts` mutation ~95%, `dsl.ts` interpreter 100%. `MoveSpec.cancelInto` +
  `Rules.cancelWindow` are optional; absent ⇒ **byte-identical** to C5. Self-cancel
  (`strike→strike`) demonstrates the mechanic; a multi-move arsenal + distinct routes is a later
  additive slice. **Throws** (C7) are the union's genuine test-forcing consumer — now shipped.
- DONE (throw triangle + knockdown — C7, PRs #29–#33): the §11.4 anti-turtle mind-game and the
  compute-then-apply union's genuine **test-forcing** consumer. A committed `throw` (startup →
  grab-active → recovery) GRABS a grounded, non-downed defender in `reach` — beating any guard/parry
  (it is **unbanded**) — scoring `throw.score` (3) and knocking them **down** (`canAct=0`,
  untargetable) for `knockdownDuration` ticks (Slice 1). The full precedence **`strike > throw >
  guard`** then resolves *in* the union: an opposing active in-range strike (a HIT) **stuffs** the
  throw — voided + marked `stuffed`, thrower left committed (punishable) — which also **interrupts
  throw startup** (Slice 2); a defender's **`throw-break`** on a grab-active tick defeats the grab the
  same way (`throw-break > throw`), and a break is a per-tick **non-guard** action so a strike still
  hits it (the anti-break-spam balance, Slice 3); two live grabs **clash** — both whiff — one of only
  two swap-symmetric outcomes in §11.4 (the other is the strike∥strike trade, Slice 4). The incoming
  grab is perceivable as a bare **`opponent.throwing`** boolean on the **`L_act`** layer (invariant #4,
  like `attacking`/`attackBand`/`posture`), making `throw-break` a **reaction** skill-gradient —
  escapable iff `S ≥ L_act + 1` (Slice 5). This is the union's **strictly-forced** consumer: throws
  create the first same-tick **cross-fighter mutual dependencies** (a throw mutates the *defender* via
  knockdown while a strike mutates the *attacker* via score), which the frozen-snapshot
  **compute-then-apply** split (`computeThrow`/`applyThrow` alongside `computeStrike`/`applyStrike`,
  live since C5) resolves order-independently. (The "926 tests" once recorded here was a
  `.stryker-tmp` pollution artifact — the real suite is **287** after C8.) `sim.ts` mutation ~95%,
  `dsl.ts` interpreter
  100%. The `throw`/`throw-break` actions are allowlisted in `src/engine/dsl.ts`; `Rules.throw` (a
  `ThrowSpec`) + `knockdownDuration` are optional ⇒ a `throw` is inert when unconfigured ⇒
  **byte-identical** to C6. Deferred to **C8**: sweeps, the one guaranteed **finish window** (okizeme),
  wake-up i-frames, and `opponent.knockdown`.
- DONE (sweeps + limited okizeme — C8, PRs #35–#38): the ground game on the throw triangle. A `sweep`
  is a **low-band STRIKE variant** (reusing `computeStrike` + the §11.4 precedence) that on HIT
  **knocks down** (score 0) instead of scoring — so a low guard blocks/parries it, it whiffs a jumper
  (low occupancy) and hits a croucher, trades with strikes, and stuffs throws, **all precedence
  emergent** ("a sweep is a strike", Slice 1). One **uniform knockdown lifecycle** (throw *and* sweep),
  `downed{ elapsed, finish }`: the opening `finishWindow` ticks of ANY knockdown are a guaranteed
  **FINISH** window — an opposing active in-range strike scores once, **ignoring band/guard/occupancy**
  (the target is prone) — then the window closes (**exactly one** finish; never re-downs or extends
  `knockdownDuration`); the untargetable tail is the wake-up **i-frames** (Slice 2). The okizeme read is
  split across the two perception layers: the finish window is read **live** as **`self.finishWindow`**
  (= the live opponent's `downed.finish`, like the counter/cancel windows, Slice 3), while the grounded
  state is a delayed **`opponent.knockdown`** boolean on the **`L_act`** layer (like `throwing` —
  invariant #4 — `1` for the *whole* knockdown incl. i-frames, Slice 4) — so `knockdown ∧ finishWindow>0`
  ⇒ go for the finish, `knockdown ∧ finishWindow==0` ⇒ reset against an invulnerable prone foe. **No new
  resolution machinery**: sweep + okizeme slot onto the C5 compute-then-apply union (`StrikeOutcome`
  gains a `finish` variant; the `hit` and throw outcomes carry the finish window to grant on knockdown).
  287 tests; `sim.ts` mutation ~95% (changed-line 100%), `dsl.ts` interpreter 100%. `MoveSpec.knockdown`
  + `Rules.finishWindow` + `moves.sweep` are optional ⇒ a `sweep` is inert and a knockdown is
  unfinishable when unconfigured ⇒ **byte-identical** to C7. Deferred: deeper okizeme wake-up mind-games
  (multi-option oki), air-actions, *yame*/match structure.
- NOT YET BUILT (later slices): no real frame table (concrete move numbers live only
  in test mocks); no horizontal jump displacement or air-actions,
  *yame*/match structure, telemetry object, Vercel API, or Pixi viewer.
- NEXT: **capability not yet resolved.** C1–C8 (the resolved combat tree) are shipped; the remaining
  items are unresolved in design. Candidates from the deferred list: **match structure** (*yame* resets
  / rounds / WKF win conditions), a **real frame table** (concrete move numbers — today they live only
  in test mocks), or **air-actions** (air strikes / horizontal jump displacement). Pick one and run
  **`grill-me` → `planning` → TDD** before any code. (Roadmap capabilities are **C1–C8** — the `C`
  prefix avoids colliding with `slice/N` git branch names; C1 = walking skeleton (branches
  `slice/1`–`slice/5`), C2 = perception keystone, C3 = height bands, C4 = vertical axis + occupancy,
  C5 = parry windows, C6 = on-contact cancel combos, C7 = throw triangle + knockdown, C8 = sweeps +
  limited okizeme.) The spine is pinned in `docs/DESIGN.md` **§11 (Combat resolution order)**: two-phase
  compute-then-apply (live from C5, **strictly forced by C7's throws**), S1 posture → S2 intake → S3
  compute → S4 apply → S5 advance, `strike > throw > guard` precedence, HIT/BLOCK/WHIFF gate. Flow:
  `grill-me`/`planning` → TDD, **PR per capability**.

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
