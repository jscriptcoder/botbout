# C10 Stamina — story split

> Output of `story-splitting` (2026-06-28). Resolved design: `docs/DESIGN.md` §P1.
> Feeds `planning`, which PR-slices ONE child story at a time (by behavior, not by
> layer). Numbers are NOT fixed here — they are pinned in `CANONICAL_RULES` via
> `runFight` relationship tests and re-tuned when the C9 arsenal lands.
>
> **STATUS:** ✅ **Story 1 SHIPPED** (PRs #51–#53 — meter, on-commit cost, affordability,
> regen, `self.stamina`; its plan `plans/c10-stamina.md` is deleted). ✅ **Story 2 SHIPPED**
> (PRs #54–#55 — the guard contact-chip: a block draws `blockChip` per contact tick, a parry
> draws a larger `parryChip` once, both on the defender via the §11 union with a `[0]` floor;
> its plan `plans/c10-stamina-story2.md` is deleted). **Next: Story 3** (gassing penalty +
> `self.gassed`). Stories 3–4 plus `CANONICAL_RULES` wiring remain.

## Parent (reframed)

**A fighter has a light stamina economy that paces the fight.** Costed moves drain
stamina on commit; resting recovers it; over-extension is punished — an unaffordable
move whiffs to idle, and "gassing" (low stamina) slows recovery and locks out
specials. A bot reads its own (live) and its opponent's (delayed) stamina to pace
itself and to exploit a gassed foe. **Outcome:** curbs spam and turtling, adds
conditioning/pacing depth without a second health bar — **never a win condition.**
**Current constraint:** too large — one capability spans the meter, on-commit costs,
the affordability gate, regen, the guard contact-chip, the stepped gas penalty, and
the `L_act` opponent tell, touching State, Rules, the §11 intake/advance tick steps,
the perception layer, and the DSL read surface.

## Recommended first slice

**Story 1 — Self-side stamina economy** (meter + on-commit costs + affordability +
regen + `self.stamina`).

**Why first:** it is the _primitive whole_ — the smallest non-throwaway, end-to-end
drain→recover→consequence loop — and it burns down the only real integration risk up
front: **where deduct / affordability / regen slot into the §11 tick order while
staying swap-symmetric and replay-stable.** Every later story builds on this meter.

## Split candidates

| #   | Slice (capability)                  | Value                                                   | Includes                                                                                                                                                                                                                                                                                                                                           | Defers                                 | Acceptance examples (observable via `runFight`)                                                                                                                                                                                                                                                          | Release                      |
| --- | ----------------------------------- | ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| 1   | **Self-side stamina economy**       | Over-aggression has a cost; bot can pace itself         | Integer meter (starts full=`max`, clamp `[0,max]`); `attack`/`throw`/`sweep` deduct `staminaCost` **on-commit** (whiff still costs); **affordability gate** (cost > stamina ⇒ action → `idle`, no spend, no startup); **regen** flat `+rate` when `canAct ∧ not guarding`, paused in moves/guard/stun/knockdown; **`self.stamina`** live DSL field | Guard chip, gas penalty, opponent tell | • strike spends `cost` even on a whiff • stamina < cost ⇒ attack degrades to idle (no spend) • resting N ticks raises stamina by `rate·N`, clamped at `max` • mid-move / knocked-down ⇒ no regen • a C6 rekka follow-up spends its own cost (self-limiting) • **absent stamina config ⇒ byte-identical** | Internal (test-demonstrated) |
| 2   | **Guard stamina chip**              | Defending under pressure bleeds — gentle anti-turtle    | Block draws a small chip on **absorbed contact**; parry draws a **larger** chip on deflect; reads via existing `self.stamina`                                                                                                                                                                                                                      | —                                      | • blocking an active strike drops stamina by `blockChip` on the contact tick • a parry drops by `parryChip` (> `blockChip`) • an un-contacted held guard draws nothing • **absent chip config ⇒ byte-identical to Story 1**                                                                              | Internal                     |
| 3   | **Gassing penalty**                 | Over-extension makes you slow, punishable, special-less | Stepped `gasThreshold` ⇒ `gassed`; gassed move recovery +`gasRecoveryPenalty` (recovery-only); **emergent special-lockout** (cost inequality `specialCost > gasThreshold ≥ basicCost`); **`self.gassed`** live                                                                                                                                     | —                                      | • gassed (stamina ≤ T) ⇒ move recovery extends by P • stamina > T ⇒ recovery unmodified • gassed fighter's `throw`/`sweep` is unaffordable → idle, while a strike still commits • `self.gassed` = 1 iff stamina ≤ T (live) • **absent `gasThreshold` ⇒ never gassed ⇒ byte-identical to Story 2**        | Internal                     |
| 4   | **Opponent stamina read (`L_act`)** | Gas-baiting + punishing a gassed foe — the counter-read | `opponent.stamina` + `opponent.gassed` on the **`L_act`** layer (coherent delayed snapshot, invariant #4)                                                                                                                                                                                                                                          | —                                      | • opponent.stamina reflects the value from `tick − L_act` (same layer as `attacking`/`throwing`) • opponent.gassed is the `L_act`-delayed gassed boolean • with `L=0` perception the read is live (skeleton-consistent) • **inert unless stamina configured**                                            | Internal                     |

## Story detail (titles, value, deferrals)

- **Story 1 — Self-side stamina economy.** _As a bot author,_ my fighter spends
  stamina to act and recovers it by resting, so reckless aggression leaves it unable
  to afford its next move and I can read `self.stamina` to pace it. _Defers_ all
  defensive/gas/opponent mechanics. _Planning will PR-sub-slice_ by behavior — likely
  (1a) meter + on-commit costs + `self.stamina` as a replay-stable tracer, (1b)
  affordability gate, (1c) regen — **not** by layer.
- **Story 2 — Guard stamina chip.** Turtling has a price _when the attacker invests
  strikes_; the throw stays the PRIMARY anti-turtle, this is the gentle secondary.
  Reorderable with Story 3 (both depend only on Story 1).
- **Story 3 — Gassing penalty.** The conditioning mind-game: drop below the line and
  you are slower and can't throw/sweep. The lockout is **emergent** (affordability +
  the cost inequality), not a new flag. Reorderable with Story 2.
- **Story 4 — Opponent stamina read.** The delayed tell that turns the self-economy
  into a two-player read game (bait the gas, punish the gassed). Depends on Stories
  1+3 and the existing `L_act` perception machinery.

## Story 1 — pinned edge cases (find-gaps 2026-06-28)

- **Affordability boundary (B1).** A move is affordable **iff `stamina ≥ staminaCost`** —
  the last affordable move empties the meter to **exactly 0**; a move costing strictly
  more than current stamina is rejected → `idle`, no spend. _AC:_ given stamina == cost,
  the move commits and stamina becomes 0; given stamina == cost − 1, the move degrades to
  idle. (Pin the `≥` with a mutation test so the off-by-one can't survive.)
- **Regen timing (B2).** Regen is applied in the **§11 advance step (S5)**, evaluating
  `canAct ∧ not guarding` on the **post-intake** state — so a fighter that committed a
  move (now in-startup) or raised a guard on tick T does **not** regen on T (no
  pre-intake snapshot, no spend-then-refund). _AC:_ a fighter that idles for a tick gains
  `rate`; a fighter that commits a strike that same tick gains 0 (net stamina = −cost).
- **Unconfigured reads (S1).** With **no stamina config in `Rules`**, no meter is
  simulated: `self.stamina` reads sentinel **`0`**, `self.gassed` reads **`0`** (no
  `gasThreshold` ⇒ never gassed). The fields are always on the static DSL allowlist (the
  TCB boundary can't depend on `Rules`); only their value is config-gated. _AC:_ an
  unconfigured fight is byte-identical to the pre-stamina engine, and a bot reading
  `self.stamina`/`self.gassed` in it gets `0`/`0`. (Document: `0` = system inactive; the
  gas read is `self.gassed`, not the raw number.)

## Completion bar — all stories (find-gaps 2026-06-28, S2)

Each story is **done** when: (1) its behavioral `runFight` tests are green (assert
_relationships_, no literals); (2) `sim.ts` mutation ≈95%+ (changed-line 100%), and
`dsl.ts` interpreter **100%** for any story touching the TCB allowlist (Story 1 adds
`self.stamina`; Story 3 adds `self.gassed`; Story 4 adds the opponent reads); (3) an
**additive guard test** proves _absent stamina config ⇒ byte-identical_; (4) for
canonical wiring, `CANONICAL_RULES` carries the numbers, each proven by a relationship
test (the cost inequality; regen offsetting a sustainable poke rate; `parryChip >
blockChip`). **Out of scope:** any quantitative balance metric (spam / turtle win-rate)
— that needs the unbuilt telemetry object + mass-matchup harness.

## Parking lot

- **Concrete numbers** (`max`, `rate`, per-move `staminaCost`, `gasThreshold`,
  `gasRecoveryPenalty`, `blockChip`/`parryChip`) — canonical-table content, pinned by
  `runFight` _relationship_ tests, **re-tuned when the C9 arsenal spreads costs across
  the 4-strike roster.** Not stories.
- **Additive switch** — settle the optional-field shape in planning (e.g. a single
  optional `Rules.stamina` config block) so _absent ⇒ meter untracked ⇒ byte-identical_.
- **`throw-break` cost** — left **free** for now (C7 already balances it via
  strike-vulnerability). Revisit only if break-spam emerges.
- **Tiebreak/win** — stamina **never** feeds a win condition or tiebreak (no match
  structure exists yet anyway).
- **✓ Gassed × okizeme finish (S3, resolved).** The okizeme finish is delivered by a
  strike, so it **costs stamina on-commit like any strike** — a gassed fighter that
  can't afford it **cannot convert** the knockdown. "Guaranteed finish" = guaranteed vs
  the opponent's defense (band/guard/occupancy ignored), **not** vs your own gas. No
  special-case in the finish path. _(Surfaces in Story 3; affirm with an AC once the
  gas economy + finish coexist in `CANONICAL_RULES`.)_

## Warnings

- **"Failure is telemetry" is half-realizable.** BOT-DSL says unaffordable/failed
  actions "degrade to idle + a logged telemetry event," but the engine has **no
  telemetry object yet** (not built). These slices deliver the **observable behavior**
  (degrade-to-idle, stamina curves provable from fight state) — do **not** write
  acceptance criteria that require a structured telemetry event; that waits for the
  telemetry capability.
- **Do not PR-split by layer** (State / sim / dsl). Each story is one vertical
  behavior; planning sub-slices by behavior increments.
- **No literals in acceptance criteria.** Assert relationships ("spends its cost",
  "regens over rest", "recovery extends when gassed", "parryChip > blockChip"); exact
  integers live in `CANONICAL_RULES`.
- **Test the additive guard every story** (absent config ⇒ byte-identical) — the
  project invariant.

## Planning notes — find-gaps nice-to-haves (not decisions)

- **Story 2 touches the §11 union (N1).** Unlike Story 1 (self-targeted, deducts at
  intake), the guard chip is a **cross-fighter** effect — drawn on the _defender_ when
  its guard absorbs/deflects the _attacker's_ strike. It rides the existing
  compute-then-apply union (`computeStrike` already yields block/parry; apply the chip
  to the defender in `applyStrike`), so no new resolution machinery.
- **Story 4 needs the history buffer (N2).** `opponent.stamina` must be stored in the
  per-fighter perception ring buffer so the `L_act` read is coherent with
  `attacking`/`throwing`/`posture` (invariant #4 — one delayed frame). `opponent.gassed`
  is derived from the _delayed_ opponent stamina vs the shared `gasThreshold`.
- **Regen is whole-integer per tick (N3).** No sub-tick fractional accumulation
  (determinism). Effective rates slower than 1/tick are achieved by scaling the meter
  (larger `max` + proportional costs), not by fractional regen — a canonical-table
  tuning constraint.
- **Story 3's lockout AC depends on canonical numbers (N4).** The emergent special-
  lockout (`throw`/`sweep` unaffordable while gassed) can only be _proven_ once
  `CANONICAL_RULES` satisfies `specialCost > gasThreshold ≥ basicCost`; author those
  numbers in the same slice that adds the gas penalty.

## Next step

Load **`planning`** for **Story 1 (self-side stamina economy)** → PR-sized slices,
each running the full RED-GREEN-MUTATE-KILL MUTANTS-REFACTOR cycle (load `tdd`,
`testing`, `mutation-testing`, `refactoring` before code). Optionally run `find-gaps`
on this split first to harden the acceptance examples.
