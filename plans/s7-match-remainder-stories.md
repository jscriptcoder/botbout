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
  (2 fields join the read-surface list + JSON-schema enum; drift test green); penalty *prose*
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

Why this first: it burns the single biggest *architecture risk* of the whole
feature — reading a new officiating boundary (`[margin, width−margin]`) over the
existing hard positional clamp and firing the reset path — as a clean tracer,
independent of the penalty ladder. End-to-end and demonstrable; every later jogai
and passivity slice builds on this reset/edge-detect spine.

## Split Candidates

### Capability A — Jogai (ring-out penalty)

| Slice | Value | Includes | Defers | Acceptance Examples | Release |
|---|---|---|---|---|---|
| **A1** out-zone detection + reset | Proves the boundary read + reset spine; de-risks geometry | `match.jogai.margin`; legal `[margin, width−margin]`; on-entry edge-detect (in-bounds→out); `resetToNeutral` both; `was-in-bounds` tracker set true post-reset | Penalty, points, warnings, perception | Given `margin` set, When A walks past `margin`, Then both reset to start that tick (points unchanged). Given absent `match.jogai`, Then byte-identical replay | Shippable (inert without config) |
| **A2** warning-ladder penalty | The jogai *value*: retreat costs points | Shared per-fighter `penaltyCount` (generic, reused by passivity); 1st foul free, 2+ ⇒ opponent +1 → existing `winGap`; `winGap` re-check at the jogai boundary (endReason `"gap"`); jogai `FightEvent` | Perception fields | Given A's 1st out-zone entry, Then warning only (0 pts). Given A's 2nd, Then B +1 pt + reset. Given enough retreats, Then B wins on `winGap` | Shippable |
| **A3** penalty perception | Bots can read the shared warning count | `self.penalties` + `opponent.penalties` (live scoreboard `FIELD_READERS`, like `opponent.points`); interpreter stays 100% | Passivity/senshu reads | Given A has 1 warning, Then A's bot reads `self.penalties==1` and B reads `opponent.penalties==1` | Shippable |

### Capability B — Passivity (non-engagement penalty) — reuses A2's ladder

| Slice | Value | Includes | Defers | Acceptance Examples | Release |
|---|---|---|---|---|---|
| **B1** clock + reset-on-contact + re-engage reset | Proves the anti-stall metric (the subtle part) | Per-fighter `ticksSinceOffense`; reset **only on contact** (hit/block/parry/grab/sweep-connect — whiff at air does NOT reset); exceed `match.passivity.limit` ⇒ `resetToNeutral` both + reset both clocks | Penalty, perception | Given two far-apart idle bots, When neither connects for `limit` ticks, Then both reset to `startGap`. Given a whiff-at-air spammer, Then it still goes passive (whiff didn't reset) | Shippable (inert without config) |
| **B2** passivity feeds shared ladder | Non-engagement costs points | Passivity `++` on the shared `penaltyCount` (shares the free first warning with jogai); opponent +1 after free; `winGap` re-check; `FightEvent` | — | Given B's clock hits `limit` twice, Then A +1 pt the 2nd time. Given one jogai already used the free warning, Then the next passivity immediately costs a point | Shippable |
| **B3** self passivity clock read (live) | Bot times its forced engagement | `self.passivityRemaining` (live `FIELD_READER`) | Opponent read | Given `limit` and elapsed ticks, Then `self.passivityRemaining` counts down and a bot commits contact just in time to avoid the foul | Shippable |
| **B4** opponent passivity read (delayed) | Bait the forced commit | `opponent.passivityRemaining` on the `L_act` layer (ring-buffer served, like `opponent.stamina` in C10 S4) | — | Given B is 3 ticks from passive, Then A perceives `opponent.passivityRemaining==3+jitter` on the delayed layer and can prep a counter | Shippable |

### Capability C — Tie resolution (senshu + overtime)

| Slice | Value | Includes | Defers | Acceptance Examples | Release |
|---|---|---|---|---|---|
| **C1** senshu first-blood tiebreak | Fixes the real `"draw"` gap cheaply (a bargain) | First-blood latch (first scorer holds senshu; simultaneous ⇒ none); at cap, level ⇒ winner = senshu-holder, endReason `"senshu"`; no senshu ⇒ `"draw"`. Config toggle under `match` | Overtime, perception | Given a 4-4 bout where A scored first, Then A wins, endReason `"senshu"`. Given 0-0 all bout, Then `"draw"` | Shippable (inert without config) |
| **C2** sudden-death overtime | Decisive resolution before falling to senshu | On level at cap: `resetToNeutral` both (points/stamina/mem persist), first fighter to gap ≥ 1 wins immediately, same-tick trade stays level, `match.overtimeTicks` cap ⇒ fall to C1's senshu; jogai/passivity live in OT; endReason `"overtime"` | — | Given level at cap, When A scores first in OT, Then A wins, endReason `"overtime"`. Given OT elapses scoreless, Then senshu (C1) decides | Shippable |
| **C3** senshu perception | Late-bout tiebreak strategy | `self.senshu` + `opponent.senshu` (live 1/0 scoreboard `FIELD_READERS`) | — | Given A holds senshu, Then A reads `self.senshu==1`, B reads `opponent.senshu==1` | Shippable |
| **C4** overtime perception | Play-safe vs all-in in sudden death | `clock.overtime` (live 1/0) — could ride C2 | — | Given the bout is in OT, Then both bots read `clock.overtime==1` | Shippable (may fold into C2) |

### Capability D — Downstream adoption (per the precedent; after the mechanics land)

| Slice | Value | Includes | Defers | Acceptance Examples | Release |
|---|---|---|---|---|---|
| **D1** benchmark adopts full officiating | The frozen gauntlet scores under jogai/passivity/tie-res | Fold new `match` config into the benchmark `MATCH` constant + `INPUT_HASH`; bump `BENCHMARK_VERSION`; re-characterize the gauntlet + `docs/benchmark-gauntlet-vN.md` | A possible rebalance (see Parking Lot) | Given the benchmark config change, Then `INPUT_HASH` guard test forces a version bump; the gauntlet is re-characterized in a note | Shippable |
| **D2** spec teaches the new rules | LLM authors know the officiating | Extend `generateSpec(rules, match)` to teach jogai margin/penalty, the passivity engagement rule, senshu/OT + corrected win/draw semantics; drift-test the regenerated `docs/spec.md` | — | Given the generator change, Then `docs/spec.md` documents jogai/passivity/tie-break and the byte-match drift test passes | Shippable |

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

- **D1 — reset predicate: ATTACKER ONLY** (Q1). A fighter's clock resets iff *its own* committed
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

## Next Step

**Capability A (jogai) COMPLETE** (A1+A2+A3, PRs #97–#99). **B1 (passivity clock)
COMPLETE** (PR #100; see Progress). Branch `feat/passivity-penalty` is cut for the next slice.

**Next: B2 — passivity feeds the shared penalty ladder.** The passivity *value*: a
`ticksSinceOffense > limit` foul (B1's now-inert re-engage) becomes a real penalty by
incrementing the **shared `Fighter.penaltyCount`** (A2's ladder) — 1st foul free, 2+ ⇒
opponent +1 point → existing `winGap` re-check (`endReason "gap"`), then `resetToNeutral(both)`.
Because jogai and passivity **share** `penaltyCount`, a fighter that already burned its free
warning on a jogai retreat pays a point on its **first** passivity foul (and vice-versa) —
that cross-mechanic interaction is B2's key new behavior to pin. Byte-identical absent
`match.passivity`; still **no DSL surface** (perception is B3/B4).

Officiating order (design §7a, the swap-symmetry contract): resolve combat → update clocks
(passivity, jogai edge-detect) → `events.push` → apply penalties → at most one
`resetToNeutral(both)` → one `winGap` check. B2 folds the passivity award into that same
penalty/winGap path A2 established — the natural moment to extract A2's inline award into a
shared helper (deferred there by YAGNI; passivity is now the second consumer).

After B2: **B3** (`self.passivityRemaining` live read — also completes B1's throw-term
behavioral verification) → **B4** (`opponent.passivityRemaining`, `L_act`-delayed) → **C**
(tie-resolution) → **D** (benchmark + spec).

Each planned implementation slice runs the full RED-GREEN-MUTATE-KILL MUTANTS-REFACTOR cycle
(`tdd` + `testing` + `mutation-testing` + `refactoring`) before code changes. **B2's `find-gaps`
pass is DONE** (2026-07-02) — see the "B2 — resolved decisions & acceptance criteria" section above
(D1–D4, AC-1…AC-9): per-fighter mutual-net-zero award (D1), fire independently of a same-tick score
(D2), extract a shared `applyPenalty` helper (D3), reuse `endReason "gap"` (D4); the shared-free-
warning interaction is captured as AC-3. **Next: `planning` B2** into PR-sized slices.
