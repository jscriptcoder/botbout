import React, { useState, useMemo } from "react";

// ─────────────────────────────────────────────────────────────────────────────
// FRAME LAB — perception-latency tuner for the stickman fighting platform
// Two master inequalities decide the whole defensive meta:
//   reaction-block :  S ≥ L + B
//   whiff-punish   :  R ≥ L + Sₚ   (Sₚ = fastest punish startup = punch startup)
// ─────────────────────────────────────────────────────────────────────────────

const C = {
  ink: "#10131A",
  panel: "#171C26",
  panel2: "#1F2630",
  line: "#2A323F",
  hi: "#EDEFF4",
  mid: "#9AA4B2",
  dim: "#5C6675",
  startup: "#3FA7FF", // wind-up frames
  active: "#FF4D5E", // the hit
  recovery: "#FFC24B", // vulnerable frames
  invuln: "#7C5BFF", // dodge i-frames
  eye: "#00E0C7", // defender perception
  good: "#46D88A",
  bad: "#FF5D6C",
};

const FONTS = `
@import url('https://fonts.googleapis.com/css2?family=Anton&family=IBM+Plex+Mono:wght@400;500;600&family=Inter:wght@400;500;600&display=swap');
`;

const INITIAL_MOVES = [
  { key: "punch", name: "Punch", S: 4, A: 2, R: 6, dmg: 6, stam: 5, kind: "strike" },
  { key: "kick", name: "Kick", S: 10, A: 3, R: 14, dmg: 16, stam: 14, kind: "strike" },
  { key: "grab", name: "Grab", S: 8, A: 2, R: 18, dmg: 14, stam: 12, kind: "grab" },
  { key: "dodge", name: "Dodge", S: 3, A: 0, R: 8, dmg: 0, stam: 18, kind: "dodge", invuln: [3, 12] },
];

const L_PRESETS = [
  { L: 3, label: "Twitchy" },
  { L: 6, label: "Footsies" },
  { L: 9, label: "Mind-games" },
];

function Stepper({ label, value, onChange, min = 0, max = 60, accent = C.mid }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 52 }}>
      <span style={{ fontSize: 10, letterSpacing: 1, color: C.dim, fontFamily: "Inter, sans-serif", textTransform: "uppercase" }}>{label}</span>
      <div style={{ display: "flex", alignItems: "center", border: `1px solid ${C.line}`, borderRadius: 6, overflow: "hidden", background: C.ink }}>
        <button aria-label={`decrease ${label}`} onClick={() => onChange(Math.max(min, value - 1))} style={stepBtn}>–</button>
        <span style={{ flex: 1, textAlign: "center", fontFamily: "'IBM Plex Mono', monospace", fontSize: 14, color: accent, fontWeight: 600, minWidth: 22 }}>{value}</span>
        <button aria-label={`increase ${label}`} onClick={() => onChange(Math.min(max, value + 1))} style={stepBtn}>+</button>
      </div>
    </div>
  );
}

const stepBtn = {
  width: 24, height: 28, border: "none", background: "transparent", color: C.mid,
  fontSize: 16, cursor: "pointer", fontFamily: "'IBM Plex Mono', monospace", lineHeight: 1,
};

function Chip({ ok, label, detail }) {
  const col = ok ? C.good : C.bad;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2, padding: "5px 10px", borderRadius: 6, background: `${col}14`, border: `1px solid ${col}40`, minWidth: 96 }}>
      <span style={{ fontSize: 9, letterSpacing: 1.2, color: C.dim, fontFamily: "Inter, sans-serif", textTransform: "uppercase" }}>{label}</span>
      <span style={{ fontSize: 12, color: col, fontFamily: "'IBM Plex Mono', monospace", fontWeight: 600 }}>{detail}</span>
    </div>
  );
}

function Ribbon({ move, L, B, Sp, pxPerTick }) {
  const { S, A, R } = move;
  const total = S + A + R;
  const w = (t) => Math.max(0, t * pxPerTick);

  // marker positions on the attacker's clock (ticks)
  const perceptionTick = L; // defender perceives the commit
  const guardUpTick = L + B; // earliest guard fully raised
  const punishHitTick = S + A + L + Sp; // where the defender's punish lands

  const blockEligible = move.kind === "strike";
  const punishableMove = move.kind !== "grab" || true; // all whiff-punishable; grab too

  const Marker = ({ tick, color, glyph, title }) => {
    if (tick > total + 0.5) return null; // off the end → irrelevant / safe
    return (
      <div title={title} style={{ position: "absolute", left: w(tick), top: -6, bottom: -6, width: 2, background: color, zIndex: 3 }}>
        <span style={{ position: "absolute", top: -16, left: -5, fontSize: 11, color }}>{glyph}</span>
      </div>
    );
  };

  return (
    <div style={{ position: "relative", height: 34, marginTop: 14 }}>
      {/* phase segments */}
      <div style={{ position: "absolute", inset: 0, display: "flex", borderRadius: 5, overflow: "hidden", border: `1px solid ${C.line}` }}>
        <div style={{ width: w(S), background: `${C.startup}cc`, display: "flex", alignItems: "center", justifyContent: "center" }}>
          {S * pxPerTick > 26 && <span style={segLabel}>{S}</span>}
        </div>
        <div style={{ width: w(A), background: `${C.active}dd`, display: "flex", alignItems: "center", justifyContent: "center" }}>
          {A * pxPerTick > 16 && <span style={segLabel}>{A}</span>}
        </div>
        <div style={{ width: w(R), background: `${C.recovery}cc`, display: "flex", alignItems: "center", justifyContent: "center" }}>
          {R * pxPerTick > 26 && <span style={{ ...segLabel, color: "#3a2c00" }}>{R}</span>}
        </div>
      </div>

      {/* dodge i-frames overlay */}
      {move.invuln && (
        <div style={{ position: "absolute", top: -3, height: 4, borderRadius: 2, left: w(move.invuln[0]), width: w(move.invuln[1] - move.invuln[0]), background: C.invuln }} title={`invulnerable ${move.invuln[0]}–${move.invuln[1]}`} />
      )}

      {/* markers */}
      <Marker tick={perceptionTick} color={C.eye} glyph="◆" title={`Defender perceives commit @ tick ${perceptionTick}`} />
      {blockEligible && <Marker tick={guardUpTick} color={S >= L + B ? C.good : C.bad} glyph="⛉" title={`Guard up @ ${guardUpTick} — ${S >= L + B ? "in time" : "too late"}`} />}
      <Marker tick={punishHitTick} color={R >= L + Sp ? C.bad : C.dim} glyph="✶" title={`Punish lands @ ${punishHitTick} — recovery ends @ ${total}`} />
    </div>
  );
}

const segLabel = { fontSize: 10, fontFamily: "'IBM Plex Mono', monospace", color: "#06121f", fontWeight: 600 };

export default function FrameLab() {
  const [moves, setMoves] = useState(INITIAL_MOVES);
  const [L, setL] = useState(6);
  const [B, setB] = useState(2);

  const Sp = moves.find((m) => m.key === "punch").S; // fastest punish startup = punch startup

  const maxTotal = useMemo(() => Math.max(...moves.map((m) => m.S + m.A + m.R)), [moves]);
  const pxPerTick = 760 / (maxTotal + Sp + L + 2); // leave room for off-ribbon punish markers

  const setMove = (key, field, val) =>
    setMoves((ms) => ms.map((m) => (m.key === key ? { ...m, [field]: val } : m)));

  // meta read
  const strikes = moves.filter((m) => m.kind === "strike");
  const reactable = strikes.filter((m) => m.S >= L + B);
  const punishable = moves.filter((m) => m.R >= L + Sp);
  let metaTitle, metaBody, metaCol;
  if (reactable.length === 0) {
    metaTitle = "PURE READS";
    metaBody = "Nothing is reactable on defense — every block is a guess. Spacing, conditioning and prediction decide fights. High variance, high skill ceiling.";
    metaCol = C.invuln;
  } else if (reactable.length === strikes.length) {
    metaTitle = "REACTION DEFENSE";
    metaBody = "Every committed strike can be blocked on sight. Turtling is strong here — lean on stamina drain + ring pressure to punish passivity, or lower L.";
    metaCol = C.startup;
  } else {
    metaTitle = "FOOTSIES";
    metaBody = "Fast pokes are unreactable and must be respected; slow commits are reactable and punishable. This is the classic sweet spot — ship here.";
    metaCol = C.eye;
  }

  return (
    <div style={{ minHeight: "100%", background: C.ink, color: C.hi, fontFamily: "Inter, sans-serif", padding: "28px 20px 40px" }}>
      <style>{FONTS}{`
        input[type=range]{ -webkit-appearance:none; appearance:none; height:4px; border-radius:4px; outline:none; }
        input[type=range]::-webkit-slider-thumb{ -webkit-appearance:none; appearance:none; width:22px; height:22px; border-radius:50%; background:${C.eye}; border:3px solid ${C.ink}; cursor:pointer; box-shadow:0 0 0 1px ${C.eye}; }
        input[type=range]::-moz-range-thumb{ width:18px; height:18px; border-radius:50%; background:${C.eye}; border:3px solid ${C.ink}; cursor:pointer; }
        button:focus-visible, input:focus-visible{ outline:2px solid ${C.eye}; outline-offset:2px; }
        @media (prefers-reduced-motion: reduce){ *{ transition:none !important; } }
      `}</style>

      <div style={{ maxWidth: 880, margin: "0 auto" }}>
        {/* header */}
        <div style={{ borderBottom: `1px solid ${C.line}`, paddingBottom: 16, marginBottom: 22 }}>
          <div style={{ fontSize: 11, letterSpacing: 3, color: C.dim, textTransform: "uppercase", marginBottom: 4 }}>Stickman Combat · v1 balance bench</div>
          <h1 style={{ fontFamily: "'Anton', sans-serif", fontSize: 52, lineHeight: 0.9, margin: 0, letterSpacing: 1, textTransform: "uppercase" }}>
            Frame <span style={{ color: C.eye }}>Lab</span>
          </h1>
          <p style={{ color: C.mid, fontSize: 14, marginTop: 10, maxWidth: 620 }}>
            Perception latency <strong style={{ color: C.eye }}>L</strong> is the master dial. It decides which moves a bot can block on reaction and which it can punish. Tune the frame data, drag L, read the meta.
          </p>
        </div>

        {/* control deck */}
        <div style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 12, padding: "20px 22px", marginBottom: 18 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 10, flexWrap: "wrap", gap: 8 }}>
            <span style={{ fontFamily: "'Anton', sans-serif", fontSize: 18, letterSpacing: 1, textTransform: "uppercase" }}>Perception latency</span>
            <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 28, color: C.eye, fontWeight: 600 }}>L = {L}<span style={{ fontSize: 13, color: C.dim }}> ticks</span></span>
          </div>
          <input type="range" min={1} max={12} value={L} onChange={(e) => setL(+e.target.value)} style={{ width: "100%", background: `linear-gradient(90deg, ${C.eye} ${(L - 1) / 11 * 100}%, ${C.panel2} ${(L - 1) / 11 * 100}%)` }} />
          <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap", alignItems: "flex-end", justifyContent: "space-between" }}>
            <div style={{ display: "flex", gap: 8 }}>
              {L_PRESETS.map((p) => (
                <button key={p.L} onClick={() => setL(p.L)} style={{ ...presetBtn, borderColor: L === p.L ? C.eye : C.line, color: L === p.L ? C.eye : C.mid }}>
                  <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontWeight: 600 }}>{p.L}</span> {p.label}
                </button>
              ))}
            </div>
            <div style={{ display: "flex", gap: 14, alignItems: "flex-end" }}>
              <Stepper label="Block raise B" value={B} onChange={setB} min={0} max={10} />
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <span style={{ fontSize: 10, letterSpacing: 1, color: C.dim, textTransform: "uppercase" }}>Punish startup Sₚ</span>
                <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 14, color: C.mid, padding: "5px 0" }}>{Sp} <span style={{ color: C.dim, fontSize: 11 }}>(= punch)</span></span>
              </div>
            </div>
          </div>

          {/* live inequalities */}
          <div style={{ display: "flex", gap: 10, marginTop: 16, flexWrap: "wrap" }}>
            <Formula label="Reaction-block" eq={`S ≥ L + B  =  S ≥ ${L + B}`} />
            <Formula label="Whiff-punish" eq={`R ≥ L + Sₚ  =  R ≥ ${L + Sp}`} />
          </div>
        </div>

        {/* meta banner */}
        <div style={{ background: `${metaCol}12`, border: `1px solid ${metaCol}55`, borderRadius: 12, padding: "16px 20px", marginBottom: 22, display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
          <span style={{ fontFamily: "'Anton', sans-serif", fontSize: 26, letterSpacing: 1, color: metaCol, textTransform: "uppercase", whiteSpace: "nowrap" }}>{metaTitle}</span>
          <span style={{ color: C.mid, fontSize: 13.5, flex: 1, minWidth: 240 }}>{metaBody}</span>
        </div>

        {/* moves */}
        {moves.map((m) => {
          const total = m.S + m.A + m.R;
          const blockOk = m.S >= L + B;
          const blockMargin = m.S - (L + B);
          const punishOk = m.R >= L + Sp;
          const punishMargin = m.R - (L + Sp);
          return (
            <div key={m.key} style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 12, padding: "16px 20px 22px", marginBottom: 14 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16, flexWrap: "wrap" }}>
                <div>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
                    <span style={{ fontFamily: "'Anton', sans-serif", fontSize: 24, letterSpacing: 1, textTransform: "uppercase" }}>{m.name}</span>
                    <span style={{ fontSize: 10, letterSpacing: 1, color: C.dim, textTransform: "uppercase", border: `1px solid ${C.line}`, borderRadius: 4, padding: "2px 6px" }}>{m.kind}</span>
                  </div>
                  <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: C.dim }}>total {total}t · {m.dmg} dmg · {m.stam} stam</span>
                </div>
                <div style={{ display: "flex", gap: 12, alignItems: "flex-end" }}>
                  <Stepper label="Startup" value={m.S} onChange={(v) => setMove(m.key, "S", v)} min={1} accent={C.startup} />
                  <Stepper label="Active" value={m.A} onChange={(v) => setMove(m.key, "A", v)} min={0} accent={C.active} />
                  <Stepper label="Recovery" value={m.R} onChange={(v) => setMove(m.key, "R", v)} min={0} accent={C.recovery} />
                </div>
              </div>

              <Ribbon move={m} L={L} B={B} Sp={Sp} pxPerTick={pxPerTick} />

              <div style={{ display: "flex", gap: 10, marginTop: 18, flexWrap: "wrap" }}>
                {m.kind === "strike" && (
                  <Chip ok={blockOk} label="React-block" detail={blockOk ? `yes · +${blockMargin}t spare` : `no · ${blockMargin}t short`} />
                )}
                {m.kind === "grab" && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 2, padding: "5px 10px", borderRadius: 6, background: `${C.invuln}14`, border: `1px solid ${C.invuln}40`, minWidth: 96 }}>
                    <span style={{ fontSize: 9, letterSpacing: 1.2, color: C.dim, textTransform: "uppercase" }}>React-block</span>
                    <span style={{ fontSize: 12, color: C.invuln, fontFamily: "'IBM Plex Mono', monospace", fontWeight: 600 }}>unblockable</span>
                  </div>
                )}
                {m.kind === "dodge" && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 2, padding: "5px 10px", borderRadius: 6, background: `${C.invuln}14`, border: `1px solid ${C.invuln}40`, minWidth: 96 }}>
                    <span style={{ fontSize: 9, letterSpacing: 1.2, color: C.dim, textTransform: "uppercase" }}>I-frames</span>
                    <span style={{ fontSize: 12, color: C.invuln, fontFamily: "'IBM Plex Mono', monospace", fontWeight: 600 }}>{m.invuln[0]}–{m.invuln[1]}</span>
                  </div>
                )}
                <Chip ok={!punishOk} label="On whiff" detail={punishOk ? `punishable · ${punishMargin}t window` : `safe · ${-punishMargin - 1}t cushion`} />
              </div>
            </div>
          );
        })}

        {/* legend */}
        <div style={{ display: "flex", gap: 18, flexWrap: "wrap", marginTop: 18, padding: "14px 18px", border: `1px solid ${C.line}`, borderRadius: 10, fontSize: 11.5, color: C.mid }}>
          <Leg c={C.startup} t="startup" />
          <Leg c={C.active} t="active (the hit)" />
          <Leg c={C.recovery} t="recovery (vulnerable)" />
          <Leg c={C.invuln} t="i-frames" />
          <span style={{ display: "flex", alignItems: "center", gap: 6 }}><span style={{ color: C.eye }}>◆</span> perceive</span>
          <span style={{ display: "flex", alignItems: "center", gap: 6 }}><span style={{ color: C.good }}>⛉</span> guard up</span>
          <span style={{ display: "flex", alignItems: "center", gap: 6 }}><span style={{ color: C.bad }}>✶</span> punish lands</span>
        </div>
        <p style={{ color: C.dim, fontSize: 11.5, marginTop: 12, lineHeight: 1.6 }}>
          The <span style={{ color: C.eye }}>◆ perceive</span> line is where the defender first sees the commit. If <span style={{ color: C.good }}>⛉ guard up</span> lands on or before the startup ends, the move is blockable on reaction. If <span style={{ color: C.bad }}>✶ punish</span> lands inside the amber recovery band, the move is whiff-punishable. Markers that fall past the ribbon end mean "can't get there in time" — i.e. safe.
        </p>
      </div>
    </div>
  );
}

function Formula({ label, eq }) {
  return (
    <div style={{ background: C.ink, border: `1px solid ${C.line}`, borderRadius: 8, padding: "8px 12px", flex: 1, minWidth: 180 }}>
      <div style={{ fontSize: 9, letterSpacing: 1.2, color: C.dim, textTransform: "uppercase", marginBottom: 3 }}>{label}</div>
      <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 13, color: C.hi }}>{eq}</div>
    </div>
  );
}

function Leg({ c, t }) {
  return (
    <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <span style={{ width: 12, height: 12, borderRadius: 3, background: c, display: "inline-block" }} />
      {t}
    </span>
  );
}

const presetBtn = {
  background: "transparent", border: `1px solid ${C.line}`, borderRadius: 6,
  padding: "6px 11px", fontSize: 12, cursor: "pointer", fontFamily: "Inter, sans-serif",
  color: C.mid, display: "flex", gap: 5, alignItems: "center",
};
