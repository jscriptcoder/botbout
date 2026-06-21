# Design

The full rationale behind the combat model and architecture. Read alongside
`BOT-DSL.md` (authoring grammar) and the engine source.

## What this is

LLMs (Claude, Gemini, GPT, …) author fighters. A bot is submitted **once** as a
JSON document, but it executes **reactively**: the engine calls its decision
logic every tick. Closest precedents: Robocode, Battlecode, Toribash. We use a
discrete move set (not continuous joint control) because it's balanceable and
LLMs reason about it well.

## Control model: policy author, not real-time controller

The LLM does not control the fighter live (LLM latency would kill the pace, cost
per fight, and — fatally — break replay determinism). Instead it authors a policy
once; that policy runs at full speed inside the engine. Deterministic, cheap,
replayable.

## Combat model

### The move triangle (counterplay spine)

Four move classes give rock-paper-scissors so no move dominates:

- **Strike** (punch/kick) — blocked by guard; beaten by dodge; trades with strikes.
- **Grab** — **beats block** (unblockable); loses to strikes (slow startup) and dodge.
- **Block** — stops strikes (chip only); loses to grab; drains stamina per hit.
- **Dodge** — i-frames beat strike and grab; high stamina cost; punishable recovery.

### Frame data

Every move runs **startup → active → recovery** at 60 ticks/s. Starting values
(`packages/engine/src/rules.ts`, tune via Frame Lab):

| Move  | Startup | Active | Recovery | Dmg | Stam | Range | On-block |
|-------|--------:|-------:|---------:|----:|-----:|------:|---------:|
| Punch | 4       | 2      | 6        | 6   | 5    | 60    | −2       |
| Kick  | 10      | 3      | 14       | 16  | 14   | 110   | −8       |
| Grab  | 8       | 2      | 18       | 14  | 12   | 55    | (unblockable) |
| Dodge | 3       | —      | 8        | —   | 18   | —     | i-frames 3–12 |

On-block advantage is the commitment layer: punch (−2) is a safe poke; kick (−8)
is a hard commit you eat a punish for if blocked/whiffed.

### Perception latency — the keystone

An LLM-authored bot otherwise has *perfect* reactions, which makes frame data
meaningless (it would block everything on frame 1). Fix: the opponent is seen
**delayed by L ticks** — the bot-world equivalent of reaction time. Two latencies:
`L_pos ≈ 1` (you track *where* fast) and `L_act ≈ 6` (you recognize *what* slow).

This yields **two master inequalities** that *derive* the meta from L:

- **Reaction-block:** blockable on sight iff `move.startup ≥ L_act + block.raise`.
- **Whiff-punish:** punishable on recovery iff `move.recovery ≥ L_act + punch.startup`.

At the default L=6: punch (recovery 6) is **always safe**; kick (recovery 14) is
**always punishable**; grab (recovery 18) is **always whiff-punishable**. Slide L
to retune the whole defensive meta: low L → reaction/turtle meta; high L → pure
reads/spacing meta. **L=6 ("Footsies")** is the v1 sweet spot — fast moves must be
respected, slow moves are reactable and punishable.

The `staleness` field is exposed to bots on purpose so they can **dead-reckon**
(`opp.x + opp.vx * staleness`) — leading a moving target is real skill, not cheating.

### Macro layer: stamina + ring

**Stamina** gates spam; blocking costs stamina per hit, so a turtle eventually
drains and chip kills it — aggression beats passivity over time. The **1D ring
with edges** (ring-out = loss) plus block pushback means a cornered turtle gets
shoved out. Together they guarantee doing nothing loses.

## Decisions baked in (each is a reversible fork)

- **Reactive per-tick policy** with persistent per-fight memory (enables in-fight
  adaptation / opponent prediction).
- **Self = live; opponent = coherent delayed snapshot**, with `staleness` exposed.
- **Full frame table exposed** to bots (`RULES`) — LLMs reason great with numbers.
- **Transparent move identity** (`opponent.move` names the move) — feints are v2.
- **Auto-facing** in the 1D ring (removes a footgun; `dir` is relative).
- **No cancels** — moves are committed start→recovery; actions while locked ignored.
- **Failure ⇒ telemetry, never a crash** (illegal/unaffordable/over-budget ⇒ idle + log).
- **DSL, not sandboxed JS** — smaller TCB, safe by construction, bounded cost,
  integer math ⇒ bit-identical replays. (See `BOT-DSL.md`.)

## Open forks (not yet decided)

- **Input buffering** (sharper combos vs slight determinism risk). Currently off.
- **Hidden info**: coarse opponent stamina bands instead of exact values (more
  reads, harder to balance). Currently exact.
- **Feints / mid-move cancels** (mind-games layer; feint power scales with L).
  Deferred to keep the delayed stream pure truth.
- **`L` as a per-fighter stat** (reflex archetypes). Optional balance surface.

## Balance methodology

Instrument everything and let bot-vs-bot playtest balance for you. Run thousands
of matchups; watch move-usage distribution and win-rate-by-opening-move. Healthy:
no move > ~35% usage, no opener > ~60% win-rate. The published frame numbers are a
starting point — the sim tells the truth.

## Replay

Persist `{ seed, rulesHash, botA, botB, initialConditions }`. Re-running the sim
from these reproduces the fight tick-for-tick. The per-tick event log is derived.
Pin fixed-point math so replays are identical across machines.
