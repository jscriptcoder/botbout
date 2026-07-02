# ModelKombat — Deep Karate Combat Design

> **Status:** The canonical combat + platform design. The **LOCKED** section is
> decided; **PROPOSED** sections are recommendations not yet ratified. Paired with
> the generated `docs/spec.md` (the bot authoring API). **Last updated:** 2026-06-26
>
> The **non-negotiable invariants** in `.claude/CLAUDE.md` (determinism, DSL-as-data
> TCB, integer math, same-snapshot resolution) hold throughout. Karate move design
> is salvaged from the dropped **Project Pixel Fist** (its `docs/move-taxonomy.md`,
> `docs/design-brief.md`, `docs/character-rig.md` — external; see the salvage memo).

## What this is

ModelKombat is a platform where LLMs author fighters that battle in a deterministic
ring; fights are bit-reproducible so they can be replayed and watched. We are
taking the **"go deep"** path: instead of a lean 4-move model, the combat core is
a **full karate fighting system** — ~24-technique arsenal, three height zones,
technique-specific active defense, WKF cumulative scoring — expressed so that an
LLM can author a bot for it as a **JSON DSL document (data, never code)**.

## Control model & the perception keystone (foundational rationale)

- **Policy author, not real-time controller.** The LLM does not drive the fighter
  live — live LLM latency would kill the pace, cost a fortune per fight, and
  (fatally) break replay determinism. It authors a policy **once**; that policy
  runs **reactively** at full speed inside the engine (the engine calls its
  decision logic every tick). Deterministic, cheap, replayable. Closest
  precedents: **Robocode, Battlecode, Toribash**. We use a discrete, banded move
  set (not continuous joint control) because it's balanceable and LLMs reason
  about it well.
- **Perception latency is the keystone.** An authored bot otherwise has _perfect_
  reactions, which would make frame data meaningless (block everything on frame
  1). The fix: the opponent is perceived **delayed** — `L_pos` (~1: track _where_
  fast) and `L_act` (~6: recognize _what_/which band slow). This _derives_ the
  meta from `L` via the **two master inequalities** (see LOCKED #9): reaction-block
  iff `S ≥ L_act + B`; whiff-punish iff `R ≥ L_act + S_punish`. Slide `L` and the
  whole defensive meta slides with it.
- **Balance methodology.** Don't trust the published numbers — instrument
  everything and let **bot-vs-bot** playtest balance: run thousands of matchups,
  watch move-usage and win-rate-by-opener (healthy ≈ no move >35% usage, no opener
  > 60% win). The sim tells the truth; the frame table is just a starting point.

## Non-negotiables preserved (from `.claude/CLAUDE.md`)

1. **Determinism.** Fixed timestep; one decision per fighter per tick from a
   single seeded PRNG. **Integer / fixed-point math only** in the outcome path.
2. **Security / TCB.** Bots are **data, not code**. The validator + interpreter
   (`packages/engine/src/dsl.ts`) is the trusted computing base; its allowlists
   are the security boundary. No DSL op may touch host/net/fs/time/randomness.
3. **Bounded DSL.** Loop-free, recursion-free; worst-case cost bounded by document
   size, enforced at validation.
4. **Same pre-tick snapshot.** Both fighters decide against one immutable snapshot
   of tick T; actions resolve together afterward. Opponent perception is served
   from a per-fighter history ring buffer as one coherent delayed snapshot.

### The render/authority seam (the key architectural unlock)

The **integer sim is authoritative**; the salvaged stick-figure **rig + forward
kinematics + Pixi rendering are a derived, non-authoritative render layer** that
is a pure function of the integer event log. Floats (radians, `sin`/`cos`,
ragdoll) are therefore harmless in the render layer — two viewers replaying the
same integer log see the same fight regardless of float platform quirks. This
seam is what lets us reuse Pixel Fist's float rig without violating integer
determinism. **Rule of thumb:** anything that affects the _outcome_ is integer and
lives in the core; anything that only affects _how it looks_ may be float and
lives in the render layer.

## Salvage from Project Pixel Fist

- **Move taxonomy** (`move-taxonomy.md`) — ~24 karate techniques, the move-anatomy
  schema, height→guard→scoring map, WKF scoring. The design backbone.
- **Stick-figure rig** (`core/rig.ts`) — 14-joint humanoid skeleton, forward
  kinematics, idle/stride/punch poses, facing-mirror → ModelKombat's visual fighter
  (render layer).
- **Render model** (`core/render-model.ts`) — pure world→screen projection.
- **Pixi adapter** (`render/stage.ts`) — PixiJS v8 renderer; fixed-timestep loop.
- **Stack** — Vite + Pixi + SolidJS (chosen) for the replay/fight viewer + HUD.

---

## LOCKED decisions

Resolved in the design interview. Numbered to match the running tree.

### 1. Spatial model — real 2D, fixed-point

Position is **2D**: `x` (ground) + `y` (vertical). A real fixed-point integer
vertical axis with **jump arcs + gravity**; **crouch** lowers the hurtbox
positionally. Jumps, anti-airs, gap-closers, and the low/high game are all
physically real (not faked). Determinism via fixed-point integers (scale TBD —
see _Fixed-point representation_).

### 2. Hit model — band attribute + geometric occupancy

A move declares a discrete target **band** (`high` / `mid` / `low`) — that is what
**scoring and _uke_-matching key off**. A strike connects when the attacker is in
**`x`-reach** _and_ the defender's hurtbox **occupies that band**. The continuous
`y` drives traversal _and_ band occupancy: crouching vacates `high` (a _jodan_
kick whiffs a croucher); jumping vacates `low` and enters an airborne band (a
sweep whiffs a jumper). **Bots reason in 3 bands; the renderer reasons in exact
`y`.** FK/trig stays in the render layer; the core needs only band occupancy +
`x`-reach + simple AABB. (Full limb-accurate geometric hits = possible later slice
_if_ we pay for fixed-point FK.)

### 3. Combos — on-contact cancels only

A move may cancel into another (per `cancelInto` windows) **only on hit or block —
never on whiff.** Because feints come from whiff-cancelling, forbidding them means
you can only cancel something the opponent _already perceived connect_ → real
combos + WKF score escalation, with the **no-feint / pure-perception** property
intact. Adds a `cancelable` state + per-move cancel-route data.

### 4. Guards — 3 height-keyed

Three mechanically-distinct guards: `block-high` (_age-uke_), `block-mid`
(_soto/uchi-uke_), `block-low` (_gedan-barai_) — a clean 3-way read mirroring the
3 attack bands, each **rendered/named** as its authentic _uke_. Wrong-height guard
⇒ you get hit. Inner/outer angle + knife-hand = flavor now, optional depth slice
later.

### 5. Parry — opening window of a correct guard → counter

The first few ticks of raising the **matching-height** guard are a **parry
window**: if the attack's active frame lands then, it is **deflected** (attacker
thrown into extra recovery → big frame advantage + counter-hit bonus on the
immediate follow-up, which flows into the on-contact cancel system); later in the
guard it's a **normal block** (blockstun + pushback + small stamina chip). Fast
(unreactable) strikes can only be **predict-parried**; slow strikes can be
**reaction-parried** — the intended skill gradient.

### 6. Ground game — limited okizeme

A clean **throw/takedown** (_o-goshi_), if not broken, grounds the opponent and
**scores 3 directly**. A **sweep** (_ashi-barai_) is a **low-band strike that
knocks down instead of scoring** (`score 0`, an `onHit.knockdown` move): it runs
the normal strike contact gate, so a **low guard blocks it** and a **fresh low
guard parries it**, it **whiffs a jumper** (low-band occupancy) but **hits a
croucher**, and it **trades with strikes / stuffs throws** like any strike
(`strike > throw`). Its payoff is tempo, not points.

**Okizeme (C8-resolved).** Every knockdown — throw _or_ sweep — opens **exactly
one** guaranteed "finish" window: for the first `finishWindow` ticks of the
knockdown the grounded fighter is **targetable** by a single opposing strike
(guard / occupancy ignored — it is prone), which **scores and closes the window**.
After that, **wake-up i-frames** (the untargetable tail of the knockdown) run
until the fighter **wakes to a fully-agentive neutral** — no re-down, no clock
extension, **no ground loops**. WKF _ippon_ drama + sweep setups. Perception: the
finisher reads its own window **live** as **`self.finishWindow`**; the grounded
state is a delayed **`opponent.knockdown`** tell (`L_act`). `finishWindow` is
**optional** — absent ⇒ no finish for any knockdown ⇒ a throw stays the C7
pure-3-point untargetable knockdown.

The throw triangle is locked: **strike > throw > guard > strike**; `throw-break`
escapes throws; strikes interrupt throw startup.

### 7. Match structure — point-exchange resets (_yame_)

After a scoring technique lands _and its combo/advantage sequence fully resolves_
(okizeme window closes / fighters return to neutral): call **_yame_**, award that
exchange's accumulated points (the **1→2→3 escalation happens within the
exchange**), **reset both to neutral start**, continue. Win by **8-point gap or
most points at the time limit**. **`jogai`** (ring exit) and **passivity** are
**penalties**, not instant loss. Each fight = a sequence of clean, replayable
exchanges.

> See **#10** below — confirmed: no HP bar, points only.

#### 7a. Resolved §7 remainder — jogai · passivity · tie-resolution (grill 2026-07-01)

**Already built** (benchmark match-structure, PRs #87–#93): _yame_ resets + the
**8-point `winGap`** early-stop + the time-limit fallback, all as an optional
`runFight` `match?: { winGap }` **scoring-layer** param (NOT in `Rules`/`CANONICAL_RULES`
— match mode is a scoring concept; `npm run fight` is unaffected). Absent ⇒ byte-identical,
**no DSL surface** (the `dsl.ts` TCB untouched). The three capabilities below extend the
SAME `match` param and reuse `resetToNeutral` + the yame boundary check; each is
byte-identical when its config key is absent.

**Boundary fact that shapes jogai:** the ring edge is a **hard positional clamp**
(`sim.ts`: `f.x = clamp(f.x + …, 0, ring.width)`) — fighters cannot leave. There is **no
knockback/pushout** anywhere, and `move` requires neutral, so the ONLY way to the boundary
is a fighter **voluntarily walking there** (a retreating zoner). jogai therefore penalizes
**retreat**, not "got pushed out" — a cap on the zoning/turtle escape space (also the
anti-stall motive behind passivity). Combat resolves before officiating each tick, so a
legit score always lands before any reset — no free-escape exploit.

**Jogai (ring-out penalty).**

| Decision | Resolution |
| --- | --- |
| Boundary | **Out-zone over the hard clamp**: legal region `[margin, width−margin]`, outer strips = jogai zone. A pure scoring-layer READ (`self.x` vs `margin`) — no movement-physics change. |
| Config | `match.jogai?: { margin }` (sub-units). Officiating layer, not `Rules`. |
| Penalty | **Warning ladder** on the shared per-fighter `penaltyCount` (below): 1st foul free, each subsequent ⇒ **opponent +1 point**, feeding the existing `winGap`. No DQ / instant loss. |
| Trigger | **On-entry transition** (in-bounds → out-zone edge-detect); one jogai per crossing, re-arms on return. The margin is the grace — no dwell counter. |
| Consequence | **Full yame reset** (`resetToNeutral` both) + `winGap` re-check (endReason `"gap"`) + jogai `FightEvent`. Offender lands at center ⇒ no re-trigger. |

**Passivity (non-engagement penalty)** — the anti-stall lever (bots were farming the 600-tick cap).

| Decision | Resolution |
| --- | --- |
| Metric | **Per-fighter no-offense clock** `ticksSinceOffense`; exceed `match.passivity.limit` ⇒ passive. |
| Reset | **Making contact only** (hit/block/parry/grab/sweep-connect) — a whiff at air does NOT reset. This is what breaks the far-apart stall; reuses the union's computed outcomes. |
| Ladder | **Shared category-2 ladder with jogai**: one `penaltyCount`/fighter, both fouls feed it (1st free, 2+ ⇒ opponent +1 → `winGap`), sharing the free first warning. WKF-faithful pooling. |
| Consequence | Full yame reset (restores `startGap` engaging distance), reset both clocks, `winGap` re-check, event. |

**Tie resolution (the reframed "rounds")** — WKF is single-round; the real §7 gap is breaking a
level bout (equal points at the time limit → today `"draw"`). Best-of-N is a non-WKF import, dropped.

| Decision | Resolution |
| --- | --- |
| Scheme | **Overtime → senshu fallback.** Level at cap ⇒ sudden-death OT; OT decides ⇒ win; OT scoreless ⇒ senshu-holder; never-scored ⇒ draw. |
| Overtime | Reset both to neutral start (points/stamina/mem persist); **first fighter to hold a lead (gap ≥ 1) wins immediately**; a same-tick trade stays level; fixed `match.overtimeTicks` cap ⇒ senshu fallback; jogai/passivity stay live in OT (their points can BE the sudden-death score). |
| Senshu | **First-blood latch (WKF-faithful)**: the first fighter to score a **technique** point (penalty points never confer) holds senshu; simultaneous first score ⇒ none (permanent, not transferred). **Revoked** to none if the holder later commits any jogai/passivity foul (incl. the free 1st warning). Standalone toggle `match.senshu?: boolean` (also the OT fallback). |
| endReason | `"gap" \| "time" \| "overtime" \| "senshu"` (a true no-senshu draw reports via the tie path with winner `"draw"`). |

**New DSL read surface** (all additive `FIELD_READERS`, config-gated values, static entries ⇒
`dsl.ts` interpreter stays 100% — the C10 pattern). jogai `margin` is **spec-taught**, not a field.

- `self.penalties` / `opponent.penalties` — shared category-2 warning count (live scoreboard, like `opponent.points`).
- `self.passivityRemaining` (live) / `opponent.passivityRemaining` (`L_act`-delayed — bait the forced commit).
- `self.senshu` / `opponent.senshu` (live 1/0, public scoreboard fact).
- `clock.overtime` (live 1/0 — sudden-death on).

**Per-tick officiating order** (determinism / swap-symmetry): resolve combat (union) → update
clocks (passivity `++`, reset-on-contact; jogai edge-detect) → `events.push` → officiating: apply
ALL triggered penalties (each on its own per-fighter counter — commutative), then **at most one
`resetToNeutral(both)`** if any yame/jogai/passivity fired, then one `winGap` check. **Ordering
(refined A1/B2):** the yame block runs first but fires only on `scored ∧ both-neutral`, which is
almost never true when a fighter is out mid-exchange (the scorer is still in recovery) — so **jogai
fires independently**, and a point scored earlier in the exchange **stands** (already applied in
combat; a retreating defender can end an exchange after eating a hit — WKF-consistent). Only in the
rare both-neutral+scored+out tick does the yame reset pre-empt jogai (single reset, no double-fire).
Both-out / both-passive same tick ⇒ each evaluated independently, net-symmetric.

**Config shape** (all optional; absent key ⇒ byte-identical):

```ts
match?: {
  winGap: number;                 // built
  jogai?: { margin: number };     // sub-units
  passivity?: { limit: number };  // ticks
  senshu?: boolean;               // first-blood tie-break (C1; standalone + the OT fallback)
  overtimeTicks?: number;         // enables sudden-death OT (falls back to senshu)
};
```

Ladder constants (1 free warning, +1 pt/foul) are fixed for the first pass (parameterize later if
tuning needs it).

**Downstream** (per capability, like the match-structure feature): fold the new `match` config into
the benchmark's `MATCH` constant + `INPUT_HASH` (bump `BENCHMARK_VERSION`), re-characterize the
gauntlet, and extend `generateSpec(rules, match)` to teach the new rules. §P6 already sketches the
`Ring`/`Match`/penalty state this realizes.

**Sequencing (recommended):** jogai → passivity (shares the ladder) → tie-resolution. Full slicing
goes to `story-splitting` → `planning`.

### 10. Outcome — pure WKF points, no HP

**No health bar, no KO.** The outcome is the **score**. "Damage" in the old frame
table becomes **WKF score (0–3)**; knockback / stagger / knockdown are
**tempo/positioning** reactions, never life loss. Payoff structure comes from
counter-hit bonuses, the sweep→finish, the 3-point throw, and within-exchange
combo escalation — not a damage race. A stun/durability meter is a deferred future
lever, not in the deep core.

### 8. Fighter model — identical mechanics, behavior-only

Both fighters share **one global `RULES`** table and **one global `L`**. The only
difference is the **authored DSL strategy**. Symmetric, fairest, single frame
table; archetypes (rushdown / counter / turtle / grappler) emerge from behavior.
Stats / build-crafting = a later meta/career expansion.

### 9. Perception — transparent + delayed

Self is **live**. The opponent is a **coherent delayed snapshot** with **split
latency**: positional fields (`x`, `y`, `vx`, `vy`) delayed by small `L_pos`
(~1–2); action/intent fields (current move, **its band**, phase, `phaseElapsed`)
delayed by `L_act` (~6). **2D velocity exposed** for dead-reckoning. **Seeded,
clamped jitter** on `L` (anti-frame-counting, replay-deterministic). Perception is
**transparent** — exact values, just time-delayed; **latency is the only fog**.
Master inequalities, now **per band**:

- reaction-block iff `S ≥ L_act + B`
- whiff-punish iff `R ≥ L_act + S_punish`

> **Engine note (built, PRs #7–#10).** With whole-frame pre-tick sampling, an
> attack's tell first appears one tick _after_ commit, so the realised boundary is
> `S ≥ L_act + 1` even at `B = 0` — the `+1` is a structural observe-after-commit
> tick. Seeded jitter `j` keeps it always-blockable at `S ≥ L_act + 1 + j` and
> never-blockable at `S ≤ L_act − j`. Built so far at `L_pos`/`L_act` (1D, no band);
> `y`/`vy`, posture, and the perceived attack _band_ arrive with later slices.

### 11. Combat resolution order — the ordered per-tick procedure

The single, deterministic, **order-independent** procedure that resolves one tick once
both bots have returned their actions. It composes §2 (band + occupancy), §4 (3 guards),
§5 (parry), §6 (throw triangle), and §3 (on-contact cancels) into **one fixed order** so
every mechanic has exactly one home and adding later mechanics never reshapes the spine.
This closes **combat design gap #1**. _(Pinned via `grill-me`, 2026-06-26.)_

**What is pinned now vs. later.** This section locks the **ordered spine + the
order-independence contract** for the whole deep model. **Per-stage numerics** (parry
window length, blockstun/pushback/extra-recovery amounts, knockdown/i-frame durations,
cancel-window sizes) are **deferred to the slice that builds each stage** — they fill
documented slots without moving the spine.

#### 11.1 The order-independence contract (the foundation)

Resolution is **two-phase compute-then-apply**:

- **Stages S1–S3 read only the frozen pre-tick snapshot and accumulate _effects_
  (pure data); they mutate nothing.**
- **S4 applies all effects atomically; S5 advances clocks. Nothing mutates a fighter
  outside S4/S5.**

This is what keeps the tick **swap-symmetric** (identical regardless of which fighter is
"A") even once interactions mutate the _other_ fighter — a throw knocks the **defender**
down, a parry adds recovery to the **attacker**, a block puts blockstun on the
**defender**. Because every effect is computed from the same frozen snapshot before any
is applied, "A-then-B" and "B-then-A" cannot diverge. Order-independence is therefore
**structural, not hand-proved per interaction** (the property the old single-`resolveHit`
trick — "each effect lands on its own fighter" — gave up the moment effects cross to the
opponent). Frozen = **pre-intake**: this tick's movement (steps) are S4 effects taking
hold next tick, so the whole tick is a pure function of one snapshot + both actions, and
**there is no same-tick step-dodge of an already-active strike** (you escape danger by
predicting and moving _earlier_ — consistent with the commitment/perception meta).

#### 11.2 The five stages

| #      | Stage                      | Reads / does                                                                                                                                                                                   | Mutates? |
| ------ | -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| **S1** | **Posture classification** | From the frozen snapshot + both actions, label each fighter `guard(band)` / `parry(band)` (opening window) / `open`. A committed/attacking fighter is `open` — **cannot guard**.               | no       |
| **S2** | **Intake**                 | For each fighter **free to act**, _emit_ its intent as an effect: `MoveStart` (attack/throw/sweep), `Step`, `GuardRaise`. Locked fighters ignore their action. **Self-targeted effects only.** | no       |
| **S3** | **Interaction resolution** | From the frozen snapshot: for each fighter whose committed move is in its **active window**, classify contact (11.3) and resolve the **precedence table** (11.4). Emit interaction effects.    | no       |
| **S4** | **Apply**                  | Apply all S2 + S3 effects atomically: move-starts, steps, scores, blockstun/pushback, knockdown, extra-recovery, cancel-enable.                                                                | **yes**  |
| **S5** | **Advance clocks**         | Tick each committed fighter's move/stun clock; completed moves → recovery/neutral.                                                                                                             | **yes**  |

S1 is **before** S2 so "a fighter that starts attacking this tick cannot also be
guarding" holds. A move started in S2 is at `elapsed 0` (startup) so it is **never active
on its own start tick** — which is exactly why deferring the start to S4 changes no
outcome (S3 only ever reads _already-committed_ moves). **Free to act** generalizes
today's `neutral` check: a fighter honors intake only when **not**
committed/stunned/knocked-down/recovering.

#### 11.3 Contact classification (inside S3)

A strike yields a **three-way result** — the BLOCK vs WHIFF distinction is first-class
**now** because cancels (§3) fire on **hit or block, never whiff**, and collapsing them
would force re-plumbing later:

- **HIT** — scores; defender takes the tempo reaction.
- **BLOCK** — no score; defender blockstun + pushback _(numerics deferred)_. **PARRY**
  (§5) is the C5 refinement of this branch: deflect + attacker extra-recovery + counter.
- **WHIFF** — nothing connects; no score, no stun, **no cancel**.

Gate order (short-circuits top to bottom):

```
1. active window?        no → NONE  (not striking this tick)
2. reach?                no → WHIFF
3. occupancy(atk.band)?  no → WHIFF        // e.g. a high strike sails over a croucher
4. defender guards band == atk.band?
       yes, in opening window → PARRY       // C5
       yes, past window       → BLOCK
       no  (open OR wrong band) → HIT
```

Two rulings the order encodes: **occupancy is checked before guard** (a high strike vs a
croucher WHIFFs _regardless of guard_ — it physically misses), and **wrong-band guard ⇒
HIT** (the core read: a guard at the wrong height does not save you).

#### 11.4 Interaction precedence (the throw triangle, inside S3)

The locked precedence is §6's cycle **strike > throw > guard > strike**. Directed
resolution (attacker's offensive event this tick × defender's posture):

| Attacker event    | Defender posture                        | Outcome (A→B)                                             |
| ----------------- | --------------------------------------- | --------------------------------------------------------- |
| strike active     | open (incl. _attacking_)                | **HIT** — scores (gated by 11.3)                          |
| strike active     | guard, **wrong** band                   | **HIT** — scores                                          |
| strike active     | guard, **correct** band, past window    | **BLOCK** — no score; B blockstun + pushback              |
| strike active     | guard, **correct** band, opening window | **PARRY** — no score; A extra recovery + B counter window |
| throw grab-active | open **or any guard** (incl. parry)     | **THROW** — scores 3; B knocked down _(throw > guard)_    |
| throw grab-active | B strike-active **or** B throw-startup  | **strike beats throw** — A's throw fails                  |

**Mirror (both-offensive) cases — the _only_ swap-symmetric outcomes:**

- **strike ∥ strike**, both in range → **trade**, both score.
- **throw ∥ throw** → **clash**, both whiff _(throw-break detail → throws slice)_.

Every other conflict is broken by the `strike > throw > guard` ordering, so it never
depends on who is "A." Two precedence rulings protect the cycle: **throw beats parry too**
(a throw is _the_ anti-guard option — a predicted parry still loses to a throw; parry only
ever answers _strikes_), and the trade/clash above are the _only_ symmetric resolutions.

#### 11.5 C3–C5 scope and deferred slots

**C3 (height bands + 3 _uke_ guards) builds:** S1 posture (`guard`/`open`), S2 intake as
effects, S3 with the **top three contact rows** (HIT / wrong-band-HIT / correct-band-
BLOCK) + the **strike∥strike trade**, S4/S5. In C3 **occupancy was hardwired `true`** (no
`y` — the only posture was standing, occupying all 3 bands). **C4 makes step 3 live:** a
`crouch` vacates `high` and an airborne fighter (fixed-point gravity arc, committed until it
lands at `y=0`) vacates `low` once past `lowClearance` — driven by a `posture→vacated-band`
table read-only on the defender, so resolution stays single-`resolveHit`. The read game adds
`opponent.y` (`L_pos`) and `opponent.posture` (`L_act` enum: `0`/`1`/`2`). Reachable contact
results in C3: **HIT / BLOCK / WHIFF**.
Reachable effects in C3: **`MoveStart`, `Step`, `Score`** (BLOCK = "no score" with stun =
pushback = 0 until their numerics land).

**C5 (parry windows) makes the BLOCK row two-way and brings the union:** the opening
`parryWindow` ticks of a matching-band guard **PARRY** (deflect — no score, attacker
`parryRecovery` extra recovery) instead of BLOCK; a parry also opens a `counterWindow` on the
parrying fighter, and a strike it lands while the window is open scores `+counterBonus`. The
counter is the first **cross-fighter** effect (it lands on the OTHER fighter), so resolution
graduates from C4's single-`resolveHit` to the **compute-then-apply union**: a pure
`computeStrike` (hit/parry outcome from the frozen snapshot) + `applyStrike` (both directions
applied atomically), keeping the tick swap-symmetric. The live window is perceivable as
`self.counterWindow`. _(Engine note: the union is adopted **deliberately** here at the first
cross-fighter effect — it is **not** strictly forced until **throws** create same-tick mutual
dependencies (strike-beats-throw, throw-clash); the frozen snapshot is taken **post-intake**, so
§11.1's pre-intake step-dodge refinement is still deferred, as is parry-aware `phaseRemaining`.)_

**Documented insertion points (deferred, bound to this spec):** throw-triangle rows +
knockdown/i-frames (throws slice); `CancelEnable` on hit/block
(C6); blockstun/pushback/extra-recovery numerics (their slices). The procedure is strictly **per-tick**; point accumulation stays raw —
_yame_ / match-scoring reset (§7) is match structure, **outside** this procedure.

> **C3 planning dependency (tracked separately — _not_ part of this procedure).** C3 is
> "the read/counter game," but section 11 only governs how bands _resolve_. For a bot to
> _counter_, it must **perceive the opponent's attack band** (delayed by `L_act`); today
> `OpponentState.attacking` is a bare boolean with no band. Exposing the perceived band is
> a **perception / State-contract** change (§9), not a resolution-order change — the
> procedure is sound without it; the _game_ is not interesting without it. Pull it into C3
> planning alongside this section.

#### 11.6 C8 scope (sweeps + limited okizeme) — RESOLVED

C8 realizes the deferred **knockdown / i-frames** insertion point. **No new
resolution machinery** — a sweep is a **strike** (§11.3 gate, §11.4 precedence), so
it slots into the existing `computeStrike` / `applyStrike` union:

- **Sweep = a knockdown-flagged low strike.** `{type:"sweep"}` starts an
  `attacking` move at band `low` reading `rules.moves.sweep` (a `MoveSpec` with
  `score 0` + the new `knockdown?: boolean`). On **HIT**, `applyStrike` downs the
  defender (no score) instead of scoring; on **BLOCK / PARRY** it behaves as any
  strike (no knockdown). Inert without a `moves.sweep` spec ⇒ byte-identical to C7.
  Precedence falls out for free: **sweep stuffs throws**, **sweep ∥ strike trades**
  (the sweep downs, the poke scores), **sweep ∥ sweep ⇒ mutual knockdown**.
- **One knockdown lifecycle (throw and sweep alike).** A knockdown sets
  `downed{ elapsed, finish: finishWindow }`. `computeStrike` against a downed
  defender returns a **finish HIT** iff `finish > 0` (gated by active + reach
  **only** — band / guard / occupancy ignored, the target is prone), else `null`
  (i-frames). `applyStrike` scores the finisher and sets the target's `finish = 0`
  ⇒ **exactly one** finish; it **never re-downs or extends `knockdownDuration`** (no
  ground loops). The i-frames are the untargetable tail; the fighter then **wakes to
  neutral** with full agency.
- **`finishWindow` optional in `Rules`.** Absent ⇒ `F = 0` ⇒ no finish for any
  knockdown ⇒ **throws stay byte-identical to C7** (downed fully untargetable); a
  sweep is then a pure tempo knockdown.
- **Perception (§9, additive).** `self.finishWindow` — the finisher's window, read
  **live** from the live opponent's `downed.finish` (the "guaranteed" enabler, like
  `self.cancelWindow` / `self.counterWindow`). `opponent.knockdown` — a **bare
  boolean** grounded tell on the **`L_act`** layer (like `opponent.throwing`).
  Combined read: `knockdown ∧ finishWindow > 0` ⇒ finish; `knockdown ∧
finishWindow == 0` ⇒ i-frames (reset); else the opponent is up.

---

## PROPOSED (my recommendation — open for the interview)

Each section: my recommendation, why, and the live alternative. Status: **OPEN**.

### P1. Stamina economy — ✓ RESOLVED → concretized as **C10** (grill 2026-06-28)

**Light layer (locked).** Every offensive move (`attack`/`throw`/`sweep`) costs
stamina, paid **on-commit** (a whiff still costs — the spam-curb); **guards chip on
absorbed contact** (a block draws a small chip when it actually absorbs an active
strike, a **parry draws more** — risk/reward); **movement and idle are free**
(neutral spacing is the regen window). Stamina is an integer clamped to `[0, max]`,
**starts full**, symmetric, and consumes **no PRNG** (deduct/regen are
deterministic ⇒ replay-stable).

- **Regen:** flat `+rate` every tick you are **uncommitted** (`canAct` and not
  guarding — idle _or_ moving); **paused** during any move (startup/active/
  recovery), while guarding, stunned, or knocked down.
- **Gassing (stepped, binary):** one `gasThreshold`; at/below it `gassed = true` ⇒
  a flat **`gasRecoveryPenalty`** is added to your moves' recovery (recovery-only;
  the original brief's "reduced knockback" is **moot** — no knockback exists yet).
  Never "cannot act," never a win condition.
- **No-specials is emergent, not a flag:** the core inequality
  **`specialCost > gasThreshold ≥ basicCost`** means a gassed fighter can't
  _afford_ throw/sweep (affordability rejects them → `idle` + telemetry) while the
  cheap basic stays available. One inequality, provable by a `runFight` test.
- **Anti-turtle ordering:** the **throw** stays the PRIMARY anti-turtle (beats
  guard); the contact-chip is the gentle SECONDARY (the attacker drives the stamina
  war by investing strikes — an un-attacked held guard bleeds nothing).
- **Perception:** `self.stamina` + a derived **`self.gassed`** (1/0) are **live**
  (proprioception); `opponent.stamina` + **`opponent.gassed`** ride the **`L_act`**
  layer (status reflects accumulated action — invariant #4), shipped as a follow-up
  slice after the self-side economy. `staminaCost` is a `rule`-readable `MoveStat`;
  `gasThreshold` is **not** rule-readable (hence the `gassed` boolean).
- **Cancel interaction:** a C6 cancel follow-up costs its own `staminaCost`
  on-commit ⇒ rekka pressure is self-limiting (you gas out of an infinite chain).

**Why:** matches the locked brief (light conditioning; gassing = slower /
punishable, never a win condition); curbs spam; paces without a second health bar.
**Alternatives (rejected):** hard gate (at 0 stamina, basics only) — more swingy;
continuous-scaling gas — heavier integer/tuning surface, no clean threshold tell.

### P2. Movement & footwork / momentum — ✓ RESOLVED (direct velocity + gravity)

**Recommendation:** ground movement is **direct velocity** (instant horizontal
control, integer units/tick); vertical is **gravity-driven** (jump = upward
impulse, then constant-`g` integer arc). Footwork set: **walk** fwd/back,
**dash-in** (short burst, recovery), **backstep** (quick dash-back, brief
low-profile), **crouch** (posture: vacates `high`, lowers reach), **jump**
up/fwd/back. Knockback uses **impulse + integer decay** (as in Pixel Fist's
`physics.ts`, ported to fixed-point). **Why:** crisp, fighting-game-legible,
fully integer. **Alternative:** acceleration/friction model — smoother feel, more
state + tuning.

### P3. Physics & impact / ragdoll authority seam — ✓ RESOLVED (cosmetic ragdoll, render-only)

**Recommendation:** **authoritative integer physics** = impulse knockback (`x`,
and `y` for launchers if any), gravity, ground collision, **hitstop** (freeze
frames on contact for weight), `stagger`/`knockdown` as **discrete states**.
**Ragdoll = render-layer-only cosmetic** (float verlet for throw/knockdown
flourish, non-authoritative). **Why:** keeps the outcome path integer/cheap;
ragdoll is pure spectacle (the render/authority seam). **Alternative:** integer
fixed-point ragdoll in the core — heavy, only if ragdoll ever affects outcomes
(it shouldn't).

### P4. Fixed-point representation & determinism — ✓ RESOLVED by default (overridable)

**Recommendation:** all sim quantities are **integers in sub-units** at a fixed
`SCALE` (proposed **1 world unit = 1000 sub-units**); velocities/gravity in
sub-units per tick; `tickRate = 60`. Avoid division in the outcome path; where
unavoidable, define `÷0 = 0` and truncate toward zero (matches the DSL). **Trig
only in the render layer (float).** A single seeded PRNG (e.g. mulberry32)
threads the sim; `rulesHash` + `seed` + bots + initial conditions reproduce a
fight bit-for-bit. **Why:** human-readable logs, cross-platform-identical.
**Alternative:** power-of-two fixed-point (e.g. `1<<8`) — cheaper shifts, less
readable.

### P5/P6. DSL action grammar + state schema — ✓ RESOLVED → see `docs/spec.md`

Synthesized into a full spec: reactive one-action-per-tick; attacks parameterized
by band; implicit on-contact cancels (combos via `canCancel` + memory);
**let-bindings** added to cut verbosity; expanded state schema (2D, posture,
cancel/knockdown state, points, scoreGap). The sketch below is retained for
context.

The bot still returns **one action per tick**; the engine is the loop. New shape
(finalized in `docs/spec.md`):

- **Attacks** are parameterized by **band**: `{ type: "strike", move: <punch|kick|...>, band: high|mid|low }`
  (the move's legal bands come from the frame table). Specials via the same form.
- **Throws:** `{ type: "throw" }`, `{ type: "sweep" }`, `{ type: "throw-break" }`.
- **Guards:** `{ type: "block", band: high|mid|low }` (timing → block vs parry is
  resolved by the engine, not chosen).
- **Movement:** `{ type:"move", dir }`, `{ type:"dash", dir }`, `{ type:"backstep" }`,
  `{ type:"crouch" }`, `{ type:"jump", dir }`, `{ type:"idle" }`.
- **Cancels need no special action** — returning an attack while `self.canCancel`
  is true (and it's in the move's `cancelInto` set) performs the cancel; the
  engine validates the window. Keeps the grammar uniform.
- **Failure is telemetry:** illegal/unaffordable/out-of-window actions degrade to
  `idle` + a logged event the author reads afterward.

### P6. State schema (expanded) — sketch

Extends the current `State`. **Self (live):** add `y`, `vy`, `posture`
(`standing|crouching|airborne`), `canCancel` + `cancelWindowRemaining`,
`knockdown` state + wake-up timer, `points`. **Opponent (delayed, coherent):** add
`y`, `vy` (`L_pos`), `posture`, perceived **attack band**, `knockdown` state;
keep `predictedDistance` and add `predictedY`/occupancy derivations.
**Match:** `scores {self,opponent}`, `exchangePhase` (`active|resetting`),
`clock.ticksRemaining`, `pointGap`. **Ring:** edges for `jogai` penalty distance.
All numeric leaves go on the DSL allowlist; booleans exposed as 1/0.

### P7. Unified move / frame-table schema

**Recommendation:** one integer record per technique, merging Pixel Fist `MoveDef`

- taxonomy anatomy + ModelKombat `MoveSpec`:

```
{ id, family, bands[], frames:{startup,active,recovery},
  score:0|1|2|3, staminaCost, reach,
  onHit:{ hitstun, knockbackX, knockbackY?, stagger?, knockdown? },
  onBlock:{ blockstun, pushback, staminaChip },
  cancelInto:[ ...moveIds/families + window ], tags:[ counterHitBonus, iFrames?, armor?, commitment ] }
```

**`score` replaces `damage`** (no HP — see #7). All values integers, test-pinned,
tuned via bot-vs-bot telemetry (target: no move >~35% usage, no opener >~60%
win). **Why:** single source of truth the DSL reads via `rule`/`field` ops and the
sim resolves against. **Alternative:** keep score and impact in separate tables —
more indirection.

**✓ DONE → the arsenal capability (C9; shipped 2026-06-29).** The single abstract
`strike` is now **RETIRED** into a **flat `MoveId` union** of named techniques — `Rules.moves` is a
record of `MoveSpec` keyed by id (sweep stays an optional concrete key); **no
`family` in the engine** (families are a docs/telemetry grouping only). Each move
declares its legal **`bands: Band[]`** (an out-of-band `attack` fails → `idle` +
telemetry, a runtime check — band is often a dynamic expression); **score is
band-dependent** (WKF: punch = 1 _yuko_ any band; body kick = 2 _waza-ari_; head
kick = 3 _ippon_ — so aiming _jodan_ is worth more but is easier to block high /
whiffs a croucher). **Cross-move cancel routes** reuse C6's `cancelInto: MoveId[]` +
the no-feint "connect required" property unchanged (the specific combo edges are
canonical-table content). **Target roster (the 4-strike WKF core):** `kizami-zuki`
(jab — fast/short/cheap, high·mid, 1), `gyaku-zuki` (reverse punch —
committed/mid-reach, high·mid, 1), `mae-geri` (front kick — mid-reach, mid, 2),
`mawashi-geri` (roundhouse — long/slow/expensive, high·mid, 3 _jodan_ / 2 _chudan_)
— plus the existing `sweep` + `throw`. The reach hierarchy extends jab < reverse
punch < front kick < roundhouse. **As shipped in `CANONICAL_RULES`:** reaches
`throw 120k < sweep 180k < jab 210k < reverse 240k < front 270k < roundhouse 300k`;
startups 7/7/9/11 (all ≥ `lAct+1`, reactable); per-move `staminaCost` 15/20 (punches,
≤ `gasThreshold 30`) < 35/45 (kicks, special) — so a gassed fighter keeps its punches
but loses its kicks; the cancel web is jab→reverse→{front|roundhouse}, kick→reverse, and
the sweep→reverse okizeme finisher. **It shipped additively across 7 slices** (C9 S1–S7,
PRs #67–#76), one technique at a time, preserving green tests — and the abstract `strike`
was retired in the final slice (S7.3) once all four techniques were canonical. (C10 stamina
shipped first; `staminaCost` on `MoveSpec`/`ThrowSpec` was forward-compatible, as planned.)

### P8. Platform / meta loop — ✓ RESOLVED

- **Backend stack:** **all-TypeScript.** The API imports `@modelkombat/engine`
  directly — shared `validate`/`runFight` + contract types end-to-end, one
  monorepo/toolchain, deploys on Vercel with the Solid+Pixi viewer. No
  cross-language contract drift. (Supersedes the planned Python/FastAPI
  `services/api` — update that stub + the `CLAUDE.md` mention.)
- **Ladder:** **king-of-the-hill + lineage.** A new bot challenges the reigning
  champion; win → become champion; track streaks/lineage (replayable "title
  defenses"). ELO ladder = later growth.
- **Telemetry:** **rich structured telemetry + replay.** Machine-readable
  per-exchange + aggregate stats (move usage both sides, points by band/move,
  blocked/parried/whiffed/hit-confirm rates, stamina + lead curves, key moments)
  - full deterministic replay. Counter-design fuel _and_ balance instrumentation.
    Auto NL coaching summary = trivial later add (generated _from_ this telemetry).
- **Pipeline:** `POST /fighter` (validate + store), `POST /fight` (vs champion),
  `GET /replay/:id`, `GET /spec`.

### P9. First-build scope (planning, not design)

Even "design for the full taxonomy" needs a concrete first frame table. **Likely
first slice:** a vertical slice proving the whole loop end-to-end with a **curated
subset** (a few strikes across the 3 bands, the 3 guards, one throw, one sweep,
core footwork) rendered as the stick figure in Pixi. Resolved later via the
`story-splitting` + `planning` skills, not here.

---

## Open-questions queue (what we grill next)

- ✓ P1 Stamina · ✓ P2 Movement · ✓ P3 Physics · ✓ P4 Fixed-point — **resolved**
- ✓ P5/P6 DSL synthesis — **resolved** → `docs/spec.md`
- ✓ P8 Platform/meta — **resolved** (all-TS · KotH+lineage · rich telemetry)
- ✓ P7 Move schema — **resolved → C9 arsenal** (flat moveIds · per-move `bands[]` · band-dependent WKF score · 4-strike core)
- ✓ P1 concretized → **C10 stamina** (on-commit costs · contact guard-chip · stepped gas · `L_act` opponent tell)
- **NEXT build:** C10 stamina (first), then C9 arsenal — via `story-splitting` → `planning` → TDD
- → P9 Scope — first vertical slice: hand off to `story-splitting` then `planning`
- ✓ Combat design gap #1 (ordered resolution procedure) — **resolved** → **§11**

**Design tree resolved.** Next: docs-alignment pass (CLAUDE.md / DESIGN.md /
spec.md / services-api / README reflect deep-karate + all-TS), then
`story-splitting` → `planning` → TDD build.
