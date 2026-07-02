# Plan: Passivity clock + reset-on-contact + re-engage reset (story B1)

**Branch**: feat/passivity-clock
**Status**: Active

## Goal

Non-engaging fighters get periodically snapped back to engaging distance: a per-fighter
no-offense clock (`ticksSinceOffense`) that resets only on making contact, and — when it
exceeds `match.passivity.limit` — fires a `resetToNeutral(both)` re-engage (the anti-stall
lever). **B1 is the METRIC + reset ONLY** — no penalty, no `winGap`, no perception, no new
`endReason` (those are B2/B3/B4). A passivity reset is a pure re-engage, exactly like A1's jogai.

## Context & source of truth

- Backlog + resolved decisions: `plans/s7-match-remainder-stories.md` — Capability B row **B1**
  and the **"B1 — resolved decisions & acceptance criteria (find-gaps 2026-07-02)"** section
  (D1–D5, AC-1…AC-9). This plan implements that section.
- Design: `docs/DESIGN.md §7a` — the passivity table + the per-tick officiating order.
- Precedent: the jogai A1 slice (PR #97) — an optional `match` key over the union, byte-identical
  absent, replay-stable, swap-symmetric, reset observed via a **mover's position snap-back**. B1
  mirrors it (the passivity block is a 3rd officiating block after yame + jogai).

## Non-negotiable invariants

- **Scoring-layer, not `Rules`.** `match.passivity` extends `FightConfig.match` (sim.ts:93) — NOT
  `Rules`/`CANONICAL_RULES`; `npm run fight` is unaffected. Absent ⇒ byte-identical.
- **No DSL surface.** B1 adds NO `FIELD_READERS`, NO `FieldPath` (perception is B3/B4). The
  `dsl.ts` TCB is untouched. No new `endReason`.
- **Determinism / integer math.** `ticksSinceOffense` is an integer counter; no float, no PRNG,
  no wall-clock.
- **Same pre-tick snapshot.** The reset predicate reads the tick's already-computed union outcomes
  (`aOutcome`/`bOutcome`/`aThrow`/`bThrow`, all `const`s in scope) — no re-derivation.
- **Byte-identical / additive.** `Fighter.ticksSinceOffense` is always present (like `penaltyCount`),
  init `0`, and — absent `match.passivity` — never incremented, never framed (it is not a
  `FighterFrame` field) ⇒ replay byte-identical to pre-B1.

## Resolved decisions (from the tracker — restated for implementers)

- **D1** reset predicate is **attacker-only**: `aOutcome !== null || aThrow !== null` resets **that
  fighter** (its committed strike connected — hit/block/parry/finish — OR it had a live grab). The
  fighter merely hit / merely defending does NOT reset.
- **D2** clock increments **every tick, unconditionally** (no state gate; a knockdown is bounded ≪ a
  sane `limit`).
- **D3** stuffed/clash throw **resets** the thrower — read **`aThrow`** (pre-precedence `computeThrow`,
  frozen before `stuffIfDefeated`), **NOT** `aThrowFinal`.
- **D4** fire boundary is strict: increment → reset-on-contact → fire iff `ticksSinceOffense > limit`
  (so a connect on the `limit`-th contactless tick avoids the foul; first foul on the limit+1-th).
- **D5** every `resetToNeutral(both)` this bout — yame OR jogai OR passivity — **zeros both clocks**
  (fresh engagement), gated on `match?.passivity`.

## Acceptance Criteria

AC-1…AC-9 as written in the tracker's B1 section. The behaviorally-verified subset in B1 (see
**Testing strategy** for why some predicate internals defer to B3):

- [ ] **AC-1** far-apart non-engaging pair → periodic `resetToNeutral(both)` at period `limit+1`,
      with drift between (frame snap-back on a mover). [increment + `>limit` + zeroing]
- [ ] **AC-2 / D1** attacker-only: a bot that only MOVES and gets HIT keeps fouling on its own
      schedule (being hit ≠ engaging); the attacker's `points` rise (real hits). [kills "reset the
      defender too"]
- [ ] **AC-3** committing a strike that connects with NOTHING (whiff at air / out of range,
      `aOutcome === null`) does not reset — a whiffing bot still fouls. [committing ≠ contact]
- [ ] **reset-on-contact (strike) DEMANDED**: a mutually-trading pair (both connect within `limit+1`)
      never fouls — scores on the natural cadence, no interrupting reset. [demands `aOutcome`
      resets the attacker]
- [ ] **AC-6 / D5** a yame/jogai reset zeros the passivity clock: with jogai + passivity both
      configured, a jogai reset re-arms the clock so the next passivity foul is `limit+1` ticks
      LATER (no spurious passivity reset between jogai resets).
- [ ] **AC-8** byte-identical replay absent `match.passivity`; replay-stable + swap-symmetric present.
- [ ] **AC-9** no new DSL reader, no new `endReason`; `dsl.ts` unchanged.

## Testing strategy & known constraint (surfaced pre-RED — needs confirmation)

**Finding:** a passivity reset's only frame-visible footprint is a **position/`y` snap-back**, which
requires a **moving, non-connecting** bot — but under **attacker-only** (D1) a bot resets its clock
ONLY by committing a *stationary* offense that connects. Movers and connecters are disjoint, and in a
2-bot fight a non-connecting mover always fouls at `limit+1` and **masks** the other bot's clock. So:

- **Cleanly frame-observable in B1** (behavioral tests): AC-1 (stall fires, boundary, zeroing),
  AC-2/D1 (being-hit does NOT reset the defender — the mover keeps fouling), the strike
  reset-on-contact **positive** (a trading pair does NOT foul — a scoring-cadence assertion), AC-6/D5
  (re-engage zeroing, via a jogai reset's effect on the passivity schedule), AC-8.
- **NOT cleanly frame-observable in B1**: the **throw term** (`aThrow`, incl. the D3 stuffed/clash
  distinction) — the thrower is stationary and masked. It is required for **correctness** (a
  throw-only bot IS engaging and must reset), so it ships in B1, pinned by **scoped mutation** where
  Stryker generates a killable mutant (e.g. dropping `|| aThrow !== null`, or `!== null` → `=== null`);
  its full behavioral verification lands in **B3**, where `self.passivityRemaining` becomes readable
  and a bot flips its action on the clock (the A3 `crouchWhen(self.penalties>=1)` pattern makes every
  predicate branch observable).
- **Precedent** for accepting non-cheap-to-observe behavior with documented structural/mutation
  coverage: A2's AC-6 (yame-preempts-jogai) was covered structurally + documented, not by a bespoke
  test. **If the throw-term mutant survives with no clean killing test, ask the human** (per the
  mutation-testing skill) before accepting mutation-only + B3-deferral.

*(If you'd rather make the predicate fully behavioral now, the alternative is to merge B1+B3 into one
"clock + self-read" slice — bigger PR, mixes mechanic with perception, departs from the A-precedent's
mechanic/perception split. Recommendation: keep B1/B3 split; accept the documented B3-deferral for the
throw term. Confirm at plan approval.)*

## Slices

Single slice (like A1/A3). Full RED-GREEN-MUTATE-KILL MUTANTS-REFACTOR; no production code without a
failing test.

### Slice 1 (the whole story): the passivity clock fires a re-engage reset for non-engaging fighters

**Value**: match outcomes stop rewarding far-apart / non-engaging clock-farming — fighters are
snapped back to `startGap` when neither makes contact for `limit+1` ticks. The anti-stall spine
every later passivity slice (penalty B2, perception B3/B4) builds on.

**Path**: `runFight` tick loop → after the yame + jogai officiating blocks, a new
`if (match?.passivity)` block: increment both `ticksSinceOffense`; reset the connecter(s) via
`aOutcome !== null || aThrow !== null`; if no prior reset this tick and either clock `> limit` ⇒
`resetToNeutral(both)` + zero both clocks. The yame + jogai reset sites gain the D5 zeroing (gated).
Observable as a mover's periodic snap-back in a `runFight` event log. **Intentionally skipped:**
penalty/`winGap` (B2), any `FIELD_READER` (B3/B4), the throw-term's fine behavioral proof (B3).

**Required implementation skills**: Before code changes, load `tdd`, `testing`, `mutation-testing`,
`refactoring`.

**Acceptance criteria**: the AC list above. **Present to human and confirm before writing code.**

**RED** (behaviour-driven, `runFight`, mover-observable; mutation-aware — target the `> limit`
boundary, the `++` increment, the `=== 0` zeroing, the `||` predicate terms, the attacker/defender
side):

1. **AC-1 / D4 / D5 — stall fires periodically.** `botA = RETREATER`, `botB = IDLE`,
   `match: { winGap: 99, passivity: { limit: 3 } }`, `maxTicks: 12`. Neither connects. Assert the
   RETREATER drifts then snaps back on a `limit+1` period: e.g. `events[3].a.x` drifted (pre-reset),
   `events[4].a.x` === `aStartX − walkSpeed` (1st reset snap-back), `events[7].a.x` drifted again
   (no premature re-fire ⇒ zeroing), `events[8].a.x` === `aStartX − walkSpeed` (2nd reset, period 4).
   Kills: drop `++` (never fires), `>=`↔`>` (shifts the fire tick / period), drop zeroing (fires
   every tick after the 1st). *(Exact constants nailed in RED — cf. A2's 96000/196000.)*
2. **reset-on-contact (strike) DEMANDED — a trading pair does not foul.** Two `ATTACKER`s
   (`{type:"attack", move:"gyaku-zuki", band:"mid"}`) in range at `startGap`, `limit` set above the
   move's contactless poke-gap (≈ recovery+startup, computed in RED — ~10, use ~15), `maxTicks ~40`.
   Assert clean natural-cadence scoring (`events[T].a.points` steps 1,2,3… on the move's re-arm
   cadence) — which only holds if each connect resets the attacker's clock (else a foul interrupts
   the cadence). Kills: drop `aOutcome !== null` reset for the attacker.
3. **AC-2 / D1 — attacker-only (being hit ≠ engaging).** `botA = ATTACKER`, `botB = AGGRESSOR`
   (advances toward A, in range, never attacks). Assert `botA.points` rise (real hits land) AND the
   advancing B is reset on ITS own contactless schedule (snap-back to `bStartX`), i.e. B being hit
   does NOT reset B. Kills: resetting the defender instead of/in addition to the attacker.
4. **AC-3 — whiff still fouls (committing ≠ contact).** A bot that returns an out-of-range
   `attack` behaves like an idler for passivity — paired with a mover, the reset still fires at
   `limit+1` (the attacker's committing did not reset it). *(Verifies `aOutcome === null` on a whiff;
   RED confirms the out-of-range strike returns null from `computeStrike`.)*
5. **AC-6 / D5 — jogai reset zeros the passivity clock.** `botA = RETREATER`,
   `match: { winGap: 99, jogai: { margin: 100000 }, passivity: { limit: 30 } }`. The RETREATER
   crosses out at tick 25 (jogai reset, visible 26), again at 51, … each < `limit+1`. Assert NO
   passivity-driven snap-back occurs at tick 31 (`events[31].a.x` is the continued drift, not a
   reset) — the jogai reset zeroed the passivity clock. Kills: dropping the gated zeroing at the
   jogai reset site (a spurious passivity reset would appear at tick 31).
6. **AC-8 — byte-identical absent + replay-stable/swap-symmetric present.** With no
   `match.passivity`, a run is byte-identical to the pre-B1 engine (covered by the untouched suite +
   an explicit equality of two logs). With it present, two runs are identical, and swapping A/B is
   symmetric.

**GREEN**:
- `sim.ts` `FightConfig.match` (:93): add `; passivity?: { limit: number }`.
- `sim.ts` `Fighter` (:125): add `ticksSinceOffense: number;` (bout no-offense clock — always
  present, like `penaltyCount`). Both initializers (:853, :869): `ticksSinceOffense: 0,`.
- `sim.ts` tick loop: a `let resetThisTick = false;` per tick (near `scored`). In the yame reset
  path and the jogai reset path, set `resetThisTick = true` and — gated `if (match?.passivity)` —
  zero both `ticksSinceOffense` (D5). Add the passivity block **after** the jogai block:
  ```ts
  if (match?.passivity && !resetThisTick) {
    a.ticksSinceOffense++;
    b.ticksSinceOffense++;
    if (aOutcome !== null || aThrow !== null) a.ticksSinceOffense = 0;
    if (bOutcome !== null || bThrow !== null) b.ticksSinceOffense = 0;
    if (
      a.ticksSinceOffense > match.passivity.limit ||
      b.ticksSinceOffense > match.passivity.limit
    ) {
      resetToNeutral(a, aStartX);
      resetToNeutral(b, bStartX);
      a.ticksSinceOffense = 0;
      b.ticksSinceOffense = 0;
    }
  }
  ```
  (Increment + reset-on-contact + fire kept in one post-events block for B1; note for B3: the
  increment may move to the pre-events "update clocks" step once the clock is framed/readable.)

**MUTATE**: fresh scoped Stryker (`rm -rf .stryker-tmp reports` first, no `--incremental` — the
memory-noted pollution) on the changed `sim.ts` region (the passivity block + the two gated zeroing
lines) — use LINE RANGES, not single-line specs. Target changed-line 100%.

**KILL MUTANTS**: expected hotspots — the `> limit` boundary (T1), the `||` predicate and its
`!== null` terms (T2/T3/T4), the attacker/defender side (T3), the zeroing (T1/T5). The **throw term**
(`aThrow`) may lack a clean killing test in B1 (see Testing strategy) — if its mutant survives,
**ask the human** before accepting mutation-only coverage + B3-deferral (A2-AC6 precedent).

**REFACTOR**: assess only if it adds value — likely none (additive, mirrors the jogai block). If the
three reset sites' D5 zeroing repeats awkwardly, consider a tiny local helper; don't over-abstract.

**Done when**: the AC list is met, full suite green, `npm run typecheck` + `npm run lint` clean,
mutation reviewed (changed-line 100% or documented survivor + human sign-off), `dsl.ts` interpreter
untouched, byte-identical absent config proven, human approves commit.

## Pre-PR Quality Gate

1. Mutation testing — fresh scoped Stryker on the changed `sim.ts` lines (`rm -rf .stryker-tmp
   reports` first, line ranges).
2. Refactoring assessment — run `refactoring`.
3. `npm run typecheck` + `npm run lint` pass; full `npm test` green.
4. Confirm NO DSL/TCB change (`dsl.ts` untouched), NO `endReason` change, `Rules`/`CANONICAL_RULES`/
   `npm run fight` unaffected, and a no-`match.passivity` run is byte-identical.

## Result (Slice 1 — RED→GREEN→MUTATE→KILL→REFACTOR complete)

- **Tests:** 784 pass (8 new in `run-fight.test.ts`). RED confirmed first — 3 driving tests failed
  because no reset fired (positions kept drifting: 180000/372000/420000 vs the snapped-back values).
- **AC coverage:** AC-1/D4/D5 (periodic reset at period `limit+1`, drift between) · reset-on-contact
  DEMANDED (trading pair byte-identical with/without passivity) · AC-2/D1 attacker-only (a hit mover
  keeps fouling) + its mirror/swap (sole passive fighter fires on its OWN clock term) · AC-6/D5 (a
  jogai reset zeroes the passivity clock — no spurious passivity reset) · AC-8 inert (huge limit ⇒
  byte-identical) + replay-stable + swap-symmetric (mover in B slot).
- **Production (`sim.ts`, ~48 lines):** `FightConfig.match.passivity?: { limit }`; `Fighter.
  ticksSinceOffense` (always present, init 0, both initializers); a pre-`events.push` clock-update
  step (increment both, then zero the connecter(s) via `aOutcome !== null || aThrow !== null` — the
  pre-precedence `aThrow`, so a stuffed/clash still counts, D3); D5 zeroing folded into
  `resetToNeutral` (its only callers are the re-engage sites ⇒ one place covers yame/jogai/passivity);
  the fire block after jogai (`> limit`, `resetToNeutral(both)` + `scored = false`). NO
  `resetThisTick` flag needed — `resetToNeutral` zeroing makes a prior yame/jogai reset leave the
  clock at 0, so the fire check can't double-fire.
- **MUTATE:** fresh scoped Stryker on `sim.ts:838-842` + `1059-1066` + `1156-1164` — **14/14 killed
  = 100%**. The lone first-pass survivor (the A-side `> limit` term dropped to `false`, masked by
  symmetric bots) was killed by adding the T3 mirror (A passive / B engaging ⇒ A is the sole fouler).
  The `aThrow` throw-term mutants were all killed by T1 (RETREATER: `aThrow===null` makes any flip
  observable) + T2 (trading pair) — **no throw-connect test needed**, and the plan's "consult human if
  the throw term survives" contingency did NOT trigger. The D3 stuffed/clash SEMANTIC (`aThrow` vs
  `aThrowFinal`, not a Stryker-generatable mutant) is covered-by-construction; its behavioral
  verification lands in **B3** (readable `self.passivityRemaining`).
- **REFACTOR:** none — additive, mirrors the jogai block; D5 in one place.
- **Invariants:** byte-identical absent `match.passivity` (full pre-B1 suite unchanged + inert-limit
  test); replay-stable + swap-symmetric present; integer-only; NO DSL/TCB change (no `FIELD_READERS`),
  NO new `endReason`; `Rules`/`CANONICAL_RULES`/`npm run fight` untouched. `dsl.ts` unchanged.

---
*Delete this file when the plan is complete. The standing record is `plans/s7-match-remainder-stories.md`.*
