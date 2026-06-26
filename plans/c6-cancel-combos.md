# Plan: C6 — On-contact cancel combos

**Branch**: one per slice — `feat/c6-cancel-on-hit`, `feat/c6-cancel-on-block`, `feat/c6-cancel-window-read`
**Status**: Active
**Capability**: C6 (roadmap `docs/stories/first-slice-split.md`). Follows C5 (parry windows, PRs #23–#25).

## Goal

A strike that **connects** (hit, then block) may **cancel into** a follow-up attack
before its recovery ends — escalating the within-exchange score — while a strike that
**whiffs or is parried** cannot (the no-feint / pure-perception property, `docs/DESIGN.md`
§3).

## Context (read before slicing)

- **Design source of truth:** `docs/DESIGN.md` §3 (combos — on-contact cancels only) and
  §11 (combat resolution order). §11.3/§11.5 name **`CancelEnable` on hit/block** as a
  *documented, deferred insertion point* — C6 is the slice that builds it. §11.3 makes the
  **BLOCK vs WHIFF distinction first-class** precisely because "cancels fire on hit or block,
  never whiff."
- **The §11 compute-then-apply union is already live (built in C5).** `computeStrike` (pure,
  reads the frozen post-intake snapshot) → `applyStrike` (mutates). **`CancelEnable` is a
  self-targeted effect** (it opens a window on the *attacker*), so C6 slots into the existing
  spine **without** restructuring it — no new cross-fighter machinery (throws are that
  test-forcing consumer, later).
- **C6 mirrors C5's three-slice shape:** (1) build the mechanic on the primary trigger,
  (2) widen the trigger, (3) expose the live window as a `self.*` read so a bot can act on it.
  C5: deflect → counter-bonus → `self.counterWindow`. C6: cancel-on-hit → cancel-on-block →
  `self.cancelWindow`.
- **No real frame table yet** (`MoveId = "strike"` only; concrete moves live in test mocks).
  The cancel is demonstrated as a **self-cancel** (`strike → strike`): the follow-up is another
  `strike` whose route is listed in the move's own `cancelInto`. This proves "recovery is
  skipped / the chain lands earlier" with **no `MoveId` expansion** (a multi-move arsenal +
  distinct cancel routes is a later, additive slice). The `cancelInto` *route list* is still
  exercised as a real gate (an empty list ⇒ no cancel).
- **New `Rules`/`MoveSpec` config (all optional ⇒ absent = inert = byte-identical to C5):**
  - `MoveSpec.cancelInto?: MoveId[]` — the moves this move may cancel into (route allowlist).
    Absent/empty ⇒ no routes.
  - `Rules.cancelWindow?: number` — ticks the cancel window stays open after a connect.
    Absent/`0` ⇒ no cancel.
- **The cancelable window** is tied to the connecting move and follows the **`counterRemaining`
  precedent** (C5): set on connect, decremented once per tick, read live. It opens on the
  attacker; a fired cancel starts a fresh move (window resets to closed until *that* move
  connects). **Parry and whiff never open it.**
- **Intake gets the one surgical exception to commitment:** today `intake` honours an action
  only when `state.kind === "neutral"`. The cancel is the deliberate exception — a committed
  (`canAct = 0`) fighter whose move is **cancelable** *and* whose returned `attack` is a **legal
  route** starts the follow-up, interrupting the recovery. Every other committed action stays
  ignored.

## Acceptance Criteria

- [x] A strike that **HITs**, with the bot returning a legal cancel-route `attack` during the
      cancel window, starts the follow-up **before the first move's recovery ends** — the
      follow-up's active frame lands earlier than a re-strike-when-free baseline. _(Slice 1)_
- [x] The **same** follow-up attempted after a **WHIFF** (out of reach / vacated band) is
      **ignored** — the move runs full recovery; no early follow-up. _(Slice 1)_
- [x] A **parried** strike does **not** become cancelable — the follow-up is ignored and the
      attacker eats full `parryRecovery` (cancel never rescues a parry). _(Slice 1)_
- [ ] A strike **BLOCKed** by a stale matching guard becomes cancelable too (block is a
      first-class connect alongside hit); whiff and parry still do not. _(Slice 2)_
- [x] The cancel is gated by the **route list**: with the move's `cancelInto` empty, even a
      connecting strike + follow-up `attack` does **not** cancel. _(Slice 1)_
- [ ] A bot can read its **live cancel window** (`self.cancelWindow`) and hit-confirm — issue
      the follow-up only when the window is open, choosing a different action on whiff. _(Slice 3)_
- [x] With `cancelWindow`/`cancelInto` absent, the engine is **byte-identical** to the C5
      engine (the standard inertness guarantee). _(Slice 1; re-verified per later slice)_
- [x] Cancel timing is **swap-symmetric** (identical whether the canceller is fighter A or B). _(Slice 1)_

## Slices

Every slice follows RED-GREEN-MUTATE-KILL MUTANTS-REFACTOR. No production code without a
failing test. Read `.claude/CLAUDE.md` (invariants #1–#4, determinism/integer-only) and the
`testing` rules before writing any slice.

---

### Slice 1: A connecting (HIT) strike can cancel its recovery into a follow-up; a whiff cannot · ✅ done

> **Shipped** on `feat/c6-cancel-on-hit` — `feat` (b3cd8c8) + `refactor: extract startAttack`
> (216e84c). 8 cancel tests (214 suite); `sim.ts` mutation **95.00%** (the window-length test
> kills the decrement mutant; 3 cancel-region survivors are equivalent type-narrowing guards).
> `MoveSpec.cancelInto` + `Rules.cancelWindow` added (absent ⇒ byte-identical to C5).

**Value**: A bot author gets real combos — a hit-confirmed follow-up that escalates the
within-exchange score, with the no-feint property intact (the cancel exists only because the
opponent *already perceived* the hit connect).

**Path**: `runFight` loop → tick T: striker's `strike` HITs (`computeStrike` → `applyStrike`)
→ **`CancelEnable`**: the attacking move opens a cancel window (`cancelWindow` ticks, on the
attacker; `counterRemaining`-style countdown) → tick T+k: `intake` sees the committed striker
is cancelable *and* its returned `attack` is in `rules.moves[move].cancelInto` → replaces the
attacking state with a fresh follow-up (`elapsed 0`, `scored false`), interrupting recovery →
the follow-up's active frame lands earlier than a non-cancelled re-strike → observable in the
event log (`attackTicks`) + escalated `scores`. **Skipped this slice:** block-enables-cancel
(Slice 2), the `self.cancelWindow` read (Slice 3 — Slice 1's bot cancels *blindly*, spamming
the follow-up every tick; the engine gates it). Whiff/parry must **not** open the window.

**Required implementation skills**: Before code, load `tdd`, `testing`, `mutation-testing`,
`refactoring`.

**Acceptance criteria** (confirm before code):
1. **On hit, the chain lands early.** Striker hits an in-range idle opponent; returning a
   `strike` (a listed `cancelInto` route) during the window starts the follow-up mid-recovery,
   so its active frame / second score arrives **earlier** than the `restrikeWhenFree`
   baseline (which waits the full move + recovery).
2. **On whiff, no cancel.** The same blind-follow-up bot striking an **out-of-reach** (or
   `crouch`-vacated-band) opponent is **ignored** while committed — the move runs full recovery;
   no early follow-up, no extra score.
3. **Parry does not enable cancel.** Against a fresh matching guard (PARRY, C5 config present),
   the follow-up is ignored and the attacker eats the full `parryRecovery` (same as C5's parry
   test — the cancel must not rescue it).
4. **Route gate.** With `strike.cancelInto = []` (empty), a hit + blind follow-up does **not**
   cancel (full recovery) — proving the route-membership check is live, not dead.
5. **Inertness.** With `cancelWindow` absent, behaviour is byte-identical to the C5 engine
   (a connecting strike never becomes cancelable).
6. **Swap-symmetric.** The cancelled follow-up's `attackTicks` are identical whether the
   canceller is fighter A or B.

**RED**: In `run-fight.test.ts`, a new `describe("runFight — on-contact cancel combos (a
connecting strike can cancel into a follow-up)")`. Reuse `restrikeWhenFree` /
`attackTicks` helpers. Add `cancelRules(o?)` = `getMockRules({ cancelWindow: N,
moves: { strike: { …, cancelInto: ["strike"] } }, … })`. First failing test: AC-1 — assert the
follow-up's `attackTicks[1]` is the *cancelled* (early) tick, not the full-recovery tick.
**Likely mutants to pre-empt** (`mutation-testing` `resources/mutator-rules.md`): window boundary
(`cancelRemaining > 0` vs `>= 0`), the `cancelInto.includes(move)` membership (→ always
true/false), the connect-gate equality (only HIT opens — not parry/whiff), the per-tick decrement
(off-by-one), and the `cancelWindow ?? 0` inertness guard. Pin each with a test (the route-gate,
parry-no-cancel, whiff-no-cancel, and boundary cases cover them).

**GREEN**: Minimum engine change in `sim.ts`:
- `types.ts`: add `MoveSpec.cancelInto?: MoveId[]` and `Rules.cancelWindow?: number`.
- A cancelable window on the attacking move (set on HIT in `applyStrike`, `counterRemaining`-style
  countdown; **parry/whiff leave it closed**).
- `intake`: honour an `attack` from a **committed** fighter iff its move is cancelable *and* the
  returned move ∈ `rules.moves[committedMove].cancelInto` — replace the attacking state with a
  fresh follow-up. All other committed actions stay ignored.

**MUTATE**: Run `mutation-testing` (diff-against-main on `sim.ts`/`types.ts`) — produce a report.
**KILL MUTANTS**: Address survivors; ask the human if a survivor's value is ambiguous.
**REFACTOR**: Assess only if it adds value (e.g. a small `canCancelInto(att, action, rules)`
predicate if `intake` gets crowded — keep it pure).
**Done when**: all six ACs met, mutation report reviewed (`sim.ts` stays ~95%+), typecheck +
lint pass, human approves commit.

---

### Slice 2: A BLOCKed strike is also cancelable (block becomes a first-class connect)

**Value**: A bot author gets **frame-trap pressure** — a blocked attacker can keep its turn by
cancelling into a follow-up, where a whiffing one cannot. This is the §11.3 "BLOCK is
first-class now" payoff.

**Path**: tick T: striker's `strike` lands on a **stale** matching guard → `computeStrike` now
classifies it **BLOCK** (a first-class outcome) instead of returning `null` → `applyStrike`
opens the cancel window on the attacker (no score, as today) → the rest is Slice 1's machinery.
**Skipped this slice:** blockstun / pushback numerics on the defender (still deferred — BLOCK
remains "no score, no stun" *except* it now enables cancel); the `self.cancelWindow` read.

**Required implementation skills**: `tdd`, `testing`, `mutation-testing`, `refactoring`.

**Acceptance criteria** (confirm before code):
1. **Block enables cancel.** Striker hits a **stale** matching guard (BLOCK, age past
   `parryWindow`); the blind follow-up **chains** (lands early), escalating tempo with **no
   score** (block scores nothing).
2. **Parry still does not.** A **fresh** matching guard (PARRY) still leaves the move
   uncancelable (Slice 1's AC-3 still green) — the trigger is hit *or block*, never parry.
3. **Whiff still does not** (Slice 1 AC-2 still green).
4. **Inertness unchanged.** With `cancelWindow` absent, a blocked strike is byte-identical to
   the C5 engine (block stays a no-effect `null`).
5. **Swap-symmetric** for the block-cancel path.

**RED**: New tests in the C6 `describe` (or a nested `describe` for the block trigger). A
defender holding a stale matching guard (`guardFrom(0, "mid")` — age past window ⇒ BLOCK) +
`restrikeWhenFree`-style blind follow-up; assert the follow-up `attackTicks` is the early
(cancelled) tick and `scores` stay 0. **Likely mutants**: the BLOCK branch returning the new
"block-connect" outcome vs `null` (the core change — pin with the chains-on-block assertion);
the parry-vs-block boundary (`guardAge <= parryWindow`) must still route fresh→parry (no cancel),
stale→block (cancel).

**GREEN**: `computeStrike`'s stale-guard branch returns a **BLOCK** outcome (a connect that
opens the cancel window, no score) instead of `null`; `applyStrike` opens the window for both
HIT and BLOCK, **not** parry/whiff. Smallest change to the outcome union (e.g. add a `block`
result, or fold "opens cancel" into a shared connect flag).

**MUTATE / KILL MUTANTS / REFACTOR**: as Slice 1.
**Done when**: all ACs met, Slice 1 tests still green, mutation report reviewed, typecheck +
lint pass, human approves commit.

---

### Slice 3: A bot can read its live cancel window (`self.cancelWindow`) and hit-confirm

**Value**: A bot author can **condition** the cancel on a confirmed connect — issue the
follow-up only when the window is open and do something else (guard, reposition) on whiff —
instead of blindly spamming the follow-up. This is the realistic hit-confirm combo, mirroring
C5's `self.counterWindow` read.

**Path**: tick T+k: `viewFor` exposes the attacker's live cancel window as `self.cancelWindow`
(numeric ticks remaining, `0` = closed — live, self is always perceived live, no latency) →
`dsl.ts` adds `"self.cancelWindow"` to `FieldPath` + `FIELD_READERS` → a bot's rule
`gt(self.cancelWindow, 0)` fires the follow-up only on a confirmed connect.

**Required implementation skills**: `tdd`, `testing`, `mutation-testing`, `refactoring`.

**Recommended read surface** (confirm in ACs — see "Decisions to confirm" below): expose
**`self.cancelWindow`** (numeric ticks-remaining, `0` = closed), exactly mirroring C5's
`self.counterWindow`. `canCancel` is then derivable as `self.cancelWindow > 0`.

**Acceptance criteria** (confirm before code):
1. **Window is readable and live.** `self.cancelWindow` reads `0` while no move is cancelable,
   becomes positive the tick after a connect, and counts down each tick to `0` (mirroring the
   `self.counterWindow` countdown semantics from C5).
2. **Hit-confirm works.** A bot whose follow-up rule is gated on `gt(self.cancelWindow, 0)`
   chains on a HIT but, on a WHIFF, the window stays `0` so it issues its **default/other**
   action (proving it read the confirm rather than spamming).
3. **DSL exposure.** `"self.cancelWindow"` is on the field allowlist (`validate` accepts a bot
   reading it; the interpreter returns the live value); a bot reading it is accepted.
4. **Inertness.** With `cancelWindow` absent the field reads `0` always; byte-identical engine.
5. (Carried) Slices 1–2 behaviour unchanged.

**RED**: A `dsl`/`interpret-tick`-level test that a bot reading `self.cancelWindow` validates
and interprets to the live value; plus a `run-fight` test with a **hit-confirm bot** (rule:
`when gt(self.cancelWindow, 0) do attack strike`, default `idle`) — assert it cancels on hit
and stays idle on whiff. **Likely mutants**: the `viewFor` wiring (`self.cancelWindow:
<source>` → mutate source to constant `0`; pin with the live-value test), the field reader, and
the `> 0` gate in the bot path.

**GREEN**: `types.ts` `SelfState.cancelWindow: number`; `sim.ts` `viewFor` populates it from the
attacker's live cancel window; `dsl.ts` adds the `FieldPath` + `FIELD_READERS` entry. (Exactly
the C5 `self.counterWindow` change set.)

**MUTATE / KILL MUTANTS / REFACTOR**: as before.
**Done when**: all ACs met, mutation report reviewed, typecheck + lint pass, human approves
commit. Then update `.claude/CLAUDE.md` Status + `docs/stories/first-slice-split.md` (C6 done;
mark NEXT = throws/sweeps) and **delete this plan file**.

## Decisions to confirm (raise at plan approval)

1. **Cancel demonstration = self-cancel (`strike → strike`).** Recommended — keeps `MoveId`
   unchanged (no dsl `MOVES` ripple); the multi-move arsenal + distinct cancel routes is a
   later additive slice. The route list is still a live gate (empty ⇒ no cancel). *Alternative:*
   add a second move now (broader, touches `types.ts` `MoveId` + dsl allowlist).
2. **Slice 3 read surface = `self.cancelWindow`** (numeric ticks-remaining, mirrors
   `self.counterWindow`). Recommended for consistency. *Alternatives the docs also name:*
   `self.canCancel` (1/0 — derivable from the window) or `self.lastAttackConnected` (a richer,
   window-independent hit-confirm that persists past the window — defer unless wanted).
3. **No cancel-chain cap in C6.** A self-cancel against a passive in-range opponent could chain
   each tick the window allows (within-exchange escalation is *intended*). Unbounded loops are
   bounded later by *yame* (exchange reset) + stamina, not by C6. Tests bound chains with
   `maxTicks` / opponent range. Confirm we accept no per-move "cancel once" limit now.

## Pre-PR Quality Gate (every slice)

1. Mutation testing — run `mutation-testing` (diff-against-main); `sim.ts` stays ~95%+.
2. Refactoring assessment — run `refactoring`.
3. `npm run typecheck` + `npm run lint` + `npm test` pass.
4. Confirm the **inertness** test (config absent ⇒ byte-identical) is green — the project's
   standing forward-compat guarantee.

---
*Delete this file when C6 is complete. If `plans/` is empty, delete the directory.*
