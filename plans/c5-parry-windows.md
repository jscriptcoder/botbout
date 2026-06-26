# Plan: C5 — Parry windows

**Branch**: feat/c5-parry-deflect (slice 1); later slices get their own branches
**Status**: Active

> Capability **C5** on the roadmap (`docs/stories/first-slice-split.md`). The skill
> gradient: predict vs react. The opening ticks of a **matching-height** guard form a
> **parry window** — an active strike absorbed then is **deflected** (attacker thrown
> into extra recovery + a counter window for the defender) instead of merely **blocked**.
>
> **C5 is the first consumer of the deferred §11 effects machinery.** The genuinely
> **cross-fighter** parry effect is the **counter window** — it lands on the **defender**
> (the fighter `resolveHit(att, def)` does _not_ own). That is what forces resolution to
> graduate from C4's self-targeted single-`resolveHit` into the §11 **compute-then-apply
> union** (S3 computes effects from the frozen pre-tick snapshot; S4 applies them
> atomically) so the tick stays **swap-symmetric** even though effects now cross fighters.
> Spine: `docs/DESIGN.md` §11 (esp. §11.1 contract, §11.3 gate row 4, §11.4 PARRY row).
>
> **Which slice owns the union (refined during slice-1 RED design):** the attacker's
> **extra recovery** (slice 1) lands on the _attacker_ — the same fighter `resolveHit`
> already mutates — so it is **self-targeted** and fits the existing structure; building the
> union in slice 1 would be **speculative**. The union arrives in **slice 2**, demanded by
> the counter window's cross-fighter mutation.

## Goal

The opening ticks of a correct-height guard **parry** an incoming strike (deflect: no
score, attacker extra recovery, defender counter window) while the same guard held past
the window only **blocks** — and a strike landing in the post-parry counter window scores
a bonus.

## Acceptance Criteria

- [ ] A matching-band guard **freshly raised** (within the parry window) when a strike's
      active frame lands ⇒ **PARRY**: no score, and the attacker is thrown into extra
      recovery (stays committed `parryRecovery` ticks longer than after a block).
- [ ] The **same** matching-band guard held **past** the window ⇒ **BLOCK**: no score,
      attacker recovers normally (unchanged C4 behaviour).
- [ ] The parry-window boundary is pinned (guard-age == `parryWindow` parries; == `parryWindow + 1` blocks).
- [ ] Resolution stays **swap-symmetric**: the same parry scenario with A/B swapped
      produces the byte-swapped event log (the §11 compute-then-apply union holds with a
      cross-fighter effect).
- [ ] A strike that connects during the defender's **counter window** scores
      `score + counterBonus`; outside the window it scores base.
- [ ] A bot can read its live **`self.counterWindow`** (ticks remaining) and gate its
      counter on it; the validator accepts the field.
- [ ] **Forward-compatible / inert when absent:** with `parryWindow`/`parryRecovery`/
      `counterWindow`/`counterBonus` all absent, a matching-band guard always BLOCKs and
      no counter bonus exists ⇒ **byte-identical** to the C4 engine.

## Design notes (pinned before slicing)

- **All new `Rules` fields are optional and inert when absent** — the standing
  forward-compat rule (like `jumpImpulse`/`gravity`/`lowClearance`). Absent ⇒ the
  C5 branches are unreachable ⇒ byte-identical to C4.
  - `parryWindow?: number` — the first N ticks (guard-age `1..N`) of a **continuous**
    matching-band guard during which an absorbed active strike PARRIES rather than BLOCKs.
    Absent / `0` ⇒ no parry (always block).
  - `parryRecovery?: number` — extra recovery ticks added to the **attacker** whose strike
    is parried (the deflect / frame disadvantage). Absent ⇒ `0`.
  - `counterWindow?: number` — ticks after a parry during which the parrying **defender**'s
    connecting strike earns the counter bonus. Absent ⇒ `0`.
  - `counterBonus?: number` — extra points added to a strike that connects while the
    defender's counter window is open. Absent ⇒ `0`.
- **Guard age is persisted on the `Fighter`** (mirroring the C4 `posture` persistence):
  `guardBand: Band | null` + `guardAge: number`. At resolve time, if this tick's guard
  band equals the persisted band, age = prevAge + 1; on a fresh raise (or band change)
  age = 1; not guarding ⇒ band `null`, age `0`. A freshly-raised guard is age 1, so the
  parry window is guard-age `1..parryWindow`. Computed from the **frozen** pre-tick state,
  then persisted for next tick.
- **§11 compute-then-apply union (slice 2, not slice 1):** the two in-place
  `resolveHit(att, def, …)` mutations are replaced by computing both directions' interaction
  **effects** (score on the attacker; extra-recovery on the attacker; the **counter window on
  the defender**) from the one frozen pre-intake snapshot, then applying them atomically. The
  counter window is the first effect that lands on the _other_ fighter, so it is what demands
  the union — minimum needed to pass the cross-fighter counter test **and** keep swap-symmetry
  structural, not a generic effects bus. Slice 1's extra recovery is attacker-self-targeted
  and stays inside the existing `resolveHit(att, def)` structure.
- **Attacker extra recovery** rides the existing move clock: the `attacking` state carries
  an `extra` tick count (default 0) added to `totalFrames` in `advance`, set as an S4 effect
  when parried. Integer only.
- **Out of scope for C5** (stay deferred, per §11.4 / Parking Lot): the throw-triangle rows
  (throw > guard > parry), knockdown/i-frames, blockstun/pushback **numerics** (still 0),
  and the §3 on-contact cancels (C6). C5 only refines the strike-vs-guard BLOCK row into
  BLOCK-vs-PARRY and adds the counter payoff.

## Slices

Every slice follows RED-GREEN-MUTATE-KILL MUTANTS-REFACTOR. No production code without a
failing test. Read `.claude/CLAUDE.md` + the testing rules before each slice.

### Slice 1: A freshly-raised matching guard parries a strike — the attacker is thrown into extra recovery; held past the window it only blocks

**Value**: A bot author gains the core skill-gradient read — timing a guard into the parry
window deflects the attacker (frame advantage), not just absorbs it. This is the C5 keystone
and the first consumer of the §11 compute-then-apply union.
**Path**: `runFight` resolve step → S1 guard-age classification (frozen snapshot) → S3
contact gate row 4 splits PARRY (age ≤ window) vs BLOCK (age > window) → S4 applies the
cross-fighter `extra recovery` effect to the attacker → S5 advance keeps it committed longer
→ observable in the event log (the attacker's `canAct`/next honoured action returns later
after a parry than after a block). Intentionally skipped: counter bonus (slice 2),
perceiving the window (slice 3), throw rows, cancels.
**Required implementation skills**: Before code changes, load `tdd`, `testing`,
`mutation-testing`, and `refactoring`.
**Acceptance criteria** (present + confirm before any code):

- Given an attacker mid-strike whose active frame lands on a defender who raised the
  **matching-band** guard **this tick** (guard-age 1) with `parryWindow ≥ 1` and
  `parryRecovery > 0`, When the tick resolves, Then no one scores AND the attacker stays
  committed `parryRecovery` ticks **longer** than the same strike absorbed by a stale guard.
- Given the same geometry but the defender has held the matching guard **past** the window
  (guard-age `parryWindow + 1`), When it resolves, Then it BLOCKs: no score, attacker
  recovers on its normal clock.
- Boundary: guard-age == `parryWindow` PARRIES; guard-age == `parryWindow + 1` BLOCKS.
- Swap-symmetric: the A/B-swapped scenario yields the byte-swapped event log.
- With `parryWindow` (or `parryRecovery`) absent, a matching guard always BLOCKs ⇒
  byte-identical to C4 (regression guard).
  **RED**: In `run-fight.test.ts`, a `blockOnTell` bot (raise matching guard when the incoming
  attack is perceived) + a scripted attacker; rules with `parryWindow`/`parryRecovery`. Assert
  the tick the attacker returns to neutral (or `phaseRemaining` reaching 0 / next action being
  honoured) is later by exactly `parryRecovery` for a fresh guard vs a stale guard. Add the
  boundary pair (age `parryWindow` vs `parryWindow+1`), the swap-symmetry case, and the
  absent-config byte-identity case. Mutator focus: the `≤` vs `<` window comparison, the
  `age + 1` increment, the `parryRecovery` add, and the band-match guard.
  **GREEN**: Add the optional `parryWindow`/`parryRecovery` `Rules` fields; add
  `guardBand`/`guardAge` to `Fighter` (persisted, like C4's `posture`) and `extra` to the
  `attacking` state; compute the defender's guard band + age from the frozen pre-intake
  snapshot; classify PARRY (age ≤ window) vs BLOCK in gate row 4 inside the existing
  `resolveHit(att, def)`; apply `extra = parryRecovery` to the parried **attacker** (self-
  targeted — no union needed yet); `advance`/`totalFrames` honour `extra`.
  **MUTATE**: Run `mutation-testing` scoped to the changed `sim.ts` ranges (use manual
  mutation for any integer-literal / plumbing gaps Stryker's default set misses, per the C4
  experience).
  **KILL MUTANTS**: Strengthen tests for survivors; ask if a survivor's value is ambiguous.
  **REFACTOR**: Assess (e.g. naming of the effect record / classification helper). Commit
  separately if valuable.
  **Done when**: All slice-1 acceptance criteria met, mutation report reviewed, human approves
  commit.

### Slice 2: A strike that connects in the post-parry counter window scores a bonus

**Value**: The deflect pays off — the parrying defender's punish on the frame-disadvantaged
attacker scores extra, completing the predict-vs-react incentive.
**Path**: parry now also emits a `counterWindow` effect on the **defender** (set
`counterRemaining = counterWindow`) — the first effect that crosses to the other fighter, so
this slice **introduces the §11 compute-then-apply union** (compute both directions' effects
from the frozen snapshot, apply atomically) to keep swap-symmetry structural. Each tick
decrements the window; S3 scoring adds `counterBonus` to a strike that connects while the
parrying fighter's `counterRemaining > 0`. Observable in the score / event log. Skipped: the
bot _reading_ the window (slice 3).
**Required implementation skills**: load `tdd`, `testing`, `mutation-testing`, `refactoring`.
**Acceptance criteria** (present + confirm before any code):

- Given a defender that parried last tick (counter window open) then lands a strike on the
  extra-recovery-locked attacker, When it resolves, Then the strike scores `score +
counterBonus`.
- Given the same strike landing after the counter window has expired
  (`counterRemaining == 0`), Then it scores base only. Boundary on the window length pinned.
- With `counterWindow`/`counterBonus` absent ⇒ no bonus, byte-identical to slice 1.
  **RED**: A `parryThenCounter` scripted defender; assert the bonus is applied inside the
  window and not after; pin the last-bonus-tick boundary; absent-config byte-identity.
  Mutator focus: the `> 0` window guard, the decrement, the bonus add.
  **GREEN**: Add `counterRemaining` to `Fighter`; emit the counter-window effect on parry;
  decrement each tick; add `counterBonus` to a counter-window strike's score effect.
  **MUTATE / KILL MUTANTS / REFACTOR**: as above.
  **Done when**: slice-2 criteria met, mutation report reviewed, human approves commit.

### Slice 3: A bot can read its live `self.counterWindow` to time the counter

**Value**: Makes the counter **playable** — a defender cannot otherwise know a parry
occurred (it depends on the opponent's hidden move timing), so the live self-signal lets a
bot fire the bonus strike only when the window is open. Mirrors C4's read-surface slices.
**Path**: `viewFor` exposes `self.counterWindow` (live, no latency — self is always live);
`dsl.ts` adds the `self.counterWindow` field reader + path (validator allowlist derives from
it). A bot gates `attack` on `self.counterWindow` via `gt`/`gte`. Skipped: nothing further —
this caps C5.
**Required implementation skills**: load `tdd`, `testing`, `mutation-testing`, `refactoring`.
**Acceptance criteria** (present + confirm before any code):

- Given a bot whose rule fires an `attack` only when `self.counterWindow > 0`, When it has
  just parried, Then it strikes (and earns the slice-2 bonus); when it has not, Then it does
  not throw the counter.
- `self.counterWindow` reads the live remaining ticks (set on parry, decrements to 0).
- The validator **accepts** `self.counterWindow` and still rejects unknown `self.*` paths.
  **RED**: In `perception.test.ts` (self-state, live) + `validate-bot.test.ts`, assert the
  field reads the live remaining count and is on the allowlist. A behaviour test: a
  counter-gated bot strikes only post-parry.
  **GREEN**: Add `counterWindow` to `SelfState` (types.ts); `viewFor` reads
  `self.counterRemaining`; add the `self.counterWindow` reader + `FieldPath` in dsl.ts.
  **MUTATE / KILL MUTANTS / REFACTOR**: as above.
  **Done when**: slice-3 criteria met, mutation report reviewed, human approves commit.

> **Scope note.** Slice 3 (the `self.counterWindow` read surface) is the playability cap; if
> you prefer to keep C5 to pure resolution mechanics, it can be deferred to its own
> follow-up. Slices 1–2 deliver the deflect + counter payoff; slice 3 makes the counter
> bot-readable. Recommended: include it so the counter is actually usable.

## Pre-PR Quality Gate (per slice)

1. Mutation testing — run `mutation-testing` (clean `.stryker-tmp` after; watch the stale
   sandbox test-count inflation seen in C4).
2. Refactoring assessment — run `refactoring`.
3. `npm run typecheck` + `npm run lint` pass.
4. Forward-compat regression: a fight with all C5 `Rules` fields absent is byte-identical to
   the C4 engine.

## End of C5 (after slice 3 / final slice merges)

- Update `.claude/CLAUDE.md` Status (add the C5 DONE bullet; rewrite NEXT → C6 cancels).
- Update `docs/DESIGN.md` §11.5 (mark the PARRY branch + counter live; trim the C5 deferred
  slot) and `docs/stories/first-slice-split.md` (C5 row → ✅ done, C6 → ← next) + `README.md`.
- Delete this plan file (record lives in the PRs); delete `plans/` if empty.

---

_Delete this file when the plan is complete. If `plans/` is empty, delete the directory._
