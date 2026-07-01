# Benchmark gauntlet measurement — `v3` (post match-structure)

The re-measure that closes the `benchmark-match-structure` feature's Slice 4. It
records the gauntlet spread and the dogfood re-read under the **WKF match** metric
(win by an 8-point gap, else most points at the 600-tick cap, with _yame_ resets),
on the post-Slice-6 frame table (`knockdownDuration` de-walled `30 → 18`).

## Frozen scoring inputs

Everything below is pinned by `BENCHMARK_VERSION` / `INPUT_HASH` in
`src/engine/benchmark-config.ts` — a change to any of it bumps the version, and
these numbers move with it.

| Input               | Value                                              |
| ------------------- | -------------------------------------------------- |
| `BENCHMARK_VERSION` | `v3`                                               |
| Rules               | `CANONICAL_RULES` (`knockdownDuration: 18`)        |
| Match               | `winGap: 8`, `MAX_TICKS: 600`                      |
| Seeds               | `1..10`                                            |
| Gauntlet            | `jabber, rekka, zoner, grappler, sweeper, vulture` |

Reproduce by running the real aggregator (`benchmark()` in
`src/engine/benchmark.ts`) with the frozen manifest for each member as the
submitted bot — 100 fights each (5 opponents × 10 seeds × 2 sides; the no-mirror
rule drops the self-match).

## Round-robin — each member as the submitted bot

Ranking is by **win-rate (primary)**; net-points is the tiebreaker only.

| Member     | Win-rate | Record (of 100) | Net   | Band `[25%, 75%]` |
| ---------- | -------- | --------------- | ----- | ----------------- |
| `rekka`    | 70.0%    | 70W 28L 2D      | +1483 | ✅ in             |
| `sweeper`  | 69.0%    | 69W 18L 13D     | +1430 | ✅ in             |
| `grappler` | 61.0%    | 61W 31L 8D      | +265  | ✅ in             |
| `zoner`    | 27.0%    | 27W 64L 9D      | −1329 | ✅ in             |
| `jabber`   | 25.0%    | 25W 72L 3D      | −1566 | ✅ in             |
| `vulture`  | 16.0%    | 16W 55L 29D     | −283  | ❌ **out (low)**  |

**5 of 6 members inside the confirmed `[25%, 75%]` band.**

Contrast with the pre-feature evidence (raw 600-tick points, no match cap): a
`sweeper` that went **100% / +4664** and collapsed the whole spread (even `jabber`
at 0 wins). The match metric alone tightened `sweeper` from 100% to a wall-like
~92%; **Slice 6's `knockdownDuration 30 → 18`** then de-walled the okizeme loop —
a swept foe now wakes before it can be re-locked, so the both-neutral _yame_
boundary arrives and a match ends decisively instead of farming the cap — landing
`sweeper` at **69%**.

## Rebalance go/no-go

- **High tail — RESOLVED.** `sweeper` (was ~100%) is now 69%, in-band. Shipped as
  **Slice 6 (PR #91)**: `knockdownDuration 30 → 18`, `BENCHMARK_VERSION → v3`.
- **Low tail — DEFERRED to a follow-up story.** `vulture` (16%) is below the band.
  It is a pure reactive defender that rarely scores; a naive offense buff
  **backfired** during exploration (a defensive bot punished for attacking). It
  needs a deliberate parry→counter redesign, out of scope for this feature. Logged
  as the **vulture follow-up story**.

`jabber` (25.0%) and `zoner` (27.0%) sit just inside the low edge — acceptable, and
watched if the band is later tightened.

## Dogfood re-read (authored cold from `docs/spec.md`)

The dogfood bot exercises the spec's sweep→cancel→finish okizeme combo. Under the
v3 match metric, versus the full gauntlet (6 opponents × 10 seeds × 2 sides = 120
fights):

| Metric   | Value               |
| -------- | ------------------- |
| Win-rate | 12.5% (15W 104L 1D) |
| Net      | −1715               |

| vs         | Record    | Net  |
| ---------- | --------- | ---- |
| `grappler` | 11W 8L 1D | +22  |
| `vulture`  | 4W 16L 0D | −115 |
| `jabber`   | 0W 20L 0D | −48  |
| `zoner`    | 0W 20L 0D | −54  |
| `sweeper`  | 0W 20L 0D | −600 |
| `rekka`    | 0W 20L 0D | −920 |

A **weak but legitimate** competitor: it takes genuine wins (beating `grappler`,
splitting some off `vulture`) rather than the degenerate 0-wins read the raw
metric produced. This record is pinned as a characterization in
`src/cli/dogfood.test.ts`.

**Net is not hard-bounded.** In matchups where _both_ bots run okizeme/cancel
loops (dogfood vs `rekka` −920, vs `sweeper` −600), the fights still farm toward
the cap because both sides mutually starve the _yame_ trigger — the same mechanism
Slice 6 fixed only for the one-sided (passive-foe) case. This does not break the
feature: ranking is by **win-rate**, which is discriminating and in-band; net is
only the tiebreaker. A deeper two-sided yame-starvation fix, if ever wanted, is a
separate capability.
