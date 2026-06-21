# BotBout — Deep Karate Combat Design

> **Status:** The canonical combat + platform design. The **LOCKED** section is
> decided; **PROPOSED** sections are recommendations not yet ratified. Paired with
> `docs/BOT-DSL.md` (the bot API). **Last updated:** 2026-06-21
>
> The **non-negotiable invariants** in `.claude/CLAUDE.md` (determinism, DSL-as-data
> TCB, integer math, same-snapshot resolution) hold throughout. Karate move design
> is salvaged from the dropped **Project Pixel Fist** (its `docs/move-taxonomy.md`,
> `docs/design-brief.md`, `docs/character-rig.md` — external; see the salvage memo).

## What this is

BotBout is a platform where LLMs author fighters that battle in a deterministic
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
- **Perception latency is the keystone.** An authored bot otherwise has *perfect*
  reactions, which would make frame data meaningless (block everything on frame
  1). The fix: the opponent is perceived **delayed** — `L_pos` (~1: track *where*
  fast) and `L_act` (~6: recognize *what*/which band slow). This *derives* the
  meta from `L` via the **two master inequalities** (see LOCKED #9): reaction-block
  iff `S ≥ L_act + B`; whiff-punish iff `R ≥ L_act + S_punish`. Slide `L` and the
  whole defensive meta slides with it.
- **Balance methodology.** Don't trust the published numbers — instrument
  everything and let **bot-vs-bot** playtest balance: run thousands of matchups,
  watch move-usage and win-rate-by-opener (healthy ≈ no move >35% usage, no opener
  >60% win). The sim tells the truth; the frame table is just a starting point.

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
determinism. **Rule of thumb:** anything that affects the *outcome* is integer and
lives in the core; anything that only affects *how it looks* may be float and
lives in the render layer.

## Salvage from Project Pixel Fist

- **Move taxonomy** (`move-taxonomy.md`) — ~24 karate techniques, the move-anatomy
  schema, height→guard→scoring map, WKF scoring. The design backbone.
- **Stick-figure rig** (`core/rig.ts`) — 14-joint humanoid skeleton, forward
  kinematics, idle/stride/punch poses, facing-mirror → BotBout's visual fighter
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
see *Fixed-point representation*).

### 2. Hit model — band attribute + geometric occupancy
A move declares a discrete target **band** (`high` / `mid` / `low`) — that is what
**scoring and *uke*-matching key off**. A strike connects when the attacker is in
**`x`-reach** *and* the defender's hurtbox **occupies that band**. The continuous
`y` drives traversal *and* band occupancy: crouching vacates `high` (a *jodan*
kick whiffs a croucher); jumping vacates `low` and enters an airborne band (a
sweep whiffs a jumper). **Bots reason in 3 bands; the renderer reasons in exact
`y`.** FK/trig stays in the render layer; the core needs only band occupancy +
`x`-reach + simple AABB. (Full limb-accurate geometric hits = possible later slice
*if* we pay for fixed-point FK.)

### 3. Combos — on-contact cancels only
A move may cancel into another (per `cancelInto` windows) **only on hit or block —
never on whiff.** Because feints come from whiff-cancelling, forbidding them means
you can only cancel something the opponent *already perceived connect* → real
combos + WKF score escalation, with the **no-feint / pure-perception** property
intact. Adds a `cancelable` state + per-move cancel-route data.

### 4. Guards — 3 height-keyed
Three mechanically-distinct guards: `block-high` (*age-uke*), `block-mid`
(*soto/uchi-uke*), `block-low` (*gedan-barai*) — a clean 3-way read mirroring the
3 attack bands, each **rendered/named** as its authentic *uke*. Wrong-height guard
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
A clean **throw/takedown** (*o-goshi*), if not broken, grounds the opponent and
**scores 3 directly**. A **sweep** (*ashi-barai*) knocks down (low/no score) and
opens **exactly one** guaranteed follow-up "finish" window before the opponent
wakes with **i-frames**. WKF *ippon* drama + sweep setups, **no ground loops**.
The throw triangle is locked: **strike > throw > guard > strike**; `throw-break`
escapes throws; strikes interrupt throw startup.

### 7. Match structure — point-exchange resets (*yame*)
After a scoring technique lands *and its combo/advantage sequence fully resolves*
(okizeme window closes / fighters return to neutral): call ***yame***, award that
exchange's accumulated points (the **1→2→3 escalation happens within the
exchange**), **reset both to neutral start**, continue. Win by **8-point gap or
most points at the time limit**. **`jogai`** (ring exit) and **passivity** are
**penalties**, not instant loss. Each fight = a sequence of clean, replayable
exchanges.

> See **#10** below — confirmed: no HP bar, points only.

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

---

## PROPOSED (my recommendation — open for the interview)

Each section: my recommendation, why, and the live alternative. Status: **OPEN**.

### P1. Stamina economy — ✓ RESOLVED (light layer, soft penalties + block chip)
**Recommendation:** a *light* layer. Every move costs stamina; stamina regens in
neutral. **Gassing** (low stamina) ⇒ **reduced knockback + longer recovery + no
specials/throws** (never "cannot act", never a win condition). **Blocking** costs
a small stamina chip; **parry** costs more (risk). Primary anti-turtle is the
**throw** (beats guard); stamina-on-block is a secondary, gentle anti-turtle.
**Why:** matches the locked brief ("light conditioning, gassing = slower/weaker/
punishable, never a win condition"); curbs spam; gives pacing without a second
health bar. **Alternative:** hard gate (at 0 stamina, basics only) — more
punishing, more swingy.

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

### P5/P6. DSL action grammar + state schema — ✓ RESOLVED → see `docs/BOT-DSL.md`
Synthesized into a full spec: reactive one-action-per-tick; attacks parameterized
by band; implicit on-contact cancels (combos via `canCancel` + memory);
**let-bindings** added to cut verbosity; expanded state schema (2D, posture,
cancel/knockdown state, points, scoreGap). The sketch below is retained for
context.

The bot still returns **one action per tick**; the engine is the loop. New shape
(finalized in `docs/BOT-DSL.md`):
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
+ taxonomy anatomy + BotBout `MoveSpec`:
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

### P8. Platform / meta loop — ✓ RESOLVED
- **Backend stack:** **all-TypeScript.** The API imports `@botbout/engine`
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
  + full deterministic replay. Counter-design fuel *and* balance instrumentation.
  Auto NL coaching summary = trivial later add (generated *from* this telemetry).
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
- ✓ P5/P6 DSL synthesis — **resolved** → `docs/BOT-DSL.md`
- ✓ P8 Platform/meta — **resolved** (all-TS · KotH+lineage · rich telemetry)
- ◻ P7 Move schema — settled by default (revisit when authoring the frame table at build)
- → P9 Scope — first vertical slice: hand off to `story-splitting` then `planning`

**Design tree resolved.** Next: docs-alignment pass (CLAUDE.md / DESIGN.md /
BOT-DSL.md / services-api / README reflect deep-karate + all-TS), then
`story-splitting` → `planning` → TDD build.
