# Plan: Self passivity clock read — `self.passivityRemaining` (story B3)

**Branch**: feat/passivity-self-read
**Status**: Active

## Goal

Expose a live self-perception field **`self.passivityRemaining`** — a countdown of ticks until the
passivity foul, `max(0, limit − ticksSinceOffense)` — so a bot can time a forced re-engagement just
before it fouls. Capability B's **first new DSL surface**. Byte-identical absent `match.passivity`
(sentinel `0`); no opponent read (B4), no new `endReason`, no canonical wiring (D). Also **completes
B1's throw-term behavioral verification** (AC-4/D3), now that the clock is observable.

## Context & source of truth

- **Resolved decisions + ACs:** the tracker `plans/s7-match-remainder-stories.md`, section **"B3 —
  resolved decisions & acceptance criteria (find-gaps 2026-07-02)"** — D1 derived countdown
  `max(0, limit − ticksSinceOffense)`, D2 sentinel `0` unconfigured, D3 B3 completes B1's `aThrow`
  throw-reset verification, D4 mechanical spec regen (prose deferred to Capability D); AC-1…AC-7.
  This plan implements that section verbatim.
- **Precedent to mirror exactly:** **A3** (jogai penalty perception, PR #99) — the single-slice
  live-`FIELD_READER` PR: a static `FIELD_READERS` entry (interpreter stays 100%), config-gated
  value, `SelfState`/`FieldPath` additions, `docs/spec.md` regen + drift test. B3 is the same shape
  with a _derived_ value (like `finishWindow`) instead of a raw counter.
- **Non-negotiable invariants:** determinism (integer-only outcome math — the countdown is a pure
  integer subtraction; the seam is a read, not an outcome), **DSL-as-data TCB boundary — the new
  reader is a static allowlist entry; the interpreter gains NO branch; `dsl.ts` stays 100%; NO new
  `endReason`**, same pre-tick snapshot. `limit` is scoring-layer config
  (`FightConfig.match.passivity.limit`), NOT `Rules`/`CANONICAL_RULES` — `npm run fight` is
  unaffected; `limit` stays test-fixture-only (canonical wiring is Capability D).

## Read-timing note (design-critical — pins the tick math)

`viewFor` runs at the **top** of the tick loop (`sim.ts:967/974`), while the clock increment +
foul-check run **later that same tick** (`sim.ts:1066+`). So `self.passivityRemaining` at tick T
reflects the clock as of the **end of tick T−1** — the same live-but-one-step convention as the
other self windows (`counterWindow`/`cancelWindow`/`finishWindow`). For a never-connecting fighter
the read value at tick T equals `limit − T` (until the foul at tick `limit` resets it), which the
RED tests key off.

## Code touch points

**1. `src/engine/types.ts`** — add the self-view field (after `penalties`, ~line 45):

```ts
passivityRemaining: number; // B3: ticks until the passivity foul (live self-proprioception); max(0, limit − ticksSinceOffense), 0 = foul imminent / no passivity configured (the sentinel)
```

**2. `src/engine/dsl.ts`** — the TCB read surface (two additive edits; `ALLOWED_FIELDS` auto-derives
from `FIELD_READERS` keys, so validation + spec follow for free):

- `FieldPath` union — add after `"self.penalties"` (~line 34): `| "self.passivityRemaining"`
- `FIELD_READERS` — add after the `self.penalties` reader (~line 111), a **static** entry (no new
  branch ⇒ interpreter stays 100%):
  ```ts
  "self.passivityRemaining": (s) => s.self.passivityRemaining,
  ```

**3. `src/engine/sim.ts`** — thread `match` into `viewFor` and derive the value (like `finishWindow`):

- `viewFor` signature — add a param (typed from the same file's `FightConfig`):
  ```ts
  match: FightConfig["match"],
  ```
- Inside `viewFor`, alongside the `finishWindow` derivation:
  ```ts
  // Live countdown to the passivity foul (B3): the clock counts UP to `limit`, so remaining =
  // limit − clock; 0 = "connect this tick or foul". Config-gated — sentinel 0 when passivity is
  // unconfigured (the value can't depend on match at the TCB boundary; only here in viewFor).
  const passivityRemaining = match?.passivity
    ? Math.max(0, match.passivity.limit - self.ticksSinceOffense)
    : 0;
  ```
- Add `passivityRemaining,` to the returned `self` object (after `penalties`).
- Both `viewFor(...)` call sites (`sim.ts:967`, `sim.ts:974`) — pass `match` as the new trailing arg.

**4. `docs/spec.md`** — regenerate via `npm run gen:spec`. `self.passivityRemaining` auto-joins the
**State read surface** bullet list (`bullets(ALLOWED_FIELDS)`) **and** the embedded JSON-schema
`fieldPath` enum (`enum: [...ALLOWED_FIELDS]`). No `gen-spec.ts` code change — D4 is mechanical
(strategic prose deferred to Capability D). The drift test (`gen-spec.test.ts` /
`spec-schema.test.ts`) pins the regenerated file.

_(Minor: `FightConfig.match`'s doc-comment at `sim.ts:92–94` still says passivity has "no penalty
yet" — stale since B2. Optional one-line refresh while here; not B3's behavior.)_

## Testing strategy / observability (the tricky part)

`self.passivityRemaining` is **not** framed — the only observation channels are a bot's frame-visible
outputs (`x`/`y` via movement, chosen `action`, `points`, `stamina`, `degrade`). So the value is
observed by **gating a distinctive, frame-visible action on a comparison of the field**, and
asserting the action appears at exactly the tick the countdown crosses the constant. Two test layers,
mirroring A3:

- **Reader region (`interpret-tick.test.ts`):** one row on the existing `[fieldPath, partialState,
expected]` table — `["self.passivityRemaining", { self: { passivityRemaining: 8 } }, 8]` — pins the
  `FIELD_READERS` entry (`(s) => s.self.passivityRemaining`) directly against a hand-built `State`.
- **Derivation + integration (`run-fight.test.ts`, new describe block):** the `viewFor` countdown /
  sentinel / throw-reset, via gated idle-default bots (an idle bot is always neutral, so a gated
  `move` produces a clean visible step; a _committed_ bot's move is ignored — see the reset caveat).
  Reuse B1's `IDLE`/`ATTACKER`/`AGGRESSOR`/`RETREATER` factories.

**Observation caveats worked in RED:**

- **Exact-value pin (AC-1):** an idle bot with `when self.passivityRemaining == V do move` steps at
  exactly the one tick where `limit − clock == V` — pinning the subtraction, direction, and off-by-
  one (kills `limit − clock → limit + clock` / `clock − limit`).
- **Reset via contact (AC-2, AC-3):** a fighter that commits a connecting offense is **committed
  during recovery**, so it can't step at the reset tick. Observe the reset **indirectly but via the
  field**: after the offense, the clock restarts at 0, so a threshold gate `when
self.passivityRemaining <= T do move` fires `resetTick + (limit − T)` ticks later — the reset
  **delays** the gate by the reset offset. The no-reset mutant fires it earlier ⇒ killed. This reads
  the field the reset feeds (strictly better than B1's snap-back-only observation).
- **Throw-reset (AC-3, completes B1 AC-4):** the reset tick is the grab-active tick; test the plain
  grab **and** the stuffed/clash variants (grab voided but `aThrow !== null` still resets) — the gate-
  delay proves `aThrow` (not `aThrowFinal`) zeroed the clock.
- **The `[0]` clamp is provably equivalent (documented):** the officiating resets `ticksSinceOffense`
  the tick it exceeds `limit`, so at read time `clock ≤ limit` always ⇒ `limit − clock ≥ 0` ⇒
  `Math.max(0, …)` never fires. **AC-4 is a characterization invariant** (the value never reads
  negative across a bout), NOT a floor-forcing test; the `Math.max(0, X) → X` mutant is a **known
  equivalent** (kept as defensive code per find-gaps D1 + the codebase's meter-flooring convention;
  precedent: CLAUDE.md's documented equivalents). The `max(0, X) → max(1, X)` mutant IS killed by an
  assertion that the value reads exactly `0` at the foul-imminent tick.

## Acceptance Criteria

Verbatim from the tracker's B3 section (AC-1…AC-7). Done when all are met:

- [ ] **AC-1** — countdown when configured: bot reads `limit − k` after `k` contactless ticks (fresh ⇒ `limit`; foul-imminent tick ⇒ `0`).
- [ ] **AC-2** — resets with the clock: after a connecting offense / re-engage, the countdown restarts from `limit`.
- [ ] **AC-3** — throw resets (completes B1 AC-4): a committed throw's grab-active tick (incl. stuffed/clash) restarts the countdown — proving `aThrow !== null` zeroed the clock.
- [ ] **AC-4** — floored/characterized: the value never reads negative (stays in `[0, limit]`); the `[0]` clamp is a documented equivalent.
- [ ] **AC-5** — sentinel `0` unconfigured: absent `match.passivity`, reads `0` all bout.
- [ ] **AC-6** — actionable: a bot gating a connecting commit on the countdown (`when self.passivityRemaining <= T do attack`, `T` = the strike's startup lead, opponent in range) avoids a foul the same idling bot takes.
- [ ] **AC-7** — byte-identical absent, interpreter 100%, spec drift-clean: sentinel `0` ⇒ byte-identical replay; static reader ⇒ `dsl.ts` interpreter 100%; `docs/spec.md` regenerated (field in read-surface list + schema enum, drift test green); replay-stable + swap-symmetric present.

## Slices

One slice — a single derived read field, its two-layer tests, the B1 throw-term verification, and the
mechanical spec regen (mirrors A3's single perception PR). No REFACTOR extraction expected (the
derivation is one inline expression like `finishWindow`).

### Slice 1: A bot can read its live countdown to the passivity foul

**Value**: the bot author (and, downstream, the benchmark's LLM) — a fighter can now perceive how
close it is to a passivity foul and commit a forced re-engagement just in time, instead of being
blindly re-centered.
**Path**: `runFight` per-tick loop → `viewFor` derives `self.passivityRemaining` from the live
`ticksSinceOffense` + `match.passivity.limit` → the bot reads it via `{op:"field",
path:"self.passivityRemaining"}` through the unchanged interpreter → observable in the bot's gated
action / position. Skipped: opponent read (B4), strategic spec prose (D), canonical wiring (D).
**Required implementation skills**: before code, load `tdd`, `testing`, `mutation-testing`,
`refactoring`.
**Acceptance criteria**: AC-1…AC-7 above. **Present to human and confirm before writing any code.**
**RED**: failing tests first —

- `interpret-tick.test.ts`: add the reader-table row for `self.passivityRemaining` (fails —
  `SelfState` has no such field yet / not in `FieldPath`).
- `run-fight.test.ts` new block "runFight — self passivity read (story B3)": - _countdown value_ (AC-1): idle bot, `when self.passivityRemaining == V do move`; steps at the
  single tick `limit − clock == V`; earlier/later ticks show no step. - _foul-imminent reads 0_ (AC-1/AC-4): the value is exactly `0` at the foul-imminent tick (kills
  `max(0,X) → max(1,X)`); never negative across the bout (AC-4 characterization). - _strike reset restarts_ (AC-2): a connecting strike at tick R delays a `<= T` gate to
  `R + (limit − T)`; the no-reset baseline fires earlier. - _throw reset restarts, incl. stuffed/clash_ (AC-3, completes B1 AC-4): grab-active tick restarts
  the countdown; stuffed and clashed variants still reset (`aThrow`, not `aThrowFinal`). - _actionable_ (AC-6): a `when self.passivityRemaining <= T do attack` bot (opponent in range,
  `T` = startup lead) connects and avoids the foul the same idling bot takes. - _sentinel unconfigured_ (AC-5): absent `match.passivity`, an `== 0`-gated bot steps every tick
  from tick 0 (field is always `0`); and a `> 0`-gated bot never steps. - _byte-identical + replay + swap-symmetry_ (AC-7): a no-`passivity` run `toEqual` a pre-B3
  baseline; same-config run twice `toEqual`; swap-symmetric with roles switched.
  Likely mutants to pre-empt (mutator-rules scan): `match?.passivity` ternary cond (→true crashes on
  `match.passivity.limit` when unconfigured ⇒ AC-5 kills; →false ⇒ always 0 ⇒ AC-1 kills);
  `limit - clock` (→`+`/swap ⇒ AC-1 eq-gate kills); the `0` sentinel branch (AC-1 vs AC-5);
  `max(0, X) → max(1, X)` (foul-imminent-reads-0 kills); `max(0, X) → X` (**documented equivalent**);
  the `FIELD_READERS` reader (interpret-tick row + run-fight reads).
  **GREEN**: the four edits in Code touch points (types field → `FieldPath` + `FIELD_READERS` → `viewFor`
  param + derivation + call sites) — minimum to pass. Then `npm run gen:spec` to regenerate
  `docs/spec.md` (AC-7 drift test).
  **MUTATE**: `rm -rf .stryker-tmp reports` first (pollution artifact), then scoped Stryker (separate
  `--mutate` flags per range — comma-separated single flag misparses): the `sim.ts` `viewFor`
  derivation + `self`-object line, and the `dsl.ts` `FIELD_READERS` reader line. No `--incremental`.
  Produce killed/survived/score.
  **KILL MUTANTS**: strengthen tests for survivors. **Expected pre-declared equivalent:** `Math.max(0,
X) → X` (the clamp never fires — the officiating guarantees `clock ≤ limit` at read; documented, not
  killed). Ask the human only if any OTHER survivor's value is ambiguous.
  **REFACTOR**: none expected (the derivation is one inline expression, like `finishWindow`). Assess and
  skip unless it adds value.
  **Done when**: AC-1…AC-7 met, mutation report reviewed (changed regions ~100% bar the one documented
  equivalent), `docs/spec.md` regenerated + drift test green, typecheck + lint clean, human approves
  commit.

## Pre-PR Quality Gate

1. Mutation testing — scoped Stryker on the changed `sim.ts` (`viewFor` derivation + `self` line) and
   `dsl.ts` (`FIELD_READERS` reader) regions; `rm -rf .stryker-tmp reports` first. Note the one
   documented equivalent (`max(0,X)→X`).
2. Refactoring assessment — run `refactoring` (expected: nothing to extract; one inline derivation).
3. Full suite green (`npm test`), `npm run typecheck`, `npm run lint`.
4. Re-prove **byte-identical absent `match.passivity`** (AC-7) + replay-stable + swap-symmetric.
5. Confirm **TCB boundary held**: `dsl.ts` interpreter 100% (static reader, no new branch), **no new
   `endReason`**, `docs/spec.md` regenerated (field in read-surface list + schema enum, drift test
   green).

## Optional split (not taken by default)

Could split into **1a** the field + reader + `viewFor` derivation (countdown + sentinel, AC-1/4/5/7)
and **1b** the reset/throw-term verification (AC-2/3/6 — the B1 throw-term completion). Kept together
to mirror A3's single perception PR and because the throw-term test is small and thematically part of
"can a bot read its clock."

---

_Delete this file when the plan is complete. If `plans/` is empty, delete the directory._
