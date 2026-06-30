import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { validate } from "../engine/dsl.js";

// The dogfood bot — authored COLD from `docs/spec.md` alone (the one-shot
// benchmark input), exercising the spec's sweep→cancel→finish okizeme combo to
// prove the generated spec is a sufficient authoring instrument. CI asserts its
// validity here; the full benchmark report + the documented "> half net-points"
// near-miss (the frozen gauntlet is dominated by a 100%-win sweeper) live in the
// PR description and the plan's Slice 6 notes.
describe("dogfood bot (authored from docs/spec.md)", () => {
  it("validates on the first generation", () => {
    const path = fileURLToPath(
      new URL("../../bots/dogfood.json", import.meta.url),
    );

    const doc: unknown = JSON.parse(readFileSync(path, "utf8"));
    expect(validate(doc).ok).toBe(true);
  });
});
