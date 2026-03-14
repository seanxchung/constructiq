"use client";

import { useState, useRef, useEffect } from "react";
import ReactMarkdown from "react-markdown";

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

const GANTT_PHASES = [
  { label: "Foundation", start: 1, end: 110, color: "#3b82f6" },
  { label: "Structural", start: 111, end: 200, color: "#8b5cf6" },
  { label: "MEP", start: 201, end: 270, color: "#f59e0b" },
  { label: "Finishing", start: 271, end: 330, color: "#22c55e" },
  { label: "Handover", start: 331, end: 365, color: "#ef4444" },
];

const INITIAL_MESSAGES = [
  { role: "ai", text: "Good morning. I'm Mike Callahan, your AI construction advisor. I've analyzed the site geotechnical report and I'm ready to help you optimize this build from day one." },
  { role: "ai", text: "Recommendation: Start by laying Access Roads along the perimeter for logistics flow, then position Cranes for maximum lift coverage. I'll flag conflicts in real-time." },
];

const API_BASE = "http://localhost:8000";

const MD_COMPONENTS = {
  p: ({ children }) => <p style={{ margin: "4px 0" }}>{children}</p>,
  strong: ({ children }) => <strong style={{ fontWeight: 600, color: "#f1f5f9" }}>{children}</strong>,
  em: ({ children }) => <em style={{ fontStyle: "italic", color: "#cbd5e1" }}>{children}</em>,
  ul: ({ children }) => <ul style={{ margin: "4px 0", paddingLeft: 18 }}>{children}</ul>,
  ol: ({ children }) => <ol style={{ margin: "4px 0", paddingLeft: 18 }}>{children}</ol>,
  li: ({ children }) => <li style={{ marginBottom: 2 }}>{children}</li>,
  code: ({ children }) => (
    <code style={{ background: "#334155", padding: "1px 5px", borderRadius: 4, fontSize: 12, fontFamily: "monospace" }}>
      {children}
    </code>
  ),
  h3: ({ children }) => <h3 style={{ fontSize: 14, fontWeight: 700, color: "#f1f5f9", margin: "6px 0 2px" }}>{children}</h3>,
  h4: ({ children }) => <h4 style={{ fontSize: 13, fontWeight: 600, color: "#f1f5f9", margin: "4px 0 2px" }}>{children}</h4>,
};

/* ───────────────────── component ───────────────────── */

export default function Home() {
  const [activeTool, setActiveTool] = useState(null);
  const [cells, setCells] = useState(Array(GRID * GRID).fill(null));
  const [day, setDay] = useState(1);
  const [isPlaying, setIsPlaying] = useState(false);
  const [messages, setMessages] = useState([...INITIAL_MESSAGES]);
  const [draft, setDraft] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [hoveredCell, setHoveredCell] = useState(-1);
  const [activeTab, setActiveTab] = useState("site");
  const [analytics, setAnalytics] = useState([]);
  const [hasNewAlert, setHasNewAlert] = useState(false);
  const scrollRef = useRef(null);
  const simulatingRef = useRef(false);
  const skipInProgressRef = useRef(false);
  const alertTimerRef = useRef(null);

  const triggerAlert = () => {
    setHasNewAlert(true);
    clearTimeout(alertTimerRef.current);
    alertTimerRef.current = setTimeout(() => setHasNewAlert(false), 3000);
  };

  useEffect(() => () => clearTimeout(alertTimerRef.current), []);

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
    }, 800);
    return () => clearInterval(id);
  }, [isPlaying]);

  useEffect(() => {
    if (!isPlaying || day <= 1) return;
    if (simulatingRef.current || skipInProgressRef.current) return;
    simulatingRef.current = true;

    fetch(`${API_BASE}/api/simulate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ day, zones: buildZones() }),
    })
      .then((res) => res.ok ? res.json() : null)
      .then((data) => {
        if (data) {
          setAnalytics((prev) => [...prev, {
            day,
            conflictCount: data.conflicts?.length || 0,
            totalWorkers: data.simulation?.total_workers || 0,
            materials: Object.values(data.simulation?.materials || {}).map((m) => ({ name: m.name, pct: m.pct_remaining })),
            costImpact: (data.conflicts || []).reduce((s, c) => s + (c.cost_impact || 0), 0),
          }]);
        }
        const hasHigh = (data?.conflicts || []).some((c) => c.severity === "HIGH");
        if (hasHigh && data.ai_analysis) {
          setMessages((m) => [...m, { role: "ai", text: data.ai_analysis }]);
          triggerAlert();
        }
      })
      .catch(() => {})
      .finally(() => { simulatingRef.current = false; });
  }, [day, isPlaying]);

  const buildZones = () =>
    cells.reduce((acc, cell, i) => {
      if (cell) acc.push({ type: cell.id, x: i % GRID, y: Math.floor(i / GRID), capacity: 25, metadata: {} });
      return acc;
    }, []);

  const placeZone = (i) => {
    if (!activeTool) return;
    setCells((prev) => {
      const next = [...prev];
      const zone = ZONES.find((z) => z.id === activeTool);
      next[i] = prev[i]?.id === activeTool ? null : zone;
      return next;
    });
  };

  const sendMessage = async (overrideText) => {
    const text = (overrideText || draft).trim();
    if (!text || isLoading) return;
    setMessages((m) => [...m, { role: "user", text }]);
    setDraft("");
    setIsLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/ai/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text, day, zones: buildZones() }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setMessages((m) => [...m, { role: "ai", text: data.reply }]);
    } catch {
      setMessages((m) => [
        ...m,
        { role: "ai", text: "Sorry, I'm having trouble connecting to the server. Please check that the backend is running and try again." },
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  const rewind = () => {
    setIsPlaying(false);
    setDay(1);
    setMessages([...INITIAL_MESSAGES]);
    setAnalytics([]);
  };

  const skipDays = (n) => {
    const target = Math.min(day + n, TOTAL_DAYS);
    skipInProgressRef.current = true;
    setDay(target);
    fetch(`${API_BASE}/api/simulate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ day: target, zones: buildZones() }),
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data) {
          setAnalytics((prev) => [...prev, {
            day: target,
            conflictCount: data.conflicts?.length || 0,
            totalWorkers: data.simulation?.total_workers || 0,
            materials: Object.values(data.simulation?.materials || {}).map((m) => ({ name: m.name, pct: m.pct_remaining })),
            costImpact: (data.conflicts || []).reduce((s, c) => s + (c.cost_impact || 0), 0),
          }]);
        }
        const hasHigh = (data?.conflicts || []).some((c) => c.severity === "HIGH");
        if (data?.conflicts?.length > 0 && data.ai_analysis) {
          setMessages((m) => [...m, { role: "ai", text: data.ai_analysis }]);
          if (hasHigh) triggerAlert();
        }
      })
      .catch(() => {})
      .finally(() => { skipInProgressRef.current = false; });
  };

  const clearSite = () => {
    setCells(Array(GRID * GRID).fill(null));
    setIsPlaying(false);
    setDay(1);
    setAnalytics([]);
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
          <NavTab label="SITE PLAN" active={activeTab === "site"} onClick={() => setActiveTab("site")} />
          <NavTab label="SCHEDULE" active={activeTab === "schedule"} onClick={() => setActiveTab("schedule")} />
          <NavTab label="ANALYTICS" active={activeTab === "analytics"} onClick={() => setActiveTab("analytics")} />
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
          {activeTab === "site" ? (
          <>
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
            <div style={{ width: 1, height: 24, background: "#1e293b", margin: "0 4px" }} />
            <button
              onClick={clearSite}
              style={{
                ...S.toolBtn,
                borderColor: "#1e293b",
                background: "transparent",
                color: "#ef4444",
              }}
            >
              ✕ Clear Site
            </button>
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
          </>
          ) : activeTab === "schedule" ? (
            <ScheduleView analytics={analytics} day={day} currentPhase={currentPhase} />
          ) : (
            <AnalyticsDashboard analytics={analytics} />
          )}

          {/* Timeline */}
          <div style={S.timeline}>
            <button onClick={rewind} style={{ ...S.playBtn, background: "#1e293b", fontSize: 14 }} title="Rewind to Day 1">
              ⏮
            </button>
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
            <button
              onClick={() => skipDays(7)}
              disabled={day >= TOTAL_DAYS}
              style={{
                ...S.toolBtn,
                borderColor: "#334155",
                background: "#1e293b",
                color: "#94a3b8",
                fontSize: 11,
                padding: "5px 10px",
                opacity: day >= TOTAL_DAYS ? 0.4 : 1,
                cursor: day >= TOTAL_DAYS ? "not-allowed" : "pointer",
              }}
              title="Skip forward 7 days"
            >
              +7 days
            </button>

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
        <div style={{
          ...S.rightCol,
          borderLeft: hasNewAlert ? "1.5px solid #ef4444" : "1px solid #1e293b",
          boxShadow: hasNewAlert ? "inset 0 0 30px #ef444425, 0 0 40px #ef444420" : "none",
          transition: "border-left 0.3s ease, box-shadow 0.3s ease",
        }}>
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
                onClick={() => sendMessage(q)}
                disabled={isLoading}
                style={{
                  ...S.quickBtn,
                  opacity: isLoading ? 0.5 : 1,
                  cursor: isLoading ? "not-allowed" : "pointer",
                }}
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
                  {msg.role === "ai" ? (
                    <ReactMarkdown components={MD_COMPONENTS}>{msg.text}</ReactMarkdown>
                  ) : (
                    msg.text
                  )}
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
              placeholder={isLoading ? "Mike is thinking..." : "Ask Mike anything..."}
              disabled={isLoading}
              style={{
                ...S.input,
                opacity: isLoading ? 0.6 : 1,
              }}
            />
            <button
              onClick={() => sendMessage()}
              disabled={isLoading}
              style={{
                ...S.sendBtn,
                opacity: isLoading ? 0.5 : 1,
                cursor: isLoading ? "not-allowed" : "pointer",
              }}
            >
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

function NavTab({ label, active, onClick }) {
  return (
    <button
      onClick={onClick}
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

/* ───────────────────── analytics dashboard ───────────────────── */

function AnalyticsDashboard({ analytics }) {
  if (!analytics.length) {
    return (
      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 8, background: "#080c18" }}>
        <span style={{ fontSize: 36 }}>📊</span>
        <span style={{ fontSize: 14, fontWeight: 600, color: "#64748b" }}>No analytics data yet</span>
        <span style={{ fontSize: 12, color: "#475569" }}>Press play to start the simulation</span>
      </div>
    );
  }

  const W = 380, H = 170;
  const P = { t: 8, r: 8, b: 20, l: 44 };
  const iW = W - P.l - P.r;
  const iH = H - P.t - P.b;

  const last = analytics[analytics.length - 1];
  const totalConflicts = analytics.reduce((s, d) => s + d.conflictCount, 0);
  const peakWorkers = Math.max(...analytics.map((d) => d.totalWorkers));
  let cum = 0;
  const riskSeries = analytics.map((d) => ({ day: d.day, cum: (cum += d.costImpact) }));
  const totalCost = cum;

  const fmtK = (v) =>
    v >= 1_000_000 ? `$${(v / 1_000_000).toFixed(1)}M` : v >= 1000 ? `$${Math.round(v / 1000)}K` : `$${v}`;

  const yGrid = (maxVal, fmt) =>
    [0.25, 0.5, 0.75].map((pct) => {
      const y = P.t + iH * (1 - pct);
      const label = fmt ? fmt(Math.round(pct * maxVal)) : Math.round(pct * maxVal);
      return (
        <g key={pct}>
          <line x1={P.l} y1={y} x2={W - P.r} y2={y} stroke="#1e293b" strokeWidth="1" />
          <text x={P.l - 4} y={y + 3} fill="#475569" fontSize="9" textAnchor="end" fontFamily="monospace">{label}</text>
        </g>
      );
    });

  const baseline = <line x1={P.l} y1={P.t + iH} x2={W - P.r} y2={P.t + iH} stroke="#334155" strokeWidth="1" />;

  const polyStr = (pts) => pts.map((p) => `${p.x},${p.y}`).join(" ");
  const areaPath = (pts) => {
    if (pts.length < 2) return "";
    return `M ${P.l},${P.t + iH} ${pts.map((p) => `L ${p.x},${p.y}`).join(" ")} L ${pts[pts.length - 1].x},${P.t + iH} Z`;
  };

  const cData = analytics.slice(-60);
  const maxC = Math.max(1, ...cData.map((d) => d.conflictCount));
  const cBarW = Math.max(2, iW / cData.length - 1);

  const maxW = Math.max(1, peakWorkers);
  const wPts = analytics.map((d, i) => ({
    x: P.l + (i / Math.max(analytics.length - 1, 1)) * iW,
    y: P.t + iH - (d.totalWorkers / maxW) * iH,
  }));

  const mats = last.materials || [];
  const matRowH = mats.length > 0 ? Math.min(30, iH / mats.length) : 30;
  const matLabelW = 96;
  const matBarMax = iW - matLabelW - 36;

  const maxR = Math.max(1, totalCost);
  const rPts = riskSeries.map((d, i) => ({
    x: P.l + (i / Math.max(riskSeries.length - 1, 1)) * iW,
    y: P.t + iH - (d.cum / maxR) * iH,
  }));

  const card = {
    background: "#0f1520",
    borderRadius: 10,
    border: "1px solid #1e293b",
    padding: "12px 14px",
    display: "flex",
    flexDirection: "column",
    gap: 6,
    overflow: "hidden",
  };
  const titleSt = { fontSize: 11, fontWeight: 700, color: "#64748b", letterSpacing: "0.06em" };

  return (
    <div style={{ flex: 1, overflow: "auto", background: "#080c18", padding: "16px 20px", display: "flex", flexDirection: "column", gap: 14 }}>
      {/* KPI row */}
      <div style={{ display: "flex", gap: 10 }}>
        {[
          { label: "DAYS RECORDED", val: analytics.length, color: "#60a5fa" },
          { label: "TOTAL CONFLICTS", val: totalConflicts, color: "#f59e0b" },
          { label: "PEAK WORKERS", val: peakWorkers, color: "#3b82f6" },
          { label: "RISK EXPOSURE", val: fmtK(totalCost), color: "#ef4444" },
        ].map((k) => (
          <div key={k.label} style={{ flex: 1, background: "#0f1520", borderRadius: 8, border: "1px solid #1e293b", padding: "10px 14px" }}>
            <div style={{ fontSize: 10, color: "#475569", fontWeight: 600, letterSpacing: "0.08em", marginBottom: 2 }}>{k.label}</div>
            <div style={{ fontSize: 20, fontWeight: 800, color: k.color, fontVariantNumeric: "tabular-nums" }}>{k.val}</div>
          </div>
        ))}
      </div>

      {/* 2×2 charts */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, flex: 1, minHeight: 0 }}>
        {/* Conflict Frequency */}
        <div style={card}>
          <span style={titleSt}>CONFLICT FREQUENCY</span>
          <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: "block" }}>
            {yGrid(maxC)}
            {cData.map((d, i) => {
              const x = P.l + i * (cBarW + 1);
              const h = (d.conflictCount / maxC) * iH;
              return <rect key={i} x={x} y={P.t + iH - h} width={cBarW} height={Math.max(h, 0)} rx={1} fill="#f59e0b" opacity={0.85} />;
            })}
            {baseline}
          </svg>
        </div>

        {/* Worker Density */}
        <div style={card}>
          <span style={titleSt}>WORKER DENSITY OVER TIME</span>
          <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: "block" }}>
            {yGrid(maxW)}
            {wPts.length >= 2 && <path d={areaPath(wPts)} fill="#3b82f618" />}
            <polyline points={polyStr(wPts)} fill="none" stroke="#3b82f6" strokeWidth="2" strokeLinejoin="round" />
            {wPts.length > 0 && <circle cx={wPts[wPts.length - 1].x} cy={wPts[wPts.length - 1].y} r={3} fill="#3b82f6" />}
            {baseline}
          </svg>
        </div>

        {/* Material Levels */}
        <div style={card}>
          <span style={titleSt}>MATERIAL LEVELS</span>
          <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: "block" }}>
            {mats.length === 0 ? (
              <text x={W / 2} y={H / 2} fill="#475569" fontSize="11" textAnchor="middle">No material zones placed</text>
            ) : (
              mats.map((m, i) => {
                const y = P.t + i * matRowH;
                const bW = Math.max(0, (m.pct / 100) * matBarMax);
                const clr = m.pct > 50 ? "#22c55e" : m.pct > 20 ? "#eab308" : "#ef4444";
                const name = m.name.length > 14 ? m.name.slice(0, 13) + "\u2026" : m.name;
                return (
                  <g key={i}>
                    <text x={P.l} y={y + matRowH / 2 + 3} fill="#94a3b8" fontSize="9" fontFamily="monospace">{name}</text>
                    <rect x={P.l + matLabelW} y={y + 4} width={matBarMax} height={matRowH - 8} rx={3} fill="#1e293b" />
                    <rect x={P.l + matLabelW} y={y + 4} width={bW} height={matRowH - 8} rx={3} fill={clr} opacity={0.8} />
                    <text x={P.l + matLabelW + matBarMax + 4} y={y + matRowH / 2 + 3} fill="#64748b" fontSize="9" fontFamily="monospace">
                      {Math.round(m.pct)}%
                    </text>
                  </g>
                );
              })
            )}
          </svg>
        </div>

        {/* Risk Exposure */}
        <div style={card}>
          <span style={titleSt}>RISK EXPOSURE (CUMULATIVE $)</span>
          <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: "block" }}>
            {yGrid(maxR, fmtK)}
            {rPts.length >= 2 && <path d={areaPath(rPts)} fill="#ef444418" />}
            <polyline points={polyStr(rPts)} fill="none" stroke="#ef4444" strokeWidth="2" strokeLinejoin="round" />
            {rPts.length > 0 && <circle cx={rPts[rPts.length - 1].x} cy={rPts[rPts.length - 1].y} r={3} fill="#ef4444" />}
            {baseline}
          </svg>
        </div>
      </div>
    </div>
  );
}

/* ───────────────────── schedule view ───────────────────── */

function ScheduleView({ analytics, day, currentPhase }) {
  const W = 760, H = 280;
  const P = { t: 32, r: 20, b: 36, l: 110 };
  const iW = W - P.l - P.r;
  const iH = H - P.t - P.b;
  const barH = iH / GANTT_PHASES.length;
  const barPad = 6;

  const dayToX = (d) => P.l + ((d - 1) / (TOTAL_DAYS - 1)) * iW;
  const todayX = dayToX(day);

  const conflictDays = analytics
    .filter((a) => a.conflictCount > 0)
    .map((a) => a.day);

  const firstConflict = analytics.find((a) => a.conflictCount > 0);
  const peakRiskEntry = analytics.length > 0
    ? analytics.reduce((best, a) => (a.costImpact > (best?.costImpact || 0) ? a : best), analytics[0])
    : null;
  const critMaterial = analytics.find((a) =>
    (a.materials || []).some((m) => m.pct < 20)
  );

  const milestones = [
    { label: "Project Start", value: "Day 1", icon: "🚀", color: "#3b82f6" },
    {
      label: "First Conflict Detected",
      value: firstConflict ? `Day ${firstConflict.day}` : "—",
      icon: "⚠️",
      color: "#f59e0b",
    },
    {
      label: "Peak Risk Day",
      value: peakRiskEntry && peakRiskEntry.costImpact > 0 ? `Day ${peakRiskEntry.day}` : "—",
      icon: "📈",
      color: "#ef4444",
    },
    {
      label: "Critical Material Warning",
      value: critMaterial ? `Day ${critMaterial.day}` : "—",
      icon: "📦",
      color: "#f97316",
    },
    {
      label: "Current Phase",
      value: currentPhase,
      icon: "🏗️",
      color: "#60a5fa",
    },
  ];

  const monthTicks = [1, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334, 365];
  const monthLabels = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec", ""];

  return (
    <div style={{ flex: 1, overflow: "auto", background: "#080c18", padding: "20px 24px", display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 700, color: "#f1f5f9", marginBottom: 2 }}>Project Schedule</div>
          <div style={{ fontSize: 12, color: "#475569" }}>365-day construction timeline — Day {day}</div>
        </div>
        <div style={{ display: "flex", gap: 12 }}>
          {GANTT_PHASES.map((p) => (
            <div key={p.label} style={{ display: "flex", alignItems: "center", gap: 5 }}>
              <div style={{ width: 10, height: 10, borderRadius: 3, background: p.color }} />
              <span style={{ fontSize: 11, color: "#64748b" }}>{p.label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Gantt Chart */}
      <div style={{ background: "#0f1520", borderRadius: 10, border: "1px solid #1e293b", padding: "16px 18px" }}>
        <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: "block" }}>
          {/* Month gridlines + labels */}
          {monthTicks.map((d, i) => {
            const x = dayToX(d);
            return (
              <g key={d}>
                <line x1={x} y1={P.t - 4} x2={x} y2={P.t + iH} stroke="#1e293b" strokeWidth="1" />
                {monthLabels[i] && (
                  <text x={x + 4} y={P.t + iH + 14} fill="#475569" fontSize="9" fontFamily="monospace">{monthLabels[i]}</text>
                )}
              </g>
            );
          })}

          {/* Phase bars */}
          {GANTT_PHASES.map((phase, i) => {
            const x1 = dayToX(phase.start);
            const x2 = dayToX(phase.end);
            const y = P.t + i * barH + barPad;
            const h = barH - barPad * 2;
            const isActive = day >= phase.start && day <= phase.end;
            const isPast = day > phase.end;

            return (
              <g key={phase.label}>
                {/* Phase label */}
                <text
                  x={P.l - 10}
                  y={y + h / 2 + 4}
                  fill={isActive ? "#f1f5f9" : "#64748b"}
                  fontSize="11"
                  fontWeight={isActive ? "700" : "500"}
                  textAnchor="end"
                  fontFamily="inherit"
                >
                  {phase.label}
                </text>

                {/* Background track */}
                <rect x={P.l} y={y} width={iW} height={h} rx={4} fill="#1e293b" opacity="0.3" />

                {/* Phase bar */}
                <rect
                  x={x1}
                  y={y}
                  width={x2 - x1}
                  height={h}
                  rx={4}
                  fill={phase.color}
                  opacity={isPast ? 0.4 : isActive ? 0.9 : 0.55}
                />

                {/* Progress fill within active phase */}
                {isActive && (
                  <rect
                    x={x1}
                    y={y}
                    width={Math.max(0, todayX - x1)}
                    height={h}
                    rx={4}
                    fill={phase.color}
                    opacity={1}
                  />
                )}

                {/* Day range label */}
                <text
                  x={x1 + (x2 - x1) / 2}
                  y={y + h / 2 + 3.5}
                  fill="#fff"
                  fontSize="9"
                  fontWeight="600"
                  textAnchor="middle"
                  fontFamily="monospace"
                  opacity={0.8}
                >
                  {phase.start}–{phase.end}
                </text>
              </g>
            );
          })}

          {/* Conflict markers */}
          {conflictDays.map((cd, i) => {
            const cx = dayToX(cd);
            const phaseIdx = GANTT_PHASES.findIndex((p) => cd >= p.start && cd <= p.end);
            if (phaseIdx < 0) return null;
            const cy = P.t + phaseIdx * barH + barPad - 5;
            return (
              <circle
                key={`c-${i}`}
                cx={cx}
                cy={cy}
                r={3.5}
                fill="#ef4444"
                stroke="#080c18"
                strokeWidth="1.5"
              />
            );
          })}

          {/* Today line */}
          <line
            x1={todayX}
            y1={P.t - 12}
            x2={todayX}
            y2={P.t + iH + 4}
            stroke="#ef4444"
            strokeWidth="2"
            strokeDasharray="4 3"
          />
          <rect x={todayX - 18} y={P.t - 24} width={36} height={14} rx={3} fill="#ef4444" />
          <text
            x={todayX}
            y={P.t - 14}
            fill="#fff"
            fontSize="8"
            fontWeight="700"
            textAnchor="middle"
            fontFamily="monospace"
          >
            DAY {day}
          </text>
        </svg>
      </div>

      {/* Milestone Table */}
      <div style={{ background: "#0f1520", borderRadius: 10, border: "1px solid #1e293b", overflow: "hidden" }}>
        <div style={{ padding: "12px 18px", borderBottom: "1px solid #1e293b" }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: "#64748b", letterSpacing: "0.06em" }}>PROJECT MILESTONES</span>
        </div>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              {["", "Milestone", "Status / Value", ""].map((h, i) => (
                <th
                  key={i}
                  style={{
                    padding: "8px 18px",
                    textAlign: "left",
                    fontSize: 10,
                    fontWeight: 600,
                    color: "#334155",
                    borderBottom: "1px solid #1e293b",
                    letterSpacing: "0.06em",
                  }}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {milestones.map((m, i) => (
              <tr key={i} style={{ borderBottom: i < milestones.length - 1 ? "1px solid #1e293b20" : "none" }}>
                <td style={{ padding: "10px 18px", fontSize: 16, width: 44 }}>{m.icon}</td>
                <td style={{ padding: "10px 0", fontSize: 13, fontWeight: 600, color: "#e2e8f0" }}>{m.label}</td>
                <td style={{ padding: "10px 18px" }}>
                  <span style={{
                    fontSize: 12,
                    fontWeight: 700,
                    color: m.value === "—" ? "#334155" : m.color,
                    fontVariantNumeric: "tabular-nums",
                    fontFamily: "monospace",
                  }}>
                    {m.value}
                  </span>
                </td>
                <td style={{ padding: "10px 18px", width: 24 }}>
                  {m.value !== "—" && (
                    <div style={{ width: 8, height: 8, borderRadius: "50%", background: m.color, opacity: 0.6 }} />
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
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
