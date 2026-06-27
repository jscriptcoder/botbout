// ============================================================================
// Bot intake for the CLI runner. Untrusted JSON text → a validated BotDoc, or a
// ValidationError. EVERY path into the engine goes through the real `safeParse`
// + `validate` gate in dsl.ts (the TCB) — this file adds no trust, it only
// normalises every failure mode (oversize, forbidden key, malformed JSON,
// structural invalidity) into one ValidationError the runner can print.
// ============================================================================
import {
  safeParse,
  validate,
  ValidationError,
  type BotDoc,
} from "../engine/dsl.js";

export const loadBotDoc = (text: string): BotDoc => {
  let doc: unknown;

  try {
    doc = safeParse(text);
  } catch (e) {
    if (e instanceof ValidationError) throw e;
    // JSON.parse threw a SyntaxError (or similar) — normalise it.
    throw new ValidationError([
      { path: "$", reason: e instanceof Error ? e.message : "invalid JSON" },
    ]);
  }

  const res = validate(doc);
  if (!res.ok) throw new ValidationError(res.issues);

  // Justified assertion: `validate` returning ok is exactly the guarantee that
  // `doc` matches the BotDoc shape — that is what the TCB validator is for.
  return doc as BotDoc;
};
