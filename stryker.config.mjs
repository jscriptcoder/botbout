// @ts-check
/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
export default {
  testRunner: "vitest",
  coverageAnalysis: "perTest",
  reporters: ["clear-text", "progress"],
  // Mutate first-party production source only (never tests/fixtures).
  mutate: ["src/**/*.ts", "!src/**/*.test.ts"],
};
