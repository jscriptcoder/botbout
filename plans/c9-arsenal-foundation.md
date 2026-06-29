# Plan: C9 — Arsenal foundation (band-legality gate + first technique)

**Branch**: `feat/c9-band-legality-gate` (Slice 1) · `feat/c9-kizami-zuki-jab` (Slice 2)
**Status**: Active — **Slice 1 code complete (pending commit approval)**; Slice 2 not started.

> Implements **Slice 1** of `plans/c9-arsenal-split.md` (the multi-move arsenal
> foundation), broken into two PR-sized planning slices. Session-resolved defaults:
> Japanese move ids; band-legality is a **runtime degrade-to-idle** gate (not a
> validator reject); `strike` stays as scaffolding (retired in the split's final slice).

## Goal

A bot can throw a band-restricted named technique (the jab `kizami-zuki`), and any
out-of-band `attack` degrades to `idle` — landing the multi-move schema (`MoveId` union,
record-keyed `Rules.moves`, `MoveSpec.bands`, the `dsl.ts` `MOVES` allowlist) and the
band-legality gate **additively**: byte-identical to today when unused.

## Acceptance Criteria (capability-level)

- [ ] An out-of-band `attack` (resolved `band ∉ move.bands`) starts **no** move — no
  startup, no stamina spend, no score — at **both** move-start sites, but the two
  *degrade differently*: a **neutral** commit (`sim.ts:370`) → `idle` (fighter stays
  neutral); an **on-contact cancel** (`sim.ts:357`) → the cancel is **not honoured**, so
  the fighter simply **continues its current move's recovery** (it is mid-move, not idle).
- [ ] A `MoveSpec` with **no** `bands` declared is legal at every band ⇒ `CANONICAL_RULES`
  (whose `strike` declares none) is **byte-identical**; the full suite stays green.
- [ ] `"kizami-zuki"` is a valid `MoveId`: the validator accepts `{type:"attack",
  move:"kizami-zuki", band:…}`; an unknown move id is still **rejected** by the TCB allowlist.
- [ ] On a fixture, a `kizami-zuki` landed at a legal band (`high`/`mid`) in reach scores
  **1**; at `low` it fizzles to `idle`; beyond its (short) reach it **whiffs**.
- [ ] `dsl.ts` interpreter/validator region stays at **100%** mutation; `sim.ts`
  changed-line **100%** (project bar).

## Slices

Every slice follows RED-GREEN-MUTATE-KILL MUTANTS-REFACTOR. No production code without a
failing test. Read `.claude/CLAUDE.md` (invariants #1–#4) + testing rules before coding.

### Slice 1: Out-of-band attacks fizzle (the band-legality gate)

**Value**: bot author — an attack a move can't perform at that height no longer commits;
height becomes a per-move constraint, the foundation the whole arsenal read-game rests on.
**Path**: bot returns `{type:"attack", move, band}` → `intake` checks `bandLegal(spec,
band)` before committing → illegal ⇒ condition fails ⇒ falls through to `idle` (no commit,
so `spend`/`startAttack` never run); legal ⇒ commits exactly as today. Same guard added to
the cancel-exception condition. Observability: a fizzle leaves `points` + `self.stamina` +
fighter state unchanged vs a legal commit. **Skipped state**: no telemetry emission on
fizzle (the telemetry object is NOT YET BUILT — a separate roadmap item).
**Schema**: add `MoveSpec.bands?: Band[]` — optional; **absent ⇒ all bands legal**
(byte-identical). No `MoveId`/allowlist change in this slice (proven against `strike`).
**`bands` semantics** (resolved): `bandLegal = spec.bands === undefined ||
spec.bands.includes(band)`. So **absent ⇒ unrestricted**; an **empty `[]` ⇒ every band
illegal ⇒ the move always fizzles** (the literal semantics — no special-case branch).
`bands` is trusted Rules data (not bot-validated), so a degenerate `[]` is an author
error the engine does not defend against.
**Required implementation skills**: load `tdd`, `testing`, `mutation-testing`,
`refactoring`, and `typescript-strict` (the `MoveSpec` contract change) before code.
**Acceptance criteria** (present + confirm before any code):
  1. Fixture with `strike.bands = ["high","mid"]`: a neutral `attack` at `low` ⇒ fighter
     stays `neutral`, scores nothing, spends no stamina — while the same attack at `mid`
     commits + spends (the contrast pins the gate, not just "nothing happened").
  2. A `MoveSpec` with no `bands` (canonical `strike`): `attack` at all three bands commits
     as before ⇒ byte-identical replay against a recorded baseline.
  3. Edge: an attacking, in-window-cancelable fighter that cancels into a band the
     follow-up can't strike ⇒ the cancel is **ignored**, the fighter **continues its
     current move's recovery** (not idle), and crucially `cancelRemaining` is **not
     reset** — so a later *in-band* cancel within the same window still fires.
  4. A fizzle is a **pure no-op**: the fighter stays `neutral` (never enters `attacking`),
     so it raises no `attacking`/`attackBand` tell to the opponent, and — being
     uncommitted (neutral ∧ not guarding) — it **regens this tick exactly like idle**
     (the existing C10 rule; **no new code** for regen). *Covered transitively, no dedicated
     test:* the gate adds zero regen code, a fizzle lands in the same `neutral ∧ not guarding`
     state the existing C10 regen suite already proves recovers, and AC-1 pins the
     no-spend/no-commit half (a pure low-fizzler starts at `max`, so a +`regen` rise is not
     directly observable without a contrived spend-then-fizzle sequence).
  5. The gate is on the **`attack` action only**. `sweep` (band engine-fixed to `low`)
     and `throw` (unbanded) are **out of scope** — their height is engine-determined, so
     `bands` on `moves.sweep` is meaningless and not consulted.

**Notes / non-gaps** (recorded so they aren't re-litigated):
  - *Verification vehicle*: byte-identical (AC-2 / capability AC) is proven by extending
    the existing replay/determinism test (`run-fight.test.ts`) with a no-`bands` fixture —
    not a new harness.
  - *Check order*: `bandLegal` and `affordable` are both pure AND-conditions; order is
    immaterial to the outcome (either failing ⇒ no commit). A future telemetry layer may
    want to distinguish *why* a commit failed (out-of-band vs gassed) — deferred with the
    telemetry object.
  - *Resolved literal*: by `intake` time `action.band` is already a concrete `Band` (the
    DSL interpreter resolved any dynamic expression upstream), so `bandLegal` tests the
    resolved literal. "Runtime" gate means *authoring-time* band dynamism, not deferred
    resolution.
**RED**: the three tests above, via `runFight` on test fixtures (lowest level that gives
confidence). Mutator-aware (`resources/mutator-rules.md`): the `spec.bands === undefined ⇒
true` branch (a mutant making absent⇒illegal must die), the `includes` membership boundary
(band in/not-in the list), and the `&&` short-circuit added to the intake condition.
**GREEN**: `const bandLegal = (spec: { bands?: Band[] }, band: Band) => spec.bands ===
undefined || spec.bands.includes(band);` — add `&& bandLegal(rules.moves[action.move],
action.band)` to the neutral-attack condition (`sim.ts:370`) and the cancel-exception
condition (`sim.ts:361`).
**MUTATE**: run `mutation-testing` (diff-against-main) on `sim.ts`.
**KILL MUTANTS**: cover the absent-bands branch, both `includes` boundaries, and the
short-circuit; ask the human if any survivor's value is ambiguous.
**REFACTOR**: assess (likely none — one pure predicate + two guard clauses).
**Done when**: all ACs met, byte-identical replay test green, suite + typecheck + lint
green, mutation report reviewed, human approves commit.

### Slice 2: Bot can throw the jab (`kizami-zuki`)

**Value**: bot author — the first real technique with distinct trade-offs (short / fast /
cheap, `high·mid`, 1 yuko); the gate from Slice 1 now bites a real move on a realistic fixture.
**Path**: `MoveId` gains `"kizami-zuki"`; `Rules.moves` gains optional `"kizami-zuki"?:
MoveSpec`; the `dsl.ts` `MOVES` allowlist (the TCB security boundary for `attack.move`)
gains `"kizami-zuki"`; the sim resolves it through the **existing** generic
`rules.moves[action.move]` indexing — **no resolver change**. Observability: `runFight`
awards +1 on a legal in-reach jab.
**Contract decision** (split parking-lot #2): explicit optional key `"kizami-zuki"?:
MoveSpec` (keep `strike` **required** through the additive phase; switch `Rules.moves` to
`Partial<Record<MoveId, MoveSpec>>` only at the split's final retirement slice).
**Required implementation skills**: load `tdd`, `testing`, `mutation-testing`,
`refactoring`, `typescript-strict` (the `MoveId` union + allowlist = a TCB change), and
`api-design` (the `MoveId` contract) before code.
**Acceptance criteria** (present + confirm before any code):
  1. Validator accepts `{type:"attack", move:"kizami-zuki", band:"mid"}`; rejects an
     unknown id (e.g. `{move:"oroshi"}`) with the existing structured "unknown move" error.
  2. `runFight` on a fixture (canonical-ish rules + a `kizami-zuki` spec with reach **<**
     `strike.reach`): a legal in-reach `kizami-zuki` at `mid` scores **1**; at `low` ⇒
     `idle` (Slice-1 gate); at a gap **beyond jab reach but within `strike.reach`** ⇒
     **whiff** (proves the shorter reach is real, not incidental).
  3. `CANONICAL_RULES` (no `kizami-zuki` key) unchanged ⇒ existing fights byte-identical.
**RED**: validator tests (accept new id / reject unknown) + the three `runFight`
behaviors. Mutator-aware: the `MOVES` set membership (a mutant dropping the new id must
fail the accept test; a mutant adding a bogus id is caught by the reject test), and the
reach boundary (`<=` vs `<` at the jab-reach edge — borrow the existing strike-reach
boundary test shape).
**GREEN**: extend the `MoveId` type union; add `"kizami-zuki"` to the `MOVES` `Set`; add
the optional `"kizami-zuki"?: MoveSpec` key to `Rules.moves`; add the fixture spec in the
test. No `sim.ts` change expected (resolution is already generic over `MoveId`).
**MUTATE**: run `mutation-testing` on `dsl.ts` (the allowlist/validator) + `sim.ts`.
**KILL MUTANTS**: the allowlist is TCB — every member's membership must be test-pinned
(keep `dsl.ts` at 100%); kill the reach-boundary survivor.
**REFACTOR**: assess (e.g. whether the test fixture deserves a shared `kizami-zuki` factory).
**Done when**: all ACs met, suite + typecheck + lint green, mutation report reviewed,
human approves commit.

## Pre-PR Quality Gate (each slice)

1. Mutation testing — `mutation-testing` skill (diff-against-main); meet the project bar.
2. Refactoring assessment — `refactoring` skill.
3. `npm run typecheck` + `npm run lint` pass.
4. Update `.claude/CLAUDE.md` Status (a new C9 entry) and reconcile `docs/BOT-DSL.md`'s
   illustrative move-id examples with the Japanese roster — at the slice where it lands.

## Slice 2 parking lot (harden when we plan/build it — after Slice 1 merges)

- `kizami-zuki` gets **no `cancelInto`** in Slice 2 (cross-move cancels are the split's
  Slice 6). Keep the jab a plain move; revisit routes later.
- Verify adding `"kizami-zuki"` to `MoveId` breaks **no exhaustive switch** (today
  resolution is via `rules.moves[action.move]` indexing — no `switch (move)` seen — but
  re-grep before coding).
- Jab frames / reach / `staminaCost` live in a **test fixture**, not `CANONICAL_RULES`
  (split parking-lot #3 — canonical re-tune is the split's Slice 7).

## Gaps closed — find-gaps session 2026-06-29 (Slice 1)

Resolved (9):
- [Blocker → schema note]  `bands: []` ⇒ every band illegal (literal `undefined || includes`; no special-case)
- [Blocker → capability AC] Out-of-band degrades *differently* per site: neutral ⇒ idle, cancel ⇒ continues recovery
- [Should  → AC-4]         Fizzle is a pure no-op that **regens like idle** (§P7 "idle"; effort lives in the whiff)
- [Should  → AC-3]         Ignored cancel does **not** reset `cancelRemaining` (window survives for a later in-band cancel)
- [Should  → AC-4]         Fizzle stays `neutral` ⇒ raises no `attacking`/`attackBand` tell
- [Should  → note]         Byte-identical verified via existing `run-fight.test.ts` replay, no new harness
- [Nice    → AC-5]         Gate is `attack`-only; `sweep`/`throw` out of scope
- [Nice    → note]         `bandLegal`/`affordable` order immaterial (telemetry-reason split deferred)
- [Nice    → note]         `action.band` is a resolved literal by intake ("runtime" = authoring-time dynamism)

Parked: none for Slice 1. (Slice 2 candidates in the parking lot above.)

---
*Delete this file when the plan is complete. If `plans/` is empty, delete the directory.*
