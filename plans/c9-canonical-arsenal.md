# Plan: C9 Slice 7 — canonical wiring + retire `strike` (the C9 FINALE)

**Branch(es)**: one PR per slice — `feat/c9-cancel-knockdown-hardening` (S7.1),
`feat/c9-canonical-arsenal` (S7.2), `feat/c9-retire-strike` (S7.3).
**Status**: Active (planning)
**Parent tracker**: `plans/c9-arsenal-split.md` (Slice 7 row — the only remaining C9 slice).

## Goal

The platform (`npm run fight`, the future API / viewer) fights **real karate on the
4-strike roster**, the abstract `strike` scaffold is **gone**, and the deferred
cancel·knockdown mutation gap is closed — completing C9.

**Out of scope (S7):** no new engine *mechanic* (all four techniques, band-legality,
`scoreByBand`, and cross-move cancels already shipped in slices 1–6 — S7 is wiring +
retirement + docs, so the only production-code touch is `rules.ts` data; `sim.ts` is
untouched). Also deferred (separate roadmap items, not this slice): match structure
(*yame* / rounds / win conditions), air-actions (air strikes / horizontal jump
displacement), the telemetry object, and showcasing the full roster in the example bots
(see Decision 5). The new-move reach/`staminaCost` MAGNITUDES are provisional against
today's roster — re-tuned only by the relationship tests here; the structural
INEQUALITIES (reach hierarchy; the gas band) are what's locked.

## Why this is 3 PRs, not 1

The tracker frames S7 as one slice with four concerns, but they are independently
mergeable and one of them (retiring `strike`) is a broad breaking migration. Splitting
keeps each PR a single reviewable concept and the suite green at every step:

1. **S7.1 — cancel·knockdown hardening.** Small, independent, uses the *existing*
   `strike` fixture (so it's easiest to write *before* the migration churn). Clears the
   `sim.ts:365` debt that prompted the "are we really done with S6?" question.
2. **S7.2 — wire the 4 techniques into `CANONICAL_RULES`.** Purely **additive** —
   `strike` stays alongside, so every existing canonical + engine test is byte-identical
   green. This is the "real karate numbers + relationship tests" PR.
3. **S7.3 — retire `strike` + reconcile docs.** The **breaking** migration: remove
   `strike` from `MoveId`/`Rules.moves`/`MOVES`/`CANONICAL_RULES`, migrate every
   fixture/test/CLI/bot onto a real technique, reconcile the docs. One concept ("strike
   is gone"), but large mechanical churn — must land atomically (a half-migrated `MoveId`
   union won't typecheck).

Dependency chain: S7.1 independent · S7.2 additive (no break) · S7.3 depends on S7.2
(the techniques must be canonical before `strike` can be removed as the canonical move).

## Acceptance Criteria (whole feature)

- [ ] `CANONICAL_RULES.moves` contains `kizami-zuki`, `gyaku-zuki`, `mae-geri`,
  `mawashi-geri` with the reach hierarchy `throw < sweep < jab < reverse < front <
  roundhouse`, each proven by a `runFight`/relationship test (not a literal in isolation).
- [ ] Every committed technique stays on the read-game knife-edges: startup ≥ `lAct + 1`
  (reactable); a whiff is punishable (recovery ≥ `lAct + a basic startup`).
- [ ] The C10 gas band is preserved across the new per-move `staminaCost`: punches stay
  affordable when gassed, kicks lock out (`basicCost ≤ gasThreshold < specialCost`,
  emergent special-lockout) — proven by a `runFight` test, not a literal compare alone.
- [ ] The canonical `cancelInto` rekka routes resolve on `CANONICAL_RULES` (the S6 proof,
  now canonical).
- [ ] `strike` is no longer a valid `MoveId`: the validator **rejects**
  `{type:"attack", move:"strike"}` with a structured error; `tsc` no longer accepts it.
- [ ] Full suite green on the techniques; `npm run fight` fights the arsenal.
- [ ] `docs/BOT-DSL.md` + `docs/DESIGN.md` reconciled (illustrative ids → canonical
  Japanese ids; §P7 C9 marked done).
- [ ] The `sim.ts:365` cancel-guard survivor is killed (a fighter downed the same tick it
  lands a cancelable hit does not cancel-attack while prone).

## Slices

Every slice follows RED-GREEN-MUTATE-KILL MUTANTS-REFACTOR. Load `tdd`, `testing`,
`mutation-testing`, `refactoring` before any code. Run `find-gaps` on this plan first
(decisions are flagged in **Decisions for `find-gaps`** below).

### Slice 7.1: A fighter downed the same tick it lands a cancelable hit cannot cancel-attack while prone

**Value**: closes the C6/C7 cancel·knockdown edge deferred from S6 — a downed fighter
can never sneak a cancel-attack out of a same-tick connect+knockdown. Regression-locks the
`f.state.kind === "attacking"` cancel guard.
**Actor / Trigger / Outcome**: fight engine / a mutual same-tick exchange where A's strike
connects (opening A's cancel window) *while* B's sweep/throw downs A / A's queued
`cancelInto` follow-up on the next tick is **refused** — A stays prone (`downed`,
untargetable), no follow-up score.
**Path**: bot DSL `attack` → `intake` cancel path (`sim.ts:365` guard
`f.state.kind === "attacking"`) → A is `downed`, not `attacking` ⇒ cancel refused →
`result.scores` / A stays untargetable. **No production change expected** (the guard
already exists — this is a KILL-MUTANTS test that kills the `sim.ts:365` survivor).
**Required implementation skills**: `testing`, `mutation-testing`.
**Acceptance criteria** (present + confirm before code):
- Construct a `runFight` where A's strike and B's **sweep** (a low-band strike — a
  strike∥sweep is a trade, both connect) resolve the same tick: A's strike connects on B
  (opening A's `cancelWindow`), B's sweep downs A simultaneously.
- A holds a `cancelInto` follow-up `attack` for the ticks while it is `downed`.
- **Assert**: A does **not** execute the cancel-attack while downed — A scores nothing
  further from the cancel during the knockdown, and A's state stays `downed`/untargetable
  through `knockdownDuration`. (B's sweep-knockdown and A's trade-score resolve as normal.)
**RED**: with `sim.ts:365` mutated `f.state.kind === "attacking"` → `true`, the downed
fighter would pass the cancel guard and cancel-attack while prone → the assertion fails.
The new test fails under that mutant and passes against the real guard.
**GREEN**: none expected — the guard is already in production. **CONTINGENCY**: if the
scenario reveals the guard is *insufficient* (wrong behavior even with the guard present),
this converts to RED-GREEN and we fix `sim.ts` — flag it, don't paper over it.
**MUTATE**: scope Stryker to the cancel block (`sim.ts:360-378`); confirm `sim.ts:365`
moves survived → **killed** (and the two documented equivalents on `:367`/`:373` stay
equivalent).
**REFACTOR**: assess the new test helper only.
**Done when**: the test is green, `sim.ts:365` killed under scoped mutation, full suite
green, typecheck + lint clean, human approves commit.

### Slice 7.2: The platform fights the 4-strike arsenal (canonical wiring)

**Value**: `CANONICAL_RULES` becomes real karate — four techniques with genuine
reach/speed/score/stamina trade-offs and rekka routes — so `npm run fight` (and the future
API/viewer) play the read game with an arsenal. `strike` stays alongside ⇒ additive,
byte-identical for existing behavior.
**Actor / Trigger / Outcome**: bot author / a bot throws a named technique on
`CANONICAL_RULES` / it resolves per the tuned frame table (reach hierarchy, band legality,
band-dependent score, gas band, cancel routes) — every number proven by a relationship test.
**Path**: `CANONICAL_RULES.moves` (`rules.ts`) gains the 4 techniques → `runFight` on
canonical → relationship assertions in `rules.test.ts`. No engine code change (the resolver
is generic). The new-move numbers move from the per-slice test fixtures (S2–S6) into the
authoritative table.
**Required implementation skills**: `tdd`, `testing`, `mutation-testing`, `refactoring`.
**Acceptance criteria** (present + confirm before code):
- **Reach hierarchy**: `throw(120k) < sweep(180k) < kizami-zuki < gyaku-zuki < mae-geri <
  mawashi-geri`, proven both structurally (the canonical reach values are strictly
  ordered) **and** behaviorally (at a gap only the longer move reaches, the shorter
  whiffs). Anchors `throw 120k < sweep 180k` and the locked `240k` reference are respected.
- **Read-game per technique**: each committed technique's `startup ≥ lAct(6) + 1`
  (reactable); each whiff is punishable (`recovery ≥ lAct + a basic startup`).
- **Band legality (canonical)**: `mae-geri` bands `["mid"]` (whiffs high/low → idle);
  `mawashi-geri` `["high","mid"]` with `scoreByBand` jodan **3** / chudan **2**; jab+reverse
  `["high","mid"]` score 1.
- **Gas band preserved**: per-move `staminaCost` keeps `basicCost ≤ gasThreshold(30) <
  specialCost`; a **gassed** fighter still commits a punch but its kicks degrade to idle —
  proven by a `runFight` relationship test (the emergent special-lockout).
- **Canonical cancel routes**: the rekka `cancelInto` routes (per the S6 proof) resolve on
  `CANONICAL_RULES` (e.g. a canonical jab→reverse hit-confirm scores within the window).
- **Existing behavior unchanged**: all current `strike`-based canonical + engine tests stay
  green (strike still present) — additive, byte-identical.
**RED**: relationship tests fail until the moves exist with satisfying numbers (e.g. the
reach-hierarchy test fails while `gyaku-zuki.reach ≤ kizami-zuki.reach`; the gas-band test
fails while a kick is affordable when gassed). Drive each number by a failing relationship
assertion — no literals in isolation.
**GREEN**: add the four `MoveSpec`s to `CANONICAL_RULES.moves` with the minimum numbers
that satisfy the relationships.
**MUTATE**: `rules.ts` is data — pin the shape with structural `toBe` assertions; the
relationship `runFight` tests provide behavioral coverage. Confirm `rules.ts` mutation
stays 100% (as the prior canonical slices did).
**KILL MUTANTS**: strengthen any relationship test whose number survives mutation.
**REFACTOR**: assess `rules.test.ts` helpers (per-move accessors mirroring `strike()`).
**Done when**: all ACs green, `rules.ts` 100% under mutation, full suite green, typecheck +
lint clean, human approves commit.

### Slice 7.3: Retire the abstract `strike` + reconcile docs

**Value**: the scaffolding is gone — `strike` is no longer a valid technique anywhere, the
contract/TCB/canonical/fixtures/docs all speak the real arsenal. C9 is complete.
**Actor / Trigger / Outcome**: bot author / submits `{type:"attack", move:"strike"}` / the
validator **rejects** it (no longer in the `MOVES` allowlist) — and every fight/test runs on
real techniques.
**Path**: remove `strike` from `MoveId` (`types.ts`), `Rules.moves` (`types.ts`), the
`MOVES` allowlist (`dsl.ts` — the TCB), and `CANONICAL_RULES` (`rules.ts`); migrate every
engine `getMockRules`/fixture/test, the CLI runner, and `bots/` off `strike` onto a real
technique; reconcile docs. **No `sim.ts` change** (the resolver never branched on the literal
`"strike"`; `computeStrike`/`applyStrike` are function names that stay).
**Required implementation skills**: `tdd`, `testing`, `mutation-testing`, `refactoring`.
**Acceptance criteria** (present + confirm before code):
- The validator **rejects** `move:"strike"` with a structured error (the inverse of the S2
  accept test) — a `validate-bot` test asserting rejection.
- `tsc` no longer admits `"strike"` as a `MoveId` (removing it from the union turns any
  lingering reference into a compile error — this drives the migration to completion).
- The `MOVES` allowlist (`dsl.ts`, the TCB) no longer contains `"strike"`; `dsl.ts`
  interpreter/reader stays 100% under mutation.
- `CANONICAL_RULES.moves` has no `strike`; `npm run fight` + `bots/` use a real technique.
- Full suite green: every fixture/test migrated onto a real technique per the agreed
  workhorse strategy (see Decisions).
- `docs/BOT-DSL.md` illustrative ids (`jab`/`kick`/`roundhouse`/`punch`) → canonical Japanese
  ids; the abstract-strike model text updated. `docs/DESIGN.md` §P7 marks C9 done.
**RED**: the validator-reject test fails (today the validator *accepts* `"strike"`); `tsc`
fails on lingering `strike` references after the union edit.
**GREEN**: remove `strike` everywhere and migrate references onto the chosen technique.
**MUTATE**: scope Stryker to `dsl.ts` `MOVES` (the TCB) — confirm 100% after the removal.
**KILL MUTANTS**: address any survivor introduced by the contract change.
**REFACTOR**: assess the migrated fixtures (a shared `getMockRules` workhorse spec).
**Done when**: all ACs green, `dsl.ts` 100% under mutation, full suite green, typecheck +
lint clean, docs reconciled, human approves commit. **On merge: C9 is complete — delete
`plans/c9-arsenal-split.md` and this file.**

## Decisions (resolved via `find-gaps`, 2026-06-29)

All six are settled — the plan is ready for TDD. Each ✅ entry is the confirmed decision.

1. **Migration workhorse (S7.3).** ✅ **RESOLVED: `gyaku-zuki` (reverse punch)** — the
   closest analog to the retired abstract `strike` (score 1, a standard mid punch), so the
   migration is a near-mechanical rename `move:"strike"` → `move:"gyaku-zuki"` across the
   generic mechanical fixtures (perception / parry / throw / sweep / occupancy / stamina —
   *not* the technique-specific describe blocks, which keep their own moves). **Unbanded
   strategy:** the engine's `getMockRules`/`run-fight.test.ts` fixtures define their workhorse
   `gyaku-zuki` MoveSpec with `bands` **OMITTED** so it stays unrestricted *in that fixture*
   (fixtures own their `MoveSpec`, exactly as `getMockRules` does today — independent of the
   `["high","mid"]` canonical `gyaku-zuki`). This keeps every migrated mechanical test
   byte-identical (a move that hits any band, like the old `strike`). A **single** shared
   workhorse (not per-test) — lowest churn / smallest review surface.
2. **Per-move `staminaCost` gas split (S7.2).** ✅ **RESOLVED: punches basic, kicks special.**
   `kizami-zuki` + `gyaku-zuki` cost **≤ gasThreshold (30)** (still commit when gassed);
   `mae-geri` + `mawashi-geri` cost **> 30** (lock out when gassed) — preserving the emergent
   special-lockout (`basicCost ≤ gasThreshold < specialCost`). Cost gradient
   `jab < reverse ≤ 30 < front < roundhouse`; the workhorse `gyaku-zuki` stays near strike's
   current 20 so migrated canonical stamina tests (`rules.test.ts:839/:981`) barely move. A
   gassed fighter keeps its full punch game, loses both kicks. **Exact magnitudes** TDD-driven
   from the relationship tests; the gas-band test proves: gassed ⇒ a punch commits, a kick
   degrades to idle.
3. **Canonical `cancelInto` route table (S7.2).** ✅ **RESOLVED: the "richer combo web"** —
   the escalation tree jab → reverse → {front kick | roundhouse}, with a kick able to come back
   to a punch:

   | Move | `cancelInto` |
   |------|-------------|
   | `kizami-zuki` (jab) | `["gyaku-zuki"]` |
   | `gyaku-zuki` (reverse) | `["mae-geri", "mawashi-geri"]` |
   | `mae-geri` (front kick) | `["gyaku-zuki"]` |
   | `mawashi-geri` (roundhouse) | `["gyaku-zuki"]` |
   | `sweep` | `["gyaku-zuki"]` (the **load-bearing finisher** — replaces the current
     `sweep.cancelInto:["strike"]`, keeping the okizeme finish test `rules.test.ts:714` green) |

   The economy self-limits the punch↔kick cycle (kicks are special-cost > `gasThreshold`, so the
   gas band caps repetition; each cancel must *connect* to re-open the window). **Test approach:**
   the cross-move cancel *machinery* is already proven move-agnostic (S6), so S7.2 is a **wiring
   check** — prove a representative subset on `CANONICAL_RULES` (the full jab→reverse→roundhouse
   chain + at least one kick→punch route + the sweep→reverse okizeme finish), not an exhaustive
   per-route proof.
4. **Docs placement.** ✅ **RESOLVED: docs ride S7.3** — `docs/BOT-DSL.md` + `docs/DESIGN.md`
   update in the same PR that retires `strike`, so code and the docs describing it change
   together (no transient window where shipped docs contradict the code).
5. **CLI / `bots/` migration scope (S7.3).** ✅ **RESOLVED.** Verified exact scope:
   `src/cli/format.test.ts` (3 `strike` refs) + the two strike-using example docs
   `bots/aggressor.json` (`strike` high) and `bots/sweeper.json` (`strike` high + `sweep`).
   **Mechanical swap:** `strike` → `gyaku-zuki`, keeping `band:"high"` (legal — canonical
   `gyaku-zuki` is `["high","mid"]`), preserving each bot's existing intent. (The other three
   bots — `counter`/`turtle`/`grappler` — use no `strike`, so they're untouched.) Showcasing
   the full roster in the demos is deferred to a later polish task, not S7.
6. **Slice ordering.** ✅ **RESOLVED: S7.1 → S7.2 → S7.3** (hardening first — easiest while
   `strike` still exists as the simple test workhorse, and it clears the deferred line-365 debt
   before the heavy lifting).

## Pre-PR Quality Gate (each slice)

1. Mutation testing — scoped to the changed region (`sim.ts:360-378` for S7.1; `rules.ts`
   for S7.2; `dsl.ts` `MOVES` for S7.3).
2. Refactoring assessment — `refactoring` skill.
3. `npm run typecheck` + `npm run lint` pass; full `npm test` green.
4. Update `plans/c9-arsenal-split.md`: mark the sub-slice done (PR #). On S7.3 merge, C9 is
   complete — delete the tracker and this plan.

---
*Delete this file when S7 is fully merged (its record lives in the PRs + git history).*
