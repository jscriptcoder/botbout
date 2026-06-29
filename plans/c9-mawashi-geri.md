# Plan: C9 Slice 5 — `mawashi-geri` (roundhouse) + band-dependent score

**Branch**: feat/c9-mawashi-geri-roundhouse
**Status**: Active
**Parent tracker**: `plans/c9-arsenal-split.md` (Slice 5 row + "Resolved (session 2026-06-29)")

## Goal

The bot can throw `mawashi-geri` (roundhouse) — the risk/reward apex: longest reach, slowest,
costliest, `high·mid` — and it introduces **band-dependent score** (the one genuinely new
mechanic left in C9): a high (*jodan*) roundhouse scores **3** (ippon), a mid (*chudan*) one
scores **2** (waza-ari).

## Context — the FIRST non-mechanical arsenal slice

Unlike Slices 2–4 (pure data + allowlist), this slice adds **one new resolver behavior**:
band-dependent score. A new additive optional field `MoveSpec.scoreByBand?: Partial<Record<
Band, number>>` overrides the flat `score` **per band**; `computeStrike`'s HIT path resolves
`scoreByBand?.[band] ?? spec.score`. Absent `scoreByBand` ⇒ flat `score` everywhere ⇒
**byte-identical** to the pre-S5 engine.

**Production edits:**
1. `types.ts` — `MoveId` union `+ "mawashi-geri"` (type-only).
2. `types.ts` — optional `"mawashi-geri"?: MoveSpec` key on `Rules.moves` (type-only).
3. `types.ts` — `MoveSpec.scoreByBand?: Partial<Record<Band, number>>` (type-only).
4. `dsl.ts` — `"mawashi-geri"` into the `MOVES` allowlist (the TCB). **No validator change for
   `scoreByBand`** — it is trusted `Rules` data, not bot-authored (like `bands`).
5. `sim.ts` — `computeStrike` HIT path: resolve `const baseScore = spec.scoreByBand?.[st.band]
   ?? spec.score;` and award `points: baseScore + bonus`. **This is the only resolver line that
   changes.**

**Resolved design decisions (confirm before RED):**
- **`scoreByBand` overrides per band; missing entry falls back to flat `score`.** (`?? spec.score`
  — a `0` entry is respected via `??`.) Per the split plan's Resolved section.
- **The okizeme FINISH is band-agnostic and does NOT use `scoreByBand`.** A downed target is
  prone (no band); the finish keeps `rules.finishScore ?? spec.score` (line 531 unchanged). So
  `scoreByBand` affects the **live HIT only**.
- **Fixture shape** (recommended): `score: 2` + `scoreByBand: { high: 3 }` — high *overrides*
  to 3, mid *falls back* to `score` 2. This exercises BOTH the override and the `?? spec.score`
  fallback with `scoreByBand` present (stronger mutation coverage than setting both keys).

`CANONICAL_RULES` is **not** touched (canonical wiring + per-move stamina re-tune is Slice 7);
`mawashi-geri`'s frames/reach/score live in a **test fixture**.

## Acceptance Criteria

Proven by `runFight` (engine behavior) + `validate` (TCB allowlist).

- [ ] **AC-1 (jodan ippon — THE new mechanic, genuine RED):** Given `mawashi-geri` with
  `score:2, scoreByBand:{high:3}` in reach, when a bot lands it at **high**, then it scores
  **3** (the per-band override — without the resolver change it would score the flat 2).
- [ ] **AC-2 (chudan waza-ari — the fallback):** same move, landed at **mid**, scores **2**
  (no `mid` entry ⇒ `?? spec.score` fallback).
- [ ] **AC-3 (band gate — low):** same move (`bands:["high","mid"]`), attacked at **low** ⇒
  degrades to idle ⇒ score **0**.
- [ ] **AC-4 (byte-identical preservation):** a move with **no** `scoreByBand` scores its flat
  `score` at every band (covered by the full pre-existing suite staying green; the abstract
  `strike` is unchanged).
- [ ] **AC-5 (reach has a limit):** Given a gap **beyond `mawashi-geri`'s (longest) reach**, it
  whiffs ⇒ score **0**.
- [ ] **AC-6 (inert when unconfigured):** Given a ruleset with **no** `mawashi-geri` key, the
  attack ⇒ idle ⇒ score **0** (the `spec !== undefined` guard).
- [ ] **AC-7 (TCB allowlist):** `validate` accepts `{type:"attack", move:"mawashi-geri",
  band:"high"}`, and accepts it at out-of-band `band:"low"` (runtime gate decides legality).

**Optional (will ask at CONFIRM):** AC-R — a `high` guard BLOCKS the high roundhouse (score 0),
documenting the risk/reward ("the ippon is defendable"). Re-proves the generic matching-band
guard on the new move; include only if you want the risk/reward framing pinned by a test.

**Deferred (NOT this slice):** longest-reach hierarchy cross-move test, slowest frames /
highest `staminaCost` magnitudes, whiff-punishability — all S7 canonical-tuning concerns. The
fixture sets longest `reach` + slowest frames to document intent.

## Slices

One slice = one PR. Follows RED-GREEN-MUTATE-KILL MUTANTS-REFACTOR.

### Slice 5: Bot can throw `mawashi-geri` for band-dependent points (high 3 / mid 2)

**Value**: The bot author gets the high-risk/high-reward finisher — aim *jodan* for ippon (3)
at the cost of being easier to block / whiffing a croucher, or *chudan* for a safer waza-ari (2).
**Actor / Trigger / Outcome**: bot author / `{type:"attack", move:"mawashi-geri", band}` / the
fight scores **3** at high, **2** at mid, **0** at low / out-of-reach / unconfigured.
**Path**: bot DSL `attack` → `dsl.ts` validate (MOVES admits it) → `sim.ts` `intake` reads
`rules.moves["mawashi-geri"]` → existing `bandLegal`/`affordable`/`spec !== undefined` gates →
`startAttack` → `computeStrike` **(NEW: band-resolved `baseScore`)** / `applyStrike` →
`result.scores`.
**Required implementation skills**: before code, load `tdd`, `testing`, `mutation-testing`,
`refactoring`.
**Acceptance criteria**: AC-1 … AC-7 above (+ optional AC-R). **Present + confirm before code.**

**RED** — write these failing tests first:

- New `describe("runFight — mawashi-geri (the roundhouse: band-dependent score, high 3 / mid 2)")`,
  a `roundhouseRules(o)` fixture:
  ```ts
  moves: {
    strike:         { startup: 4, active: 2, recovery: 6,  score: 1, reach: 250000 },
    "mawashi-geri": { startup: 6, active: 2, recovery: 16, score: 2, reach: 320000,
                      bands: ["high", "mid"], scoreByBand: { high: 3 } },
  }
  ```
  (longest `reach 320000`, slowest `startup 6`/`recovery 16`; `score 2` is the chudan base,
  `scoreByBand:{high:3}` overrides jodan.)
  - **AC-1**: `roundhouseRules({ startGap: 200000 })`, roundhouse `high` ⇒ `scores.a === 3`.
    *(This is the genuine RED test — fails as `2` until the `sim.ts` change.)*
  - **AC-2**: same, roundhouse `mid` ⇒ `scores.a === 2` (fallback).
  - **AC-3**: same, roundhouse `low` ⇒ `scores.a === 0` (band gate).
  - **AC-5**: `roundhouseRules({ startGap: 360000 })` (beyond reach 320000), `high` ⇒ `0`.
    *(Check ring width — `getMockRules` ring is 600000, so a 360000 gap fits.)*
  - **AC-6**: `getMockRules({ startGap: 200000 })` (no `mawashi-geri` key), `high` ⇒ `0`.
  - *(AC-R if chosen: a `block high` opponent vs roundhouse `high` ⇒ `0`.)*
- In `validate-bot.test.ts`: **AC-7** — accepts `mawashi-geri` at `high`; accepts at out-of-band
  `low`.

Mutator-awareness (TWO mutable production regions this time):
- `sim.ts` `baseScore` line — `scoreByBand?.[st.band] ?? spec.score`:
  - drop `?.` ⇒ existing no-`scoreByBand` strike tests throw (undefined index) ⇒ killed.
  - drop `?? spec.score` ⇒ mid roundhouse (AC-2) + every flat-score hit ⇒ `undefined`/NaN ⇒ killed.
  - `baseScore + bonus → baseScore - bonus` ⇒ existing counter-bonus hit tests ⇒ killed.
  - AC-1 (`=== 3`) pins the override; AC-2 (`=== 2`) pins the fallback; both needed.
- `dsl.ts` `MOVES` literal — AC-7 kills `"mawashi-geri" → ""`; suite kills `Set([...]) → Set([])`.

**GREEN** — the five edits in Context above (4 type-only + the one `sim.ts` `baseScore` line).

**MUTATE** — scope Stryker to BOTH changed regions: the `sim.ts` `computeStrike` HIT/baseScore
lines AND the `dsl.ts` `MOVES` line range. Confirm 100% on the changed lines.

**KILL MUTANTS** — strengthen for any survivor (watch the `?? spec.score` fallback + the
optional-chaining mutant). Ask the human if a survivor's value is ambiguous.

**REFACTOR** — assess via `refactoring`. The `baseScore` extraction is likely the natural
shape; skip further restructuring if no value.

**Done when**: AC-1…AC-7 green, full suite green (byte-identical for all non-`scoreByBand`
paths), changed-line mutation 100% (`sim.ts` + `dsl.ts`), typecheck + lint clean, mutation
report reviewed, human approves commit.

## Pre-PR Quality Gate

1. Mutation testing — `mutation-testing` skill, scoped to the changed `sim.ts` + `dsl.ts` lines.
2. Refactoring assessment — `refactoring` skill.
3. `npm run typecheck` + `npm run lint` pass.
4. Update `plans/c9-arsenal-split.md`: mark Slice 5 ✅ (PR #), set Slice 6 (cross-move cancels)
   ▶ next.

---
*Delete this file when the slice is merged (its record lives in the PR + the split tracker).*
