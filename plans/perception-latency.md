# Plan: Perception-latency keystone (design Slice 2)

**Branch**: feat/perception-latency
**Status**: Active

> Implements Slice 2 of `docs/stories/first-slice-split.md`. Source of truth for
> the mechanic: `docs/DESIGN.md` §"Control model & the perception keystone" and
> LOCKED #9 ("Perception — transparent + delayed"). Honours invariant #4 (per-fighter
> history ring buffer → one coherent delayed snapshot, never mix fresh + stale).

## Goal

The opponent is perceived **delayed** — positional fields by `L_pos`, action/intent
fields by `L_act` — so that frame data finally _means_ something: a fast strike
cannot be reaction-blocked while a slow one can, derived purely from latency.

## Why this slice (keystone rationale)

At `L=0` (today) an authored bot has perfect reactions, making frame data
meaningless. Delaying perception **derives** the whole defensive meta from `L` via
the master inequality **reaction-block iff `S ≥ L_act + B`** (here `B = 0`, block
startup deferred ⇒ **`S ≥ L_act`**). This is the project's distinctive mechanic and
the spine every later combat slice (bands, parry, cancels) reads through.

## Decisions baked into this plan (tunable; flag to change)

These are starting-point numbers — per the design's balance methodology they are
**configurable and meant to be tuned by bot-vs-bot playtest**, not trusted as given.

- **`L` lives in `Rules`** as an optional `perception` block (a balance knob, like
  the frame table). `rules.perception` **absent ⇒ `{ lPos: 0, lAct: 0, jitter: 0 }`**
  ⇒ today's behaviour, **byte-identical**. This is the split's forward-compat rule
  ("expose latency but at 0"). Existing `Rules` mocks need no change.
- **Defaults when authored:** `lPos = 1`, `lAct = 6`, `jitter = 1` (design says
  `L_pos ~1–2`, `L_act ~6`).
- **Self stays live** (`L = 0`) — design invariant. Only the _opponent_ is delayed.
- **Block startup `B = 0`** in this slice (instantaneous guard, as today) ⇒ the
  inequality is the clean `S ≥ L_act`. Block frame-data (`B > 0`) is a later combat
  slice, not latency.
- **1D only** — velocity is `vx`; `y`/`vy`/posture/band deferred to slices 3–4.
- **History ring** stores each fighter's whole outward frame per tick; the opponent's
  perceiver reads **whole frames** at `t − L_pos` (positional) and `t − L_act`
  (action) — two coherent layers, never mixing fields within a layer (invariant #4).
  Ring length ≥ `lAct + jitter + 1`; seeded with initial conditions so the first `L`
  ticks read the start state.

## Acceptance Criteria

- [ ] `perception` absent (or all-zero) ⇒ event logs are **byte-identical** to the
      pre-slice engine (forward-compat regression guard).
- [ ] A perceiver's reaction to opponent movement lands **exactly `L_pos` ticks
      later** than at `L = 0` (not `L_pos ± 1`).
- [ ] Within one snapshot, positional fields are a coherent whole-frame from
      `t − L_pos` and action fields a coherent whole-frame from `t − L_act`
      (no fresh+stale mixing).
- [ ] **Reaction-block succeeds iff `S ≥ L_act`** (`B = 0`): a strike with
      `startup = L_act` is blocked by a reactive blocker; `startup = L_act − 1` lands.
- [ ] `opponent.predictedDistance` equals the **true current** distance for a
      constant-velocity opponent, while raw `opponent.distance` lags by
      `walkSpeed · L_pos`.
- [ ] With `jitter > 0`: same `seed` replays **byte-identically**; different seeds
      can diverge; effective `L` stays clamped so `S ≥ L_act + jitter` is _always_
      blockable and `S < L_act − jitter` _never_ is.

## Slices

Every slice follows RED-GREEN-MUTATE-KILL MUTANTS-REFACTOR. No production code without
a failing test. Load `tdd`, `testing`, `mutation-testing`, `refactoring` before code.
Each slice keeps all prior tests green and stays byte-reproducible for fixed inputs.

---

### Slice 1: Opponent positional perception delayed by `L_pos` (history ring buffer)

**Value**: A bot author sees reactions to opponent _movement_ lag by a fixed,
configurable latency — the ring-buffer + coherent-delayed-snapshot spine, proven on
positional fields alone. (Walking skeleton of perception.)

**Path**: `runFight` → per-fighter history ring (push each fighter's outward frame
each tick) → `viewFor` serves opponent `x` / `distance` / `facing` from frame
`t − L_pos` (clamped to start-of-fight) → bot's `runTick` reads delayed values →
event log shows the shifted reaction. `L_act`, action fields, velocity, jitter, PRNG
all **skipped this slice**.

**Required implementation skills**: load `tdd`, `testing`, `mutation-testing`,
`refactoring`.

**Acceptance criteria** (confirm before code):

- `rules.perception` optional; absent ⇒ `lPos = 0` ⇒ event log **byte-identical** to
  current engine for an existing scenario.
- With `lPos = k`, a perceiver bot (acts on `opponent.distance` crossing a threshold)
  fires its distinctive action **exactly `k` ticks later** than the same fight at
  `lPos = 0`, against a deterministically-advancing opponent.
- First `k` ticks: opponent positional fields equal the **initial** opponent frame
  (ring seeded with start conditions), not a wrapped/garbage frame.

**RED**: behaviour tests in `src/run-fight.test.ts` (or a new
`src/perception.test.ts`): (a) absent-perception byte-identity vs a captured baseline
log; (b) reaction-shift equals `lPos` for `lPos ∈ {0,1,3}` — pins the delay index
against off-by-one (`t − lPos` vs `t − lPos ± 1`) and sign mutants; (c) start-seeding
test pins the clamp `max(0, t − lPos)`.

**GREEN**: add optional `perception?: { lPos: number }` to `Rules` (`types.ts`);
in `sim.ts` keep a per-fighter array of outward frames, push after resolve, and read
the opponent frame at `clamp(tick − lPos, 0, …)` inside `viewFor`. Minimum to pass.

**MUTATE**: run `mutation-testing`; expect mutators on the index arithmetic and the
clamp boundary — ensure tests above kill them.

**KILL MUTANTS**: strengthen delay/clamp assertions as needed.

**REFACTOR**: assess extracting a small `history`/`perceive` helper only if it adds
clarity.

**Done when**: all criteria met, mutation report reviewed, human approves commit.

---

### Slice 2: Split latency — action fields delayed by `L_act` ⇒ the master inequality

**Value**: The headline keystone — a reactive blocker can block a _slow_ strike but
not a _fast_ one, derived from `L_act` alone. Frame data now means something.

**Path**: expose opponent **action perception** (`opponent.attacking`, 1/0) served
from frame `t − L_act`, _separately_ from positional fields at `t − L_pos` (coherent
split snapshot). A reactive-blocker bot (`if opponent.attacking == 1 → block;
else idle`) is negated by the existing block path iff it perceives the attack before
the active window opens.

**Required implementation skills**: load `tdd`, `testing`, `mutation-testing`,
`refactoring`.

**Acceptance criteria** (confirm before code):

- New DSL field `opponent.attacking` on the allowlist (additive — no prior bot
  rejected); reads as 1 while the perceived opponent frame is mid-attack, else 0.
- Snapshot coherence: positional from `t − L_pos`, action from `t − L_act`, each a
  whole frame.
- **`startup = L_act` ⇒ reactive blocker blocks (attacker scores 0); `startup =
L_act − 1` ⇒ strike lands (attacker scores).** Single-tick `active` makes the
  boundary crisp.

**RED**: tests pin the inequality at the boundary (`S = L_act` blocked vs
`S = L_act − 1` hit) — kills the `>=`/`>` relational mutant and the `lAct ± 1`
arithmetic mutant exactly at the edge; a coherence test reads a scenario where
`L_pos ≠ L_act` and asserts position vs attacking come from different ticks.

**GREEN**: add `lAct` to `rules.perception`; record `attacking` in each outward
frame; in `viewFor` read action fields at `t − lAct`, positional at `t − lPos`; add
`opponent.attacking` to `FIELD_READERS` (`dsl.ts`) — the validator allowlist derives
from its keys, so this is purely additive to the TCB read surface.

**MUTATE**: run `mutation-testing`; focus the active-window/boundary and the two
distinct delay reads.

**KILL MUTANTS**: add assertions for survivors (e.g. attacking-flag duration).

**REFACTOR**: only if a `delayedFrame(ring, t, L)` helper clarifies the two reads.

**Done when**: criteria met, mutation report reviewed, human approves commit.

---

### Slice 3: Dead-reckoned `predictedDistance` (velocity exposure + extrapolation)

**Value**: A spacing bot can compensate for `L_pos` — striking when the opponent is
_truly_ in range, not where it was `L_pos` ticks ago.

**Path**: expose `opponent.vx` (positional, `t − L_pos`); engine derives
`opponent.predictedDistance` by extrapolating the delayed opponent position forward
over the latency gap: `predictedX = delayedX + delayedVx · L_pos`, then
`|predictedX − selfX|` (self live), clamped to the ring. Integer throughout.

**Required implementation skills**: load `tdd`, `testing`, `mutation-testing`,
`refactoring`.

**Acceptance criteria** (confirm before code):

- New DSL fields `opponent.vx`, `opponent.predictedDistance` (additive).
- For a **constant-velocity** opponent, `predictedDistance` equals the **true
  current** distance exactly (integer, constant velocity), while raw
  `opponent.distance` lags by `walkSpeed · L_pos`.
- A strike gated on `predictedDistance ≤ reach` connects (scores) at the moment the
  opponent is truly in range; the same gate on raw `opponent.distance` mistimes it.

**RED**: constant-velocity test asserting `predictedDistance == trueDistance` and
`distance == trueDistance + walkSpeed·lPos` — kills `+`/`−` and `·`/`÷` arithmetic
mutants on the extrapolation and the `lPos` factor; a strike-timing behaviour test
distinguishes predicted vs raw.

**GREEN**: store `vx` (Δx over last tick) in the outward frame; compute
`predictedDistance` in `viewFor`; add both fields to `FIELD_READERS`.

**MUTATE / KILL MUTANTS**: cover the extrapolation arithmetic and clamp.

**REFACTOR**: only if extracting the dead-reckoning calc clarifies.

**Done when**: criteria met, mutation report reviewed, human approves commit.

---

### Slice 4: Seeded, clamped jitter on `L` (first PRNG consumer; anti-frame-counting)

**Value**: Latency wobbles unpredictably so bots can't frame-count the exact `L`,
yet fights stay **bit-reproducible** from the seed. This is where `FightConfig.seed`
is finally consumed.

**Path**: implement `mulberry32(seed)` (pure, integer-output); thread one PRNG
through the whole sim; each tick draw small integer offsets (fixed, documented draw
order — e.g. A-pos, A-act, B-pos, B-act) and apply `L' = clamp(L + offset, 0,
ringLen−1)` to each fighter's positional and action delay before serving the
snapshot. `jitter` amplitude from `rules.perception`.

**Required implementation skills**: load `tdd`, `testing`, `mutation-testing`,
`refactoring`.

**Acceptance criteria** (confirm before code):

- `mulberry32` reproduces a known reference sequence for a known seed (unit-pinned).
- Same `{seed, rules, bots}` ⇒ **byte-identical** event log even with `jitter > 0`
  (replay invariant survives the new PRNG consumer).
- Two different seeds can produce a differing event log across a sensitive scenario
  (jitter actually perturbs timing).
- **Clamp bound:** with amplitude `j`, a strike with `S ≥ L_act + j` is _always_
  blocked and one with `S < L_act − j` is _never_ blocked — jitter can't cross the
  inequality outside its band.

**RED**: PRNG sequence test (kills constant/`Math.random` mutants); same-seed
byte-identity (extends existing replay test to `jitter > 0`); seed-variance test;
clamp-bound pair at `L_act ± j` (kills the clamp `min`/`max` and the amplitude sign).

**GREEN**: new `src/prng.ts` (`mulberry32`); thread the rng instance in `runFight`;
draw + clamp per the fixed order; apply to the two delays.

**MUTATE / KILL MUTANTS**: focus PRNG arithmetic, draw order, clamp bounds; ask the
human if a survivor's value is ambiguous (e.g. exact draw order is a convention).

**REFACTOR**: only if it adds value.

**Done when**: criteria met, mutation report reviewed, human approves commit.

## Pre-PR Quality Gate (each slice)

1. `mutation-testing` run + report reviewed.
2. `refactoring` assessment.
3. `npm run typecheck` and `npm run lint` pass.
4. Forward-compat check: `perception` absent ⇒ byte-identical to prior engine.

## Notes / parked

- Slices 1+2 could be merged into one PR if fewer-PRs is preferred; kept separate to
  de-risk the ring buffer (byte-identical refactor) from the inequality (new field +
  meta). Slice 4 (PRNG/jitter) is separable and could ship as a follow-up if the
  keystone is wanted without anti-frame-counting first.
- Block startup `B > 0`, `L_pos`/`L_act` retuning, and 2D velocity are **not** in
  this plan — they belong to later combat/balance slices.

---

_Delete this file when the plan is complete. If `plans/` is empty, delete the directory._
