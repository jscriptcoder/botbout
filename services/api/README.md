# services/api (planned)

Python / FastAPI orchestration layer. Not yet implemented.

Intended endpoints:
- `GET  /spec`        — frame table + DSL grammar the LLM authors against
- `POST /fighter`     — validate a bot document (reject with structured errors), store
- `POST /fight`       — run a fight (challenger vs current winner), return result + replay id
- `GET  /replay/:id`  — fetch a replay for playback

The untrusted-bot validator + interpreter live in the TypeScript engine
(`packages/engine`); this service calls the engine as a child process / sidecar
rather than reimplementing the TCB in Python. Keep the security boundary in one
place.
