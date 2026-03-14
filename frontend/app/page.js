"use client";

import { useState, useRef, useEffect } from "react";

/* ───────────────────── constants ───────────────────── */

const ZONES = [
  { id: "crane", label: "Crane", emoji: "🏗️", color: "#eab308", bg: "#eab30815" },
  { id: "workers", label: "Workers", emoji: "👷", color: "#3b82f6", bg: "#3b82f615" },
  { id: "materials", label: "Materials", emoji: "📦", color: "#f97316", bg: "#f9731615" },
  { id: "road", label: "Access Road", emoji: "🛣️", color: "#64748b", bg: "#64748b15" },
  { id: "building", label: "Building", emoji: "🏢", color: "#22c55e", bg: "#22c55e15" },
];

const GRID = 12;
const TOTAL_DAYS = 365;

const PHASES = [
  { label: "Foundation", pct: 0 },
  { label: "Structural", pct: 30 },
  { label: "MEP", pct: 55 },
  { label: "Finishing", pct: 80 },
  { label: "Handover", pct: 100 },
];

const AI_REPLIES = [
  "I've analyzed your layout. The crane placement provides 85% site coverage — consider shifting it 2 cells east to reach the northwest material zone.",
  "Good call on that road placement. Delivery trucks can now access the staging area with a single turn, reducing unload time by ~20%.",
  "I'm detecting a potential safety conflict: the crane swing radius overlaps with your worker zone in sector D-7. Recommend a 2-cell buffer.",
  "Current resource allocation looks strong. At this pace, you're tracking 4 days ahead of the Primavera P6 baseline schedule.",
  "Based on Trimble's project data, similar configurations achieve optimal throughput with materials staged within 3 cells of the active building zone.",
  "I'd recommend scheduling concrete pours in sectors A-3 through A-6 during the morning shift to avoid thermal cracking in the afternoon heat.",
  "Your worker distribution is unbalanced — the east wing has 3× the labor density of the west. Rebalancing could boost productivity by 12%.",
];

/* ───────────────────── component ───────────────────── */

export default function Home() {
  const [activeTool, setActiveTool] = useState(null);
  const [cells, setCells] = useState(Array(GRID * GRID).fill(null));
  const [day, setDay] = useState(1);
  const [isPlaying, setIsPlaying] = useState(false);
  const [messages, setMessages] = useState([
    { role: "ai", text: "Good morning. I'm Mike Callahan, your AI construction advisor. I've analyzed the site geotechnical report and I'm ready to help you optimize this build from day one." },
    { role: "ai", text: "Recommendation: Start by laying Access Roads along the perimeter for logistics flow, then position Cranes for maximum lift coverage. I'll flag conflicts in real-time." },
  ]);
  const [draft, setDraft] = useState("");
  const [hoveredCell, setHoveredCell] = useState(-1);
  const scrollRef = useRef(null);

  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    if (!isPlaying) return;
    const id = setInterval(() => {
      setDay((d) => {
        if (d >= TOTAL_DAYS) {
          setIsPlaying(false);
          return TOTAL_DAYS;
        }
        return d + 1;
      });
    }, 120);
    return () => clearInterval(id);
  }, [isPlaying]);

  const placeZone = (i) => {
    if (!activeTool) return;
    setCells((prev) => {
      const next = [...prev];
      const zone = ZONES.find((z) => z.id === activeTool);
      next[i] = prev[i]?.id === activeTool ? null : zone;
      return next;
    });
  };

  const sendMessage = () => {
    const text = draft.trim();
    if (!text) return;
    setMessages((m) => [...m, { role: "user", text }]);
    setDraft("");
    setTimeout(() => {
      setMessages((m) => [
        ...m,
        { role: "ai", text: AI_REPLIES[Math.floor(Math.random() * AI_REPLIES.length)] },
      ]);
    }, 600 + Math.random() * 600);
  };

  const progress = ((day - 1) / (TOTAL_DAYS - 1)) * 100;
  const placedCount = cells.filter(Boolean).length;
  const zoneCounts = ZONES.map((z) => ({
    ...z,
    count: cells.filter((c) => c?.id === z.id).length,
  }));
  const currentPhase = [...PHASES].reverse().find((p) => progress >= p.pct)?.label ?? "Pre-Construction";

  /* ────────── row / col labels ────────── */
  const colLabels = Array.from({ length: GRID }, (_, i) => String.fromCharCode(65 + i));
  const rowLabels = Array.from({ length: GRID }, (_, i) => String(i + 1));

  /* ───────────────────── render ───────────────────── */

  return (
    <div style={S.root}>
      {/* ════════ TOP NAV ════════ */}
      <nav style={S.nav}>
        <div style={S.navLeft}>
          <div style={S.logoBox}>C</div>
          <span style={S.logoText}>ConstructIQ</span>
          <span style={S.badge}>BETA</span>
        </div>
        <div style={S.navCenter}>
          <NavTab label="SITE PLAN" active />
          <NavTab label="SCHEDULE" />
          <NavTab label="ANALYTICS" />
        </div>
        <div style={S.navRight}>
          <div style={S.liveGroup}>
            <div style={S.liveDot} />
            <span style={{ fontSize: 12, color: "#64748b" }}>Live Simulation</span>
          </div>
          <div style={S.navDivider} />
          <span style={{ fontSize: 13, color: "#64748b" }}>
            Built for <strong style={{ color: "#94a3b8" }}>Trimble</strong>
          </span>
        </div>
      </nav>

      {/* ════════ MAIN CONTENT ════════ */}
      <div style={S.main}>
        {/* ──── LEFT COLUMN ──── */}
        <div style={S.leftCol}>
          {/* Zone Toolbar */}
          <div style={S.toolbar}>
            <span style={S.sectionLabel}>ZONES</span>
            {ZONES.map((z) => {
              const active = activeTool === z.id;
              return (
                <button
                  key={z.id}
                  onClick={() => setActiveTool(active ? null : z.id)}
                  style={{
                    ...S.toolBtn,
                    borderColor: active ? z.color : "#1e293b",
                    background: active ? z.bg : "transparent",
                    color: active ? z.color : "#94a3b8",
                    boxShadow: active ? `0 0 16px ${z.bg}` : "none",
                  }}
                >
                  <span style={{ fontSize: 15 }}>{z.emoji}</span>
                  {z.label}
                </button>
              );
            })}
            <div style={{ flex: 1 }} />
            <div style={S.zoneCounter}>
              {placedCount > 0 && (
                <span style={{ fontSize: 12, color: "#475569" }}>
                  {placedCount} zone{placedCount !== 1 ? "s" : ""} placed
                </span>
              )}
            </div>
          </div>

          {/* Grid Area */}
          <div style={S.gridArea}>
            {/* Site Plan Header */}
            <div style={S.gridHeader}>
              <span style={{ fontSize: 11, fontWeight: 600, color: "#334155", letterSpacing: "0.1em" }}>
                SITE PLAN — {GRID}×{GRID} GRID
              </span>
              <span style={{ fontSize: 11, color: "#334155" }}>
                Phase: <span style={{ color: "#60a5fa" }}>{currentPhase}</span>
              </span>
            </div>

            <div style={{ display: "flex" }}>
              {/* Column Labels */}
              <div style={{ width: 24 }} />
              <div style={S.colLabelRow}>
                {colLabels.map((l) => (
                  <div key={l} style={S.colLabel}>{l}</div>
                ))}
              </div>
            </div>

            <div style={{ display: "flex" }}>
              {/* Row Labels */}
              <div style={S.rowLabelCol}>
                {rowLabels.map((l) => (
                  <div key={l} style={S.rowLabel}>{l}</div>
                ))}
              </div>

              {/* The Grid */}
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: `repeat(${GRID}, 1fr)`,
                  width: GRID * 46,
                  border: "1px solid #1e293b",
                  borderRadius: 8,
                  overflow: "hidden",
                }}
              >
                {cells.map((cell, i) => {
                  const isHover = hoveredCell === i && activeTool && !cell;
                  const hoverZone = isHover ? ZONES.find((z) => z.id === activeTool) : null;
                  return (
                    <div
                      key={i}
                      onClick={() => placeZone(i)}
                      onMouseEnter={() => setHoveredCell(i)}
                      onMouseLeave={() => setHoveredCell(-1)}
                      style={{
                        width: 46,
                        height: 46,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        background: cell
                          ? cell.bg
                          : isHover
                          ? `${hoverZone.color}0a`
                          : "#0c1221",
                        borderRight: "1px solid #1e293b30",
                        borderBottom: "1px solid #1e293b30",
                        cursor: activeTool ? "crosshair" : "default",
                        transition: "background 0.1s",
                        position: "relative",
                      }}
                    >
                      {cell && (
                        <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
                          <span style={{ fontSize: 17, lineHeight: 1 }}>{cell.emoji}</span>
                          <div
                            style={{
                              width: 8,
                              height: 2,
                              borderRadius: 1,
                              background: cell.color,
                              marginTop: 2,
                              opacity: 0.5,
                            }}
                          />
                        </div>
                      )}
                      {isHover && !cell && (
                        <span style={{ fontSize: 14, opacity: 0.25 }}>{hoverZone.emoji}</span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Zone Legend */}
            <div style={S.legend}>
              {zoneCounts.map((z) => (
                <div key={z.id} style={S.legendItem}>
                  <div style={{ width: 8, height: 8, borderRadius: 2, background: z.color }} />
                  <span style={{ fontSize: 11, color: "#64748b" }}>
                    {z.label}{z.count > 0 ? ` (${z.count})` : ""}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Timeline */}
          <div style={S.timeline}>
            <button
              onClick={() => setIsPlaying(!isPlaying)}
              style={{
                ...S.playBtn,
                background: isPlaying
                  ? "#1e293b"
                  : "linear-gradient(135deg, #3b82f6, #2563eb)",
                boxShadow: isPlaying ? "none" : "0 0 24px #3b82f630",
              }}
            >
              {isPlaying ? "⏸" : "▶"}
            </button>
            <div style={S.dayInfo}>
              <span style={{ fontSize: 15, fontWeight: 700, color: "#f1f5f9" }}>
                Day {day}
              </span>
              <span style={{ fontSize: 11, color: "#475569" }}>of {TOTAL_DAYS}</span>
            </div>

            <div style={S.progressWrapper}>
              <div style={S.phaseLabels}>
                {PHASES.map((p) => (
                  <span
                    key={p.label}
                    style={{
                      fontSize: 10,
                      color: progress >= p.pct ? "#60a5fa" : "#334155",
                      fontWeight: progress >= p.pct ? 600 : 400,
                      position: "absolute",
                      left: `${p.pct}%`,
                      transform: "translateX(-50%)",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {p.label}
                  </span>
                ))}
              </div>
              <div style={S.progressTrack}>
                <div
                  style={{
                    ...S.progressFill,
                    width: `${progress}%`,
                  }}
                />
                {PHASES.slice(1, -1).map((p) => (
                  <div
                    key={p.label}
                    style={{
                      position: "absolute",
                      left: `${p.pct}%`,
                      top: 0,
                      bottom: 0,
                      width: 1,
                      background: "#334155",
                    }}
                  />
                ))}
              </div>
            </div>

            <div style={S.pctDisplay}>
              <span style={{ fontSize: 20, fontWeight: 800, color: "#60a5fa", fontVariantNumeric: "tabular-nums" }}>
                {Math.round(progress)}%
              </span>
              <span style={{ fontSize: 10, color: "#475569" }}>Complete</span>
            </div>
          </div>
        </div>

        {/* ──── RIGHT COLUMN — AI CHAT ──── */}
        <div style={S.rightCol}>
          {/* Chat Header */}
          <div style={S.chatHeader}>
            <div style={S.avatar}>MC</div>
            <div>
              <div style={{ fontSize: 14, fontWeight: 600, color: "#f1f5f9" }}>
                Mike Callahan
              </div>
              <div style={{ fontSize: 11, color: "#64748b" }}>
                AI Construction Advisor
              </div>
            </div>
            <div style={S.onlineBadge}>
              <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#22c55e" }} />
              <span style={{ fontSize: 11, color: "#4ade80" }}>Online</span>
            </div>
          </div>

          {/* Quick Actions */}
          <div style={S.quickActions}>
            {["Site analysis", "Risk report", "Schedule review"].map((q) => (
              <button
                key={q}
                onClick={() => {
                  setDraft(q);
                  setTimeout(() => {
                    setMessages((m) => [...m, { role: "user", text: q }]);
                    setDraft("");
                    setTimeout(() => {
                      setMessages((m) => [
                        ...m,
                        { role: "ai", text: AI_REPLIES[Math.floor(Math.random() * AI_REPLIES.length)] },
                      ]);
                    }, 700);
                  }, 100);
                }}
                style={S.quickBtn}
              >
                {q}
              </button>
            ))}
          </div>

          {/* Messages */}
          <div style={S.messageArea}>
            {messages.map((msg, i) => (
              <div
                key={i}
                style={{
                  display: "flex",
                  justifyContent: msg.role === "user" ? "flex-end" : "flex-start",
                }}
              >
                <div
                  style={{
                    maxWidth: "88%",
                    padding: "10px 14px",
                    borderRadius: 12,
                    borderBottomRightRadius: msg.role === "user" ? 4 : 12,
                    borderBottomLeftRadius: msg.role === "ai" ? 4 : 12,
                    background: msg.role === "user" ? "#1d4ed8" : "#1e293b",
                    fontSize: 13,
                    lineHeight: 1.55,
                    color: "#e2e8f0",
                  }}
                >
                  {msg.role === "ai" && (
                    <div style={{ fontSize: 11, fontWeight: 600, color: "#60a5fa", marginBottom: 3 }}>
                      Mike Callahan
                    </div>
                  )}
                  {msg.text}
                </div>
              </div>
            ))}
            <div ref={scrollRef} />
          </div>

          {/* Input */}
          <div style={S.chatInput}>
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && sendMessage()}
              placeholder="Ask Mike anything..."
              style={S.input}
            />
            <button onClick={sendMessage} style={S.sendBtn}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="22" y1="2" x2="11" y2="13" />
                <polygon points="22 2 15 22 11 13 2 9 22 2" />
              </svg>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ───────────────────── sub-components ───────────────────── */

function NavTab({ label, active }) {
  return (
    <button
      style={{
        background: "none",
        border: "none",
        fontSize: 12,
        fontWeight: 600,
        letterSpacing: "0.04em",
        color: active ? "#e2e8f0" : "#475569",
        padding: "6px 14px",
        borderRadius: 6,
        cursor: "pointer",
        position: "relative",
        ...(active && { background: "#1e293b" }),
      }}
    >
      {label}
    </button>
  );
}

/* ───────────────────── styles ───────────────────── */

const S = {
  root: {
    height: "100vh",
    display: "flex",
    flexDirection: "column",
    background: "#060a14",
    color: "#e2e8f0",
    overflow: "hidden",
  },

  /* Nav */
  nav: {
    height: 56,
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "0 24px",
    background: "#0f1520",
    borderBottom: "1px solid #1e293b",
    flexShrink: 0,
  },
  navLeft: { display: "flex", alignItems: "center", gap: 10 },
  logoBox: {
    width: 30,
    height: 30,
    borderRadius: 7,
    background: "linear-gradient(135deg, #3b82f6, #1d4ed8)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: 15,
    fontWeight: 800,
    color: "#fff",
  },
  logoText: {
    fontSize: 19,
    fontWeight: 700,
    color: "#60a5fa",
    letterSpacing: "-0.03em",
  },
  badge: {
    fontSize: 9,
    fontWeight: 700,
    color: "#0f172a",
    background: "#3b82f6",
    padding: "2px 7px",
    borderRadius: 4,
    letterSpacing: "0.08em",
  },
  navCenter: { display: "flex", alignItems: "center", gap: 4 },
  navRight: { display: "flex", alignItems: "center", gap: 14 },
  liveGroup: { display: "flex", alignItems: "center", gap: 6 },
  liveDot: {
    width: 8,
    height: 8,
    borderRadius: "50%",
    background: "#22c55e",
    animation: "pulse-live 2s infinite",
  },
  navDivider: { width: 1, height: 24, background: "#1e293b" },

  /* Main Layout */
  main: { flex: 1, display: "flex", overflow: "hidden" },
  leftCol: {
    flex: "0 0 65%",
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
  },
  rightCol: {
    flex: "0 0 35%",
    display: "flex",
    flexDirection: "column",
    borderLeft: "1px solid #1e293b",
    background: "#0d1117",
  },

  /* Toolbar */
  toolbar: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "12px 20px",
    borderBottom: "1px solid #1e293b",
    background: "#0b1120",
    flexShrink: 0,
  },
  sectionLabel: {
    fontSize: 10,
    fontWeight: 700,
    color: "#334155",
    letterSpacing: "0.12em",
    marginRight: 6,
  },
  toolBtn: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    padding: "7px 13px",
    borderRadius: 7,
    border: "1.5px solid #1e293b",
    fontSize: 12,
    fontWeight: 500,
    cursor: "pointer",
    transition: "all 0.15s ease",
    fontFamily: "inherit",
  },
  zoneCounter: { display: "flex", alignItems: "center" },

  /* Grid */
  gridArea: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    padding: 16,
    background: "#080c18",
    gap: 6,
  },
  gridHeader: {
    width: GRID * 46 + 24,
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 2,
    paddingLeft: 24,
  },
  colLabelRow: {
    display: "grid",
    gridTemplateColumns: `repeat(${GRID}, 46px)`,
    marginBottom: 2,
  },
  colLabel: {
    textAlign: "center",
    fontSize: 10,
    color: "#334155",
    fontFamily: "monospace",
    fontWeight: 600,
  },
  rowLabelCol: {
    display: "flex",
    flexDirection: "column",
    marginRight: 4,
  },
  rowLabel: {
    height: 46,
    display: "flex",
    alignItems: "center",
    justifyContent: "flex-end",
    width: 18,
    fontSize: 10,
    color: "#334155",
    fontFamily: "monospace",
    fontWeight: 600,
    paddingRight: 4,
  },
  legend: {
    display: "flex",
    gap: 14,
    marginTop: 4,
    paddingLeft: 24,
  },
  legendItem: {
    display: "flex",
    alignItems: "center",
    gap: 5,
  },

  /* Timeline */
  timeline: {
    height: 72,
    display: "flex",
    alignItems: "center",
    gap: 16,
    padding: "0 24px",
    background: "#0f1520",
    borderTop: "1px solid #1e293b",
    flexShrink: 0,
  },
  playBtn: {
    width: 42,
    height: 42,
    borderRadius: "50%",
    border: "none",
    color: "#fff",
    fontSize: 15,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    cursor: "pointer",
    transition: "all 0.2s ease",
    flexShrink: 0,
  },
  dayInfo: {
    display: "flex",
    flexDirection: "column",
    gap: 1,
    minWidth: 64,
    flexShrink: 0,
  },
  progressWrapper: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    gap: 6,
    position: "relative",
    minWidth: 0,
  },
  phaseLabels: {
    position: "relative",
    height: 14,
  },
  progressTrack: {
    width: "100%",
    height: 6,
    background: "#1e293b",
    borderRadius: 3,
    overflow: "hidden",
    position: "relative",
  },
  progressFill: {
    height: "100%",
    borderRadius: 3,
    background: "linear-gradient(90deg, #3b82f6, #60a5fa)",
    transition: "width 0.12s linear",
    boxShadow: "0 0 10px #3b82f630",
  },
  pctDisplay: {
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-end",
    flexShrink: 0,
    minWidth: 56,
  },

  /* Chat */
  chatHeader: {
    padding: "16px 20px",
    borderBottom: "1px solid #1e293b",
    display: "flex",
    alignItems: "center",
    gap: 12,
    flexShrink: 0,
    background: "#0f1520",
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 10,
    background: "linear-gradient(135deg, #1e3a5f, #1e293b)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: 13,
    fontWeight: 700,
    color: "#60a5fa",
    border: "1.5px solid #334155",
    letterSpacing: "0.02em",
  },
  onlineBadge: {
    marginLeft: "auto",
    display: "flex",
    alignItems: "center",
    gap: 5,
  },
  quickActions: {
    display: "flex",
    gap: 6,
    padding: "10px 20px",
    borderBottom: "1px solid #1e293b",
    flexShrink: 0,
  },
  quickBtn: {
    fontSize: 11,
    fontWeight: 500,
    color: "#64748b",
    background: "#1e293b",
    border: "1px solid #334155",
    padding: "5px 12px",
    borderRadius: 6,
    cursor: "pointer",
    fontFamily: "inherit",
    transition: "all 0.15s",
  },
  messageArea: {
    flex: 1,
    overflowY: "auto",
    padding: "16px 20px",
    display: "flex",
    flexDirection: "column",
    gap: 12,
  },
  chatInput: {
    padding: "12px 16px",
    borderTop: "1px solid #1e293b",
    display: "flex",
    gap: 8,
    flexShrink: 0,
    background: "#0f1520",
  },
  input: {
    flex: 1,
    height: 42,
    padding: "0 14px",
    borderRadius: 8,
    background: "#0c1221",
    border: "1px solid #1e293b",
    color: "#e2e8f0",
    fontSize: 13,
    outline: "none",
    fontFamily: "inherit",
    transition: "border-color 0.15s, box-shadow 0.15s",
  },
  sendBtn: {
    width: 42,
    height: 42,
    borderRadius: 8,
    background: "linear-gradient(135deg, #3b82f6, #2563eb)",
    border: "none",
    color: "#fff",
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    transition: "opacity 0.15s",
    flexShrink: 0,
  },
};
