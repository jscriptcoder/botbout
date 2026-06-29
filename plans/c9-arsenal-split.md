# C9 — Multi-move "real karate" arsenal · story split

> Pre-planning artifact (`story-splitting`). Decomposes the **resolved** C9 design
> (`docs/DESIGN.md` §P7) into small vertical child stories. Each child becomes a
> `planning` pass → PR-sized slices → TDD. **Not** a component breakdown: every
> child is a new tactical capability the bot author can exercise and a `runFight`
> test can demonstrate.

## ⏱ Status / Resume (updated 2026-06-29) — READ FIRST

**This is the single active C9 tracker.** (The Slice 1–2 detail plan
`c9-arsenal-foundation.md` was deleted on closeout — its record is in PRs #67/#68; its
durable learnings are folded in below.)

- ✅ **Slice 1 — band-legality gate** — MERGED (PR #67). `MoveSpec.bands?: Band[]` +
  `bandLegal` intake guard at both move-start sites; an out-of-band `attack` degrades to
  idle. Absent `bands` ⇒ unrestricted (byte-identical); `[]` ⇒ always fizzles.
- ✅ **Slice 2 — `kizami-zuki` jab** — MERGED (PR #68). `MoveId = "strike" | "kizami-zuki"`;
  `MOVES` allowlist (TCB) admits it; `Rules.moves` gains optional `"kizami-zuki"?`. Both
  attack-start sites capture `const spec` once + guard `spec !== undefined` ⇒ an attack
  naming an **unconfigured** move degrades to idle (inert, like sweep/throw).
- ▶ **NEXT — Slice 3 — `gyaku-zuki` (reverse punch).** Not yet drafted. Run the loop:
  `planning` (new file `plans/c9-gyaku-zuki.md`, branch off `main`) → `find-gaps` → TDD.

**Per-technique pattern (established S2 — S3/S4 are mechanical):** to add a technique:
(1) extend the `MoveId` union (`types.ts`); (2) add it to the `MOVES` allowlist
(`dsl.ts:121` — the **TCB**, keep at 100% mutation); (3) add the optional
`"<id>"?: MoveSpec` key to `Rules.moves` (`types.ts`); (4) configure it in a **test
fixture** (NOT `CANONICAL_RULES` — canonical wiring is Slice 7); (5) `runFight` behavior
tests (in-reach scores · out-of-band fizzles via the Slice-1 gate · beyond-reach whiffs ·
unconfigured ⇒ inert). The `sim.ts` resolver already handles all of this generically —
**no resolver change** for S3/S4. New mechanics remain: **band-dependent score** (S5,
additive `scoreByBand?`) and **cross-move cancels** (S6). `dsl.ts` reader/validator at
100%; `sim.ts` changed-line ~100% (one documented equivalent on the C6 `cancelInto ?? []`
fallback at `sim.ts`). Validator scope: it accepts any valid `move`+`band`; the runtime
gate decides legality (no static out-of-band reject).

## Parent

**Actor:** the LLM bot author (and, downstream, anyone watching/replaying a fight).
**Capability:** choose among **distinct named WKF techniques** with real trade-offs
(reach / speed / score / stamina cost / legal height-bands + cross-move cancel routes)
instead of one abstract `strike`.
**Outcome:** spacing, height-reads, and combos become genuine decisions — the
read-game the perception keystone + height bands set up finally has an arsenal to
play it with.
**Current constraint:** too large for one PR — it touches the TCB allowlist
(`dsl.ts`), the `MoveId`/`MoveSpec`/`Rules.moves` contract (`types.ts`), the resolver
(`sim.ts`), and `CANONICAL_RULES` (`rules.ts`); and it introduces two genuinely new
engine behaviors (the band-legality gate; band-dependent score). Must land
**additively, preserving green tests** — the abstract `strike` is scaffolding,
retired only in the final slice.

## Recommended First Slice

**Out-of-band attacks fizzle + the bot can throw the jab (`kizami-zuki`).** Introduce
the multi-move schema (the `MoveId` union, record-keyed `Rules.moves`, `MoveSpec.bands`,
and the `MOVES` allowlist as the roster) and the **band-legality runtime gate** (an
`attack` whose `band ∉ move.bands` degrades to `idle`), proven end-to-end by adding the
first named technique — the jab: short reach, `high·mid`, fast, cheap, 1 point —
**alongside** the still-present abstract `strike`.

**Why this first:** it burns the integration/architecture risk early (the TCB
boundary + the contract reshape + the one new resolver behavior, all in one thin
end-to-end whole), and it makes `bands[]` real — without the gate, `bands[]` is dead
data (a horizontal slice). After it, every remaining technique is a thin additive
slice. Demonstrable on canonical: a bot's `kizami-zuki` scores at `mid`, fizzles to
`idle` at `low`; all existing `strike` tests stay green.

> Thinner alternative (planning's call): ship the bare gate first against a
> `bands`-restricted `strike` (CANONICAL stays byte-identical until a move restricts
> bands), then the jab. Splits "the gate mechanic" from "the union expansion" into two
> even smaller TDD increments. Recommended only if the combined PR feels too big.

## Split Candidates

| # | Slice (child story) | Value | Includes | Defers | Acceptance examples | Release |
|---|---|---|---|---|---|---|
| 1 ✅ | **Out-of-band attacks fizzle (band-legality gate)** + multi-move schema [MERGED #67] | Height becomes a per-move constraint (you can't strike a band a move can't reach); the foundation the rest rests on | `MoveSpec.bands: Band[]`; `MoveId` becomes a union; `Rules.moves` record-keyed (sweep stays optional); `MOVES` allowlist = the roster; intake degrades an out-of-band `attack` → `idle` (no startup/spend/score) | Telemetry emission on fizzle (telemetry object NOT YET BUILT); per-move score>1; band-dependent score | Given a move with `bands:["high","mid"]`, When a bot attacks `low`, Then it is `idle` (no commitment, no stamina spend). Within-band attack resolves exactly as today (byte-identical) | Shippable; inert on CANONICAL until a move restricts bands |
| 2 ✅ | **Bot can throw the jab (`kizami-zuki`)** [MERGED #68] | First real technique: a fast, cheap, short-range high/mid poke — a distinct opener | `kizami-zuki` MoveSpec (short reach < strike, `["high","mid"]`, score 1, low staminaCost, own startup/active/recovery); added to roster + allowlist + a test rules fixture; demonstrates slice 1's gate on a real move | Reach hierarchy vs other moves; canonical wiring of jab numbers | Given canonical+jab fixture, When the bot lands `kizami-zuki` at `mid` in range, Then +1 point; When it attacks `low`, Then `idle`; When out of (short) reach, Then whiff | Shippable; jab present alongside `strike` |
| 3 | **Bot can throw the reverse punch (`gyaku-zuki`)** | A longer-range, more-committed second opener → a real reach/speed spacing choice between two punches | `gyaku-zuki` MoveSpec (reach > jab, slower/more recovery, `["high","mid"]`, score 1, higher staminaCost); establishes the **reach hierarchy** jab < reverse | The kicks; band-dependent score | Given jab reach < reverse reach, When the bot is at a gap only the reverse reaches, Then jab whiffs and reverse hits. Reverse's longer recovery is whiff-punishable per the master inequality | Shippable |
| 4 | **Bot can throw the front kick (`mae-geri`)** | First single-band move + first 2-point (waza-ari) strike; deeper reach than punches | `mae-geri` MoveSpec (reach > punches, `["mid"]` only, score 2, kick-tier staminaCost); the gate now bites at **both** high and low | Band-dependent score; canonical re-tune | Given `mae-geri bands:["mid"]`, When attacked `high` or `low`, Then `idle`; When landed `mid` in range, Then +2 | Shippable |
| 5 | **Bot can throw the roundhouse (`mawashi-geri`) for band-dependent points** | The risk/reward apex: longest reach, slowest, costliest; **3 jodan / 2 chudan** — aiming high is worth ippon but easier to block / whiffs a croucher | `mawashi-geri` MoveSpec (longest reach, slowest, highest staminaCost, `["high","mid"]`); introduces **band-dependent score** (the only new mechanic here — see parking lot for shape) | Cross-move cancels; canonical re-tune | Given roundhouse, When landed `high`, Then +3; When landed `mid`, Then +2; When attacked `low`, Then `idle`. A high roundhouse is blocked by a `high` guard / whiffs a croucher | Shippable |
| 6 | **Bot can chain techniques via cross-move cancels** | Combos: a hit-confirmed technique cancels into a *different* one (the rekka routes) — within-exchange escalation across the roster | Canonical `cancelInto` routes between distinct moves (e.g. jab→reverse→roundhouse); a `runFight` proof that cross-move cancel resolves and preserves the **no-feint / connect-required** property (whiff/parry never opens it) | The exact tuned route table (canonical-content, lands here or in slice 7) | Given a jab that connects with jab.cancelInto⊇[reverse], When the bot returns `gyaku-zuki` within `cancelWindow`, Then recovery is interrupted into it; When the jab whiffed, Then the cancel is ignored | Shippable |
| 7 | **Platform fights the arsenal: canonical wiring + stamina re-tune + retire `strike`** | The platform (`npm run fight`, future API/viewer) fights real karate on the 4-strike roster; the abstract `strike` scaffold is gone | Wire all 4 techniques into `CANONICAL_RULES` (reaches `throw<sweep<jab<reverse<front<roundhouse` around the locked anchors; per-move staminaCost cheap-jab→expensive-roundhouse); re-prove the gas band `basic ≤ gasThreshold < special` and the master inequalities by relationship tests; **remove `strike`** from `MoveId`/`moves`/allowlist; migrate engine `getMockRules`/fixtures off `strike` | Match structure, air-actions, telemetry (separate roadmap items) | Given CANONICAL_RULES, the relationship tests hold (every committed startup ≥ lAct+1; reach hierarchy; gas band); `strike` is no longer a valid `MoveId`; full suite green | Shippable — C9 complete |

## Resolved (session 2026-06-29)

- **Move-id naming → Japanese** (`kizami-zuki`, `gyaku-zuki`, `mae-geri`,
  `mawashi-geri`). Reconcile BOT-DSL.md's illustrative `jab`/`kick`/`roundhouse`
  examples in slice 1's doc refresh.
- **Band-dependent score → additive optional `MoveSpec.scoreByBand?: Partial<Record<Band,
  number>>`** (overrides the flat `score` per band; only `mawashi-geri` sets it →
  byte-identical preserved). Lands in slice 5.
- **Gate semantics → runtime-degrade-to-idle.** An `attack` whose resolved `band ∉
  move.bands` degrades to `idle` at runtime (band is often a dynamic DSL expression).
  Slice 1 does **runtime-only**; a literal-band static validator reject is an optional
  later hardening (BOT-DSL.md:138), not slice-1 scope.
- **find-gaps cadence → per story.** Run `find-gaps` on each slice's plan after
  `planning`, before TDD — starting with Slice 1.

## Parking Lot — remaining decisions for `planning`

1. **`strike` retirement timing.** Keep the abstract `strike` through slices 1–6 (so
   every prior test stays green) and remove it only in slice 7. Confirmed by the
   "additively, preserving green tests" design constraint — flagged so planning doesn't
   rename early.
2. **`Rules.moves` shape.** `Partial<Record<MoveId, MoveSpec>>` vs explicit optional
   keys (today: `{ strike; sweep? }`). The roster grows additively; sweep + (interim)
   strike stay optional. Pin the exact type in slice 1.
3. **Reach magnitudes.** Locked anchors: `throw 120k < sweep 180k < strike 240k`. The 4
   strikes slot a hierarchy around 240k (e.g. jab < reverse ≈ old-strike < front <
   roundhouse). Keep new-move numbers in per-slice **test fixtures** until slice 7's
   canonical re-tune (mirrors how C10 kept costs in fixtures until its canonical-wiring
   unit) — avoids re-tuning canonical on every slice.

## Warnings

- **Don't ship `bands[]` as data without the gate** (slice 1) — that's a horizontal
  slice (dead field, no behavior). The field and the rule are one indivisible increment.
- **These are capabilities, not component tasks.** Each technique slice is a new
  tactical option (passes the "real actor" check: actor = bot author / fight outcome),
  not "add a row to the table." Resist relabeling them as schema chores.
- **Don't force canonical re-tuning into every slice.** New moves live in test fixtures
  per slice; CANONICAL changes once, in slice 7 — keeps each slice's blast radius small
  and the relationship tests stable.
- **TCB caution (slice 1).** The `MOVES` allowlist in `dsl.ts` IS the security boundary
  for `attack.move`. Expanding it to the union is the load-bearing TCB change — keep the
  `dsl.ts` interpreter at 100% mutation as the prior slices did.
- Slice 6 (cross-move cancel) depends on ≥2 techniques (slices 2–3). All others are
  linearly additive; order 1→7 is the natural dependency chain.

## Next Step

**Slice 3 — `gyaku-zuki` (reverse punch).** Run the per-slice loop: `planning` (new file
`plans/c9-gyaku-zuki.md`, branch off `main`) → `find-gaps` → `tdd` + `testing` +
`mutation-testing` + `refactoring` (RED-GREEN-MUTATE-KILL MUTANTS-REFACTOR) → present →
PR. Use the **per-technique pattern** in the Status section above — S3 is mechanical
(reach > jab establishes the reach hierarchy; `high·mid`; score 1). Then S4 (`mae-geri`),
S5 (`mawashi-geri` + band-dependent score), S6 (cross-move cancels), S7 (canonical wiring
+ retire `strike` + docs reconciliation). The session-resolved defaults (Japanese ids,
additive `scoreByBand?`, runtime gate, per-slice find-gaps) hold throughout.
