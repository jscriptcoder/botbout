# Plan: C2 — Sudden-Death Overtime (§7 WKF match structure)

**Branch**: `feat/overtime` (C2a); `feat/overtime-perception` off `main` (C2b), mirroring C1's
`feat/senshu-tiebreak` → `feat/senshu-revocation` two-branch split.
**Status**: Active

## Goal

Decisively resolve a bout that is LEVEL at the regulation cap via a single fixed sudden-death overtime
period (first to a 1-point gap wins), with senshu (C1) as the fallback — a scoring-layer extension of
`FightConfig.match`, byte-identical when unconfigured.

## Source of truth

All design decisions + AC-1…AC-15 + the AC→slice map live in
`plans/s7-match-remainder-stories.md` → **"C2 — resolved decisions (grill 2026-07-02)"** and
**"C2 — find-gaps resolutions + Acceptance criteria"**. Read them before coding. This file is the
delivery sequencing; that section is the contract.

## Non-negotiables (every slice)

- **Byte-identical when `match.overtime` absent / `ticks ≤ 0`** — no extra ticks, `endReason` never
  `"overtime"`, `clock.overtime` always `0`, `FightResult` bytes unchanged.
- **Replay-stable + swap-symmetric** (OT winner A↔B mirrors under a fighter swap).
- **Invariants:** integer-only outcome math (ticks/points/gap); the seeded PRNG threads OT unchanged;
  same pre-tick snapshot per OT tick; the only new TCB surface is C2b's one static `clock.overtime`
  reader (no host/net/fs/time/randomness). `match` is trusted engine config (scoring-layer, NOT
  `Rules`/`CANONICAL_RULES` ⇒ `npm run fight` unaffected) — no bot-validation.

## Acceptance Criteria

(Full G/W/T text in the tracker's C2 AC section — checkboxes here for tracking.)

- [x] AC-1 — OT entry on level (extra ticks; `resetToNeutral` both; points/stamina/penalties/mem/senshu persist)
- [x] AC-2 — not level ⇒ no OT (`ticks = maxTicks`, byte-identical)
- [x] AC-3 — sudden death, solo score wins (`endReason "overtime"`, `ticks = tick+1`)
- [x] AC-4 — mutual trade in OT stays level (OT continues)
- [x] AC-5 — 0-0 scoreless regulation ⇒ first OT score decides (`"overtime"`)
- [x] AC-6 — penalty (2nd+ foul) decides OT (`"overtime"`)
- [x] AC-7 — OT exhausts ⇒ senshu holder wins (`"senshu"`, `ticks = maxTicks+K`)
- [x] AC-8 — OT exhausts, no holder ⇒ `"draw"`/`"time"` (`ticks = maxTicks+K`)
- [x] AC-9 — holder's OT foul forfeits senshu (revoke → `none` → fallback is draw)
- [x] AC-10 — winGap in regulation ⇒ `"gap"`, no OT
- [x] AC-11 — degenerate `overtime.ticks ≤ 0` ⇒ byte-identical (no validation)
- [ ] AC-12 — `clock.overtime` reads `0` in regulation, `1` from first OT tick
- [ ] AC-13 — `clock.ticksRemaining` counts the OT budget down, never negative; unchanged absent OT
- [x] AC-14 — byte-identical absent + replay-stable + swap-symmetric (officiating half; perception half → C2b)
- [ ] AC-15 — C2b `docs/spec.md` drift-clean after regen; `dsl.ts` interpreter 100%

## Slices

Every slice follows RED-GREEN-MUTATE-KILL MUTANTS-REFACTOR. No production code without a failing test.
Before code changes, load `tdd`, `testing`, `mutation-testing`, `refactoring`.

### Slice C2a: A level bout at the cap plays sudden-death overtime and is decided by the first 1-point gap

**Value**: A match operator (and, later, the benchmark) gets a decisive result from a level bout
instead of a draw — the officiating half, no bot-visible surface.
**Path**: `FightConfig.match.overtime?:{ticks}` → `runFight` computes a dynamic loop cap (`maxTicks +
(level && otTicks>0 ? otTicks : 0)`, level checked after the last regulation tick's officiating) →
`resetToNeutral` both at OT entry (mirroring yame end-of-tick timing) → an `inOT` flag flips the gap
threshold to `1` at the THREE existing check-sites (yame / jogai / passivity) → `endReason "overtime"`
+ `ticks` accounting → observable via `FightResult` (`winner`, `endReason`, `ticks`, `scores`).
*Intentionally skipped this slice:* the `clock.overtime`/`ticksRemaining` perception (C2b) — during
C2a, OT ticks still build a view with the (soon-to-be-fixed) `maxTicks - tick` remaining; no bot in the
officiating fixtures reads it, and C2a asserts only `FightResult`, so this is inert until C2b.
**Files**: `src/engine/types.ts` (`match.overtime?:{ticks}`; `endReason` union gains `"overtime"`),
`src/engine/sim.ts` (dynamic cap, OT-entry reset, `inOT` gap threshold at the 3 sites, `ticks`
accounting); tests in `src/engine/run-fight.test.ts`.
**Required implementation skills**: `tdd`, `testing`, `mutation-testing`, `refactoring`.
**Acceptance criteria**: AC-1…AC-11 + AC-14 (officiating). **Present to human and confirm before code.**
**RED** (behaviour-driven `runFight` tests; reuse the C1 helpers — `twoMoveRules`, `scoreOnce`,
`scoreThenRetreat`, `foulThenScore`, `passiveLevel`, `ATTACKER`, `scoreThenBlock`):
- level-at-cap + `overtime.ticks=K` ⇒ fight runs past `maxTicks`; not-level ⇒ `ticks=maxTicks` (AC-1/2).
- solo score in OT ⇒ winner + `endReason "overtime"`, `ticks=tick+1` (AC-3).
- both score same OT tick ⇒ OT continues, still resolvable later (AC-4).
- 0-0 all regulation, first OT score ⇒ `"overtime"` (AC-5).
- 2nd+ jogai/passivity foul in OT ⇒ opponent wins `"overtime"` (AC-6).
- OT exhausts level + senshu holder ⇒ `"senshu"`, `ticks=maxTicks+K` (AC-7); no holder ⇒ `"draw"`/
  `"time"`, `ticks=maxTicks+K` (AC-8).
- holder fouls in OT (incl. free warning) ⇒ senshu revoked, OT-exhaust fallback is draw (AC-9);
  non-holder foul leaves it intact.
- winGap reached in regulation ⇒ `"gap"`, no OT ticks (AC-10).
- `overtime.ticks=0` ⇒ byte-identical to absent (AC-11).
- `match.overtime` absent ⇒ byte-identical to pre-C2; present ⇒ replay-stable + swap-symmetric (AC-14).
- *Mutator-aware cases* (from `resources/mutator-rules.md`): the `otTicks > 0` boundary (test `0` AND
  `1`); the `inOT ? 1 : winGap` conditional (a regulation gap of `1 < winGap` must NOT end the bout —
  proves the branch); the `level` equality (test level vs 1-apart at the cap); the `maxTicks + K` cap
  arithmetic (off-by-one: OT must run exactly `K` ticks); the `|a−b| ≥ 1` boundary in OT.
**GREEN**: minimal — `const otTicks = match?.overtime?.ticks ?? 0`; detect level at the regulation
boundary and extend `cap`; `resetToNeutral` both at entry + clear `scored`; `const gap = inOT ? 1 :
match.winGap` at the 3 sites; set `endReason "overtime"` on an inOT gap break; make `ticks` reflect
executed ticks including OT.
**MUTATE**: `rm -rf .stryker-tmp reports` then scoped Stryker on the changed `sim.ts` regions (cap
computation, OT-entry block, the 3 gap-check sites, `ticks` accounting). Comma-separated line ranges in
one `--mutate` flag.
**KILL MUTANTS**: strengthen tests for survivors; expect the C1-style equivalent-mutant caution (e.g. a
`"none"`/string literal or a redundant guard) — document any genuine equivalents, don't chase.
**REFACTOR**: assess extracting a shared `gapMet(gap)` / OT-entry helper if the 3 sites duplicate;
only if it adds clarity without obscuring the swap-symmetry.
**Done when**: AC-1…AC-11 + AC-14 met, mutation report reviewed (changed-line ~100%), typecheck+lint
clean, byte-identical-absent + replay + swap verified, human approves commit.

### Slice C2b: A bot can perceive sudden death (`clock.overtime`) and reads a sane OT countdown

**Value**: A bot author gets a live 1/0 sudden-death signal (play-safe vs all-in) and a
never-negative `clock.ticksRemaining`; the spec instrument stays truthful.
**Path**: `ClockState` gains `overtime: number` (view-only) → `viewFor` sets `overtime = inOT ? 1 : 0`
and `ticksRemaining = effectiveCap − tick` → `dsl.ts` adds the `clock.overtime` FIELD_READER + the
`ALLOWED_FIELDS`/`FieldPath` union entry (TCB) → a probe bot reads it via `{op:"field",path:
"clock.overtime"}` → `npm run gen:spec` regenerates `docs/spec.md` (new whitelist bullet + JSON Schema
enum, bare) → the drift test re-pins byte-for-byte.
**Files**: `src/engine/types.ts` (`ClockState.overtime`; `FieldPath` gains `"clock.overtime"`),
`src/engine/sim.ts` (`viewFor` clock: `overtime` + OT-budget `ticksRemaining`), `src/engine/dsl.ts`
(`FIELD_READERS["clock.overtime"]` + `ALLOWED_FIELDS`), `docs/spec.md` (regenerated); tests in
`run-fight.test.ts`/the perception test + the gen-spec drift test.
**Required implementation skills**: `tdd`, `testing`, `mutation-testing`, `refactoring`.
**Acceptance criteria**: AC-12, AC-13, AC-15 + AC-14's perception half. **Present and confirm before code.**
**RED**:
- a probe bot gating on `clock.overtime` observes `0` every regulation tick, `1` from the first OT tick
  (via `FighterFrame`/behaviour); absent OT ⇒ `0` all bout (AC-12).
- `clock.ticksRemaining` in OT = `(maxTicks+K) − tick` (K on the first OT tick, 1 on the last, never
  negative); absent OT ⇒ `maxTicks − tick` unchanged (AC-13).
- the `docs/spec.md` drift test FAILS until regenerated; after `gen:spec` it passes and the schema enum
  contains `clock.overtime`; the ajv-agreement + interpreter-100% invariants hold (AC-15).
- *Mutator-aware cases*: the `inOT ? maxTicks+K : maxTicks` conditional (test a regulation tick AND an
  OT tick so both arms are pinned); `overtime: inOT ? 1 : 0` (both arms); the reader returns
  `s.clock.overtime` (a value bot proves it, not a constant).
**GREEN**: add the field, set it in `viewFor` alongside the OT-budget `ticksRemaining`, add the reader
+ allowlist entry, run `npm run gen:spec`, commit the regenerated `docs/spec.md`.
**MUTATE**: `rm -rf .stryker-tmp reports` then scoped Stryker on the `dsl.ts` reader region + the
`sim.ts` `viewFor` clock region + the changed `gen-spec.ts` region (if any).
**KILL MUTANTS**: strengthen for survivors; keep the `dsl.ts` interpreter at 100% (static reader,
value config-gated).
**REFACTOR**: assess; likely none (a one-line reader + one view field).
**Done when**: AC-12/13/15 + AC-14 perception half met, mutation report reviewed, `docs/spec.md`
drift-clean, interpreter 100%, ajv agrees, typecheck+lint clean, human approves commit.

## Pre-PR Quality Gate (each slice)

1. Mutation testing — scoped Stryker on the changed regions (`rm -rf .stryker-tmp reports` first;
   pollution artifact).
2. Refactoring assessment — run `refactoring`.
3. `npm run typecheck` + `npm run lint` clean.
4. **Byte-identical-absent** proof (a fixture with `match.overtime` absent replays identically to
   pre-C2) + **replay-stability** + **swap-symmetry**.
5. (C2b only) `docs/spec.md` drift test green after regen; `dsl.ts` interpreter 100%; ajv agreement.
6. No DSL op touches host/net/fs/time/randomness (TCB boundary held — C2b's one reader is config-gated).

## After both slices (close-out)

Verify AC-1…AC-15 met; use the `learn` agent to add a C2 DONE entry to `.claude/CLAUDE.md` Status +
record C2 in `plans/s7-match-remainder-stories.md` Progress and flip Next Step to **C3** (senshu/OT
perception — `self`/`opponent.senshu`; note C4/`clock.overtime` is now shipped inside C2) → **D**
(benchmark `MATCH`/`INPUT_HASH`/`BENCHMARK_VERSION` adoption + `generateSpec` match/OT prose). Delete
this file.

---
*Delete this file when the plan is complete. If `plans/` is empty, delete the directory.*
