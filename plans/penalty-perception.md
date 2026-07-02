# Plan: Jogai penalty perception (story A3)

**Branch**: feat/penalty-perception
**Status**: Active

## Goal

A bot can read the shared warning-ladder count — its own (`self.penalties`) and its
opponent's (`opponent.penalties`) — so it can play the foul count (e.g. press an already-warned
foe toward the winGap, or back off its own retreat before the free warning is spent). Completes
Capability A (jogai).

## Context & source of truth

- Backlog: `plans/s7-match-remainder-stories.md` (Capability A row **A3**).
- Design: `docs/DESIGN.md §7a` — *"`self.penalties` / `opponent.penalties` — shared category-2
  warning count (**live scoreboard, like `opponent.points`**)."* Parking lot confirms it is a
  **zero-delay** read (**NOT** the `L_act` ring buffer) — penalties are public scoreboard facts.
- Builds on **A2** (PR #98): the per-fighter `Fighter.penaltyCount` already exists and is
  maintained by the jogai ladder. A3 only *exposes* it — no officiating change.
- Mirrors the existing **live scoreboard reads** exactly: `opponent.points`
  (`sim.ts` `perceiveOpponent`: `opponent: { ...opponent, points: oppLive.points }`) and
  `self.points`/`self.stamina` — sourced from the **live** fighter, never the perception ring buffer.
  The C10 stamina reads set the precedent for extending `SelfState`/`OpponentState` +
  `FIELD_READERS` with static, config-gated entries (interpreter stays 100%).

## Non-negotiable invariants

- **DSL-as-data TCB.** Two new **static** `FIELD_READERS` entries (pure property reads); the
  validator allowlist auto-derives from the map's keys (validate-once / run-on-any-rules).
  **No new interpreter branch ⇒ `dsl.ts` interpreter stays 100%.** No op can touch host/net/fs/
  time/randomness.
- **Determinism / integer math.** `penalties` is the integer `penaltyCount`; no float, no PRNG.
- **Live, zero-delay.** `opponent.penalties` reads the **true** opponent (`oppLive.penaltyCount`),
  NOT the `L_act` ring buffer — a public scoreboard fact, like `opponent.points`.
- **Byte-identical / additive.** A read surface only — no fight-outcome change. Absent `match.jogai`,
  `penaltyCount` stays `0` ⇒ both fields read the sentinel `0`; all existing replays unchanged.

## Acceptance Criteria

- [ ] **AC-1 — self reads own count.** Given a fighter has incurred 1 jogai warning, its bot reads
      `self.penalties == 1` and can branch on it (observable behaviour flip in a `runFight`).
- [ ] **AC-2 — opponent reads the foe's count.** Given fighter A has 1 warning, B's bot reads
      `opponent.penalties == 1` (A's own count, not B's).
- [ ] **AC-3 — live / zero-delay.** With perception latency configured (`lAct > 0`),
      `opponent.penalties` still reflects the foe's current count the next tick (not `L_act` ticks
      later) — sourced from the live opponent, like `opponent.points`.
- [ ] **AC-4 — unconfigured sentinel.** With no `match.jogai`, both fields read `0`, and outcomes
      stay byte-identical (the read surface changes nothing).
- [ ] **AC-5 — reader correctness (interpreter level).** `self.penalties` / `opponent.penalties`
      each resolve to their `State` value via the DSL; `dsl.ts` interpreter coverage stays 100%.

## Slices

Every slice follows RED-GREEN-MUTATE-KILL MUTANTS-REFACTOR. No production code without a
failing test.

### Slice 1 (the whole story): a bot reads `self.penalties` and `opponent.penalties`

**Value**: bots gain the jogai foul count as a strategic read — press a warned foe, or protect
your own free warning. Completes Capability A.

**Path**: `runTick` reads `{ op: "field", path: "self.penalties" | "opponent.penalties" }` →
`FIELD_READERS` → the `State` built by `sim.ts` `perceiveOpponent`, where `self.penalties =
self.penaltyCount` and `opponent.penalties = oppLive.penaltyCount` (live). Observable as a
behaviour flip in a `runFight` once a jogai penalty has accrued. **Intentionally skipped:**
passivity's contribution to the shared counter (B); any delayed/`L_act` variant (penalties are live).

**Required implementation skills**: Before code changes, load `tdd`, `testing`,
`mutation-testing`, and `refactoring`.

**Acceptance criteria**: AC-1…AC-5 above. **Present to human and confirm before writing code.**

**RED** (behaviour-driven; two test surfaces, mutation-aware):

1. **AC-5 reader (interpret-tick.test.ts)** — extend the `it.each` numeric-reads table with
   `["self.penalties", { self: { penalties: 2 } }, 2]` and
   `["opponent.penalties", { opponent: { penalties: 3 } }, 3]`; update `getMockState` defaults
   (`penalties: 0` on both self and opponent). (Pins each reader to the right `State` leaf — kills
   a reader that returns a constant or reads the wrong field.)
2. **AC-1 self read (run-fight.test.ts)** — a bot that retreats by default but does a distinctive
   action (e.g. `crouch`) `when self.penalties >= 1`: it retreats, earns the free 1st warning at
   the tick-25 crossing, then from tick 26 its recorded `action` flips to `crouch`. Assert
   `events[26].a.action.type === "crouch"` and an earlier tick is still `"move"`.
3. **AC-2 opponent read** — A = RETREATER (fouls at tick 25); B crouches `when opponent.penalties
   >= 1`, else idle. Assert `events[26].b.action.type === "crouch"` (B saw A's count = 1) and an
   earlier `b.action.type === "idle"`. (With A at 1 and B at 0, this also kills a self↔opponent
   source swap in `sim.ts`.)
4. **AC-3 live/zero-delay** — same as AC-2 but with `rules.perception.lAct` set (> 0): B still
   crouches at tick 26 (not tick 26 + lAct), proving `opponent.penalties` is live off the true
   opponent, not the ring buffer. (If the exact tick proves fiddly under jitter, mirror the
   existing `opponent.points` live-read assertion.)
5. **AC-4 sentinel / byte-identical** — with no `match.jogai`, a bot reading `self.penalties`
   sees `0` (the crouch rule never fires ⇒ it just idles/moves); and a jogai-free run is
   byte-identical to before (covered by the untouched existing suite).

**GREEN**:
- `types.ts`: add `penalties: number` to `SelfState` and `OpponentState` (both live scoreboard).
- `dsl.ts`: add `"self.penalties"` + `"opponent.penalties"` to the `FieldPath` union and two
  `FIELD_READERS` entries — `(s) => s.self.penalties`, `(s) => s.opponent.penalties`
  (`ALLOWED_FIELDS` auto-extends from the keys).
- `sim.ts` `perceiveOpponent`: `penalties: self.penaltyCount` on the `self` object and
  `penalties: oppLive.penaltyCount` on the `opponent` object (live, zero-delay — beside `points`).
- `interpret-tick.test.ts` `getMockState`: `penalties: 0` on both self and opponent defaults.

**MUTATE**: scoped Stryker on the changed `sim.ts` `perceiveOpponent` lines (the two `penalties:`
assignments) — `rm -rf .stryker-tmp` first. The `dsl.ts` reader entries are pure property reads
(typically no operator mutants; the interpret-tick param rows cover them). Target: changed-line
100% (document any equivalent).

**KILL MUTANTS**: the self↔opponent source swap is the hotspot — the AC-2/AC-3 tests (A=1, B=0)
pin it. Ask the human if a survivor's value is ambiguous.

**REFACTOR**: none expected — additive to an established pattern.

**Done when**: AC-1…AC-5 met, full suite green, typecheck + lint clean, mutation reviewed
(changed-line 100% or documented equivalent), interpreter still 100%, human approves commit.

## Pre-PR Quality Gate

1. Mutation testing — scoped run on the changed `sim.ts` lines (`rm -rf .stryker-tmp` first).
2. Refactoring assessment — run `refactoring` skill.
3. `npm run typecheck` + `npm run lint` pass; full `npm test` green.
4. Confirm the `dsl.ts` interpreter stays 100% and no op touches host/net/fs/time/randomness;
   `Rules`/`CANONICAL_RULES`/`npm run fight` unaffected.

## Result (Slice 1 — RED→GREEN→MUTATE→KILL→REFACTOR complete)

- **Tests:** 776 pass (6 new — 2 interpreter reader rows in `interpret-tick.test.ts`, 4 end-to-end
  in `run-fight.test.ts`). RED confirmed first (unknown field path threw in `runTick`).
- **AC coverage:** AC-1 self read · AC-2 opponent read (A=1/B=0 pins the source) · AC-3 live
  (identical under `lAct` 0 vs 6) · AC-4 sentinel 0 unconfigured · AC-5 interpreter readers.
- **Production:** `penalties` on `SelfState`/`OpponentState` (`types.ts`); `"self.penalties"` +
  `"opponent.penalties"` `FieldPath` + `FIELD_READERS` (`dsl.ts`, allowlist auto-derived);
  `perceiveOpponent` wires `self.penaltyCount` (self) + `oppLive.penaltyCount` (opponent, live) —
  the delayed `viewFor`/perceive types widened to `Omit<OpponentState, "points" | "penalties">`.
- **Spec:** `docs/spec.md` regenerated (`npm run gen:spec`) — the two fields join the auto-derived
  read-surface list + JSON-schema enum (4-line diff); the drift test passes. (Jogai/penalty *prose*
  teaching stays deferred to D2 — this is only the mechanical field surface.)
- **MUTATE:** fresh scoped Stryker on `sim.ts:277-279` + `dsl.ts:111-126` — **17/17 killed = 100%**
  (dsl.ts 16/16, sim.ts 1/1). `dsl.ts` interpreter stays 100%. No survivors.
- **REFACTOR:** none — additive to the established live-scoreboard-read pattern (`opponent.points`).
- **Invariants:** byte-identical absent `match.jogai` (sentinel 0), live zero-delay (not the ring
  buffer), no new interpreter branch, integer-only. Capability A (jogai) is COMPLETE.

---
*Delete this file when the plan is complete (record lives in git/PR + the tracker's Progress section).*
