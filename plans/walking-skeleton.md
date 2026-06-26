# Plan: Walking Skeleton — deterministic, reproducible headless fight

**Branch**: `feat/walking-skeleton`
**Status**: Active
**Base note**: bases on the clean-slate restructure (`chore/clean-slate-restructure`).
Merge that to `main` first, then branch `feat/walking-skeleton` off `main` (or stack
on the restructure branch until it lands).
**Source**: story split `docs/stories/first-slice-split.md` → Slice 1.
Design source of truth: `docs/DESIGN.md` + `docs/BOT-DSL.md`.

## Goal

Two **validated** JSON bots fight a **deterministic, fixed-timestep, headless** loop
that is **bit-reproducible** from `{seed, rulesHash, botA, botB, initialConditions}`,
with a minimal combat vocabulary (1D approach + one *mid* strike that can score / be
blocked), read from a **result object + integer event log**.

## Acceptance Criteria (feature-level)

- [x] AC1 — A malformed bot (op/field off the allowlist, over-budget, bad version/name,
      proto-pollution key) is rejected with a structured `{path, reason}` issue; the
      fight does not run.
- [x] AC2 — Two valid bots + a seed run for N ticks and return a result object with a
      winner/most-points and an integer event log.
- [x] AC3 — The same config (`{rules, botA, botB, maxTicks, seed}`) reproduces a
      **byte-identical** event log on re-run.
- [x] AC4 — An aggressor that approaches and strikes an idle opponent in reach gains
      points and wins.
- [x] AC5 — Both bots decide against the **tick-T snapshot** and simultaneous strikes
      resolve order-independently (a **trade** — both in-range strikes score; swap-symmetric).
- [x] AC6 — An action returned while `canAct=0` (mid-recovery) is ignored and logged
      (commitment).

> **Invariants (do not violate — see `.claude/CLAUDE.md`):** integer/fixed-point only
> in the outcome path (`SCALE=1000`, `tickRate=60`); single seeded PRNG (mulberry32),
> no `Math.random`/`Date.now`; bots are **data, validated before run**; both fighters
> read one immutable tick-T snapshot, resolve together. **Forward-compat:** carry
> `band` (ignored in resolution) and expose latency (at 0) so later slices don't break
> already-authored bots.

## Slices

Every slice follows **RED → GREEN → MUTATE → KILL MUTANTS → REFACTOR**. No production
code without a failing test. Read `.claude/CLAUDE.md` + the testing rules first. Tests
are **vitest unit tests** (pure functions, lowest level that gives confidence) — no
browser/Playwright in this headless engine.

---

### Slice 1: Bot intake gate — validate a JSON bot, accept or reject with structured errors  ✅ DONE

> ✅ **Done** — 68 tests · mutation 76.6% (residual survivors = error-message wording +
> equivalent type-narrowing guards) · branch cov 98.3% (`dsl.ts:135-136` = documented
> defensive budget guards, unreachable until arithmetic ops land). `src/dsl.ts`,
> `src/validate-bot.test.ts`.

**Value**: a bot author submits a JSON document and learns immediately whether it is
legal, with fixable `{path, reason}` errors — the security gate (validate **before** run).
**Path**: raw text → `safeParse` (prototype-pollution-safe, byte cap) → `validate(doc)`
walks the AST against op/field/move allowlists + static `LIMITS` → `{ ok, issues,
nodeCount }`. No sim yet. (Delivers AC1.)
**Required implementation skills**: load `tdd`, `testing`, `mutation-testing`,
`typescript-strict`, `functional`, then `refactoring` at the end.
**Acceptance criteria** *(confirm before code)*:
- `version !== 1`, or `name` missing / > 64 chars → rejected with the specific issue.
- A numeric/boolean op **not** on the allowlist → rejected `{path, reason}`.
- A `field` path not on the (skeleton) allowlist → rejected.
- A `mem` read or `set` write to an **undeclared** cell → rejected.
- Over-budget docs (bytes / nodes / depth / rules / cells beyond `LIMITS`) → rejected.
- A JSON key `__proto__` / `constructor` / `prototype` → rejected by `safeParse`.
- A minimal well-formed doc → `{ ok: true, issues: [] }`.
**RED**: tests over `safeParse`/`validate` for each reject reason + the accept case.
Pre-empt mutants: **boundary flips** (`name.length` at exactly 64 vs 65; `nodeCount` at
`maxNodes` vs `maxNodes+1`), the `version !== 1` equality, `&&`/`||` in compound guards,
and the negated allowlist `.has(...)` check.
**GREEN**: minimal `safeParse` + `validate` covering only the skeleton vocabulary
(ops/fields/moves the later slices use) + `LIMITS`.
**MUTATE**: run `mutation-testing` → report.
**KILL MUTANTS**: strengthen tests for survivors (ask if a survivor's value is ambiguous).
**REFACTOR**: only if it adds value.
**Done when**: all criteria met, mutation report reviewed, human approves commit.

---

### Slice 2: Interpret one tick — a bot's policy returns exactly one Action for a state  ✅ DONE

> ✅ **Done** — 103 tests total (34 new) · interpreter 100% mutation score (63/63) ·
> branch cov 98.56% (`dsl.ts:145-146` = same documented defensive budget guards).
> Added `src/types.ts` (State/Action contract); read surface unified via
> `FIELD_READERS` + a `FieldPath` union (total readers). `div`/arithmetic + int32
> clamp **deferred** to the perception/dead-reckoning slice (NumExpr stays leaf-only).
> `src/types.ts`, `src/dsl.ts`, `src/interpret-tick.test.ts`.

**Value**: the engine turns a validated bot + a state snapshot into one deterministic
`Action` — the per-tick decision the loop will call.
**Path**: `runTick(doc, state, rules, mem)` evaluates rules top-to-bottom; the first
rule whose `when` holds and that carries a `do` returns its `Action`; `set` writes
update `mem` (a `do`-less **tracker** rule continues evaluation); no match → `default`.
Pure: same `(doc, state, mem)` → same `Action` + same `mem` mutation. Fixed-point eval
(`div ÷0 = 0`, truncate toward zero, int32 clamp).
**Required implementation skills**: `tdd`, `testing`, `mutation-testing`,
`typescript-strict`, `functional`; `refactoring` at the end.
**Acceptance criteria** *(confirm before code)*:
- First matching rule carrying a `do` wins; earlier non-matching rules are skipped.
- A tracker rule (no `do`) writes `mem` and evaluation continues to later rules.
- `div` by 0 → 0; `div` truncates toward zero (assert a negative quotient); results
  clamp to int32.
- A `field` over a boolean state leaf reads as `1`/`0`.
- No rule matches → returns `default`.
**RED**: tests over `runTick`/`evalNum`/`evalBool`: rule ordering, tracker continuation,
div/clamp semantics, boolean-as-1/0, default fallback. Pre-empt mutants: short-circuit
`every`/`some` for `and`/`or` (mixed-truth inputs), comparison swaps (`gt`/`gte` with
**equal** operands), the `?? 0` default on an unset `mem`, truncation direction.
**GREEN**: minimal interpreter + the `State`/`Action`/`Rules` types it needs in
`src/types.ts` (single source of truth).
**MUTATE / KILL MUTANTS / REFACTOR / Done when**: as Slice 1.

---

### Slice 3: A fight runs and is bit-reproducible — fixed-length loop, event log, identical replays  ✅ DONE

> ✅ **Done** — 116 tests total (13 new) · `sim.ts` mutation 97.87% (the one survivor is
> a proven equivalent: `dir/facing ≡ dir*facing` since `facing ∈ {±1}`) · branch cov
> 98.62%. Delivers AC2, AC3, and the same-pre-tick-snapshot half of AC5. Added
> `src/sim.ts` (`runFight`/`viewFor`) and the `Rules` frame table in `types.ts`.
> Deferred (as agreed): PRNG (no randomness consumed yet), commitment (Slice 4),
> dedicated replay/`rulesHash` field. `src/sim.ts`, `src/types.ts`, `src/run-fight.test.ts`.

**Value**: the platform's core promise — two validated bots fight a fixed-timestep
deterministic loop and the same inputs reproduce the fight **byte-for-byte**. Movement +
commitment only; no hits yet. (Delivers AC2, AC3, and the snapshot half of AC5.)
**Path**: `runFight(cfg)` → seed mulberry32; build the initial world (fixed-point
positions, facing); per tick: take an **immutable** tick-T snapshot → `viewFor(A)` /
`viewFor(B)` (self live; opponent live at `L=0`) → `runTick` both → **resolve together**
(apply `move`/`idle`, commitment lock, auto-facing) → append an integer event → advance.
Returns `{ winner: "draw", ticks, events, replay }`. Re-running the same `cfg` → identical
`events`.
**Required implementation skills**: `tdd`, `testing`, `mutation-testing`,
`typescript-strict`, `functional`; `refactoring` at the end.
**Acceptance criteria** *(confirm before code)*:
- A fight of `maxTicks` completes and returns an event log of the expected length.
- Same `cfg` run twice → **byte-identical** event logs (serialized deep-equal).
- Each tick, both bots' actions are computed from the **same pre-tick snapshot**
  (a bot reading `opponent.x` sees the pre-tick value even if the opponent moves that tick).
- A bot issuing `move` changes its fixed-point `x` by the rules' walk speed, **clamped**
  to the ring edges.
- No floats appear anywhere in the event log (integer outcome path).
**RED**: golden-log determinism test (run twice, compare serialized logs);
snapshot-isolation test (one bot reads `opponent.x`, the other moves — both see pre-tick
`x`); ring-clamp test (move into the edge). Pre-empt mutants: loop bound `<` vs `<=` on
`maxTicks` (assert **exact** event count), in-place vs copied snapshot (sequential
mutation would leak B's move to A — the isolation test catches it), walk-speed
sign/magnitude, clamp boundary (exactly at the edge).
**GREEN**: minimal `runFight` + `viewFor` + mulberry32 + fixed-point movement.
**MUTATE / KILL MUTANTS / REFACTOR / Done when**: as Slice 1.

---

### Slice 4: A strike that scores — aggressor lands a hit and wins on points  ✅ DONE

> ✅ **Done** — 124 tests total (8 new) · `sim.ts` mutation 94.4% (7 accepted survivors:
> 4 forward-compat self-fields `phaseRemaining`/`canAct` not outcome-observable until
> cancels, the `dir/facing` equivalent, 2 moot active-window end-boundary mutants) ·
> branch cov 98.81%. Adds the attack state machine (startup→active→recovery),
> once-per-activation scoring, commitment, win-by-points; `MoveSpec`/`Rules.moves`.
> Delivers AC4 + AC6. `src/sim.ts`, `src/types.ts`, `src/run-fight.test.ts`.

**Value**: the first real combat behavior + scoring + winner — an aggressor that
approaches and strikes an idle opponent in reach gains a point and wins. (Delivers AC4, AC6.)
**Path**: extend the frame table with one strike (`startup/active/recovery/score/reach`);
during its `active` frame, if `|opp.x − self.x| ≤ reach` and the opponent is **not**
blocking, award the strike's `score` (here `+1`) **once per activation**, log a `hit`
event; commitment runs the move to end of `recovery`. Outcome: higher points at
`maxTicks` wins, else `draw`.
**Required implementation skills**: `tdd`, `testing`, `mutation-testing`,
`typescript-strict`, `functional`; `refactoring` at the end.
**Acceptance criteria** *(confirm before code)*:
- Aggressor (approach + strike) vs idle-in-reach → attacker points increase by exactly
  the strike's score per landed strike; attacker wins.
- A strike whose active frame is **out of reach** → no point (whiff).
- A strike scores **at most once** per activation (a multi-tick active window cannot
  double-count).
- An action returned while `canAct=0` (mid-startup/active/recovery) is ignored and logged.
- Determinism / replay equality still holds with scoring.
**RED**: scoring test; whiff test at the reach boundary (`reach` vs `reach+1`);
once-per-activation test (≥2-tick active window); commitment test. Pre-empt mutants:
reach comparison `≤` vs `<` (test **exactly** at reach), removing the once-per-activation
latch (over-counts — the multi-frame test catches it), the score magnitude, winner
comparison `>` vs `>=` (a tie must be a `draw`).
**GREEN**: minimal hit detection + scoring + winner determination.
**MUTATE / KILL MUTANTS / REFACTOR / Done when**: as Slice 1.

---

### Slice 5: Block negates a strike, and simultaneous strikes resolve by a fixed tiebreak  ✅ DONE

> ✅ **Done** — 130 tests total (6 new) · `sim.ts` mutation 95.17% (137 killed, 1 timeout,
> 7 accepted survivors: 4 forward-compat self-fields `phaseRemaining`/`canAct`, the
> `dir*facing` equivalent, 2 moot active-window end-boundary mutants) · coverage 100%
> lines/funcs. A free-to-act fighter that chose `block` guards (negates an in-reach
> active strike); a **committed** fighter cannot guard. Simultaneity resolves as a
> **trade** (both in-range strikes score) — chosen over an arbitrary startup-tiebreak as
> the non-speculative, swap-symmetric outcome; locked by a swap-symmetry test. Adds the
> `defGuarding` param to `resolveHit` + `aGuarding`/`bGuarding` (pre-intake snapshot).
> Completes AC5. `src/sim.ts`, `src/run-fight.test.ts`.

**Value**: completes the skeleton's combat read — a correctly-held `block` prevents the
score, and two bots striking on the same tick resolve deterministically regardless of
evaluation order. (Completes AC5.)
**Path**: add a `block` state (raise frames from rules); an attacker's active frame
against a **blocking** defender scores 0 and logs a `blocked` event. Same-tick
resolution: both strikes are computed from the tick-T snapshot, then resolved together by
a **documented total order** (e.g. effective `startup`, then a fixed tiebreak) that is
**swap-symmetric** — swapping which bot is A/B yields the mirrored, consistent result.
**Required implementation skills**: `tdd`, `testing`, `mutation-testing`,
`typescript-strict`, `functional`; `refactoring` at the end.
**Acceptance criteria** *(confirm before code)*:
- Striker vs a defender holding `block` → no point; a `blocked` event is logged.
- Two bots both striking in range on the same tick → a single documented outcome that
  does **not** depend on which bot is "A" (run with A/B swapped → mirrored result).
- Same-tick decisions never read the opponent's same-tick action (re-asserted with both
  acting).
- Determinism / replay equality holds with block + simultaneity.
**RED**: block-negates-score test; simultaneity **swap-symmetry** test (swap botA/botB,
assert mirrored result); snapshot-isolation re-assertion under mutual aggression.
Pre-empt mutants: the block-check negation, the tiebreak comparator (swapping operands —
symmetry test catches asymmetry), and resolve-together vs resolve-sequentially (sequential
breaks swap-symmetry).
**GREEN**: minimal block resolution + the documented simultaneity tiebreak.
**MUTATE / KILL MUTANTS / REFACTOR / Done when**: as Slice 1.

## Pre-PR Quality Gate

Before each PR: (1) run `mutation-testing`; (2) run `refactoring` assessment;
(3) `npm run typecheck` + `npm test` green; (4) confirm no float entered the outcome
path and no `Math.random`/`Date.now` was introduced.

---
*Delete this file when the plan is complete. If `plans/` is empty, delete the directory.*
