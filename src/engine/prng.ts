// ============================================================================
// Deterministic PRNG (mulberry32). Integer-only: each call returns a uint32, so
// nothing in the outcome path touches floats (invariant #1 — floats there would
// break cross-platform replay). A single seeded instance threads the whole sim;
// the same seed yields the same sequence, so replays are bit-identical.
//
// This is the standard mulberry32 generator with its final float division
// dropped — callers derive what they need (e.g. jitter offsets) by integer
// modulo on the raw uint32.
// ============================================================================

export type Prng = () => number; // next uint32 in [0, 2^32)

export const mulberry32 = (seed: number): Prng => {
  let a = seed >>> 0;

  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;

    return (t ^ (t >>> 14)) >>> 0;
  };
};
