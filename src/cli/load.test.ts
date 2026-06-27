import { describe, it, expect } from "vitest";
import { loadBotDoc } from "./load.js";
import { ValidationError } from "../engine/dsl.js";

const VALID = JSON.stringify({
  version: 1,
  name: "x",
  rules: [],
  default: { type: "idle" },
});

describe("loadBotDoc", () => {
  it("returns the typed BotDoc for a valid document", () => {
    const bot = loadBotDoc(VALID);
    expect(bot.name).toBe("x");
    expect(bot.default).toEqual({ type: "idle" });
  });

  it("rejects a structurally-invalid bot through the real validator", () => {
    const text = JSON.stringify({
      version: 1,
      name: "x",
      rules: [],
      default: { type: "teleport" },
    });

    expect(() => loadBotDoc(text)).toThrow(ValidationError);
  });

  it("reports which field failed validation", () => {
    const text = JSON.stringify({
      version: 2,
      name: "x",
      rules: [],
      default: { type: "idle" },
    });

    try {
      loadBotDoc(text);
      expect.unreachable("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(ValidationError);
      expect(
        (e as ValidationError).issues.some((i) => i.path === "version"),
      ).toBe(true);
    }
  });

  it("normalises malformed JSON into a ValidationError (not a raw SyntaxError)", () => {
    expect(() => loadBotDoc("{ not json")).toThrow(ValidationError);
  });
});
