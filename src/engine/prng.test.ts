import { describe, it, expect } from "vitest";
import { mulberry32 } from "./prng.js";

const take = (n: number, next: () => number): number[] =>
  Array.from({ length: n }, () => next());

describe("mulberry32", () => {
  it("produces the same sequence for the same seed", () => {
    expect(take(8, mulberry32(12345))).toEqual(take(8, mulberry32(12345)));
  });

  it("produces different sequences for different seeds", () => {
    expect(take(8, mulberry32(1))).not.toEqual(take(8, mulberry32(2)));
  });

  it("returns 32-bit unsigned integers", () => {
    for (const x of take(64, mulberry32(99))) {
      expect(Number.isInteger(x)).toBe(true);
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(0xffffffff);
    }
  });

  it("does not get stuck on a constant value", () => {
    expect(new Set(take(20, mulberry32(7))).size).toBeGreaterThan(1);
  });

  // Pins the exact algorithm: replays (and any external viewer) depend on this
  // sequence being stable, and it locks the internal mixing constants/operators.
  it("matches the reference sequence for a fixed seed", () => {
    expect(take(5, mulberry32(12345))).toEqual([
      4207900869, 1317490944, 2079646450, 3513001552, 2187978186,
    ]);
  });
});
