import { describe, it, expect } from "vitest";
import { runFight, type FightConfig, type FightEvent } from "./sim.js";
import type { BotDoc, BoolExpr } from "./dsl.js";
import type { Rules, Band, Action, MoveSpec, ThrowSpec } from "./types.js";
import { CANONICAL_RULES } from "./rules.js";

// ─── bot fixtures (mirroring the engine-test helpers — fixtures, not shared knowledge) ──
const bot = (rules: BotDoc["rules"], dflt: Action): BotDoc => ({
  version: 1,
  name: "b",
  rules,
  default: dflt,
});

const IDLE = bot([], { type: "idle" });

// Commits exactly one strike (at the given band) on the first tick, then idles.
const strikeOnce = (band: Band): BotDoc => ({
  version: 1,
  name: "atk1",
  memory: { fired: 0 },
  rules: [
    {
      when: {
        op: "eq",
        args: [
          { op: "mem", cell: "fired" },
          { op: "const", value: 0 },
        ],
      },
      set: [{ cell: "fired", to: { op: "const", value: 1 } }],
      do: { type: "attack", move: "strike", band },
    },
  ],
  default: { type: "idle" },
});

// Mirrors the PERCEIVED incoming attack band into a same-band guard (3 ⇒ high,
// 2 ⇒ mid, 1 ⇒ low; 0 ⇒ idle). A pure read of the L_act-delayed opponent.attackBand.
const BAND_MIRROR: BotDoc = bot(
  [
    {
      when: {
        op: "eq",
        args: [
          { op: "field", path: "opponent.attackBand" },
          { op: "const", value: 3 },
        ],
      },
      do: { type: "block", band: "high" },
    },
    {
      when: {
        op: "eq",
        args: [
          { op: "field", path: "opponent.attackBand" },
          { op: "const", value: 2 },
        ],
      },
      do: { type: "block", band: "mid" },
    },
    {
      when: {
        op: "eq",
        args: [
          { op: "field", path: "opponent.attackBand" },
          { op: "const", value: 1 },
        ],
      },
      do: { type: "block", band: "low" },
    },
  ],
  { type: "idle" },
);

// ─── small expression helpers ────────────────────────────────────────────────
const clk = (op: "eq" | "gt" | "lt" | "gte" | "lte", n: number): BoolExpr => ({
  op,
  args: [
    { op: "field", path: "clock.tick" },
    { op: "const", value: n },
  ],
});

const all = (...args: BoolExpr[]): BoolExpr => ({ op: "and", args });

// Strikes `band` whenever free to act — so its recorded attack ticks reveal recovery
// length (the gap between strikes is how long it was committed).
const restrikeWhenFree = (band: Band): BotDoc =>
  bot(
    [
      {
        when: {
          op: "eq",
          args: [
            { op: "field", path: "self.canAct" },
            { op: "const", value: 1 },
          ],
        },
        do: { type: "attack", move: "strike", band },
      },
    ],
    { type: "idle" },
  );

// Blocks `band` from tick `from` onward — `from` sets the guard's age at the active frame.
const guardFrom = (from: number, band: Band): BotDoc =>
  bot([{ when: clk("gte", from), do: { type: "block", band } }], {
    type: "idle",
  });

// Crouches (vacating `high`) while tick < until, then stands — ducks a high opener's active
// frame yet stands later, so a wrongly-cancelled follow-up WOULD land (proving it doesn't).
const crouchUntil = (until: number): BotDoc =>
  bot([{ when: clk("lt", until), do: { type: "crouch" } }], { type: "idle" });

// Strikes `band` at each listed tick — a tick-0 opener plus later cancel attempts.
const strikeAtTicks = (ticks: number[], band: Band): BotDoc =>
  bot(
    ticks.map((t) => ({
      when: clk("eq", t),
      do: { type: "attack", move: "strike", band },
    })),
    { type: "idle" },
  );

// Strikes mid on every free tick (an attacker that gets parried, then sits in recovery).
const STRIKER = bot([], { type: "attack", move: "strike", band: "mid" });

// Parries with a fresh mid guard at `parryTick`, then throws a mid counter the next tick.
const parryThenCounter = (parryTick: number): BotDoc =>
  bot(
    [
      { when: clk("eq", parryTick), do: { type: "block", band: "mid" } },
      {
        when: clk("eq", parryTick + 1),
        do: { type: "attack", move: "strike", band: "mid" },
      },
    ],
    { type: "idle" },
  );

// The ticks a side started a fresh move (a gap between them is its recovery length).
const attackTicks = (events: FightEvent[], side: "a" | "b"): number[] =>
  events.flatMap((e, t) => (e[side].action.type === "attack" ? [t] : []));

// ─── lazy readers of the canonical numbers ────────────────────────────────────
// Read on call (inside tests/builders), never at module load — so a malformed table
// fails an assertion in a test rather than throwing at collection time.
const strike = (): MoveSpec => CANONICAL_RULES.moves.strike;
const lAct = (): number => CANONICAL_RULES.perception?.lAct ?? 0;

const throwSpec = (): ThrowSpec => {
  const t = CANONICAL_RULES.throw;
  if (!t) throw new Error("CANONICAL_RULES.throw is not configured");

  return t;
};

const sweepSpec = (): MoveSpec => {
  const s = CANONICAL_RULES.moves.sweep;
  if (!s) throw new Error("CANONICAL_RULES.moves.sweep is not configured");

  return s;
};

const fight = (o: Partial<FightConfig> = {}): FightConfig => ({
  rules: CANONICAL_RULES,
  botA: IDLE,
  botB: IDLE,
  maxTicks: 60,
  seed: 1,
  ...o,
});

// The canonical table positioned inside strike range and de-jittered, so the read-game
// inequalities resolve deterministically (jitter's seed-dependence at the knife-edge is
// proven generically in perception.test.ts — here we pin the nominal-latency backbone).
const deterministic = (o: Partial<Rules> = {}): Rules => ({
  ...CANONICAL_RULES,
  startGap: 200000, // inside strike.reach (240000) ⇒ a strike can connect
  perception: { ...CANONICAL_RULES.perception, jitter: 0 },
  ...o,
});

const withStartup = (startup: number): Rules =>
  deterministic({
    moves: {
      ...CANONICAL_RULES.moves,
      strike: { ...strike(), startup },
    },
  });

// Positioned inside GRAB range (closer than strike range) and de-jittered — the throw
// reach (120000) is shorter than the strike's, so the deterministic() gap (200000) is
// out of grab range; grab tests need the pair closer.
const grappleFight = (o: Partial<FightConfig> = {}): FightConfig =>
  fight({ rules: deterministic({ startGap: 100000 }), ...o });

const withThrowStartup = (startup: number): Rules =>
  deterministic({
    startGap: 100000, // within grab reach ⇒ a grab can connect or be broken
    throw: { ...throwSpec(), startup },
  });

// Positioned inside SWEEP range (180000) — between grab range and the deterministic() gap —
// and de-jittered, so an in-range sweep connects on a grounded target.
const sweepFight = (o: Partial<FightConfig> = {}): FightConfig =>
  fight({ rules: deterministic({ startGap: 150000 }), ...o });

describe("CANONICAL_RULES — structural shape", () => {
  it("scores a clean strike as a single WKF yuko", () => {
    expect(strike().score).toBe(1);
  });

  it("starts fighters outside strike range (must close to hit)", () => {
    expect(CANONICAL_RULES.startGap).toBeGreaterThan(strike().reach);
  });

  it("makes the strike reactable but only just (startup = lAct + 1)", () => {
    expect(strike().startup).toBe(lAct() + 1);
  });

  it("makes a whiff punishable (recovery ≥ lAct + startup)", () => {
    expect(strike().recovery).toBeGreaterThanOrEqual(lAct() + strike().startup);
  });

  it("ships a reaction-viable, jittered perception layer", () => {
    expect(CANONICAL_RULES.perception?.lPos).toBe(1);
    expect(CANONICAL_RULES.perception?.lAct).toBe(6);
    expect(CANONICAL_RULES.perception?.jitter).toBe(1);
  });
});

describe("CANONICAL_RULES — neutral game (start out of range)", () => {
  it("an idle pair never scores — the start gap exceeds strike reach", () => {
    const result = runFight(fight({ botA: IDLE, botB: IDLE }));
    expect(result.scores).toEqual({ a: 0, b: 0 });
  });

  it("a strike thrown from the start position whiffs — you must close before you can hit", () => {
    // strikeOnce fires at tick 0 from the full start gap (300000) with reach 240000 ⇒ out of range.
    const result = runFight(
      fight({ botA: strikeOnce("mid"), botB: IDLE, maxTicks: 30 }),
    );

    expect(result.scores.a).toBe(0);
  });
});

describe("CANONICAL_RULES — a clean strike scores", () => {
  it("scores exactly 1 against an undefended foe in range", () => {
    const result = runFight(
      fight({
        rules: deterministic(),
        botA: strikeOnce("mid"),
        botB: IDLE,
        maxTicks: 30,
      }),
    );

    expect(result.scores.a).toBe(1);
  });
});

describe("CANONICAL_RULES — the strike read-game (reactable iff startup ≥ lAct+1)", () => {
  // BAND_MIRROR reads the delayed attackBand and guards that height; strikeOnce commits the strike.
  // scores.b is the attacker's score: 0 ⇒ the guard read & blocked, 1 ⇒ the strike landed.
  const counterEats = (band: Band, startup: number): number =>
    runFight(
      fight({
        rules: withStartup(startup),
        botA: BAND_MIRROR,
        botB: strikeOnce(band),
        maxTicks: 40,
      }),
    ).scores.b;

  it("a band-reading guard blocks the canonical strike at either height (the read is load-bearing)", () => {
    expect(counterEats("high", strike().startup)).toBe(0);
    expect(counterEats("low", strike().startup)).toBe(0);
  });

  it("no single fixed-height guard could do this — a fixed mid guard eats the high strike", () => {
    const fixedMid = bot([], { type: "block", band: "mid" });

    const scoreB = runFight(
      fight({
        rules: withStartup(strike().startup),
        botA: fixedMid,
        botB: strikeOnce("high"),
        maxTicks: 40,
      }),
    ).scores.b;

    expect(scoreB).toBe(1);
  });

  it("one tick faster (startup = lAct) beats the same read — the tell arrives too late", () => {
    expect(counterEats("high", lAct())).toBe(1);
  });
});

describe("CANONICAL_RULES — a whiffed strike is punishable", () => {
  it("a high strike whiffed over a croucher is punished during its long recovery", () => {
    const S = strike().startup; // active window opens at elapsed = startup
    const A = strike().active;

    // Punisher: crouch through the attacker's active window (duck the high strike), then strike
    // into its recovery. recovery ≥ lAct + startup is what lets the reaction land before wake-up.
    const punisher = bot(
      [
        {
          when: all(clk("gte", S), clk("lte", S + A - 1)),
          do: { type: "crouch" },
        },
        {
          when: clk("eq", S + A),
          do: { type: "attack", move: "strike", band: "mid" },
        },
      ],
      { type: "idle" },
    );

    const result = runFight(
      fight({
        rules: deterministic(),
        botA: punisher,
        botB: strikeOnce("high"),
        maxTicks: 40,
      }),
    );

    expect(result.scores.b).toBe(0); // the high strike whiffed over the crouch
    expect(result.scores.a).toBe(1); // and was punished during recovery
  });
});

// ─── Slice 3: the strike's defensive answers (parry / counter / cancel / crouch) ──

describe("CANONICAL_RULES — parry deflects and punishes (C5)", () => {
  // Runs a re-striking attacker into a `from`-aged mid guard; reports when its 2nd strike starts
  // (a later tick = longer recovery) and whether it scored. Comparing across guard ages — never
  // against a config-derived constant — is what gives the parry numbers real teeth.
  const vsGuard = (from: number): { secondStrike: number; scoreA: number } => {
    const result = runFight(
      fight({
        rules: deterministic(),
        botA: restrikeWhenFree("mid"),
        botB: guardFrom(from, "mid"),
        maxTicks: 60,
      }),
    );

    return {
      secondStrike: attackTicks(result.events, "a")[1],
      scoreA: result.scores.a,
    };
  };

  it("a fresh matching guard parries — no score, and the attacker eats extra recovery", () => {
    const firstActive = strike().startup; // the active window opens at elapsed = startup
    const fresh = vsGuard(firstActive); // guard up on the active frame ⇒ age 1 ⇒ PARRY
    const stale = vsGuard(0); // held since tick 0 ⇒ stale ⇒ BLOCK

    expect(fresh.scoreA).toBe(0); // deflected — never scored
    expect(fresh.secondStrike).toBeGreaterThan(stale.secondStrike); // parry adds recovery
  });

  it("the parry window is tight: a guard one tick older only blocks", () => {
    // A guard raised at `from` has age (firstActive − from + 1) on the active frame. With
    // parryWindow 2: age 2 (from = firstActive−1) parries; age 3 (from = firstActive−2) blocks —
    // so the younger guard's attacker eats strictly more recovery only at exactly window 2.
    const firstActive = strike().startup;

    expect(vsGuard(firstActive - 1).secondStrike).toBeGreaterThan(
      vsGuard(firstActive - 2).secondStrike,
    );
  });
});

describe("CANONICAL_RULES — counter rewards the read (C5)", () => {
  it("a counter strike after a parry scores base + counterBonus (≈ waza-ari)", () => {
    const result = runFight(
      fight({
        rules: deterministic(),
        botA: STRIKER, // strikes mid, gets parried, sits in extended recovery
        botB: parryThenCounter(strike().startup), // parry on the active frame, counter next tick
        maxTicks: 40,
      }),
    );

    expect(result.scores).toEqual({ a: 0, b: 2 }); // base 1 + counterBonus 1
  });
});

describe("CANONICAL_RULES — on-contact cancel (C6 rekka)", () => {
  it("a connecting strike cancels into a follow-up — two hits in one exchange", () => {
    // Opener at tick 0 connects on its active frame, opening the cancel window; a follow-up `attack`
    // one tick into recovery cancels into a second strike that also lands ⇒ score 2.
    const cancelTick = strike().startup + strike().active; // the first recovery frame

    const result = runFight(
      fight({
        rules: deterministic(),
        botA: strikeAtTicks([0, cancelTick], "mid"),
        botB: IDLE,
        maxTicks: 40,
      }),
    );

    expect(result.scores.a).toBe(2); // opener + cancelled follow-up
  });

  it("a whiffed strike never opens the cancel window (no feint)", () => {
    // The high opener whiffs over a croucher (never connects), so the cancel attempt is inert. The
    // croucher stands again from the cancel tick, so a wrongly-enabled cancel's follow-up WOULD
    // land — proving it does not.
    const cancelTick = strike().startup + strike().active;

    const result = runFight(
      fight({
        rules: deterministic(),
        botA: strikeAtTicks([0, cancelTick], "high"),
        botB: crouchUntil(cancelTick),
        maxTicks: 40,
      }),
    );

    expect(result.scores.a).toBe(0); // whiff ⇒ no cancel ⇒ no follow-up
  });
});

describe("CANONICAL_RULES — crouch ducks a high strike (occupancy)", () => {
  it("a high canonical strike whiffs a croucher", () => {
    const result = runFight(
      fight({
        rules: deterministic(),
        botA: strikeOnce("high"),
        botB: crouchUntil(60), // crouches the whole fight ⇒ vacates high
        maxTicks: 30,
      }),
    );

    expect(result.scores.a).toBe(0);
  });
});

describe("CANONICAL_RULES — defensive structural shape", () => {
  it("ships a tight parry window with real extra recovery", () => {
    expect(CANONICAL_RULES.parryWindow).toBe(2);
    expect(CANONICAL_RULES.parryRecovery ?? 0).toBeGreaterThan(0);
  });

  it("ships a counter window wide enough for a startup-7 counter, worth one yuko", () => {
    expect(CANONICAL_RULES.counterWindow ?? 0).toBeGreaterThan(
      strike().startup,
    );
    expect(CANONICAL_RULES.counterBonus).toBe(1);
  });

  it("ships a cancel window and a self-rekka route", () => {
    expect(CANONICAL_RULES.cancelWindow ?? 0).toBeGreaterThan(0);
    expect(strike().cancelInto).toContain("strike");
  });
});

// ─── Slice 4: the throw triangle (throw > guard, strike > throw, read-breakable) ──

// Throws once at tick 0, then idles — a single grab-active window to observe.
const throwOnce: BotDoc = bot([{ when: clk("eq", 0), do: { type: "throw" } }], {
  type: "idle",
});

// Returns throw-break the instant it PERCEIVES the opponent committing to a grab
// (a pure read of the L_act-delayed opponent.throwing tell).
const REACTIVE_BREAKER: BotDoc = bot(
  [
    {
      when: {
        op: "eq",
        args: [
          { op: "field", path: "opponent.throwing" },
          { op: "const", value: 1 },
        ],
      },
      do: { type: "throw-break" },
    },
  ],
  { type: "idle" },
);

// Advances toward the opponent whenever free — its x stalls while it is downed.
const ADVANCER: BotDoc = bot([], { type: "move", dir: 1 });

// Throws at tick 0, then holds a mid guard — so if its throw does NOT commit it, it
// blocks an incoming mid strike (the contrast that proves a whiffed grab is committed).
const throwThenGuard: BotDoc = bot(
  [
    { when: clk("eq", 0), do: { type: "throw" } },
    { when: clk("gte", 1), do: { type: "block", band: "mid" } },
  ],
  { type: "idle" },
);

describe("CANONICAL_RULES — throw structural shape", () => {
  it("scores a clean throw as a WKF ippon (3)", () => {
    expect(throwSpec().score).toBe(3);
  });

  it("puts the throw-break on the reaction knife-edge (startup = lAct + 1)", () => {
    expect(throwSpec().startup).toBe(lAct() + 1);
  });

  it("makes a whiffed throw punishable (recovery ≥ lAct + strike startup)", () => {
    expect(throwSpec().recovery).toBeGreaterThanOrEqual(
      lAct() + strike().startup,
    );
  });

  it("is shorter-range than the strike (a grab must be close)", () => {
    expect(throwSpec().reach).toBeLessThan(strike().reach);
  });

  it("knocks the defender down for a real duration", () => {
    expect(CANONICAL_RULES.knockdownDuration ?? 0).toBeGreaterThan(0);
  });
});

describe("CANONICAL_RULES — a throw beats a guard (throw > guard)", () => {
  it("grabs a guarding defender for an ippon — the unbanded grab ignores the block", () => {
    const result = runFight(
      grappleFight({
        botA: throwOnce,
        botB: bot([], { type: "block", band: "mid" }),
        maxTicks: 20,
      }),
    );

    expect(result.scores.a).toBe(3);
  });
});

describe("CANONICAL_RULES — a throw knocks the defender down", () => {
  it("freezes a thrown advancer for the knockdown, then it moves again", () => {
    const grab = throwSpec().startup; // grab-active opens at elapsed = startup
    const wake = grab + (CANONICAL_RULES.knockdownDuration ?? 0); // neutral again here

    const result = runFight(
      grappleFight({ botA: throwOnce, botB: ADVANCER, maxTicks: wake + 5 }),
    );

    expect(result.events[wake - 1].b.x).toBe(result.events[grab + 1].b.x); // frozen while downed
    expect(result.events[wake].b.x).not.toBe(result.events[wake - 1].b.x); // moves again on wake
  });
});

describe("CANONICAL_RULES — a strike stuffs a colliding throw (strike > throw)", () => {
  it("an active strike voids a colliding throw that otherwise scores uncontested", () => {
    // Baseline: the grab alone downs the idle defender for 3 — it works in this position.
    const uncontested = runFight(
      grappleFight({ botA: throwOnce, botB: IDLE, maxTicks: 20 }),
    ).scores.a;

    // Contested: a strike whose active window (7–9) overlaps the grab-active window (7–8)
    // stuffs it — strike > throw, so the strike scores and the same grab is voided.
    const contested = runFight(
      grappleFight({ botA: throwOnce, botB: strikeOnce("mid"), maxTicks: 20 }),
    );

    expect(uncontested).toBe(3); // the throw scores uncontested
    expect(contested.scores.b).toBe(1); // the colliding strike landed
    expect(contested.scores.a).toBe(0); // and voided the throw — no ippon
  });
});

describe("CANONICAL_RULES — the throw-break read-game (escapable iff startup ≥ lAct+1)", () => {
  // REACTIVE_BREAKER breaks the instant it perceives the grab; throwOnce commits one grab.
  // scores.b is the thrower's score: 0 ⇒ the grab was broken, 3 ⇒ it landed.
  const reactableBreak = (startup: number): number =>
    runFight(
      fight({
        rules: withThrowStartup(startup),
        botA: REACTIVE_BREAKER,
        botB: throwOnce,
        maxTicks: 30,
      }),
    ).scores.b;

  it("a reaction break escapes the canonical throw, but not one a tick faster", () => {
    expect(reactableBreak(throwSpec().startup)).toBe(0); // startup = lAct+1 ⇒ break is up ⇒ escaped
    expect(reactableBreak(lAct())).toBe(3); // startup = lAct ⇒ tell arrives too late ⇒ grabbed
  });
});

describe("CANONICAL_RULES — a whiffed throw is punishable", () => {
  it("a grab out of range whiffs, and its recovery stops the thrower defending the punish", () => {
    // deterministic() positions the pair at 200000: outside grab reach (120000) but inside
    // strike reach (240000), so the throw whiffs. The thrower would block the mid punish if
    // free — committing to the grab's recovery is exactly what leaves it open (b:1, not 0).
    const result = runFight(
      fight({
        rules: deterministic(),
        botA: throwThenGuard, // grab whiffs out of range; then it tries to guard
        botB: strikeAtTicks([throwSpec().startup + throwSpec().active], "mid"),
        maxTicks: 40,
      }),
    );

    expect(result.scores.a).toBe(0); // the throw whiffed
    expect(result.scores.b).toBe(1); // committed in recovery, it couldn't block ⇒ punished
  });
});

// ─── Slice 5a: the sweep (low knockdown strike) + the okizeme finish ──────────────

// Sweeps once at tick 0, then idles — a single knockdown to observe.
const sweepOnce: BotDoc = bot([{ when: clk("eq", 0), do: { type: "sweep" } }], {
  type: "idle",
});

// Sweeps at tick 0, then holds a mid guard — so if its sweep does NOT commit it, it
// blocks the incoming mid punish (the contrast that proves a whiffed sweep is committed).
const sweepThenGuard: BotDoc = bot(
  [
    { when: clk("eq", 0), do: { type: "sweep" } },
    { when: clk("gte", 1), do: { type: "block", band: "mid" } },
  ],
  { type: "idle" },
);

describe("CANONICAL_RULES — sweep & okizeme structural shape", () => {
  it("is a low knockdown strike that scores nothing", () => {
    expect(sweepSpec().score).toBe(0);
    expect(sweepSpec().knockdown).toBe(true);
  });

  it("cancels into the strike (the hit-confirm finish route)", () => {
    expect(sweepSpec().cancelInto).toContain("strike");
  });

  it("completes the reach hierarchy throw < sweep < strike", () => {
    expect(throwSpec().reach).toBeLessThan(sweepSpec().reach);
    expect(sweepSpec().reach).toBeLessThan(strike().reach);
  });

  it("keeps the sweep reactable (startup = lAct+1) and its whiff punishable", () => {
    expect(sweepSpec().startup).toBe(lAct() + 1);
    expect(sweepSpec().recovery).toBeGreaterThanOrEqual(
      lAct() + strike().startup,
    );
  });

  it("pays the finish as an ippon, inside a window shorter than the knockdown", () => {
    expect(CANONICAL_RULES.finishScore).toBe(3);
    expect(CANONICAL_RULES.finishWindow ?? 0).toBeGreaterThan(0);
    expect(CANONICAL_RULES.knockdownDuration ?? 0).toBeGreaterThan(
      CANONICAL_RULES.finishWindow ?? 0,
    );
  });
});

describe("CANONICAL_RULES — a sweep downs a grounded foe for no score", () => {
  it("sweeps an advancer: scores 0, freezes it for the knockdown, then it moves again", () => {
    const knock = sweepSpec().startup; // knockdown on the first active frame (elapsed = startup)
    const wake = knock + (CANONICAL_RULES.knockdownDuration ?? 0); // neutral again here

    const result = runFight(
      sweepFight({ botA: sweepOnce, botB: ADVANCER, maxTicks: wake + 5 }),
    );

    expect(result.scores.a).toBe(0); // a sweep scores nothing
    expect(result.events[wake - 1].b.x).toBe(result.events[knock + 1].b.x); // frozen while downed
    expect(result.events[wake].b.x).not.toBe(result.events[wake - 1].b.x); // moves again on wake
  });
});

describe("CANONICAL_RULES — a sweep is a low-band strike (banded by occupancy)", () => {
  // Guards `band` over the sweep's active frame (tick ≤ startup), then advances — so x at two
  // in-knockdown ticks reveals whether the sweep was blocked (free ⇒ moved) or landed (downed ⇒ frozen).
  const sweptFrozen = (posture: BotDoc): boolean => {
    const result = runFight(
      sweepFight({ botA: sweepOnce, botB: posture, maxTicks: 24 }),
    );

    return result.events[20].b.x === result.events[9].b.x;
  };

  // Hold the posture across the sweep's WHOLE active window (ticks startup..startup+active-1),
  // then advance — dropping it on any active frame would itself be swept.
  const activeEnd = (): number => sweepSpec().startup + sweepSpec().active;

  const guardThenAdvance = (band: Band): BotDoc =>
    bot([{ when: clk("lt", activeEnd()), do: { type: "block", band } }], {
      type: "move",
      dir: 1,
    });

  it("a low guard blocks the sweep; a high (wrong-height) guard is swept", () => {
    expect(sweptFrozen(guardThenAdvance("low"))).toBe(false); // blocked ⇒ free ⇒ moves
    expect(sweptFrozen(guardThenAdvance("high"))).toBe(true); // wrong height ⇒ swept ⇒ frozen
  });

  it("sweeps a croucher — crouch occupies low, so it does not dodge", () => {
    const crouchThenAdvance = bot(
      [{ when: clk("lt", activeEnd()), do: { type: "crouch" } }],
      { type: "move", dir: 1 },
    );

    expect(sweptFrozen(crouchThenAdvance)).toBe(true); // swept ⇒ frozen
  });
});

describe("CANONICAL_RULES — sweep → cancel → okizeme finish (3, hit-confirmed)", () => {
  // Sweep at tick 0 (knockdown at tick 7); then a strike at `strikeTick`. At the first recovery
  // frame the strike CANCELS the sweep's recovery (rekka) and its active frame lands inside the
  // finish window; at the first NEUTRAL tick (no cancel) the strike arrives in the i-frame tail.
  const finishScoreAt = (strikeTick: number): number =>
    runFight(
      sweepFight({
        botA: bot(
          [
            { when: clk("eq", 0), do: { type: "sweep" } },
            {
              when: clk("eq", strikeTick),
              do: { type: "attack", move: "strike", band: "mid" },
            },
          ],
          { type: "idle" },
        ),
        botB: IDLE,
        maxTicks: 40,
      }),
    ).scores.a;

  it("a hit-confirm cancel finishes the downed foe for an ippon; the same strike uncancelled is too late", () => {
    const cancelTick = sweepSpec().startup + sweepSpec().active; // first recovery frame ⇒ cancels

    const neutralTick =
      sweepSpec().startup + sweepSpec().active + sweepSpec().recovery; // first neutral ⇒ no cancel

    expect(finishScoreAt(cancelTick)).toBe(3); // cancel lands the finish in-window ⇒ ippon
    expect(finishScoreAt(neutralTick)).toBe(0); // uncancelled ⇒ i-frames ⇒ no finish
  });
});

describe("CANONICAL_RULES — a whiffed sweep is punishable", () => {
  it("a sweep out of range whiffs, and its recovery stops the sweeper defending the punish", () => {
    // deterministic() positions the pair at 200000: outside sweep reach (180000) but inside
    // strike reach (240000), so the sweep whiffs and (committed in recovery) cannot block the punish.
    const result = runFight(
      fight({
        rules: deterministic(),
        botA: sweepThenGuard, // sweep whiffs out of range; then it tries to guard
        botB: strikeAtTicks([sweepSpec().startup + sweepSpec().active], "mid"),
        maxTicks: 40,
      }),
    );

    expect(result.scores.a).toBe(0); // the sweep whiffed (and scores 0 anyway)
    expect(result.scores.b).toBe(1); // committed in recovery, it couldn't block ⇒ punished
  });
});

// ─── Slice 5b: the jump arc + airborne occupancy (anti-air) ───────────────────

// Jumps (vertical only) at tick `j`, then advances whenever free — so once it lands it
// moves again (a downed fighter cannot), distinguishing "whiffed the sweep" from "swept".
const jumpAt = (j: number): BotDoc =>
  bot([{ when: clk("eq", j), do: { type: "jump", dir: 0 } }], {
    type: "move",
    dir: 1,
  });

describe("CANONICAL_RULES — air physics structural shape", () => {
  it("clears the low band at/below the launch height (vacates low the instant it leaves the ground)", () => {
    expect(CANONICAL_RULES.lowClearance ?? Infinity).toBeLessThanOrEqual(
      CANONICAL_RULES.jumpImpulse ?? 0,
    );
  });
});

describe("CANONICAL_RULES — a timed jump clears the sweep (anti-air occupancy)", () => {
  // Sweep at tick 0 (active on ticks 7–8). The defender's x at two deep-in-knockdown ticks
  // reveals whether the sweep landed (downed ⇒ frozen) or whiffed (free ⇒ the jumper lands and moves).
  const downedBySweep = (defender: BotDoc): boolean => {
    const result = runFight(
      sweepFight({ botA: sweepOnce, botB: defender, maxTicks: 24 }),
    );

    return result.events[20].b.x === result.events[9].b.x;
  };

  it("whiffs an airborne jumper yet downs a grounded foe under the same rules", () => {
    expect(downedBySweep(jumpAt(4))).toBe(false); // airborne over the active frames ⇒ passes under ⇒ not downed
    expect(downedBySweep(ADVANCER)).toBe(true); // grounded ⇒ swept ⇒ frozen for the knockdown
  });

  it("clears across a launch window but must be timed (too-early lands before the active frames)", () => {
    expect(downedBySweep(jumpAt(2))).toBe(false); // earliest launch still airborne on ticks 7–8 ⇒ clears
    expect(downedBySweep(jumpAt(6))).toBe(false); // latest launch still airborne on ticks 7–8 ⇒ clears
    expect(downedBySweep(jumpAt(0))).toBe(true); // arc completes by tick 6 ⇒ grounded on 7–8 ⇒ swept
  });
});

describe("CANONICAL_RULES — the jump arc is a deterministic integer parabola", () => {
  it("rises to a held apex and returns to exactly y=0", () => {
    const result = runFight(
      sweepFight({ botA: jumpAt(0), botB: IDLE, maxTicks: 10 }),
    );

    expect(result.events.slice(0, 7).map((e) => e.a.y)).toEqual([
      12000, 20000, 24000, 24000, 20000, 12000, 0,
    ]);
  });
});
