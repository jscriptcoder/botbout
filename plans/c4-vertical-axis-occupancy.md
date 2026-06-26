# Plan: C4 — Vertical axis + occupancy

**Branch**: per-slice (`feat/c4-crouch-occupancy`, `feat/c4-jump-arc`, `feat/c4-airborne-occupancy`, `feat/c4-perceive-height`, `feat/c4-perceive-posture`)
**Status**: Active — awaiting approval

## Goal

Make the low/high game **physical**: a strike can now **whiff on posture alone** (a `high`
kick sails over a croucher; a sweep passes under a jumper), bringing the §11 step-3
**occupancy gate** live (it is hardwired open today), and exposing opponent posture/height
so a bot can read it and counter.

## Context & boundaries (read before slicing)

- **Design source:** `docs/DESIGN.md` §1 (real 2D fixed-point `y` + gravity), §2 (band
  attribute **+ geometric occupancy** — "the core needs only band occupancy + `x`-reach"),
  §9 (perception split `L_pos`/`L_act`), §11.3 (the `active → reach → occupancy → guard`
  gate, with **occupancy checked _before_ guard**). Bot API: `docs/BOT-DSL.md`
  (`crouch`, `jump`, `self.y/vy`, opponent posture).
- **No §11 effects machinery in C4.** Occupancy is **read-only on the defender** (its
  posture/`y` decides whether the strike lands); the score still lands on the **attacker**,
  the guard still on **self**. So resolution stays trivially order-independent and we keep
  the current single-`resolveHit` model — the deferred compute-then-apply union still waits
  for its first cross-fighter consumer (C5 parry / throws), exactly as the Status note says.
- **Additive only.** New actions (`crouch`, `jump`), new state fields (`self.y/vy/posture`,
  `opponent.y/vy/posture`), new `Rules` numerics (`gravity`, `jumpImpulse`, `lowClearance`)
  never reject a previously valid bot and default to byte-identical-to-C3 when unused
  (no jump/crouch ⇒ `y=0`, standing, all 3 bands occupied ⇒ today's behavior).
- **Integer/fixed-point only** in `y`, `vy`, gravity (sub-units, `SCALE=1000`); the arc is a
  pure integer recurrence — replay-stable. No floats in the outcome path.

## Design decisions pinned for C4 (confirm at approval)

1. **Occupancy = membership test, driven by (`y`, crouch flag)** — per §2 "the core needs
   only band occupancy". Compute each fighter's occupied band-set, then the gate tests
   whether the **attacked band** is in the defender's set:
   - `standing` (grounded, not crouching) → `{high, mid, low}` (today's behavior)
   - `crouching` → `{mid, low}` (**vacates `high`**)
   - `airborne` (`y ≥ lowClearance`) → `{high, mid}` (**vacates `low`**)
   - **`mid` is always occupied** — the core band; the "jump above `high` ⇒ pure anti-air"
     nuance and a 4th airborne band are deferred (numeric/extra-band slot).
2. **Commitment:** `crouch` is a **free per-tick posture** (like `block` — issue it, you
   crouch this tick; stop, you stand next tick; cannot crouch while committed). `jump` is a
   **committed airborne lock** — once airborne you cannot act until you land at `y=0` (no
   air actions in C4; they're a later slice). The free-to-act predicate stays
   `state.kind === "neutral"`.
3. **Occupancy before guard** (§11.3): a `high` strike vs a croucher **WHIFFs regardless of
   guard** (it physically misses) — the gate short-circuits at occupancy before the
   band-guard check.
4. **Numeric slots (defaults in test mocks, tuned later via bot-vs-bot):** `gravity`
   (downward `vy` delta/tick), `jumpImpulse` (initial upward `vy`), `lowClearance` (the `y`
   at/above which `low` is vacated; skeleton default = strictly airborne, `y > 0`).
5. **Perception layering (CONFIRMED):** `y`/`vy` are **positional → `L_pos`** (track height
   fast, for anti-air dead-reckoning); **posture** (the crouch/airborne _classification_)
   rides **`L_act`** as a discrete enum, matching the `opponent.attackBand` precedent and
   `docs/BOT-DSL.md`'s grouping of `posture_is` under action/intent ("track where fast,
   recognize what slow"). `opponent.posture` enum: `0` standing, `1` crouching, `2` airborne.
6. **Jump split (CONFIRMED):** jump physics (slice 2) and the vacate-`low` payoff (slice 3)
   ship as **two PRs**; a jumper is briefly sweepable-while-airborne between them (incomplete,
   not broken — like C1's walking before scoring used it).
7. **Horizontal jump `dir` (CONFIRMED): deferred.** Slice 2 is **vertical-only** (`jump.dir`
   is accepted by the validator for forward-compat but applies **no** horizontal
   displacement); jump-in / jump-back footwork is a later slice.

## Acceptance Criteria

- [x] A `crouch` action is accepted by the validator and makes the fighter occupy
      mid+low; a `high` strike in reach **whiffs** a croucher (no score), while `mid`/`low`
      strikes still score. _(Slice 1 — PR #17)_
- [x] A `jump` action launches a deterministic **integer gravity arc** (`y` rises, gravity
      pulls it back, lands at `y=0`); the fighter is **committed while airborne** (mid-air
      actions are ignored, like an attacking fighter); `y` appears in the event log.
      _(Slice 2 — PR #18)_
- [x] An airborne fighter occupies `{high, mid}`; a `low` strike (sweep) in reach **whiffs**
      a jumper, while `mid`/`high` strikes still score (anti-air). _(Slice 3 — PR #19)_
- [x] With perception latency, a bot can **read** `opponent.y` (`L_pos`-delayed) and anti-air
      a jumper by perceived height. _(Slice 4a — PR #20)_
- [x] With perception latency, a bot can **read** `opponent.posture` (`L_act`-delayed enum) and
      switch its strike's band — incl. avoiding `high` vs a perceived croucher. _(Slice 4b)_
- [x] With no `crouch`/`jump` anywhere, the fight is **byte-identical** to C3 (all fighters
      stand at `y=0`, occupy all 3 bands).
- [x] All replays stay byte-identical and every `y`/`vy` stays an integer.

## Slices

Every slice follows RED-GREEN-MUTATE-KILL MUTANTS-REFACTOR. No production code without a
failing test. Load `tdd`, `testing`, `mutation-testing`, `refactoring` before each slice.

### Slice 1: Crouch vacates `high` — a strike can whiff on posture (occupancy gate goes live) ✅ DONE (PR #17)

**Value**: A bot author can duck a high attack — the first time a strike misses on posture
alone; the §11 step-3 occupancy gate runs for real (no longer hardwired open).
**Path**: `crouch` action → DSL validator accepts it → `types.ts` `Action` union → `sim`
intake marks the fighter `crouching` this tick (free-to-act, like `block`) → `resolveHit`
gains an **occupancy check before the guard check** (`high ∉ {mid,low}` ⇒ WHIFF) → scores
in the result. _Skipped here:_ any `y`/physics (crouch is grounded, `y=0`); reach reduction
while crouching (deferred numeric).
**Required implementation skills**: `tdd`, `testing`, `mutation-testing`, `refactoring`.
**Acceptance criteria**:

- Validator accepts `{ type: "crouch" }` and still rejects unknown action types.
- A `high` strike in reach vs a crouching defender ⇒ **0** (whiff); the same strike vs a
  standing defender ⇒ scores.
- A `mid` strike and a `low` strike in reach vs a croucher ⇒ **still score** (croucher
  occupies `{mid, low}`).
- Occupancy is checked **before** guard: a `high` strike vs a croucher who _also_ (cannot —
  one action/tick) — i.e. a croucher is **open**, so assert the whiff comes from occupancy,
  not from any guard; and a `high` strike vs a standing `block-high` guard is still BLOCKED
  (regression — guard path intact).
- No `crouch` anywhere ⇒ byte-identical to C3.
  **RED**: `run-fight.test.ts` — "a high strike whiffs a crouching defender but a mid/low
  strike still scores"; `validate-bot.test.ts` — "accepts the crouch action". Likely mutants
  to pre-empt (see `mutator-rules.md`): the occupancy comparison (`∈`/`∉` flipped), the
  band-set membership (drop `high` vs drop a wrong band), boolean `crouching` derivation
  (`block`↔`crouch` swap), and gate **ordering** (occupancy-before-guard vs after — assert a
  case where the two orders differ: croucher with no guard whiffs high).
  **GREEN**: add `crouch` to `Action` + DSL `action()` validator; in `sim` derive a
  `postureOf(fighter, action)` (`crouching` when free-to-act + `crouch`), an
  `occupies(posture, band)` table, and insert `if (!occupies(defPosture, st.band)) return;`
  in `resolveHit` **above** the guard check.
  **MUTATE**: run `mutation-testing` on `sim.ts` + `dsl.ts`; target the occupancy table,
  membership test, and gate order.
  **KILL MUTANTS**: add tests for any surviving occupancy/ordering mutants.
  **REFACTOR**: assess extracting the occupancy table + a `Posture` type (only if it reads
  clearer); keep the `resolveHit` gate linear and short-circuiting per §11.3.
  **Done when**: all criteria met, mutation report reviewed, human approves commit.

### Slice 2: A fighter can jump — a deterministic integer gravity arc, committed while airborne ✅ DONE (PR #18)

**Value**: Fighters gain the vertical axis: a real jump (the platform's first `y` motion),
visible in the event log — the walking skeleton for the low/high game (mirrors how C1's
movement slices proved the `x` axis before scoring used it).
**Path**: `jump` action → DSL validator → `types.ts` `Action` + `self.y`/`self.vy` + a new
`airborne` `MoveState` → `Rules` gains `gravity`, `jumpImpulse` → `sim` integrates the arc
(launch sets `vy = jumpImpulse`; each tick `y += vy`, `vy -= gravity`; land when `y ≤ 0` ⇒
clamp `y=0`, return to `neutral`) → `y` recorded in `FighterFrame`/event log. _Skipped here
(CONFIRMED deferrals):_ occupancy change (an airborne fighter is still hittable everywhere —
slice 3 adds vacate-low); **horizontal jump `dir` displacement — `dir` is validated but
applies no movement** (vertical-only); air actions.
**Required implementation skills**: `tdd`, `testing`, `mutation-testing`, `refactoring`.
**Acceptance criteria**:

- Validator accepts `{ type: "jump", dir: -1|0|1 }`.
- Issuing `jump` from neutral raises `y` along an integer arc that peaks and returns to
  exactly `y=0`, lasting a deterministic number of ticks for given `gravity`/`jumpImpulse`.
- The fighter is **committed while airborne**: actions returned mid-air are logged but
  ignored (re-uses the commitment property; `canAct=0` while airborne).
- `y` is in the event log and is always an integer; replays byte-identical.
- No `jump` anywhere ⇒ `y` stays `0` everywhere ⇒ byte-identical to C3 (plus the inert `y:0`
  column — confirm the column addition is the only diff).
  **RED**: "a jumping fighter traces a symmetric integer arc back to y=0 and cannot act until
  it lands". Likely mutants: the gravity sign / `+=`↔`-=` on `vy`, the launch impulse, the
  landing predicate (`y <= 0` vs `< 0` — off-by-one apex/landing tick), the `canAct` /
  airborne-lock branch, and the `y` recurrence order (apply `vy` before/after gravity).
  **GREEN**: minimal integer integrator + `airborne` state in the `neutral|attacking`
  machine; `viewFor` reports `canAct=false` while airborne; record `y`.
  **MUTATE**: `mutation-testing` on the integrator + state machine; pin the recurrence,
  landing tick, and lock.
  **KILL MUTANTS**: tests for arc apex tick, landing tick, and the ignored mid-air action.
  **REFACTOR**: assess a small `stepPhysics(fighter, rules)` helper; keep it integer & pure.
  **Done when**: all criteria met, mutation report reviewed, human approves commit.

### Slice 3: Airborne vacates `low` — a sweep whiffs a jumper (the jump's combat payoff) ✅ DONE (PR #19)

**Value**: The jump becomes defensively meaningful: a `low` strike / sweep passes **under**
a jumper; the second half of the C4 acceptance example, completing the occupancy gate for
both postures.
**Path**: extend `occupies(posture, band)` so `airborne` → `{high, mid}` (gated by
`y ≥ lowClearance`) → `resolveHit`'s occupancy check now whiffs a `low` strike vs an
airborne defender, while `mid`/`high` still score (anti-air). `lowClearance` added to
`Rules`.
**Required implementation skills**: `tdd`, `testing`, `mutation-testing`, `refactoring`.
**Acceptance criteria**:

- A `low` strike in reach vs an airborne defender (`y ≥ lowClearance`) ⇒ **0** (whiff).
- `mid` and `high` strikes in reach vs the same airborne defender ⇒ **still score**.
- A `low` strike vs the **grounded** parts of the arc (`y < lowClearance`, e.g. just after
  launch / just before landing) ⇒ **scores** (the timing/anti-air window — assert at a
  specific tick, not just the total).
- Occupancy still checked before guard; swap-symmetric; byte-identical when no jump.
  **RED**: "a sweep whiffs an airborne fighter but lands on the same fighter while grounded".
  Likely mutants: the `lowClearance` comparison (`>=` vs `>` vs `<`), the airborne band-set
  (drop `low` vs drop `high`), and the `y`-threshold boundary.
  **GREEN**: one row in the occupancy table keyed on the airborne `y ≥ lowClearance` test.
  **MUTATE / KILL MUTANTS**: pin the boundary tick and the band-set.
  **REFACTOR**: fold the crouch (slice 1) and airborne occupancy into one clear table.
  **Done when**: all criteria met, mutation report reviewed, human approves commit.

### Slice 4a: Perceive opponent height (`L_pos`) — anti-air by reading `opponent.y` ✅ DONE (PR #20)

**Value**: A counter-bot can **perceive** a jumper's height (delayed) and switch to a
connecting band — the read/counter game keyed on height, the part that makes occupancy a
_game_ (mirrors C3 slice 2 exposing `opponent.attackBand`, but on the positional layer).
**Path**: record `y` in each fighter's history `Frame` (`frameOf` reads live `f.y`); serve it
from the **`L_pos`** layer in `perceiveOpponent` (`opponent.y`); add `opponent.y` to
`OpponentState`, `FieldPath`, `FIELD_READERS`. _Skipped here (deferred):_ `self.y` — a fighter
can only act while grounded (`y=0`; air-actions deferred), so live `self.y` has no behavioral
consumer yet and waits for the air-actions slice; `vy`/`predictedY` (added only when a test
needs the height dead-reckoning); the `posture` enum + crouch perception (Slice 4b, `L_act`).
**Required implementation skills**: `tdd`, `testing`, `mutation-testing`, `refactoring`.
**Acceptance criteria**:

- Validator accepts `opponent.y`; still rejects unlisted paths (e.g. `opponent.vy`, `self.y`).
- `opponent.y` lags by **`L_pos`** (asserted like the existing `opponent.x` delay) — read from
  the positional layer, never mixed with the action layer.
- A bot that switches `low → mid` on perceived `opponent.y ≥ threshold` scores against a jumper
  where a fixed-`low` bot whiffs (anti-air by perceived height); and it must perceive in time
  (ties the read to `L_pos`).
- At `L=0` ⇒ `opponent.y` reads live ⇒ byte-identical to the no-perception path; replays
  byte-identical; every `y` integer.
  **RED**: "a height-reading bot anti-airs a jumper it perceives `L_pos` ticks late". Likely
  mutants: the layer selection (`L_pos` vs `L_act` for `y`), the `self`-vs-`opponent` wiring,
  the live-`self` vs delayed-`opponent` split, and the `frameOf` `f.y` read.
  **GREEN**: extend `Frame` (+`y`), `frameOf`, `perceiveOpponent`, `SelfState`/`OpponentState`,
  `FieldPath`, `FIELD_READERS` minimally.
  **MUTATE / KILL MUTANTS**: pin the `L_pos` layer wiring and the self/opponent split.
  **REFACTOR**: assess only if it adds value.
  **Done when**: all criteria met, mutation report reviewed, human approves commit.

### Slice 4b: Perceive opponent posture (`L_act`) — the `{standing, crouching, airborne}` enum ✅ DONE

**Value**: A counter-bot can **recognize** the opponent's stance (delayed) — notably a croucher
(invisible to the height read, since crouch is grounded) — and avoid a band that would whiff;
the "recognize what slow" half on the action layer (mirrors `opponent.attackBand`).
**Path**: persist the resolved `posture` on each `Fighter` (set from the `aPosture`/`bPosture`
already computed in resolve), so `frameOf` can record it (crouch is a per-tick, pre-action
posture — it must be carried, giving the same observe-after-commit `+1` as the `attacking`
tell); encode it `{0 standing, 1 crouching, 2 airborne}` (a `POSTURE_CODE` beside `BAND_CODE`);
serve it from the **`L_act`** layer in `perceiveOpponent` (`opponent.posture`); expose
`self.posture` (live committed stance) in `viewFor`; add to `SelfState`/`OpponentState`,
`FieldPath`, `FIELD_READERS`. Add `self.vy`/`opponent.vy` only if a test needs dead-reckoning.
**Required implementation skills**: `tdd`, `testing`, `mutation-testing`, `refactoring`.
**Acceptance criteria**:

- A bot reading `opponent.posture == crouching` avoids `high` (which would whiff) and scores
  where a fixed-`high` bot whiffs; a bot reading `airborne` confirms the enum classification.
- `opponent.posture` lags by **`L_act`** (assert the coherent split — never mixed with the
  `L_pos` positional layer, per invariant #4).
- `self.posture` is readable and reflects the fighter's live committed stance.
- At `L=0` ⇒ posture reads live (+ the structural observe-after-commit tick) ⇒ byte-identical
  to the no-perception path.
- Validator accepts `self.posture`/`opponent.posture` and still rejects unlisted ones.
  **RED**: "a posture-reading bot avoids high vs a croucher it perceives `L_act` ticks late".
  Likely mutants: the layer selection (`L_act` vs `L_pos`), the `POSTURE_CODE` enum encoding,
  the persisted-posture wiring, and the `self`-vs-`opponent` split.
  **GREEN**: add `Fighter.posture` + resolve write, `POSTURE_CODE`, extend `Frame`, `frameOf`,
  `perceiveOpponent`, `SelfState`/`OpponentState`, `FieldPath`, `FIELD_READERS`.
  **MUTATE / KILL MUTANTS**: pin the `L_act` layer and the enum.
  **REFACTOR**: assess whether posture encoding belongs beside `BAND_CODE`.
  **Done when**: all criteria met, mutation report reviewed, human approves commit.

## Pre-PR Quality Gate (each slice)

1. Mutation testing — run `mutation-testing` (target `sim.ts` + `dsl.ts`; sim mutation has
   held ~95%, prng/dsl-interpreter 100% — keep them there).
2. Refactoring assessment — run `refactoring`.
3. `npm run typecheck` + `npm run lint` + `npm run format:check` pass.
4. Update `docs/DESIGN.md` §11.5 (mark the occupancy slot **live**), the `sim.ts` header
   scope note, and `.claude/CLAUDE.md` Status when the capability lands.

## Resolved decisions (2026-06-26)

- **Perception layering:** opponent posture on **`L_act`**; `y`/`vy` on **`L_pos`** (pinned
  decision 5).
- **Jump split:** **two PRs** — physics (slice 2) then vacate-`low` (slice 3) (decision 6).
- **Horizontal jump `dir`:** **deferred** — slice 2 is vertical-only (decision 7).
- **Slice 4 split (2026-06-26):** the read game splits along its own `L_pos`/`L_act` seam into
  **4a** (`opponent.y` on `L_pos` — anti-air by height; clean) and **4b** (`posture` enum on
  `L_act` — crouch perception, needs a persisted posture on `Fighter`). Crouch is a per-tick,
  pre-action posture so it cannot be read from a pre-tick state frame; deferring it to 4b keeps
  4a free of that wrinkle and each PR independently mergeable.

---

_Delete this file when the plan is complete. If `plans/` is empty, delete the directory._
