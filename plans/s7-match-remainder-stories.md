# §7 match-structure remainder — story split

Source design: `docs/DESIGN.md` §7a (grill 2026-07-01). Precedent to mirror:
benchmark match-structure (PRs #87–#93) — additive slices, each byte-identical
when its `match` config key is absent + replay-stable, with downstream
benchmark-adoption + spec-teaching slices.

## Progress

- **A1 — jogai out-zone detection + reset — ✅ DONE** (PR #97, merged 2026-07-01;
  `main`@`30e0288`). Optional `FightConfig.match.jogai.margin` over the unchanged
  hard clamp; on-entry edge-detect (in→out) fires `resetToNeutral(both)`; `wasInBounds`
  trackers re-armed post-reset (+ robust B1 init from start position); yame pre-empts
  jogai same-tick, a prior score stands. Byte-identical absent `match.jogai`, replay-stable,
  swap-symmetric. NO penalty/points/perception yet. Single-slice plan file deleted (record
  in git/PR #97).
- **A2 — jogai warning-ladder penalty — ✅ DONE** (PR #98, merged 2026-07-02;
  `main`@`e9d0771`). Per-fighter `penaltyCount` (bout-persistent, generic — passivity B2
  shares it); 1st foul free, 2+ ⇒ opponent +1 feeding `winGap`; ungated winGap re-check →
  `endReason "gap"`. Byte-identical absent `match.jogai`, replay-stable, swap-symmetric; no
  DSL/TCB surface. 770 tests; scoped `sim.ts` mutation 97.62% (changed-line 100%, lone
  survivor equivalent). Single-slice plan file (`jogai-warning-ladder.md`) deleted (record in
  git/PR #98). The A2 resolved-decisions section below is retained as the design record.
- **A3 — jogai penalty perception — ✅ DONE** (PR #99, merged 2026-07-02;
  `main`@`e8cc71c`). Two static live-scoreboard `FIELD_READERS` — `self.penalties`
  (own bout foul count) + `opponent.penalties` (the foe's), both zero-delay off the live
  fighter (like `opponent.points`, NOT the `L_act` ring buffer); `SelfState`/`OpponentState`
  gain `penalties`, the delayed `viewFor`/perceive types widened to `Omit<…, "points" |
"penalties">`. Byte-identical absent `match.jogai` (sentinel `0`), live zero-delay,
  interpreter stays 100% (static entries, no new branch). 776 tests; fresh scoped mutation
  17/17 = 100% (`sim.ts:277-279` 1/1, `dsl.ts:111-126` 16/16). `docs/spec.md` regenerated
  (2 fields join the read-surface list + JSON-schema enum; drift test green); penalty _prose_
  teaching deferred to D2. Single-slice plan file (`penalty-perception.md`) deleted (record in
  git/PR #99). **Capability A (jogai) is COMPLETE** (A1+A2+A3, PRs #97–#99).
- **B1 — passivity clock + reset-on-contact + re-engage reset — ✅ DONE** (PR #100,
  merged 2026-07-02; `main`@`66f6307`). Optional `FightConfig.match.passivity.limit` +
  per-fighter `Fighter.ticksSinceOffense` (always present, init 0). Attacker-only reset
  predicate `aOutcome !== null || aThrow !== null` (D1); increments every tick (D2);
  stuffed/clash grabs still reset — reads `aThrow` not `aThrowFinal` (D3); fires on strict
  `> limit` (D4); any re-engage (yame/jogai/passivity) zeros both clocks via `resetToNeutral`
  (D5, gated on `match?.passivity`). Byte-identical absent `match.passivity` (field never
  framed), replay-stable, swap-symmetric; **no DSL/TCB surface** (perception is B3/B4), no new
  `endReason` (penalty is B2). 784 tests; scoped `sim.ts` mutation 14/14 = 100% (a T3-mirror
  sole-fouler test killed the last `> limit` survivor). Single-slice plan file
  (`passivity-clock.md`) deleted (record in git/PR #100). The B1 resolved-decisions section
  below is retained as the design record.
- **B2 — passivity feeds the shared penalty ladder — ✅ DONE** (PR #101, merged 2026-07-02;
  `main`@`6e43bec`). B1's inert passivity re-engage becomes a real penalty on the **shared**
  `Fighter.penaltyCount` (A2's ladder): each fighter whose OWN clock `> limit` fouls — 1st free,
  2+ ⇒ opponent +1 (D1, per-fighter mutual net-zero; both-idle ⇒ mutual +1); fires independent of
  a same-tick score (D2 — only yame's both-neutral reset pre-empts, via B1's D5 clock-zeroing);
  same `winGap` re-check → `endReason "gap"` before the reset (D4, at most one check/tick). A2's
  inline award graduated to a shared `applyPenalty(fouler, opponent)` called from BOTH the jogai
  and passivity blocks (D3, pure REFACTOR-step extraction — jogai byte-identical). The headline
  cross-mechanic behavior: a warning spent on jogai makes the FIRST passivity foul cost (shared
  counter). Byte-identical absent `match.passivity`, replay-stable, swap-symmetric; **no DSL/TCB
  surface** (perception is B3/B4), no new `endReason`. 791 tests; scoped `sim.ts` mutation 100%
  (passivity block + `applyPenalty` helper 29/29, jogai call site 4/4). Single-slice plan file
  (`passivity-penalty.md`) deleted (record in git/PR #101). The B2 resolved-decisions section below
  is retained as the design record.
- **B3 — self passivity clock read (live) — ✅ DONE** (PR #102, merged 2026-07-02;
  `main`@`50e5d44`). Capability B's FIRST new DSL surface: the live self-perception field
  **`self.passivityRemaining`** — a derived countdown `Math.max(0, limit − ticksSinceOffense)`
  in `viewFor` (D1), sentinel `0` unconfigured (D2), `0` = "connect this tick or foul"; restarts on
  any re-engage/connect (mirrors the `finishWindow`/`counterWindow`/`cancelWindow` "ticks-left"
  precedent). One `FieldPath` member + one `SelfState.passivityRemaining` field + one **static**
  `FIELD_READERS` entry + `match` threaded into `viewFor` — no new interpreter branch ⇒ `dsl.ts`
  interpreter stays 100% (only the value is config-gated). Also **completed B1's `aThrow` throw-reset
  verification** (D3/AC-3): a plain grab-active tick AND a stuffed grab (reads `aThrow`, not the
  voided `aThrowFinal`) both snap the clock back — the term B1 couldn't observe. Byte-identical absent
  `match.passivity` (field never framed, sentinel `0`), replay-stable, swap-symmetric. 800 tests;
  scoped mutation 100% (`sim.ts` derivation 3/3, `dsl.ts` reader 1/1, wiring 0 mutable nodes — zero
  survivors/equivalents). `docs/spec.md` regenerated (field joins the read-surface list + JSON-schema
  enum; drift test green); strategic prose deferred to Capability D (D4). Single-slice plan file
  (`passivity-self-read.md`) deleted (record in git/PR #102). The B3 resolved-decisions section below
  is retained as the design record.
- **B4 — opponent passivity clock read (delayed) — ✅ DONE** (PR #103, merged 2026-07-02;
  `main`@`71e19fc`). **Capability B (passivity) is now COMPLETE** (B1–B4, PRs #100–#103). The
  opponent-perception field **`opponent.passivityRemaining`** on the **`L_act`-delayed** ring-buffer
  layer (like `opponent.stamina`) — a bot perceives how close the FOE is to a passivity foul and can
  bait the forced commit. **DELAYED, not live** (D1): rides `oppAct`, complementing A3's live
  `opponent.penalties` (pending timer delayed, landed foul live). `frameOf` records raw
  `ticksSinceOffense` (scoring-agnostic, like `stamina`); `perceiveOpponent` derives `Math.max(0,
  limit − oppAct.ticksSinceOffense)`, threading `match` in (D2, the C10 S4b `isGassedAt` precedent) —
  coherent with B3's self read at `L_act = 0` (D3). REFACTOR: shared `passivityRemainingOf(tso, match)`
  now feeds BOTH the B3 live self read (`viewFor`) and this delayed opponent read (`perceiveOpponent`).
  One `FieldPath` member + `OpponentState.passivityRemaining` + one **static** `FIELD_READERS` entry ⇒
  `dsl.ts` interpreter stays 100% (D4). Byte-identical absent `match.passivity` (the new
  `Frame.ticksSinceOffense` frames `0`, never enters `FightResult`; served value sentinel `0`),
  replay-stable, swap-symmetric. 809 tests; scoped mutation 100% (shared `passivityRemainingOf` helper
  4/4, `dsl.ts` reader 1/1, `frameOf` copy 0 mutable nodes — zero survivors/equivalents). `docs/spec.md`
  regenerated (field joins read-surface list + JSON-schema enum; drift test green); strategic prose
  deferred to Capability D. Single-slice plan file (`passivity-opponent-read.md`) deleted (record in
  git/PR #103). The B4 resolved-decisions section below is retained as the design record.

## Parent

**Actor:** the match officiating layer that scores an LLM-authored bot (and,
downstream, the frozen benchmark that ranks it).
**Capability:** complete WKF match officiating beyond yame + `winGap` — penalize
**retreat** (jogai), penalize **non-engagement** (passivity), and **decisively
resolve level bouts** (senshu + overtime).
**Outcome:** match outcomes reward genuine WKF engagement — no cornering-to-safety,
no far-apart stalling, no unresolved draws — so the benchmark measures real
fighting skill, not clock-farming.
**Current constraint:** three distinct mechanics, each with its own state,
perception surface, and downstream benchmark/spec adoption — far too large for one
PR. Every slice must stay byte-identical when its `match` key is absent
(`Rules`/`CANONICAL_RULES`/`npm run fight` untouched) and hold the invariants
(determinism, integer-only outcome math, DSL-as-data TCB, same pre-tick snapshot).

Each child story is a thin end-to-end capability: a rule that changes an
observable fight outcome, demonstrable by a `runFight` test, byte-identical absent
its config key.

## Recommended First Slice

**A1 — a fighter that retreats into the out-zone triggers a yame reset back to
center** (boundary geometry + on-entry edge-detect + reset; no penalty yet).

Why this first: it burns the single biggest _architecture risk_ of the whole
feature — reading a new officiating boundary (`[margin, width−margin]`) over the
existing hard positional clamp and firing the reset path — as a clean tracer,
independent of the penalty ladder. End-to-end and demonstrable; every later jogai
and passivity slice builds on this reset/edge-detect spine.

## Split Candidates

### Capability A — Jogai (ring-out penalty)

| Slice                             | Value                                                     | Includes                                                                                                                                                                                               | Defers                                | Acceptance Examples                                                                                                                                           | Release                          |
| --------------------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| **A1** out-zone detection + reset | Proves the boundary read + reset spine; de-risks geometry | `match.jogai.margin`; legal `[margin, width−margin]`; on-entry edge-detect (in-bounds→out); `resetToNeutral` both; `was-in-bounds` tracker set true post-reset                                         | Penalty, points, warnings, perception | Given `margin` set, When A walks past `margin`, Then both reset to start that tick (points unchanged). Given absent `match.jogai`, Then byte-identical replay | Shippable (inert without config) |
| **A2** warning-ladder penalty     | The jogai _value_: retreat costs points                   | Shared per-fighter `penaltyCount` (generic, reused by passivity); 1st foul free, 2+ ⇒ opponent +1 → existing `winGap`; `winGap` re-check at the jogai boundary (endReason `"gap"`); jogai `FightEvent` | Perception fields                     | Given A's 1st out-zone entry, Then warning only (0 pts). Given A's 2nd, Then B +1 pt + reset. Given enough retreats, Then B wins on `winGap`                  | Shippable                        |
| **A3** penalty perception         | Bots can read the shared warning count                    | `self.penalties` + `opponent.penalties` (live scoreboard `FIELD_READERS`, like `opponent.points`); interpreter stays 100%                                                                              | Passivity/senshu reads                | Given A has 1 warning, Then A's bot reads `self.penalties==1` and B reads `opponent.penalties==1`                                                             | Shippable                        |

### Capability B — Passivity (non-engagement penalty) — reuses A2's ladder

| Slice                                             | Value                                          | Includes                                                                                                                                                                                                  | Defers              | Acceptance Examples                                                                                                                                                                  | Release                          |
| ------------------------------------------------- | ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------- |
| **B1** clock + reset-on-contact + re-engage reset | Proves the anti-stall metric (the subtle part) | Per-fighter `ticksSinceOffense`; reset **only on contact** (hit/block/parry/grab/sweep-connect — whiff at air does NOT reset); exceed `match.passivity.limit` ⇒ `resetToNeutral` both + reset both clocks | Penalty, perception | Given two far-apart idle bots, When neither connects for `limit` ticks, Then both reset to `startGap`. Given a whiff-at-air spammer, Then it still goes passive (whiff didn't reset) | Shippable (inert without config) |
| **B2** passivity feeds shared ladder              | Non-engagement costs points                    | Passivity `++` on the shared `penaltyCount` (shares the free first warning with jogai); opponent +1 after free; `winGap` re-check; `FightEvent`                                                           | —                   | Given B's clock hits `limit` twice, Then A +1 pt the 2nd time. Given one jogai already used the free warning, Then the next passivity immediately costs a point                      | Shippable                        |
| **B3** self passivity clock read (live)           | Bot times its forced engagement                | `self.passivityRemaining` (live `FIELD_READER`)                                                                                                                                                           | Opponent read       | Given `limit` and elapsed ticks, Then `self.passivityRemaining` counts down and a bot commits contact just in time to avoid the foul                                                 | Shippable                        |
| **B4** opponent passivity read (delayed)          | Bait the forced commit                         | `opponent.passivityRemaining` on the `L_act` layer (ring-buffer served, like `opponent.stamina` in C10 S4)                                                                                                | —                   | Given B is 3 ticks from passive, Then A perceives `opponent.passivityRemaining==3+jitter` on the delayed layer and can prep a counter                                                | Shippable                        |

### Capability C — Tie resolution (senshu + overtime)

| Slice                              | Value                                           | Includes                                                                                                                                                                                                                                         | Defers               | Acceptance Examples                                                                                                                      | Release                          |
| ---------------------------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| **C1** senshu first-blood tiebreak | Fixes the real `"draw"` gap cheaply (a bargain) | First-blood latch (first scorer holds senshu; simultaneous ⇒ none); at cap, level ⇒ winner = senshu-holder, endReason `"senshu"`; no senshu ⇒ `"draw"`. Config toggle under `match`                                                              | Overtime, perception | Given a 4-4 bout where A scored first, Then A wins, endReason `"senshu"`. Given 0-0 all bout, Then `"draw"`                              | Shippable (inert without config) |
| **C2** sudden-death overtime       | Decisive resolution before falling to senshu    | On level at cap: `resetToNeutral` both (points/stamina/mem persist), first fighter to gap ≥ 1 wins immediately, same-tick trade stays level, `match.overtimeTicks` cap ⇒ fall to C1's senshu; jogai/passivity live in OT; endReason `"overtime"` | —                    | Given level at cap, When A scores first in OT, Then A wins, endReason `"overtime"`. Given OT elapses scoreless, Then senshu (C1) decides | Shippable                        |
| **C3** senshu perception           | Late-bout tiebreak strategy                     | `self.senshu` + `opponent.senshu` (live 1/0 scoreboard `FIELD_READERS`)                                                                                                                                                                          | —                    | Given A holds senshu, Then A reads `self.senshu==1`, B reads `opponent.senshu==1`                                                        | Shippable                        |
| **C4** overtime perception         | Play-safe vs all-in in sudden death             | `clock.overtime` (live 1/0) — could ride C2                                                                                                                                                                                                      | —                    | Given the bout is in OT, Then both bots read `clock.overtime==1`                                                                         | Shippable (may fold into C2)     |

### Capability D — Downstream adoption (per the precedent; after the mechanics land)

| Slice                                    | Value                                                    | Includes                                                                                                                                                                              | Defers                                 | Acceptance Examples                                                                                                               | Release   |
| ---------------------------------------- | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | --------- |
| **D1** benchmark adopts full officiating | The frozen gauntlet scores under jogai/passivity/tie-res | Fold new `match` config into the benchmark `MATCH` constant + `INPUT_HASH`; bump `BENCHMARK_VERSION`; re-characterize the gauntlet + `docs/benchmark-gauntlet-vN.md`                  | A possible rebalance (see Parking Lot) | Given the benchmark config change, Then `INPUT_HASH` guard test forces a version bump; the gauntlet is re-characterized in a note | Shippable |
| **D2** spec teaches the new rules        | LLM authors know the officiating                         | Extend `generateSpec(rules, match)` to teach jogai margin/penalty, the passivity engagement rule, senshu/OT + corrected win/draw semantics; drift-test the regenerated `docs/spec.md` | —                                      | Given the generator change, Then `docs/spec.md` documents jogai/passivity/tie-break and the byte-match drift test passes          | Shippable |

## Parking Lot

- **Bargain — C1 (senshu) could jump the queue.** It's a tiny latch that
  immediately fixes the benchmark's `"draw"` gap, fully independent of jogai/
  passivity. If a quick decisive-outcomes win is wanted before the (larger)
  spatial/anti-stall work, plan C1 first. (Default keeps the grill's jogai-first
  sequence, which tackles the distinctive spatial mechanic + the original
  stall motivation.)
- **A1/A2 may merge** into one penalty-bearing jogai PR if the team prefers not to
  ship a consequence-free reset intermediate. Kept split to de-risk geometry alone.
- **C4 may fold into C2** (expose `clock.overtime` where OT is introduced).
- **D1 may split per capability** (adopt+re-characterize after jogai, then
  passivity, then tie-res) rather than one consolidated adoption — safer if any
  single mechanic swings the gauntlet hard.
- **Possible gauntlet rebalance follow-up** (like the match-structure sweeper
  de-wall / the still-open `vulture` parry→counter story): jogai caps the zoner/
  turtle escape space and passivity taxes patient counter-play — the `zoner` and
  `vulture` archetypes will feel these most, so expect a re-tune candidate.
- **Ladder constants** (1 free warning, +1 pt/foul) are fixed for the first pass;
  parameterize under `match` only if tuning demands it.
- **`opponent.penalties`** in A3 is a live scoreboard read (zero-delay, like
  `opponent.points`) — confirm it should NOT ride the `L_act` layer (penalties are
  public scoreboard facts, so live is correct).

## Warnings

- Keep the officiating **per-tick order** explicit (design §7a): resolve combat →
  update clocks → `events.push` → apply all triggered penalties (commutative
  per-fighter) → **at most one** `resetToNeutral(both)` → one `winGap` check. A
  same-tick score's yame reset pre-empts jogai. This ordering is the swap-symmetry
  contract — every slice touching officiating needs a swap-symmetry test.
- These are **not** component slices — resist a "detect out-of-bounds" /
  "apply penalty" / "expose field" horizontal read across all three capabilities.
  Each row above is a whole observable rule change with a `runFight` acceptance test.
- Replay-stability + byte-identical-absent must be re-proven per slice (the
  precedent's discipline), plus mutation on the changed `sim.ts`/`dsl.ts`/
  `gen-spec.ts` regions.

## A2 — resolved decisions & acceptance criteria (find-gaps 2026-07-02)

Confirmed before planning A2 (jogai warning-ladder penalty). Feeds `planning` directly.

**Observability contract (decision):** penalties are observed **via `points` + reset only** — a
paid foul shows as the opponent's `points` / `scores` / `winner` / `endReason`; a free warning
shows as a `resetToNeutral` with **no** point delta. **No** new `FightEvent` / `FightResult` field
this slice (stays byte-identical; all penalty surfacing waits for A3's DSL reads). "jogai
`FightEvent`" in the table = the existing per-tick frame, not a new event type.

**Acceptance criteria (design-resolved, §7a):**

- **AC-1 — free first foul.** Given `match.jogai.margin` set and a fighter on its 1st out-zone
  crossing of the bout, When it crosses in→out, Then both reset to start, that fighter's
  `penaltyCount` = 1, and **neither** fighter's `points` change (warning only).
- **AC-2 — 2nd+ foul scores the opponent.** Given a fighter on its 2nd (or later) crossing, When it
  crosses out, Then its **opponent** gains +1 point and both reset. (The point appears in the
  **next** tick's frame — awarded after `events.push`, per A1's reset precedent.)
- **AC-3 — penalty can end the match.** Given enough retreats that a jogai +1 makes the gap reach
  `winGap`, Then the fight ends that tick, `endReason "gap"`, winner = the leading fighter. (winGap
  re-checked inside the jogai block after the award; mutually exclusive with the yame block's check
  ⇒ at most one per tick.)
- **AC-4 — per-fighter counters, bout-persistent.** Each fighter has its own `penaltyCount` (generic
  name — passivity B2 will share it); it persists across every yame/jogai reset (like `points`),
  never reset mid-bout.
- **AC-5 — both-out same tick.** Given both fighters cross out on the same tick, Then each fighter's
  OWN foul history decides whether ITS opponent scores (both past the free warning ⇒ mutual +1,
  net-zero gap; one still on its free warning ⇒ only the other opponent scores), with a **single**
  reset and no spurious early-stop. (Swap-symmetric.)
- **AC-6 — yame pre-empts jogai.** Given the rare both-neutral + scored + out tick, Then the yame
  block resets first (snapping the offender in-bounds), so jogai does **not** fire ⇒ **no** penalty
  awarded, single reset.
- **AC-7 — byte-identical absent config.** Given `match.jogai` absent, Then replay is byte-identical
  to pre-A2 (the new `penaltyCount` field is never touched and never enters a frame). Given
  `match.jogai` present, replay is stable and swap-symmetric.

**Implementation notes (not user-facing):** award inline in the jogai block; field named
`penaltyCount` (generic) but extract a shared award helper only when passivity (B2) arrives (YAGNI).
Ladder constants (1 free warning, +1 pt/foul) hardcoded — `margin` stays the only `jogai` config. A1
tests that cross ≥2 times and asserted "points unchanged" get updated (the 2nd crossing now scores).

## B1 — resolved decisions & acceptance criteria (find-gaps 2026-07-02)

Confirmed before planning B1 (passivity clock + reset-on-contact + re-engage reset). Feeds
`planning` directly. **B1 scope:** the anti-stall METRIC + re-engage reset ONLY — **NO penalty,
NO winGap, NO perception, NO new `endReason`** (penalty is B2, perception B3/B4). A passivity reset
is a pure re-engage, exactly like A1's jogai reset.

**Config:** `FightConfig.match.passivity?: { limit: number }` (ticks) — scoring-layer, NOT
`Rules`/`CANONICAL_RULES` (`npm run fight` unaffected). `limit` is test-fixture-only until D.

**State:** per-fighter `Fighter.ticksSinceOffense` (integer, init `0`), **always present** (like
`penaltyCount`) so absent config ⇒ never touched ⇒ never framed ⇒ byte-identical. **NOT** reset by
`resetToNeutral` (it persists like `points`/`penaltyCount` by default; the re-engage zeroing is an
explicit officiating step, gated on passivity configured — see AC-7).

**Resolved decisions (grill/find-gaps):**

- **D1 — reset predicate: ATTACKER ONLY** (Q1). A fighter's clock resets iff _its own_ committed
  offense connected this tick: **`aOutcome !== null || aThrow !== null`** (strike hit/block/parry/
  finish, OR a live grab). The fighter merely hit/defended-against does NOT reset — "no-OFFENSE
  clock". A real back-and-forth resets both naturally (each attacks); a pure block-only turtle
  eventually goes passive.
- **D2 — increments EVERY tick, unconditionally** (Q2). No state gate — a committed/knocked-down
  fighter still accrues (bounded: knockdown ≤ `knockdownDuration` ≪ a sane `limit`).
- **D3 — stuffed/clash throw DOES reset** (Q3). Read **`aThrow`** (the pre-precedence `computeThrow`
  result, a `const` frozen before `stuffIfDefeated`), **NOT** `aThrowFinal` — so a grab that was
  live-but-voided (stuffed by a strike, or clashed) still resets the thrower. (An out-of-reach /
  no-target grab returns `null` from `computeThrow` ⇒ still whiff-like ⇒ no reset.) This reads the
  design's "reuses the union's **computed** outcomes" literally.
- **D4 — fire boundary: `ticksSinceOffense > limit`** (Q4). Increment each tick, then reset-on-
  contact, then check strictly-greater — so a fighter that connects on the `limit`-th contactless
  tick avoids the foul; the foul fires on the first tick the clock exceeds `limit` (the limit+1-th
  consecutive contactless tick).
- **D5 — any re-engage zeros both clocks** (Q5). Every `resetToNeutral(both)` this bout — yame OR
  jogai OR passivity — zeros **both** `ticksSinceOffense` (fresh engagement, swap-symmetric), gated
  on `match?.passivity`. A scored-on fighter reset by yame does not carry a stale count.

**Acceptance criteria:**

- **AC-1 — far-apart stall fires.** Given `match.passivity.limit = L` and two bots that never
  connect (idle, or move without reaching), Then on the first tick a clock exceeds `L` (post-
  increment) `resetToNeutral(both)` fires and both clocks zero. (Frame at the firing tick shows the
  pre-reset positions; both are back at `startX` from the next tick — the A1/jogai frame precedent.)
- **AC-2 — contact resets, attacker-only.** Given a bot whose strike connects (hit/block/parry) on
  tick T, Then its clock zeros at T and it needs `L+1` further contactless ticks to foul; the
  opponent it merely hit / that merely defended does NOT reset (its clock keeps climbing).
- **AC-3 — whiff-at-air does NOT reset** (the discriminator). Given a bot spamming an attack into
  empty air (out of range ⇒ `aOutcome === null`) or a grab with no target, Then it still fouls at
  `> L` — the whiff didn't reset. Proves "contact ≠ committing an attack".
- **AC-4 — stuffed/clash throw resets** (D3). Given a thrower whose live grab (`aThrow !== null`) is
  stuffed by an opposing strike or clashes with an opposing grab, Then its clock zeros that tick
  despite the voided grab.
- **AC-5 — unconditional increment** (D2). Given a fighter mid-committed-move or knocked-down that
  never connects, Then its clock advances each of those ticks (no state gate).
- **AC-6 — re-engage zeroing** (D5). Given a yame OR jogai OR passivity reset fires with passivity
  configured, Then both clocks zero. (Absent `match.passivity`, the field is never touched.)
- **AC-7 — at most one reset/tick, order, swap-symmetry.** The passivity block runs AFTER yame and
  jogai; if either already reset this tick, passivity does NOT also reset (single
  `resetToNeutral(both)` per tick). Both-passive same tick ⇒ one reset. Replay is swap-symmetric.
- **AC-8 — byte-identical absent, stable present.** Absent `match.passivity` ⇒ byte-identical to
  pre-B1 (field never framed). Present ⇒ replay-stable + swap-symmetric.
- **AC-9 — no new surface.** B1 adds NO `FIELD_READER` (perception is B3/B4) and NO `endReason`
  (a passivity reset re-engages; no penalty/winGap until B2). `dsl.ts` TCB untouched.

**Implementation notes (not user-facing):** a 3rd officiating block after jogai, gated
`if (match?.passivity)`. Per-tick (design §7a order): the clock increment + contact-reset sit in the
"update clocks" step (with jogai edge-detect); the exceed-check + `resetToNeutral(both)` + zeroing
sit in officiating AFTER the yame + jogai blocks, fired post-`events.push` (A1 frame precedent). A
`resetThisTick` flag (or equivalent) coordinates the "at most one reset" contract and lets the yame/
jogai reset sites also zero the clocks (gated). Contact-reset reads `aThrow` (not `aThrowFinal`).
`limit` lives in test fixtures — no canonical wiring in B1.

## B2 — resolved decisions & acceptance criteria (find-gaps 2026-07-02)

Confirmed before planning B2 (passivity feeds the shared penalty ladder). Feeds `planning`
directly. **B2 scope:** turn B1's inert passivity re-engage into a real penalty on the **shared**
`Fighter.penaltyCount` ladder (A2's) — NO new perception (B3/B4), NO new `endReason`.
Byte-identical absent `match.passivity`.

**Config/state:** unchanged from B1 — `FightConfig.match.passivity.limit` + per-fighter
`Fighter.ticksSinceOffense`. B2 adds NO new config or state; it reuses A2's bout-persistent
`Fighter.penaltyCount` (shared with jogai).

**Resolved decisions (find-gaps):**

- **D1 — per-fighter fouler, mutual net-zero** (Q1). When the passivity block fires, EACH fighter
  whose OWN clock `> limit` is a fouler: `++penaltyCount`, and past the free warning (`> 1`) its
  OPPONENT scores +1 — the identical per-fighter award as jogai (A2). Both idle ⇒ both clocks
  exceed the same tick ⇒ mutual +1 (net-zero gap), a SINGLE `resetToNeutral(both)`. Swap-symmetric,
  consistent with jogai's both-out AC-5.
- **D2 — fire independently of a same-tick score** (Q2). B1's fire condition is UNCHANGED
  (`ticksSinceOffense > limit`, no `scored` gate). A pure-defender that never commits an offense
  (attacker-only, B1 D1) fouls even while being hit — so on a tick where a hit-point rose but yame
  did NOT reset, the hit-point AND the passivity penalty both apply. ONLY yame's actual reset
  (both-neutral) pre-empts passivity, via the D5 clock-zeroing — exactly as it pre-empts jogai.
- **D3 — shared helper extracted now** (Q3). A2's inline award graduates to one shared
  `applyPenalty(fouler, opponent)` (the ladder rule "1 free, then opponent +1"), called from BOTH
  the jogai and passivity blocks. Pure extraction at the REFACTOR step (mutation confirms both call
  sites first); jogai stays byte-identical.
- **D4 — reuse `endReason "gap"`, re-check in block** (Q4). The passivity block gains the same
  winGap re-check jogai has, AFTER the award: if the gap reaches `winGap`, end the bout,
  `endReason "gap"`, winner = leader. NO new `endReason`. Mutually exclusive per tick with
  yame/jogai (each reset zeroes clocks / snaps in-bounds ⇒ at most one reset AND at most one winGap
  check per tick).

**Cross-mechanic interaction (the headline — structurally guaranteed, an AC below):** jogai and
passivity share ONE `penaltyCount`. Because at most one reset fires per tick (yame > jogai >
passivity, each zeroing the clocks), a jogai foul and a passivity foul NEVER co-occur on the same
tick — the interaction is SEQUENTIAL across ticks: a fighter that spent its free warning on a jogai
retreat pays a point on its FIRST subsequent passivity foul (and vice-versa).

**Acceptance criteria:**

- **AC-1 — free first passivity foul.** Given `match.passivity.limit = L` and a fighter's clock on
  its 1st `> L` fire of the bout (no prior foul of EITHER kind), When it fires, Then that fighter's
  `penaltyCount` = 1, NEITHER fighter's `points` change (warning only), and both reset.
- **AC-2 — 2nd+ passivity foul scores the opponent.** Given a fighter fouling passivity a 2nd (or
  later) time (its `penaltyCount` already ≥ 1 from any source), When its clock fires, Then its
  OPPONENT gains +1 point (visible in the NEXT tick's frame — awarded post-`events.push`, the
  A1/A2 precedent) and both reset.
- **AC-3 — shared free warning across mechanics.** Given a fighter already used its one free warning
  on a jogai foul (`penaltyCount` = 1), When its FIRST passivity foul fires, Then its opponent
  immediately scores +1 (no second free warning). Symmetric: passivity-first then a jogai foul also
  costs.
- **AC-4 — passivity penalty can end the match.** Given a passivity +1 makes the gap reach `winGap`,
  Then the fight ends that tick, `endReason "gap"`, winner = the leader. (winGap re-checked inside
  the passivity block after the award; at most one winGap check per tick.)
- **AC-5 — both-passive same tick, swap-symmetric.** Given both clocks exceed `L` on the same tick,
  Then each fighter's OWN prior foul count decides whether ITS opponent scores (both past the free
  warning ⇒ mutual +1, net-zero gap; one still on its free warning ⇒ only the other opponent
  scores), with a SINGLE reset and no spurious early-stop. Swap-symmetric.
- **AC-6 — attacker-only + fire-independent** (from B1 D1 + D2). Given a pure-defender turtle that
  only blocks/parries and never commits an offense, When its clock reaches `> L` even on a tick it
  is being hit (a point rose but yame did not reset), Then it still fouls (opponent +1 past the free
  warning) that tick — the hit-point and the passivity penalty both apply.
- **AC-7 — yame pre-empts passivity.** Given a scored + both-neutral tick where a clock also sits
  `> L`, Then the yame block resets first and (D5) zeroes both clocks, so the passivity check reads
  0 and does NOT fire ⇒ no passivity penalty, single reset. Same when a jogai reset fires the same
  tick.
- **AC-8 — byte-identical absent, stable present.** Given `match.passivity` absent, Then replay is
  byte-identical to pre-B2 (`penaltyCount` still only moved by jogai; no passivity award path
  touched). Given `match.passivity` present, replay is stable and swap-symmetric.
- **AC-9 — jogai unchanged by the extraction.** Given the shared-helper refactor, Then jogai's
  observable behavior (A2's AC-1…AC-7) is byte-identical — the helper is a pure extraction of the
  existing two-line award.

**Implementation notes (not user-facing):** award in the passivity block, per-fighter, gated on each
fighter's own `ticksSinceOffense > limit`; call the extracted `applyPenalty(fouler, opponent)` from
both jogai and passivity. winGap re-check + `break "gap"` after the award, before the
`resetToNeutral(both)`. Ladder constants (1 free, +1/foul) stay hardcoded/shared. `limit` stays
test-fixture-only (no canonical wiring — that's D). No new `FIELD_READER`, no new `endReason`,
`dsl.ts` TCB untouched.

## B3 — resolved decisions & acceptance criteria (find-gaps 2026-07-02)

Confirmed before planning B3 (self passivity clock read, live). Feeds `planning` directly.
**B3 scope:** the self-perception field **`self.passivityRemaining`** — Capability B's FIRST new
DSL surface. NO opponent read (that's B4), NO new `endReason`, NO canonical wiring (that's D). Also
**completes B1's throw-term behavioral verification** (AC-4), now that the clock is observable.
Byte-identical absent `match.passivity` (sentinel `0`).

**Config/state:** unchanged from B1/B2 — reuses per-fighter `Fighter.ticksSinceOffense` +
`FightConfig.match.passivity.limit`. B3 adds one `FieldPath`, one `SelfState.passivityRemaining`
field, one static `FIELD_READERS` entry, and threads `match` into `viewFor` (see notes).

**Resolved decisions (find-gaps):**

- **D1 — derived countdown value** (Q1). `self.passivityRemaining = Math.max(0, limit −
self.ticksSinceOffense)` when `match.passivity` is configured. A countdown of ticks until the
  passivity foul: reads `limit` on a fresh clock, decrements each contactless tick, and reads `0` on
  the tick the foul is imminent ("connect THIS tick or foul"). Mirrors the
  `finishWindow`/`counterWindow`/`cancelWindow` "ticks-left, 0 = closed" precedent. **Read timing:**
  `viewFor` runs at the loop top, BEFORE the tick's clock increment/foul-check, so the value reflects
  the clock as of the end of the previous tick (the same live-but-one-step convention as the other
  self windows). The `[0]` floor is defensive — the officiating resets the clock the tick it exceeds
  `limit`, so the read value structurally stays in `[0, limit]` (never negative).
- **D2 — sentinel `0` when unconfigured** (Q1, baked into the value choice). Absent `match.passivity`,
  `self.passivityRemaining` reads `0` — consistent with A3's `self.penalties` and every window field
  (the interpreter/TCB boundary can't depend on `match`; ONLY the derived value is config-gated in
  `viewFor`). Accepts the same in-band/inactive `0` collision the window fields already carry (a bot
  reading `0` while unconfigured over-eagerly commits, but there is no foul ⇒ harmless; a
  spec-authored bot knows the field reads `0` when passivity is off).
- **D3 — B3 completes B1's throw-term verification** (Q2). B1's `aThrow !== null` contact-reset term
  (a stuffed/clashed grab still zeroes the clock — B1 D3 / AC-4) had NO direct test: B1 could not
  observe the clock, so the `aThrow → false` mutant was survived-or-equivalent under B1's throw-free
  tests. Now that `self.passivityRemaining` makes the clock observable, B3 adds a `runFight` test
  reading it immediately after a committed throw's grab-active tick (including stuffed/clash) and
  asserting the snap-back to `limit` — pinning the term behaviorally (AC-3 below).
- **D4 — mechanical spec only; strategic prose deferred to Capability D** (Q3). Regenerate
  `docs/spec.md` so `self.passivityRemaining` joins the read-surface list + JSON-schema enum (drift
  test green), exactly like A3. Engagement-timing prose lands in D's spec-teaching slice with the
  rest of the officiating rules (A3's defer-prose-to-D pattern — avoids doc churn when D rewrites
  that section).

**Implementation notes (not user-facing):** thread `match` (the scoring config) into `viewFor` as a
new optional param — the smallest change, forward-compatible with later live officiating reads
(senshu/OT in Capability C); absent ⇒ sentinel `0`, derived like `finishWindow` inside `viewFor`.
`self.passivityRemaining` is a static `FIELD_READERS` entry `(s) => s.self.passivityRemaining` + a
`SelfState.passivityRemaining` field + a `FieldPath` union member — **no new interpreter branch**, so
the `dsl.ts` interpreter stays 100% (A3 precedent; only the value is config-gated, in `viewFor`).
`limit` stays test-fixture-only (no canonical wiring — that's D). AC-6's "just in time" test must
account for strike **startup lead**: the clock resets on a CONNECTING strike (`aOutcome !== null`),
which occurs on the strike's active frame, not the commit tick — so a bot must gate its commit at a
`passivityRemaining` threshold ≥ the move's startup for the strike to connect before the foul
(threshold derived in RED against the harness constants).

**Acceptance criteria:**

- **AC-1 — countdown when configured.** Given `match.passivity.limit = L` and a fighter that has not
  connected for `k` ticks (`k ≤ L`), Then its bot reads `self.passivityRemaining == L − k` (fresh
  clock ⇒ `L`; the tick the foul is imminent ⇒ `0`).
- **AC-2 — resets with the clock.** Given a fighter connects (or is re-engaged by yame/jogai/
  passivity), Then `self.passivityRemaining` jumps back to `L` on the next tick (the clock zeroed).
- **AC-3 — throw resets (completes B1 AC-4).** Given a fighter commits a throw whose grab goes active
  — even stuffed by an opposing strike or clashed (⇒ the grab is voided) — Then
  `self.passivityRemaining` snaps back to `L` the next tick, proving `aThrow !== null` zeroed the
  clock (the B1 throw term, now observable).
- **AC-4 — floored at 0, stays in `[0, L]`.** `self.passivityRemaining` never reads negative.
- **AC-5 — sentinel `0` unconfigured.** Given `match.passivity` absent, Then `self.passivityRemaining`
  reads `0` for the whole bout (the value is never derived).
- **AC-6 — the read is actionable.** Given a bot in range that gates a connecting commit on the
  countdown (`when self.passivityRemaining <= T do attack`, `T` = the startup lead), Then it connects
  before its clock fouls and avoids a passivity foul that the same bot without the rule (idling)
  takes — demonstrating the B3 value (self-timed forced engagement).
- **AC-7 — byte-identical absent, interpreter 100%, spec drift-clean.** Given `match.passivity`
  absent, replay is byte-identical to pre-B3 (sentinel `0`; `ticksSinceOffense` still never framed).
  The new `FIELD_READERS` entry is static (value config-gated in `viewFor`) ⇒ `dsl.ts` interpreter
  stays 100%. `docs/spec.md` regenerated (field joins the read-surface list + schema enum; byte-match
  drift test green). Replay-stable + swap-symmetric present.

## B4 — resolved decisions & acceptance criteria (find-gaps 2026-07-02)

Confirmed before planning B4 (opponent passivity clock read, delayed). Feeds `planning` directly.
**B4 scope:** the opponent-perception field **`opponent.passivityRemaining`** — how close the FOE is
to a passivity foul, on the **`L_act`-delayed** ring-buffer layer (like `opponent.stamina`/`gassed`,
C10 S4). **Completes Capability B.** NO new `endReason`, NO canonical wiring (that's D), NO change to
the officiating/penalty logic (pure-additive perception). Byte-identical absent `match.passivity`
(sentinel `0`).

**Config/state:** unchanged from B1–B3 — reuses per-fighter `Fighter.ticksSinceOffense` +
`FightConfig.match.passivity.limit`. B4 adds one `Frame.ticksSinceOffense` field, one
`OpponentState.passivityRemaining` field, one `FieldPath` member, one static `FIELD_READERS` entry,
and threads `match` into `perceiveOpponent` (see notes).

**Resolved decisions (find-gaps):**

- **D1 — DELAYED on the `L_act` layer** (Q1). `opponent.passivityRemaining` rides the coherent delayed
  action snapshot (`oppAct`), like `opponent.stamina`/`opponent.gassed`/`attacking` — **NOT** a live
  scoreboard read. Rationale: the _pending_ internal timer is a body-condition tell a bot must WORK to
  read (that latency IS B4's value — bait the forced commit, prep a counter); the _result_ (the landed
  foul) is ALREADY live via A3's `opponent.penalties`. The two are complementary — `penalties` = LIVE
  (result), `passivityRemaining` = DELAYED (pending). A live read would collapse the read-game.
- **D2 — raw `ticksSinceOffense` in the Frame, derive the countdown on serve** (Q2). `frameOf` records
  raw `f.ticksSinceOffense` (as it records raw `stamina`), staying scoring-config-agnostic (never
  touches `match`). `perceiveOpponent` derives `passivityRemaining = match?.passivity ? Math.max(0,
limit − oppAct.ticksSinceOffense) : 0`, threading `match` in as a new param (mirrors C10 S4b threading
  `rules` for `isGassedAt`). Observably identical to framing the pre-derived countdown, since `limit` is
  a constant: `delayed(max(0, limit − tso)) == max(0, limit − delayed(tso))` — the exact
  derive-on-serve equivalence that let `gassed` avoid its own frame field.
- **D3 — value coherent with B3's self read** (from D1+D2). The countdown equals B3's
  `self.passivityRemaining` formula (`max(0, limit − ticksSinceOffense)`) evaluated on the DELAYED
  clock. Because `frameOf` records at loop-top BEFORE the tick's passivity increment (`sim.ts:953`,
  same pre-increment convention as B3's `viewFor`), at **`L_act = 0`** the read equals the opponent's
  own `self.passivityRemaining` that tick (live coherence). The opening `lAct` ticks clamp to
  `history[0]` (`ticksSinceOffense = 0` ⇒ reads `limit`, a fresh clock). A re-engage/connect that
  zeroes the clock is perceived `lAct`-delayed (the drop-back-to-`limit` lands `lAct` ticks later).
- **D4 — sentinel `0` unconfigured; interpreter stays 100%; mechanical spec only** (A3/B3 precedent).
  Absent `match.passivity`, `perceiveOpponent` serves `0` (the value is never derived) — same
  in-band/inactive `0` collision B3 and every window field carry (harmless: no foul when unconfigured).
  `opponent.passivityRemaining` is a static `FIELD_READERS` entry `(s) => s.opponent.passivityRemaining`
  - an `OpponentState` field + a `FieldPath` member — **no new interpreter branch** ⇒ `dsl.ts`
    interpreter stays 100% (only the served value is config-gated, in `perceiveOpponent`). Regenerate
    `docs/spec.md` (field joins the read-surface list + JSON-schema enum; drift test green); strategic
    prose deferred to Capability D (A3/B3's defer-prose-to-D pattern).

**Jitter / observe-after-commit (automatic — no new machinery):** the field reads the same `oppAct`
frame as `attacking`/`stamina`, so the per-tick jittered `lAct` (drawn in the fixed A.lPos/A.lAct/
B.lPos/B.lAct order — the replay contract) applies with ZERO new draws. Perceivable iff
`S ≥ L_act + 1` at `L_act = 0` (the structural observe-after-commit tick), like every other L_act tell.

**Implementation notes (not user-facing):** add `ticksSinceOffense: f.ticksSinceOffense` to `frameOf`
(unconditional — the field is always present on the Fighter, init 0, only incremented under
`match?.passivity`, so absent config it frames `0` forever ⇒ byte-identical; the ring buffer is
internal, never in `FightResult`); add `passivityRemaining` to `perceiveOpponent`'s `Omit<OpponentState,
"points" | "penalties">` return, derived from `oppAct.ticksSinceOffense` + the new `match` param; pass
`match` at both `perceiveOpponent` call sites (`sim.ts:963/971`). Static `FIELD_READERS` + `FieldPath` +
`OpponentState` additions. `limit` stays test-fixture-only (no canonical wiring — that's D). No new
`endReason`, no officiating/penalty change, `dsl.ts` TCB interpreter untouched. (Observed via the B3
precedent — gate a distinctive action on `opponent.passivityRemaining` crossing a constant, assert via
`events[T].{a,b}.action`; use a FIXED `perception.lAct` with jitter off for the delay/coherence ACs.)

**Acceptance criteria:**

- **AC-1 — delayed countdown.** Given `match.passivity.limit = L`, a fixed `L_act = d > 0` (jitter off),
  and a foe idle since the bout start, Then at tick `t` (`t ≥ d`, no reset in the window) a bot reads
  `opponent.passivityRemaining == L − (t − d)` — the foe's countdown as of `d` ticks ago (the delayed
  layer), i.e. `d` HIGHER than the foe's live remaining (less elapsed ⇒ more remaining).
- **AC-2 — live coherence at `L_act = 0`.** Given `L_act = 0`, Then `opponent.passivityRemaining` equals
  the foe's own `self.passivityRemaining` that tick (the delayed frame resolves to the current frame).
- **AC-3 — re-engage snap-back is delayed.** Given the foe connects/re-engages (its clock zeroes) at
  tick T with `L_act = d`, Then the perceiving bot sees `opponent.passivityRemaining` jump back toward
  `L` at tick `T + d`, not at T (the drop is perceived `lAct`-delayed).
- **AC-4 — sentinel `0` unconfigured.** Given `match.passivity` absent, Then `opponent.passivityRemaining`
  reads `0` for the whole bout (never derived).
- **AC-5 — the read is actionable (bait the commit).** Given a bot that gates a counter-prep action on
  `opponent.passivityRemaining <= T` (the foe near its forced commit), Then it perceives the foe's
  imminent-foul window on the delayed layer and acts on it — demonstrating B4's value.
- **AC-6 — byte-identical absent, interpreter 100%, spec drift-clean.** Given `match.passivity` absent,
  replay is byte-identical to pre-B4 (the new `Frame.ticksSinceOffense` frames `0`, never enters
  `FightResult`; the served value is sentinel `0`). The new `FIELD_READERS` entry is static ⇒ `dsl.ts`
  interpreter stays 100%. `docs/spec.md` regenerated (field joins the read-surface list + schema enum;
  drift test green). Replay-stable + swap-symmetric present.

## C1 — resolved decisions & acceptance criteria (find-gaps 2026-07-02)

Confirmed before planning C1 (senshu first-blood tiebreak). Feeds `planning` directly. **C1 is
WKF-faithful** — deliberately refined beyond DESIGN.md §7a's "score ANY point / never lost" (see the
reconciliation action; §7a updated to match). NO overtime (C2), NO perception (C3 — `self`/
`opponent.senshu`), so the `dsl.ts` TCB stays untouched (no `FIELD_READERS` entry, interpreter stays
100%).

**Config:** `FightConfig.match.senshu?: boolean` — scoring-layer, NOT `Rules`/`CANONICAL_RULES`
(`npm run fight` unaffected). Absent or `false` ⇒ no senshu tie-break ⇒ byte-identical. Test-fixture-
only until Capability D (the benchmark `MATCH` + spec prose adopt it there).

**State (no new per-fighter field):** a bout-level `senshuHolder: "undecided" | "A" | "B" | "none"`
local to `runFight` (like `endReason`), NOT on the `Fighter` body ⇒ `resetToNeutral` can't touch it
⇒ persists across every yame/jogai/passivity reset automatically. First blood is detected from the
**per-tick scored-technique points delta** (snapshot points at tick-top, read right after combat
resolution, BEFORE the jogai/passivity penalty block) — so penalty points never register as first
blood, with NO separate technique counter.

**State machine (one-way, deterministic):**

- start `undecided`.
- **Latch** (combat phase, only while `undecided`): the fighter whose technique points rose this tick
  claims senshu; both rose the same tick ⇒ `none` (simultaneous); neither ⇒ stays `undecided`.
- **Revoke** (penalty phase, only while holder is `A`/`B`): if the **holder** commits any jogai/
  passivity foul this tick (incl. the free 1st warning) ⇒ `none`. A foul by the non-holder does nothing.
- `none` is terminal — never re-latched, never transferred.

**Resolution order:** senshu is consulted ONLY at the terminal tally (post-loop) and ONLY when
`winner === "draw"` (level points). It never overrides a `winGap`/`"gap"` early-stop or a points-
decided `"time"` winner (both non-level ⇒ mutually exclusive with senshu). `FightResult.endReason`
gains the union member `"senshu"`.

**Acceptance criteria:**

- **AC-1 — first-blood latch (solo).** Given `match.senshu` true and A lands the bout's first scored
  technique (1-0) at tick T, Then A holds senshu.
- **AC-2 — simultaneous ⇒ none (permanent).** Given both score a technique on the same first-scoring
  tick (1-1), Then senshu is `none` for the bout; a level cap stays winner `"draw"`, endReason
  `"time"`; a later solo technique does NOT claim it.
- **AC-3 — decides a level bout only.** Given A holds senshu and the bout is level at the cap (e.g.
  4-4), Then A wins, endReason `"senshu"`. Given NOT level (e.g. 5-3), Then the leader wins, endReason
  `"time"` (senshu never overrides a points winner).
- **AC-4 — gap early-stop unaffected.** Given the gap reaches `winGap`, Then endReason `"gap"`,
  winner = the leader, regardless of senshu (a `"gap"` bout is never level).
- **AC-5 — no-senshu draw.** Given a level cap with no holder (0-0, or `none`), Then winner `"draw"`,
  endReason `"time"` (unchanged from pre-C1).
- **AC-6 — penalty never confers.** Given a jogai/passivity penalty gives B its first point (never a
  technique), Then B does not hold senshu; a subsequent first A technique latches senshu to A.
- **AC-7 — holder's foul revokes.** Given A holds senshu and A later commits any jogai/passivity foul
  (incl. the free warning), Then senshu → `none` (not transferred to B); a level cap is then `"draw"`/
  `"time"`. (A non-holder foul leaves senshu intact.)
- **AC-8 — same-tick latch-then-revoke.** Given A scores its first technique AND fouls on the same
  tick, Then latch (combat phase) precedes revoke (penalty phase) ⇒ `none`.
- **AC-9 — persists across resets.** Given A holds senshu and yame/jogai/passivity resets occur, Then
  A still holds senshu at the cap.
- **AC-10 — byte-identical absent + swap-symmetric.** Given `match.senshu` absent/`false`, replay is
  byte-identical to pre-C1 (no `senshuHolder` consulted, no `"senshu"` endReason). Given present,
  replay is stable and swap-symmetric (holder A↔B mirrors under a fighter swap).

**Spec:** NO `docs/spec.md` change in C1 — `generateSpec`'s `Match` type is `{ winGap }` and emits no
`endReason`; the "equal ⇒ draw" win-condition prose stays accurate while `match.senshu` is fixture-
only. The prose fix (equal ⇒ senshu-holder, else draw) + the `Match` extension land in Capability D
alongside the benchmark `MATCH`/`INPUT_HASH`/`BENCHMARK_VERSION` adoption.

**DESIGN.md reconciliation (DONE this pass):** §7a's senshu row + the `match` config block were
updated to the confirmed semantics — "score ANY point" → **scored techniques only** (penalty points
never confer); "never lost" → **lost on the holder's Category-2 foul** (any foul, incl. free warning;
permanent; not transferred); standalone `match.senshu?: boolean`.

**Recommended slicing (for `planning`):** two PR-sized slices — **C1a** the latch (techniques-only) +
level-at-cap resolution + `endReason "senshu"` + `match.senshu` toggle (senshu-only fixtures; the
"fully independent bargain" tracer; byte-identical absent); **C1b** the revocation coupling — a
holder's jogai/passivity foul cancels senshu (co-configured jogai/passivity fixtures). Each byte-
identical-absent + replay-stable + swap-symmetric, with scoped mutation on the changed `sim.ts`
officiating regions.

## Next Step

**Capability A (jogai) COMPLETE** (A1+A2+A3, PRs #97–#99). **Capability B (passivity) COMPLETE**
(B1 clock #100, B2 shared penalty ladder #101, B3 self read #102, B4 opponent read #103) — see
Progress. Branch `feat/senshu-tiebreak` is cut for the next slice.

**Next: C1 — senshu first-blood tiebreak** (find-gaps DONE 2026-07-02 — see the "C1 — resolved
decisions & acceptance criteria" section above). The Parking-Lot **bargain**: a WKF-faithful first-
blood latch that decisively resolves a level bout at the cap and cheaply closes the benchmark's
`"draw"` gap. **Resolved:** senshu latches on the first **scored-technique** point (penalty points
never confer); a simultaneous first score ⇒ `none` (permanent); the holder is **revoked** to `none`
by any jogai/passivity foul it commits (incl. the free 1st warning; not transferred); at the cap a
LEVEL bout goes to the holder (`endReason "senshu"`), else `"draw"`; config `match.senshu?: boolean`,
byte-identical absent. Bout-level `runFight` state (survives resets); **no DSL surface** (`self`/
`opponent.senshu` is C3) ⇒ `dsl.ts` TCB untouched; **no `docs/spec.md` change** (`Match` is
`{ winGap }`; prose to Capability D). DESIGN.md §7a's senshu row + `match` block were updated to match.

After C1: **C2** (sudden-death overtime) → **C3/C4** (senshu/overtime perception) → **D** (benchmark
`MATCH`/`INPUT_HASH` + `BENCHMARK_VERSION` adoption; spec teaches jogai/passivity/tie-break prose).

Each planned implementation slice runs the full RED-GREEN-MUTATE-KILL MUTANTS-REFACTOR cycle
(`tdd` + `testing` + `mutation-testing` + `refactoring`) before code changes. **C1's `find-gaps` pass
is DONE** — proceed to `planning` (recommended split: **C1a** latch + level-at-cap + `endReason
"senshu"` + `match.senshu` toggle, the independent tracer; **C1b** the revocation coupling with
co-configured jogai/passivity fixtures). Precedent to mirror: every §7 slice is byte-identical when
its `match` key is absent + replay-stable + swap-symmetric, with scoped mutation on the changed
`sim.ts` officiating regions.
