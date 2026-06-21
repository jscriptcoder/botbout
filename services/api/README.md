# services/api (planned — all-TypeScript)

The orchestration layer. **Not yet implemented.** All-TypeScript: it imports
`@botbout/engine` directly, so the state schema, frame table, and DSL validator
(the TCB) are **one shared contract** — no cross-language seam, no duplicated
types. Likely Fastify/Hono or Vercel serverless functions; deploys on Vercel
alongside the Solid + Pixi viewer.

Intended endpoints:
- `GET  /spec`        — frame table + DSL grammar the LLM authors against
- `POST /fighter`     — validate a bot document (reject with structured errors), store
- `POST /fight`       — run a fight (challenger vs reigning champion), return result + replay id
- `GET  /replay/:id`  — fetch a replay for playback

Meta-loop: **king-of-the-hill + lineage** (challenger fights the champion; winner
reigns). The post-fight response carries **rich structured telemetry** (move usage
both sides, points by band/move, blocked/parried/whiffed/hit-confirm rates,
stamina + lead curves, key moments) + the full deterministic replay — the fuel an
LLM uses to counter-design.

The untrusted-bot validator + interpreter live in `packages/engine`; this service
calls them in-process via the shared package. **Keep the security boundary in one
place** (the engine's `dsl.ts` allowlists).

See `docs/DESIGN.md` (§P8) and `docs/BOT-DSL.md`.
