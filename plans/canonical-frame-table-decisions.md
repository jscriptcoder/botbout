# Canonical frame table — resolved decisions (grill-me output)

Pre-planning decision record. Feeds `story-splitting` / `planning` → TDD.
Capability: replace the provisional `src/cli/demo-rules.ts` with a real,
authoritative `Rules` instance that the runner (and future API/viewer) consume.

## Resolved decisions

1. **Scope — today's move set only.** Canonicalize exactly what the engine reads
   today: one `strike`, the `sweep`, the `throw`, every window, perception, and
   jump physics. **No arsenal expansion, no stamina, no schema overhaul.** The
   ~24-technique arsenal, per-band WKF scoring, and stamina are each their own
   later capability.
   - **One sanctioned exception:** a single small additive engine field
     (`finishScore`, see #6) — same optional/inert pattern as every other knob.

2. **Verification — behavioral, through `runFight`.** Each meta-defining number is
   derived by a _failing fight-outcome test_ asserting a design relationship, then
   set to pass (test behavior through the public API). Pure bounds (scores ∈ 0..3,
   ordering relations) added as cheap structural asserts. The engine's existing
   `getMockRules` mocks stay **independent** — they test the engine; this suite
   tests the _table's balance_.

3. **Location / wiring.** New **`src/engine/rules.ts`** exports the canonical
   `Rules` (`CANONICAL_RULES`). New **`src/engine/rules.test.ts`** holds the
   behavioral invariant suite. The runner imports it; **`src/cli/demo-rules.ts` is
   deleted**. Reachable by the future API/viewer (engine-level single source).

4. **Perception — reaction-viable, thin margin.** `lPos ≈ 1`, `lAct ≈ 6`,
   `jitter ≈ 1`. Every committed move's `startup ≥ lAct + 1` (≈ 7) so its tell
   (band / grab / sweep) is readable in time — but only just; jitter + sharp
   timing decide the exchange. The C2/C3/C7 read game works as designed.
   (Demo's `lAct = 2` is abandoned — it neutered the keystone.)

5. **Whiff risk — punishable on whiff.** Recovery `≥ lAct + S_punish` (≈ 13) so a
   whiffed strike / sweep / throw can be reaction-punished while the whiffer is
   stuck in recovery (`canAct = 0`). Commitment carries real risk; the
   bait-whiff-punish layer is live. The triangle (strike/throw/guard), not move
   safety, is the balancer.

6. **WKF scoring.**
   - `strike` = **1** (yuko — a hand technique / poke).
   - `throw` = **3** (ippon — anti-guard reward; design-fixed).
   - `sweep` = **0** (knockdown setup; design-fixed).
   - **`finishScore` = 3** (ippon-on-downed). New optional `Rules` field; absent ⇒
     falls back to `spec.score` ⇒ byte-identical. Makes the sweep→finish path
     worth a real 3, competitive with throws.
   - `counterBonus` = modest (a read parry → counter strike ≈ waza-ari, ~+1).

7. **Neutral game — distinct reach hierarchy + approach.**
   `throw.reach < sweep.reach < strike.reach`; `startGap > strike.reach` (must
   close); `walkSpeed` tuned so reaching strike range takes ~30–60 ticks
   (0.5–1.0 s). Footsies, spacing, and whiff-baiting all matter.

8. **Depth — full C1–C8 set ON, each tuned to work.** Every engine mechanic is
   enabled with numbers proven (by a behavioral test) to function:
   - parry: tight window (~2–3 t) + real counter reward
   - cancel: hit-confirmable `strike → strike` rekka
   - jump: arc clears `lowClearance` over a sweep's active window (jump-over viable)
   - okizeme: finish reliably closable (see #9)
   - knockdown: `knockdownDuration > finishWindow` (wake-up i-frame tail exists)

9. **Okizeme route — hit-confirm cancel** (resolves the #5 ↔ #8 tension).
   `sweep.cancelInto = [strike]`. A sweep that knocks down opens the cancel
   window; the sweeper cancels its (long, punishable) recovery into the finishing
   strike, landing within a **tight `finishWindow` (~8)**. A _whiffed_ sweep never
   connects ⇒ never cancels ⇒ pays full recovery 13 ⇒ stays punishable. Okizeme
   becomes a skillful C6 hit-confirm rather than a sloppy 21-tick window.

## Derived behavioral invariants (each a RED test first)

- A band-reading guard **can** block the canonical strike (reactable: `S ≥ lAct+1`).
- A guard raised one tick too late is **hit** (not trivially reactable).
- A whiffed strike **can** be punished on recovery (`R ≥ lAct + S_punish`).
- A `throw` beats a correct-band guard (throw > guard); scores **3**.
- A `throw` whiff/stuff leaves the thrower punishable.
- A `sweep` whiffs a jumper, connects on a croucher; scores **0** + knockdown.
- A sweep knockdown **can** be hit-confirm-cancelled into a finish for **3**.
- `knockdownDuration > finishWindow` (i-frame tail).
- Fighters start **out** of strike range (`startGap > strike.reach`).
- Reach ordering `throw < sweep < strike`.
- Every score ∈ {0,1,2,3}.

## Illustrative starting numbers (to be pinned/adjusted by the tests)

```
tickRate 60 · walkSpeed 4000 · ring.width 600000 · startGap 300000
strike { startup 7, active 3, recovery 13, score 1, reach 240000, cancelInto:[strike] }
sweep  { startup 8, active 2, recovery 13, score 0, reach 200000, knockdown:true, cancelInto:[strike] }
throw  { startup 7, active 2, recovery 14, reach 120000, score 3 }
parryWindow 2 · parryRecovery 12 · counterWindow 8 · counterBonus 1 · cancelWindow 6
knockdownDuration 30 · finishWindow 8 · finishScore 3
jumpImpulse / gravity / lowClearance: arc clears low across the sweep's active window
perception { lPos 1, lAct 6, jitter 1 }
```

## "Balanced" means

Structurally sound _starting_ numbers that satisfy the master inequalities + WKF
grounding — **not** telemetry-tuned balance. The design is explicit: "the sim
tells the truth; the frame table is just a starting point." Telemetry-driven
tuning (move-usage / win-rate-by-opener targets) needs telemetry infra and a
mass-matchup harness — a **separate later capability**.

## Suggested PR breakdown (for planning to refine)

- **PR 1 — engine slice:** add optional `finishScore?: number` to `Rules`
  (`src/engine/types.ts`) + wire into `sim.ts` `computeStrike` downed branch
  (`points: rules.finishScore ?? spec.score`). TDD + mutation. Absent ⇒
  byte-identical. Small, self-contained, no table dependency.
- **PR 2 — canonical table + behavioral suite:** `src/engine/rules.ts` +
  `src/engine/rules.test.ts`. Derive every number via the RED behavioral invariants
  above.
- **PR 3 — wire-up + docs:** runner imports `CANONICAL_RULES`; delete
  `demo-rules.ts`; refresh README layout + CLAUDE.md; re-verify the example bots
  against the canonical numbers (expect different scores; update/annotate as needed).

## Explicitly deferred (not this capability)

Arsenal expansion (multi-move, per-band scoring) · stamina · P7 rich move schema ·
telemetry-tuned balance · match structure / _yame_ / rounds / WKF win conditions ·
air-actions / horizontal jump displacement.
