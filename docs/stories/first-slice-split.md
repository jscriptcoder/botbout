# First Vertical Slice — Story Split

> Splits design item **P9** (`docs/DESIGN.md`) into end-to-end child stories.
> Source of truth for combat/platform: `docs/DESIGN.md` + `docs/BOT-DSL.md`.
> Feeds `planning` (one child story → PR-sized TDD slices). **Created 2026-06-25.**

## Parent (reframed)

- **Actor:** a **bot author** — an LLM, or a developer hand-writing JSON during bring-up.
- **Capability:** submit a **JSON bot (data, not code)** that fights a deterministic
  opponent.
- **Outcome:** get a **bit-reproducible** fight result they can read, learn from, and
  iterate on.
- **Current constraint:** the full deep-karate capability — 24-move arsenal, 3 bands +
  vertical axis, _uke_/parry/cancel/throw/sweep, stamina, _yame_ scoring, the
  perception-latency meta, Pixi render, Vercel API, KotH ladder — is far too large for
  one increment.

## C1 — Walking skeleton (recommended first slice) · ✅ done (PRs #1–#5)

**Walking skeleton — a deterministic, reproducible _headless_ fight.**

> A developer submits two JSON bots and runs a fixed-length headless fight that is
> **bit-reproducible** from its seed + inputs, with a minimal combat vocabulary
> (1D approach + one _mid_ strike that can score), and reads the outcome from a
> **result object + integer event log**.

**Why this first:** it burns down the three architectural risks that are brutal to
retrofit — **(1) determinism / replay**, **(2) the validate-before-run TCB**, and
**(3) the same-snapshot fight loop** — while deferring every _additive_ combat feature
and the render layer. It is the smallest end-to-end whole that exercises the real
production path (intake → validate → interpret → deterministic sim → result/log →
replay-verify). Everything after it is feature addition onto a proven spine.

### Scope (included)

- **Intake + TCB gate:** prototype-pollution-safe parse; validator over the op/field
  allowlists + static `LIMITS`; structured reject `{path, reason}`; **validate before run**.
- **Interpreter:** rules top-to-bottom, **one `Action`/tick**, memory cells + tracker
  rules, the numeric/boolean op set the skeleton needs.
- **Deterministic loop:** fixed timestep (`tickRate=60`); single seeded PRNG
  (mulberry32); fixed-point integers (`SCALE=1000`); **one immutable tick-T snapshot**,
  both bots decide, **resolve together** with a fixed documented tiebreak; commitment
  (startup→recovery locked, `canAct`).
- **Minimal combat:** 1D `x` only; moves `{ idle, move, block, one strike }`; a strike
  whose active frame overlaps the opponent within `x`-reach while they are **not**
  blocking scores **+1**; thin "most points / first-to-N" outcome.
- **Result + replay:** result object (`winner`, `ticks`, integer **event log**);
  persist `{ seed, rulesHash, botA, botB, initialConditions }`; re-running yields a
  byte-identical event log.

### Intentional deferrals (and why)

- **Pixi render / viewer** — safe to defer: the renderer is a **pure function of the
  integer event log** (LOCKED render/authority seam). The event log is the demonstrable
  artifact for now.
- **Perception latency** (`L_pos`/`L_act`, ring buffer, seeded jitter) — **C2**. The
  skeleton runs at **L=0** (perfect info) to isolate loop determinism.
- **Height bands + _uke_ guards · vertical axis (y/gravity/jump/crouch) · parry ·
  cancels/combos · throws/sweeps/okizeme · stamina · _yame_ + full WKF 0–3 scoring +
  penalties** — additive combat feature slices.
- **Vercel API · KotH ladder · rich telemetry & replay file format** — platform slices.
- **`let` bindings** — DSL verbosity sugar; memory cells suffice for the skeleton.

> **Forward-compat rule:** keep the bot document format stable even where the skeleton
> ignores a field (carry `band` but ignore it in resolution; expose latency but at 0)
> so later slices don't break already-authored bots.

### Acceptance examples

1. **Reject malformed:** _Given_ a bot doc using an op **not** on the allowlist,
   _When_ validated, _Then_ it is rejected with a structured `{path, reason}` issue and
   the fight does not run.
2. **Accept + run:** _Given_ two valid bot docs and a seed, _When_ a fight runs for N
   ticks, _Then_ it returns a result object with a winner and an event log.
3. **Bit-reproducible:** _Given_ the same `{seed, rulesHash, botA, botB,
initialConditions}`, _When_ the fight runs twice, _Then_ the two event logs are
   byte-identical.
4. **Minimal scoring:** _Given_ an aggressor that approaches and strikes an idle
   opponent in reach, _When_ the fight runs, _Then_ the aggressor's points increase and
   it wins.
5. **Same-snapshot resolution:** _Given_ both bots strike on the same tick, _When_ the
   tick resolves, _Then_ both decisions are computed from the tick-T snapshot and
   resolved by a fixed, documented tiebreak (order-independent).
6. **Commitment:** _Given_ a bot returns a new action while `canAct=0` (mid-recovery),
   _When_ the tick resolves, _Then_ the action is ignored and logged as telemetry.

**Release constraint:** internal / dev-only, **headless**. Demonstrable via the test
suite (replay-equality + scoring) and a printed result/event-log trace. No deployment.

## Capability roadmap (C2–C6, near-term follow-ups)

> **Labeling convention.** Capabilities are **C1, C2, C3…** (C1 = the walking skeleton
> above). The `C` prefix is deliberate: it keeps these stable roadmap IDs from colliding
> with `slice/N` **git branch names**. The walking skeleton (C1) shipped as branches
> `slice/1`–`slice/5` — those are PR stages of C1, **not** capabilities C1–C5. Don't read
> "C3" as "PR #3" or branch `slice/3`. Done: **C1** (PRs #1–#5), **C2** (PRs #7–#11),
> **C3** (PRs #15–#16). Next: **C4**.

| Capability                                      | Value                                                   | Includes                                                                                                                                         | Defers                 | Acceptance example                                                                                     | Release      |
| ----------------------------------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------- | ------------------------------------------------------------------------------------------------------ | ------------ |
| **C2. Perception latency keystone** · ✅ done   | Makes frame data _mean_ something; the distinctive meta | Split `L_pos`/`L_act`, per-fighter history ring buffer, one coherent delayed snapshot, dead-reckoned `predictedDistance`, seeded clamped jitter  | bands, y, parry        | A strike with `startup < L_act+B` **cannot** be reaction-blocked; one with `startup ≥ L_act+B` **can** | dev/headless |
| **C3. Height bands + 3 _uke_ guards** · ✅ done | Core read/counter game                                  | `high/mid/low` attack band; `block-{high,mid,low}`; wrong-height guard ⇒ hit; band keys scoring; `opponent.attackBand` perceived `L_act`-delayed | y-axis, parry, cancels | A `high` strike vs `block-mid` connects; vs `block-high` is blocked                                    | dev/headless |
| **C4. Vertical axis + occupancy** · ← next      | The low/high game becomes physical                      | fixed-point `y`, gravity arc, jump/crouch; band occupancy (croucher vacates `high`, jumper vacates `low`)                                        | parry, cancels         | A `jodan` (high) kick **whiffs** a croucher; a sweep **whiffs** a jumper                               | dev/headless |
| **C5. Parry windows**                           | The skill gradient (predict vs react)                   | opening ticks of a matching guard ⇒ deflect + attacker extra-recovery + counter-hit bonus; later ticks ⇒ normal block                            | cancels, throws        | A guard raised within the parry window deflects; the same guard raised late only blocks                | dev/headless |
| **C6. On-contact cancel combos**                | Within-exchange score escalation; the no-feint property | `cancelInto` windows, `canCancel` state, hit-confirm signal (`self.lastAttackConnected`); cancel only on hit/block, never whiff                  | throws, stamina        | An attack cancelled into a follow-up **on hit** chains; the same attempted **on whiff** does not       | dev/headless |

## Parking Lot (later — not pre-enumerated rigidly)

- **Throws + sweeps + limited okizeme** (throw triangle strike>throw>guard>strike;
  `throw-break`; sweep → one guaranteed finish window → wake-up i-frames).
- **Stamina economy** (costs, regen, gassing = slower/weaker/no-specials, block chip).
- **Match structure** — _yame_ resets, within-exchange 1→2→3 escalation, win by 8-pt
  gap / most-at-timeout, `jogai` + passivity penalties, clock.
- **Rich telemetry + replay file format** (per-exchange + aggregate stats; the
  counter-design + balance-instrumentation fuel).
- **Pixi viewer / render layer** — salvage Pixel Fist rig + FK + stage; pure function
  of the event log. _(Can be pulled forward right after the skeleton if a visual
  milestone is wanted — still safe per the seam.)_
- **Vercel serverless API** — `POST /fighter` (validate+store), `POST /fight` (vs
  champion), `GET /replay/:id`, `GET /spec`.
- **KotH ladder + lineage** — challenge champion, win→become champion, track streaks.

## Warnings

- **Do not split the skeleton by layer.** "validator", "interpreter", "loop" are
  `planning` **stages within C1**, not independent stories — none is independently
  valuable or demoable alone.
- **Design gap #1 is RESOLVED** (2026-06-26) → pinned as **`DESIGN.md` §11 — Combat
  resolution order**: the ordered per-tick procedure (two-phase compute-then-apply;
  S1 posture → S2 intake → S3 compute → S4 apply → S5 advance; frozen pre-intake
  snapshot; the `strike > throw > guard` precedence; HIT/BLOCK/WHIFF gate). C3 (bands),
  C5 (parry), C6 (cancels) and throws all slot into that spine. Per-stage numerics stay
  deferred to each slice.
- **P9 implied a Pixi visual in the first slice.** We're deferring it deliberately. If a
  visual milestone is required sooner, pull render forward as its own slice — don't bloat
  the skeleton with it.

## Next Step

C1, C2, and **C3** are shipped (height bands + `block-{high,mid,low}` +
`L_act`-delayed `opponent.attackBand`), and Design gap #1 is pinned (`DESIGN.md` §11).
**C4 (vertical axis + occupancy)** is the next capability and is **unblocked**. Load
**`planning`** on **C4** to stage it into PR-sized TDD increments (each:
RED → GREEN → MUTATE → KILL MUTANTS → REFACTOR).

> **C4 brings the §11 occupancy gate live.** Step 3 of §11's HIT/BLOCK/WHIFF gate
> (`active → reach → occupancy → guard`) is hardwired open today because no `y` /
> crouch posture exists to make it observable. C4 adds fixed-point `y`, the gravity
> arc, jump/crouch, and band occupancy (a croucher vacates `high`, a jumper vacates
> `low`) — the first capability where a strike can **whiff** on posture alone.
