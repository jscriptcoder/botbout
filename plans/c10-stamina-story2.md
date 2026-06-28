# Plan: C10 Story 2 — Guard stamina chip

**Branch**: `feat/stamina-block-chip` (Slice 2a), `feat/stamina-parry-chip` (Slice 2b)
**Status**: Active

## Goal

A defending fighter's guard bleeds stamina **on contact** — a block draws a small
`blockChip` when it absorbs an active strike; a parry draws a **larger** `parryChip`
when it deflects one — so turtling under pressure has a gentle, secondary cost.

## Context (read before slicing)

- **Source story**: `plans/c10-stamina-split.md` (Story 2 row + Story detail + note N1).
  Resolved design: `docs/DESIGN.md` §P1. Builds on Story 1 (PRs #51–#53).
- **The seam (note N1 — first cross-fighter stamina effect).** Story 1's `spend` is
  self-targeted (drains the actor at `intake`). The chip is drawn on the **defender**
  when its guard absorbs/deflects the **attacker's** strike, so it rides the existing
  §11 compute-then-apply union: `computeStrike` (sim.ts:442) already yields `block`
  and `parry` `StrikeOutcome`s; the draw lands on `def` in `applyStrike` (sim.ts:504),
  which already mutates `def` for both (`block` → `att.cancelRemaining`; `parry` →
  `def.counterRemaining`). **No new resolution machinery.**
- **Carry the chip in the outcome (match the existing pattern).** `applyStrike` takes
  no `rules`; `computeStrike` reads rules and folds the values it needs into the
  outcome (`cancel`, `counter`, `extra`). The chip follows suit: `computeStrike`
  computes `chip: rules.stamina?.blockChip ?? 0` (resp. `parryChip`) onto the `block`/
  `parry` variants; `applyStrike` just subtracts it from `def`. This keeps the
  simulate-switch in one place — `rules.stamina === undefined` ⇒ `chip` is `0` ⇒ no
  draw ⇒ byte-identical (and `rules.stamina` present but the chip field absent ⇒ `0` ⇒
  byte-identical to Story 1).
- **The chip is the FIRST consumer of the `[0]` floor.** Story 1's `spend` has **no
  floor** by design (sim.ts:268–269 — the affordability gate guarantees `stamina ≥
  cost`, so a spend never goes negative). A defender cannot *decline* to be hit, so the
  chip is unconditional and **must clamp**: `def.stamina = Math.max(0, def.stamina −
  chip)`. Chipping a near-empty meter floors at exactly 0, never negative.
- **Block vs parry contact cadence (resolved decision — confirm at Slice 2a CONFIRM).**
  A `parry` sets `st.scored = true` (sim.ts:544), so `computeStrike` returns `null` on
  later ticks ⇒ a parry chips **exactly once**. A `block` deliberately does **not** mark
  the strike resolved (preserving the C5/C6 block-then-guard-drop edge), so a sustained
  matching-band guard across an N-tick active window absorbs contact each tick ⇒ the
  block chips **per contact tick** (a wider-active strike bleeds more guard — a
  defensible emergent property, no new "already-chipped" tracking). **Recommended:**
  keep this per-contact-tick behavior (minimum code, faithful to existing block
  semantics) and pin it with a test, rather than adding once-per-strike machinery.
- **No new DSL field.** The chip is read through the existing `self.stamina` (Story 1).
  The `dsl.ts` allowlist (the TCB boundary) is **unchanged** — no new entry. Interpreter
  coverage must stay 100%, but there is nothing new to allowlist.
- **CANONICAL_RULES wiring is deferred** (per the split — tuned once against the gas
  economy + the C9 arsenal). Story 2 proves behavior via `getMockRules`-based `runFight`
  tests only, exactly as Story 1 did.

## Acceptance Criteria (story-level — assert RELATIONSHIPS, not literals)

- [ ] A fighter whose matching-band **block** absorbs an active strike loses stamina on
      the contact tick; an identical fighter holding the same guard with **no attacker
      in range** loses none (contact ⇒ chip; no contact ⇒ no chip).
- [ ] A **parry** (fresh matching-band guard deflecting a strike) draws a strictly
      **larger** chip than a block draws (`parryChip > blockChip`), proven by comparing
      the two fighters' stamina drop under the same incoming strike.
- [ ] Chipping a fighter whose stamina is below the chip amount floors stamina at
      **exactly 0** — never negative.
- [ ] **Additive guard**: a fight with `rules.stamina` configured but **no chip fields**
      is byte-identical to the Story 1 engine; and a fight with no `rules.stamina` at all
      remains byte-identical to the pre-stamina engine.
- [ ] `sim.ts` mutation ≈95%+ (changed-line 100%); `dsl.ts` interpreter 100% (unchanged
      allowlist).

## Slices

Every slice follows RED-GREEN-MUTATE-KILL MUTANTS-REFACTOR. No production code without a
failing test. Before code: load `tdd`, `testing`, `mutation-testing`, `refactoring`.

### Slice 2a: A block chip bleeds stamina when a guard absorbs a strike

**Value**: A bot author — defending under pressure now costs a little stamina, so pure
turtling is gently taxed; the bot reads the drain through `self.stamina` to know when to
stop blocking and act.
**Path**: `runFight` tick → §11 S3 `computeStrike` classifies a stale matching-band guard
as `block` and folds `chip = rules.stamina?.blockChip ?? 0` onto the outcome → S4
`applyStrike(att, def)` subtracts the chip from `def.stamina`, clamped at 0 → recorded in
`FighterFrame.stamina` → observable in the fight event log and via the live `self.stamina`
DSL read. *Skipped here*: the parry chip (Slice 2b).
**Required implementation skills**: load `tdd`, `testing`, `mutation-testing`,
`refactoring` before any code.
**Acceptance criteria** (present at CONFIRM, get human approval before code — including
the per-contact-tick decision above):
- Given a fighter holding a matching-band guard that **blocks** an in-range active strike,
  when the block lands, its stamina drops by the configured block chip on the contact
  tick(s); an otherwise-identical fighter holding the same guard with the attacker out of
  range loses no stamina.
- Given a blocking fighter whose stamina is **below** the block chip, when the block lands,
  its stamina floors at exactly 0 (never negative).
- Given `rules.stamina` configured **without** a block chip field (and given no
  `rules.stamina` at all), the fight is byte-identical to the Story 1 (resp. pre-stamina)
  engine — a held, contacted guard draws nothing.
**RED**: in `run-fight.test.ts`, a new `describe("runFight — guard stamina chip")` with:
(1) a blocker vs an attacker whose strike it blocks at the matching band → its
`FighterFrame.stamina` is full before the active window and reduced after the block tick;
(2) the same blocker with the attacker started out of `reach` (or wrong band ⇒ no block) →
stamina unchanged across the same ticks (the contrast that kills a "draw unconditionally"
mutant); (3) a blocker seeded near-empty (low `max`) → stamina ends at 0, not negative
(kills a dropped-`Math.max` / wrong-operator mutant); (4) additive guard — `blockChip`
absent ⇒ stamina constant through the block (byte-identical). Mutator focus: the
`Math.max(0, …)` floor (boundary), the `−` arithmetic, the `?? 0` chip default, and the
`rules.stamina === undefined` simulate-switch.
**GREEN**: widen `Rules.stamina` to `{ max; regen?; blockChip? }` in `types.ts`; add
`chip` to the `block` `StrikeOutcome` variant; in `computeStrike` set `chip:
rules.stamina?.blockChip ?? 0` on the block result; in `applyStrike`'s block branch add
`def.stamina = Math.max(0, def.stamina − outcome.chip)`.
**MUTATE**: run `mutation-testing` scoped to `sim.ts` (+ `types.ts` if mutated); confirm
changed-line mutants killed; grep the survivor list to confirm none fall on new lines.
**KILL MUTANTS**: strengthen tests for any changed-line survivor (ask human if ambiguous).
**REFACTOR**: assess only — likely none (one outcome field + one apply line).
**Done when**: all four ACs green, additive guard proven, mutation report reviewed, human
approves commit. One PR.

### Slice 2b: A parry chip bleeds MORE stamina than a block when a guard deflects

**Value**: A bot author — deflecting (the higher-skill, higher-reward parry) costs more
guard stamina than a passive block, so the read game has a matching stamina gradient;
visible through `self.stamina`.
**Path**: same seam — `computeStrike` classifies a **fresh** matching-band guard as
`parry` and folds `chip = rules.stamina?.parryChip ?? 0` onto the parry outcome →
`applyStrike` subtracts it from `def.stamina`, clamped at 0 (a parry already lands the
counter window on `def`, so the chip rides alongside) → recorded + observable. A parry sets
`scored` ⇒ chips once.
**Required implementation skills**: load `tdd`, `testing`, `mutation-testing`,
`refactoring` before any code.
**Acceptance criteria** (present at CONFIRM, get human approval before code):
- Given a fighter that **parries** an in-range active strike (fresh matching-band guard
  inside `parryWindow`), when the deflect lands, its stamina drops by the configured parry
  chip.
- Given the same incoming strike, a **parry** drops strictly **more** stamina than a
  **block** does (`parryChip > blockChip`) — the defining relationship, asserted by
  comparing the two defenders' drops, not against literals.
- Given `rules.stamina` configured **without** a parry chip field, a parry draws nothing
  (byte-identical to Slice 2a); and the floor at 0 holds for a near-empty parrier.
**RED**: extend the chip `describe` with: (1) a parrier (fresh guard, `parryWindow`
configured) whose stamina drops on the deflect tick; (2) the **relationship** test — a
parrier and a blocker face the same strike; assert `parryDrop > blockDrop` (kills a
`parryChip === blockChip` / swapped-field mutant and any "chip is symmetric" assumption);
(3) parry-chip-absent ⇒ no draw (additive guard); (4) near-empty parrier floors at 0.
Mutator focus: the `>` relationship, the parry-branch `−`/`Math.max` floor, the `?? 0`
default.
**GREEN**: widen `Rules.stamina` to add `parryChip?`; add `chip` to the `parry`
`StrikeOutcome` variant; set `chip: rules.stamina?.parryChip ?? 0` in `computeStrike`'s
parry branch; subtract+clamp on `def` in `applyStrike`'s parry branch.
**MUTATE**: run `mutation-testing` scoped to `sim.ts`; confirm changed-line mutants killed.
**KILL MUTANTS**: strengthen for survivors (ask human if ambiguous).
**REFACTOR**: assess — if the block and parry branches now share an identical
`def.stamina = Math.max(0, def.stamina − chip)`, consider a tiny local `chipGuard(def,
chip)` helper **only if it adds clarity** (per `refactoring`); otherwise leave inline.
**Done when**: all ACs green (esp. `parryChip > blockChip`), additive guard + floor
proven, mutation report reviewed, human approves commit. One PR.

## Pre-PR Quality Gate (each slice)

1. Mutation testing — run `mutation-testing` (scope `sim.ts`, `types.ts` if mutated);
   changed-line 100%, whole-file `sim.ts` ≈95%+ (pre-existing baseline survivors only).
2. Refactoring assessment — run `refactoring`.
3. `npm run typecheck` and `npm run lint` pass; full `npm test` green.
4. Confirm `dsl.ts` interpreter stays 100% with **no new allowlist entry** (chip is read
   through the existing `self.stamina`).
5. Additive-guard test present and green (absent chip config ⇒ byte-identical).

## On completion

- Update `plans/c10-stamina-split.md` STATUS: mark Story 2 SHIPPED, point Next at Story 3
  (gas penalty) — reorderable note resolved.
- Add a `.claude/CLAUDE.md` Status entry (C10 Story 2, PR #s).
- Delete this plan file (`plans/c10-stamina-story2.md`).

---
*Delete this file when the plan is complete. If `plans/` is empty, delete the directory.*
