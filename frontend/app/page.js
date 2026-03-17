"use client";

import { useState, useRef, useEffect, useMemo } from "react";
import ReactMarkdown from "react-markdown";
import { supabase } from "./auth";

/* ───────────────────── constants ───────────────────── */

const ZONES = [
  { id: "crane", label: "Crane", code: "CR", color: "#eab308", bg: "#eab30815" },
  { id: "workers", label: "Workers", code: "WK", color: "#3b82f6", bg: "#3b82f615" },
  { id: "materials", label: "Materials", code: "MT", color: "#f97316", bg: "#f9731615" },
  { id: "road", label: "Access Road", code: "RD", color: "#64748b", bg: "#64748b15" },
  { id: "building", label: "Building", code: "BD", color: "#22c55e", bg: "#22c55e15" },
  { id: "office", label: "Site Office", code: "OF", color: "#8b5cf6", bg: "#8b5cf615" },
  { id: "parking", label: "Parking", code: "PK", color: "#64748b", bg: "#64748b15" },
  { id: "fence", label: "Fence/Boundary", code: "FC", color: "#f59e0b", bg: "#f59e0b15" },
  { id: "manlift", label: "Man Lift", code: "ML", color: "#06b6d4", bg: "#06b6d415" },
  { id: "delivery", label: "Delivery Zone", code: "DZ", color: "#84cc16", bg: "#84cc1615" },
  { id: "boundary", label: "Site Boundary", code: "SB", color: "#ef4444", bg: "#ef444415" },
  { id: "truck_staging", label: "Truck Staging", code: "TS", color: "#84cc16", bg: "#84cc1615" },
  { id: "eraser", label: "Eraser", code: "", color: "#ef4444", bg: "#ef444415" },
];

const ZONE_SIZES = {
  crane: { w: 2, h: 2 },
  workers: { w: 2, h: 2 },
  materials: { w: 3, h: 2 },
  road: { w: 1, h: 1 },
  building: { w: 6, h: 6 },
  office: { w: 4, h: 2 },
  parking: { w: 4, h: 3 },
  fence: { w: 1, h: 1 },
  manlift: { w: 1, h: 1 },
  delivery: { w: 3, h: 2 },
  boundary: { w: 1, h: 1 },
  truck_staging: { w: 3, h: 2 },
  eraser: { w: 1, h: 1 },
};

const GRID = 30;
const DEFAULT_DURATION = 90;

const DURATION_OPTIONS = [30, 60, 90, 180, 365];

const GANTT_PHASE_DEFS = [
  { label: "Foundation", refEnd: 110, color: "#3b82f6" },
  { label: "Structural", refEnd: 200, color: "#8b5cf6" },
  { label: "MEP", refEnd: 270, color: "#f59e0b" },
  { label: "Finishing", refEnd: 330, color: "#22c55e" },
  { label: "Handover", refEnd: 365, color: "#ef4444" },
];

const buildGanttPhases = (totalDays) => {
  const scaled = GANTT_PHASE_DEFS.map((d, i, arr) => ({
    label: d.label,
    end: i === arr.length - 1 ? totalDays : Math.round((d.refEnd / 365) * totalDays),
    color: d.color,
  }));
  return scaled.map((p, i) => ({ ...p, start: i === 0 ? 1 : scaled[i - 1].end + 1 }));
};

const INITIAL_MESSAGES = [
  { role: "ai", text: "Good morning. I'm Mike Callahan, your AI construction advisor. I've analyzed the site geotechnical report and I'm ready to help you optimize this build from day one." },
  { role: "ai", text: "Recommendation: Start by laying Access Roads along the perimeter for logistics flow, then position Cranes for maximum lift coverage. I'll flag conflicts in real-time." },
];

const API_BASE = "http://localhost:8000";

const DEFAULT_CONFIG = {
  phases: [
    { id: "site-prep", name: "Site Preparation", startDay: 1, endDay: 10, color: "#64748b" },
    { id: "foundation", name: "Foundation", startDay: 11, endDay: 30, color: "#3b82f6" },
    { id: "structural", name: "Structural", startDay: 31, endDay: 60, color: "#8b5cf6" },
    { id: "mep", name: "MEP", startDay: 61, endDay: 75, color: "#f59e0b" },
    { id: "finishing", name: "Finishing", startDay: 76, endDay: 88, color: "#22c55e" },
    { id: "closeout", name: "Closeout", startDay: 89, endDay: 90, color: "#ef4444" },
  ],
  cranes: [],
  deliveries: [],
  workforce: {
    "site-prep": { total: 10, laborers: 8, operators: 2 },
    foundation: { total: 25, laborers: 12, carpenters: 8, ironworkers: 3, operators: 2 },
    structural: { total: 55, laborers: 10, carpenters: 5, ironworkers: 30, operators: 10 },
    mep: { total: 40, laborers: 5, electricians: 15, plumbers: 15, operators: 5 },
    finishing: { total: 25, laborers: 8, carpenters: 8, painters: 7, operators: 2 },
    closeout: { total: 10, laborers: 8, operators: 2 },
  },
  equipment: [],
  milestones: [],
};

const BUILDING_STAGES = [
  { maxPct: 15, bg: "#1A1D2B", border: "#4A4E63", dashed: true, label: "Excavation" },
  { maxPct: 30, bg: "#92400e20", border: "#92400e", dashed: false, label: "Foundation" },
  { maxPct: 55, bg: "#1e3a5f", border: "#3b82f6", dashed: false, label: "Structure" },
  { maxPct: 75, bg: "#78350f20", border: "#f59e0b", dashed: false, label: "MEP" },
  { maxPct: 90, bg: "#334155", border: "#94a3b8", dashed: false, label: "Finishing" },
  { maxPct: Infinity, bg: "#166534", border: "#22c55e", dashed: false, label: "Complete" },
];

const getBuildingStage = (pct) =>
  BUILDING_STAGES.find((s) => pct <= s.maxPct) || BUILDING_STAGES[5];

const cellXY = (i) => [i % GRID, Math.floor(i / GRID)];
const zoneIdAt = (i) => `zone-${i % GRID}-${Math.floor(i / GRID)}`;
const simZoneId = (type, x, y) => `${type}-${x}-${y}`;

const _parseDayList = (s) => {
  if (!s) return [];
  return s.split(",").map((d) => parseInt(d.trim(), 10)).filter((d) => !isNaN(d));
};

const _findRoadPath = (cells, fromIdx, toIdx) => {
  const roadSet = new Set();
  cells.forEach((c, i) => { if (c && c.id === "road") roadSet.add(i); });

  const [tx, ty] = [toIdx % GRID, Math.floor(toIdx / GRID)];
  let goalIdx = -1;
  let bestDist = Infinity;
  for (const ri of roadSet) {
    const [rx, ry] = [ri % GRID, Math.floor(ri / GRID)];
    const d = Math.abs(rx - tx) + Math.abs(ry - ty);
    if (d < bestDist) { bestDist = d; goalIdx = ri; }
  }
  if (goalIdx < 0 || !roadSet.has(fromIdx)) return [fromIdx];
  if (goalIdx === fromIdx) return [fromIdx];

  const queue = [fromIdx];
  const visited = new Set([fromIdx]);
  const parent = new Map();

  while (queue.length > 0) {
    const curr = queue.shift();
    if (curr === goalIdx) break;
    const cx = curr % GRID, cy = Math.floor(curr / GRID);
    const nb = [];
    if (cx > 0) nb.push(cy * GRID + cx - 1);
    if (cx < GRID - 1) nb.push(cy * GRID + cx + 1);
    if (cy > 0) nb.push((cy - 1) * GRID + cx);
    if (cy < GRID - 1) nb.push((cy + 1) * GRID + cx);
    for (const n of nb) {
      if (!visited.has(n) && roadSet.has(n)) {
        visited.add(n);
        parent.set(n, curr);
        queue.push(n);
      }
    }
  }

  if (!parent.has(goalIdx)) return [fromIdx];
  const path = [];
  let curr = goalIdx;
  while (curr !== undefined) {
    path.unshift(curr);
    curr = parent.get(curr);
  }
  return path;
};

const ENTRY_ARROWS = { right: "\u25b8", left: "\u25c2", down: "\u25be", up: "\u25b4" };

const MD_COMPONENTS = {
  p: ({ children }) => <p style={{ margin: "4px 0" }}>{children}</p>,
  strong: ({ children }) => <strong style={{ fontWeight: 600, color: "#e2e8f0" }}>{children}</strong>,
  em: ({ children }) => <em style={{ fontStyle: "italic", color: "#b0b4c3" }}>{children}</em>,
  ul: ({ children }) => <ul style={{ margin: "4px 0", paddingLeft: 18 }}>{children}</ul>,
  ol: ({ children }) => <ol style={{ margin: "4px 0", paddingLeft: 18 }}>{children}</ol>,
  li: ({ children }) => <li style={{ marginBottom: 2 }}>{children}</li>,
  code: ({ children }) => (
    <code style={{ background: "rgba(255,255,255,0.06)", padding: "1px 5px", borderRadius: 4, fontSize: 12, fontFamily: "monospace" }}>
      {children}
    </code>
  ),
  h3: ({ children }) => <h3 style={{ fontSize: 14, fontWeight: 700, color: "#e2e8f0", margin: "6px 0 2px" }}>{children}</h3>,
  h4: ({ children }) => <h4 style={{ fontSize: 13, fontWeight: 600, color: "#e2e8f0", margin: "4px 0 2px" }}>{children}</h4>,
};

/* ───────────────────── component ───────────────────── */

export default function Home() {
  const [user, setUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
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
  const [projectDuration, setProjectDuration] = useState(DEFAULT_DURATION);
  const [simulationState, setSimulationState] = useState(null);
  const [simConflicts, setSimConflicts] = useState([]);
  const [optimizerOpen, setOptimizerOpen] = useState(false);
  const [optimizerLoading, setOptimizerLoading] = useState(false);
  const [optimizerResult, setOptimizerResult] = useState(null);

  const [projectsModalOpen, setProjectsModalOpen] = useState(false);
  const [savedProjects, setSavedProjects] = useState([]);
  const [projectNameInput, setProjectNameInput] = useState("");
  const [optimizerWorkers, setOptimizerWorkers] = useState(0);
  const [projectConfig, setProjectConfig] = useState(null);
  const [savedConfig, setSavedConfig] = useState(() => {
    if (typeof window === "undefined") return DEFAULT_CONFIG;
    try {
      const cached = localStorage.getItem("constructiq_config");
      if (cached) {
        const parsed = JSON.parse(cached);
        if (parsed && parsed.phases) return parsed;
      }
    } catch {}
    return DEFAULT_CONFIG;
  });
  const [configErrorCount, setConfigErrorCount] = useState(0);
  const [activeTrucks, setActiveTrucks] = useState([]);
  const scrollRef = useRef(null);
  const simulatingRef = useRef(false);
  const skipInProgressRef = useRef(false);
  const alertTimerRef = useRef(null);
  const dragRef = useRef(null);
  const gridRef = useRef(null);
  const isPaintingRef = useRef(false);
  const prevConflictTypesRef = useRef(new Set());
  const prevPhaseRef = useRef("");
  const debriefFiredRef = useRef(false);

  const triggerAlert = () => {
    setHasNewAlert(true);
    clearTimeout(alertTimerRef.current);
    alertTimerRef.current = setTimeout(() => setHasNewAlert(false), 3000);
  };

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
      setAuthLoading(false);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });
    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => () => clearTimeout(alertTimerRef.current), []);

  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);
  useEffect(() => {
    setProjectConfig(savedConfig);
    try { localStorage.setItem("constructiq_config", JSON.stringify(savedConfig)); } catch {}
  }, [savedConfig]);

  useEffect(() => {
    if (!isPlaying) return;
    const id = setInterval(() => {
      if (simulatingRef.current) return;
      setDay((d) => {
        if (d >= projectDuration) {
          setIsPlaying(false);
          return projectDuration;
        }
        return d + 1;
      });
    }, 800);
    return () => clearInterval(id);
  }, [isPlaying, projectDuration]);

  useEffect(() => {
    if (!isPlaying || day <= 1) return;
    if (simulatingRef.current || skipInProgressRef.current || isLoading) return;
    simulatingRef.current = true;

    fetch(`${API_BASE}/api/simulate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ day, zones: buildZones(), project_duration: projectDuration, project_config: projectConfig || savedConfig }),
    })
      .then((res) => res.ok ? res.json() : null)
      .then((data) => {
        if (data) {
          setSimulationState(data.simulation || null);
          setSimConflicts(data.conflicts || []);
          setAnalytics((prev) => [...prev, {
            day,
            conflictCount: data.conflicts?.length || 0,
            totalWorkers: data.simulation?.total_workers || 0,
            materials: Object.values(data.simulation?.materials || {}).map((m) => ({ name: m.name, pct: m.pct_remaining })),
            costImpact: (data.conflicts || []).reduce((s, c) => s + (c.cost_impact || 0), 0),
            activeTasks: data.simulation?.active_tasks,
            scheduleRisk: data.simulation?.schedule?.schedule_risk,
          }]);
        }
        const conflicts = data?.conflicts || [];
        const hasHigh = conflicts.some((c) => c.severity === "HIGH");
        if (hasHigh) triggerAlert();

        if (day < projectDuration) {
          if (data?.ai_analysis) {
            const currentSigs = new Set(conflicts.map((c) => `${c.type}-${c.description || c.severity}`).filter(Boolean));
            const prevSigs = prevConflictTypesRef.current;
            const hasNewSig = [...currentSigs].some((s) => !prevSigs.has(s));
            const materialLow = Object.values(data.simulation?.materials || {}).some((m) => m.pct_remaining < 20);
            const hasBreakdown = conflicts.some((c) => c.type === "equipment_risk");

            if (hasNewSig || materialLow || hasBreakdown) {
              setMessages((m) => [...m, { role: "ai", text: `**Day ${day}:** ${data.ai_analysis}` }]);
            }
            prevConflictTypesRef.current = currentSigs;
          }

          if (data.simulation?.phase && data.simulation.phase !== prevPhaseRef.current && prevPhaseRef.current !== "") {
            setMessages((m) => [...m, {
              role: "ai",
              text: `**Day ${day} — Phase Transition:** Moving into ${data.simulation.phase} phase. Crew composition and equipment requirements are shifting.`,
            }]);
          }
          prevPhaseRef.current = data.simulation?.phase || "";
        }
      })
      .catch(() => {})
      .finally(() => { simulatingRef.current = false; });
  }, [day, isPlaying, projectDuration]);

  useEffect(() => {
    if (day < projectDuration || debriefFiredRef.current) return;
    debriefFiredRef.current = true;
    fireDebrief();
  }, [day, projectDuration]);

  // Spawn delivery trucks when day matches a scheduled delivery day
  useEffect(() => {
    const activeConfig = projectConfig || savedConfig;
    if (!activeConfig?.deliveries || !isPlaying) return;
    const newTrucks = [];
    projectConfig.deliveries.forEach((del) => {
      const scheduledDays = _parseDayList(del.days);
      if (!scheduledDays.includes(day)) return;
      const entryIdx = Number(del.entryPoint);
      const destIdx = Number(del.destination);
      if (isNaN(entryIdx) || isNaN(destIdx)) return;
      if (!cells[entryIdx] || cells[entryIdx].id !== "road") return;

      const path = _findRoadPath(cells, entryIdx, destIdx);
      const count = del.truckCount || 1;
      for (let t = 0; t < count; t++) {
        newTrucks.push({
          id: `truck-${day}-${del.id}-${t}`,
          entryIndex: entryIdx,
          destIndex: destIdx,
          path,
          progress: -t * 0.15,
          day,
          color: "#84cc16",
        });
      }
    });
    if (newTrucks.length > 0) {
      setActiveTrucks((prev) => [...prev.filter((t) => t.day !== day), ...newTrucks]);
      setMessages((m) => [...m, {
        role: "ai",
        text: `**Day ${day}:** ${newTrucks.length} delivery truck${newTrucks.length !== 1 ? "s" : ""} inbound. Materials en route to site.`,
      }]);
    }
  }, [day, projectConfig, isPlaying, cells]);

  // Animate truck progress — increment by 0.1 every 200ms, remove when done
  const hasTrucks = activeTrucks.length > 0;
  useEffect(() => {
    if (!hasTrucks) return;
    const id = setInterval(() => {
      setActiveTrucks((prev) =>
        prev
          .map((t) => ({ ...t, progress: t.progress + 0.1 }))
          .filter((t) => t.progress < 1)
      );
    }, 200);
    return () => clearInterval(id);
  }, [hasTrucks]);

  const signOut = async () => {
    await supabase.auth.signOut();
    setUser(null);
  };

  if (authLoading) {
    return (
      <div style={{
        height: "100vh", display: "flex", alignItems: "center", justifyContent: "center",
        background: "#0F1117", flexDirection: "column", gap: 16,
      }}>
        <div style={{
          width: 40, height: 40, border: "3px solid rgba(255,255,255,0.06)", borderTopColor: "#6366F1",
          borderRadius: "50%", animation: "spin 0.8s linear infinite",
        }} />
        <span style={{ fontSize: 14, color: "#8B8FA3", fontWeight: 500 }}>Loading ConstructIQ...</span>
      </div>
    );
  }

  if (!user) {
    return <LoginScreen />;
  }

  const ganttPhases = (() => {
    const mapped = (savedConfig?.phases || []).map(p => ({
      label: p.name || p.id,
      start: p.startDay,
      end: p.endDay,
      color: p.color,
    }));
    return mapped.length > 0 ? mapped : buildGanttPhases(projectDuration);
  })();

  const handleDurationChange = (dur) => {
    if (dur === projectDuration) return;
    setProjectDuration(dur);
    setIsPlaying(false);
    setDay(1);
    setAnalytics([]);
    setMessages([...INITIAL_MESSAGES]);
    setSimulationState(null);
    setSimConflicts([]);
    setActiveTrucks([]);
    prevConflictTypesRef.current = new Set();
    debriefFiredRef.current = false;
  };

  const buildZones = () =>
    cells.reduce((acc, cell, i) => {
      if (cell && cell.isOrigin) {
        acc.push({
          type: cell.id,
          x: i % GRID,
          y: Math.floor(i / GRID),
          width: cell.width,
          height: cell.height,
          capacity: cell.width * cell.height * 25,
          metadata: {},
        });
      }
      return acc;
    }, []);

    const placeZone = (i) => {
      if (!activeTool) return;
      
      if (activeTool === 'eraser') {
        setCells((prev) => {
          const next = [...prev];
          const cell = prev[i];
          if (!cell) return prev;
          const originIdx = cell.ref !== undefined ? cell.ref : i;
          const origin = next[originIdx];
          if (!origin) return prev;
          if (origin.id === 'boundary') return prev; // protect boundary from eraser
          next[originIdx] = null;
          for (let idx = 0; idx < next.length; idx++) {
            if (next[idx] && next[idx].ref === originIdx) next[idx] = null;
          }
          return next;
        });
        return;
      }
    setCells((prev) => {
      const next = [...prev];
      const zone = ZONES.find((z) => z.id === activeTool);
      const { w, h } = ZONE_SIZES[activeTool];
      const cx = i % GRID;
      const cy = Math.floor(i / GRID);

      const existing = prev[i];

      if (existing && existing.isOrigin && existing.id === "boundary" && activeTool !== "boundary") {
        return prev;
      }

      if (existing && existing.isOrigin && existing.id === activeTool) {
        next[i] = null;
        for (let idx = 0; idx < next.length; idx++) {
          if (next[idx] && next[idx].ref === i) next[idx] = null;
        }
        return next;
      }

      if (cx + w > GRID || cy + h > GRID) return prev;
      for (let dy = 0; dy < h; dy++) {
        for (let dx = 0; dx < w; dx++) {
          const ti = (cy + dy) * GRID + (cx + dx);
          if (prev[ti] !== null) return prev;
        }
      }

      next[i] = { ...zone, width: w, height: h, isOrigin: true };
      for (let dy = 0; dy < h; dy++) {
        for (let dx = 0; dx < w; dx++) {
          const ti = (cy + dy) * GRID + (cx + dx);
          if (ti !== i) next[ti] = { ref: i, id: zone.id };
        }
      }
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
        body: JSON.stringify({ message: text, day, zones: buildZones(), project_duration: projectDuration, current_conflicts: simConflicts }),
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
    setSimulationState(null);
    setSimConflicts([]);
    setActiveTrucks([]);
    prevConflictTypesRef.current = new Set();
    prevPhaseRef.current = "";
    debriefFiredRef.current = false;
  };

  const fireDebrief = (analyticsOverride) => {
    const data = analyticsOverride || analytics;
    const totalConflicts = data.reduce((s, a) => s + a.conflictCount, 0);
    const peakWorkers = Math.max(0, ...data.map(a => a.totalWorkers));
    const totalCost = data.reduce((s, a) => s + a.costImpact, 0);
    const highestRiskDay = data.length > 0 ? data.reduce((best, a) => a.costImpact > (best.costImpact || 0) ? a : best, data[0]).day : 0;
    const debriefPrompt = "The " + projectDuration + "-day simulation has completed. Generate a comprehensive project debrief. DATA: " + totalConflicts + " total conflicts, " + peakWorkers + " peak workers, $" + totalCost.toLocaleString() + " total cost exposure, highest risk day was Day " + highestRiskDay + ". Structure your response with these sections: 1. SCHEDULE OUTCOME - Did the project finish on time or overrun? If overrun by how many days at $15,000/day overhead? 2. BY THE NUMBERS - Summarize the key metrics. 3. WHAT WENT WELL - 2-3 things that worked. 4. WHAT WENT WRONG - Top 3 problems with specific day numbers and dollar figures. 5. RECOMMENDATIONS - 3-4 specific actionable changes for the next run referencing actual zone positions and days. 6. BOTTOM LINE - One sentence: greenlight this plan or iterate? Keep tone direct and experienced.";
    setMessages(function(m) { return [...m, { role: "divider", text: "Project Debrief" }]; });
    fetch(API_BASE + "/api/ai/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: debriefPrompt, day: day || projectDuration, zones: buildZones(), project_duration: projectDuration }),
    })
      .then(function(res) { return res.ok ? res.json() : null; })
      .then(function(d) {
        if (d && d.reply) {
          setMessages(function(m) { return [...m, { role: "ai", text: "**PROJECT COMPLETE**\n\n" + d.reply, isDebrief: true }]; });
        }
      })
      .catch(function(err) {
        console.error("Debrief failed:", err);
        setMessages(function(m) { return [...m, { role: "ai", text: "Simulation complete. Unable to generate debrief." }]; });
      });
  };

  const skipDays = (n) => {
    const target = Math.min(day + n, projectDuration);
    skipInProgressRef.current = true;
    setDay(target);
    fetch(`${API_BASE}/api/simulate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ day: target, zones: buildZones(), project_duration: projectDuration, project_config: projectConfig || savedConfig}),
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data) {
          setSimulationState(data.simulation || null);
          setSimConflicts(data.conflicts || []);
          setAnalytics((prev) => [...prev, {
            day: target,
            conflictCount: data.conflicts?.length || 0,
            totalWorkers: data.simulation?.total_workers || 0,
            materials: Object.values(data.simulation?.materials || {}).map((m) => ({ name: m.name, pct: m.pct_remaining })),
            costImpact: (data.conflicts || []).reduce((s, c) => s + (c.cost_impact || 0), 0),
            activeTasks: data.simulation?.active_tasks,
            scheduleRisk: data.simulation?.schedule?.schedule_risk,
          }]);
        }
        const conflicts = data?.conflicts || [];
        const hasHigh = conflicts.some((c) => c.severity === "HIGH");
        if (hasHigh) triggerAlert();

        if (target < projectDuration) {
          if (data?.ai_analysis) {
            const currentSigs = new Set(conflicts.map((c) => `${c.type}-${c.description || c.severity}`).filter(Boolean));
            const prevSigs = prevConflictTypesRef.current;
            const hasNewSig = [...currentSigs].some((s) => !prevSigs.has(s));
            const materialLow = Object.values(data.simulation?.materials || {}).some((m) => m.pct_remaining < 20);
            const hasBreakdown = conflicts.some((c) => c.type === "equipment_risk");

            if (hasNewSig || materialLow || hasBreakdown) {
              setMessages((m) => [...m, { role: "ai", text: data.ai_analysis }]);
            }
            prevConflictTypesRef.current = currentSigs;
          }

          if (data.simulation?.phase && data.simulation.phase !== prevPhaseRef.current && prevPhaseRef.current !== "") {
            setMessages((m) => [...m, {
              role: "ai",
              text: `**Day ${target} — Phase Transition:** Moving into ${data.simulation.phase} phase. Crew composition and equipment requirements are shifting.`,
            }]);
          }
          prevPhaseRef.current = data.simulation?.phase || "";
        }

        if (target >= projectDuration && !debriefFiredRef.current) {
          debriefFiredRef.current = true;
          const newEntry = {
            day: target,
            conflictCount: (data?.conflicts || []).length,
            totalWorkers: data?.simulation?.total_workers || 0,
            materials: Object.values(data?.simulation?.materials || {}).map((m) => ({ name: m.name, pct: m.pct_remaining })),
            costImpact: (data?.conflicts || []).reduce((s, c) => s + (c.cost_impact || 0), 0),
            activeTasks: data?.simulation?.active_tasks,
            scheduleRisk: data?.simulation?.schedule?.schedule_risk,
          };
          const combinedAnalytics = [...analytics, newEntry];
          console.log('DEBRIEF FIRING', target, projectDuration);
          fireDebrief(combinedAnalytics);
        }
      })
      .catch((err) => { console.error('Debrief failed:', err); })
      .finally(() => { skipInProgressRef.current = false; });
  };

  const clearSite = () => {
    setCells(Array(GRID * GRID).fill(null));
    setIsPlaying(false);
    setDay(1);
    setAnalytics([]);
    setMessages([...INITIAL_MESSAGES]);
    setSimulationState(null);
    setSimConflicts([]);
    setOptimizerWorkers(0);
    setActiveTrucks([]);
    prevConflictTypesRef.current = new Set();
    prevPhaseRef.current = "";
    debriefFiredRef.current = false;
  };

  const handleResizeMove = (e) => {
    if (!dragRef.current) return;
    const { originIndex, startX, startY, origW, origH } = dragRef.current;
    const deltaX = Math.round((e.clientX - startX) / 34);
    const deltaY = Math.round((e.clientY - startY) / 34);
    let newW = Math.max(1, origW + deltaX);
    let newH = Math.max(1, origH + deltaY);
    const ox = originIndex % GRID;
    const oy = Math.floor(originIndex / GRID);
    newW = Math.min(newW, GRID - ox);
    newH = Math.min(newH, GRID - oy);
    if (newW === origW && newH === origH && !dragRef.current._dirty) return;

    setCells((prev) => {
      const origin = prev[originIndex];
      if (!origin || !origin.isOrigin) return prev;
      const next = [...prev];
      for (let idx = 0; idx < next.length; idx++) {
        if (next[idx] && next[idx].ref === originIndex) next[idx] = null;
      }
      for (let dy = 0; dy < newH; dy++) {
        for (let dx = 0; dx < newW; dx++) {
          const ti = (oy + dy) * GRID + (ox + dx);
          if (ti === originIndex) continue;
          if (next[ti] !== null && !(next[ti].ref === originIndex)) return prev;
        }
      }
      next[originIndex] = { ...origin, width: newW, height: newH };
      for (let dy = 0; dy < newH; dy++) {
        for (let dx = 0; dx < newW; dx++) {
          const ti = (oy + dy) * GRID + (ox + dx);
          if (ti !== originIndex) next[ti] = { ref: originIndex, id: origin.id };
        }
      }
      return next;
    });
    dragRef.current._dirty = true;
  };

  const handleResizeUp = () => {
    dragRef.current = null;
  };

  const runOptimizer = async (formData) => {
    setOptimizerLoading(true);
    setOptimizerResult(null);
    try {
      const res = await fetch(`${API_BASE}/api/ai/optimize`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          building_description: formData.description,
          num_cranes: formData.cranes,
          num_workers: formData.workers,
          num_material_zones: formData.materials,
          project_duration: projectDuration,
          grid_size: GRID,
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const zones = data.zones || [];

      const next = Array(GRID * GRID).fill(null);
      zones.forEach((z) => {
        const zone = ZONES.find((def) => def.id === z.type);
        if (!zone) return;
        const { w, h } = ZONE_SIZES[z.type];
        const ox = z.x, oy = z.y;
        const idx = oy * GRID + ox;
        if (idx < 0 || ox + w > GRID || oy + h > GRID) return;
        let blocked = false;
        for (let dy = 0; dy < h && !blocked; dy++)
          for (let dx = 0; dx < w && !blocked; dx++)
            if (next[(oy + dy) * GRID + (ox + dx)] !== null) blocked = true;
        if (blocked) return;
        next[idx] = { ...zone, width: w, height: h, isOrigin: true };
        for (let dy = 0; dy < h; dy++)
          for (let dx = 0; dx < w; dx++) {
            const ti = (oy + dy) * GRID + (ox + dx);
            if (ti !== idx) next[ti] = { ref: idx, id: zone.id };
          }
      });

      cells.forEach((c, i) => {
        if (!c?.isOrigin || (c.id !== "boundary" && c.id !== "fence")) return;
        next[i] = c;
        for (let idx = 0; idx < cells.length; idx++) {
          if (cells[idx] && cells[idx].ref === i) next[idx] = cells[idx];
        }
      });

      setCells(next);
      setIsPlaying(false);
      setDay(1);
      setAnalytics([]);
      setSimulationState(null);
      setSimConflicts([]);
      setOptimizerWorkers(formData.workers);
      setActiveTrucks([]);

      const typeCounts = {};
      next.forEach((c) => { if (c?.isOrigin) typeCounts[c.id] = (typeCounts[c.id] || 0) + 1; });
      const parts = [];
      if (typeCounts.crane) parts.push(`${typeCounts.crane} crane${typeCounts.crane !== 1 ? "s" : ""}`);
      if (typeCounts.workers) parts.push(`${typeCounts.workers} worker zone${typeCounts.workers !== 1 ? "s" : ""} (${formData.workers} workers)`);
      if (typeCounts.materials) parts.push(`${typeCounts.materials} material zone${typeCounts.materials !== 1 ? "s" : ""}`);
      if (typeCounts.building) parts.push(`${typeCounts.building} building tile${typeCounts.building !== 1 ? "s" : ""}`);
      if (typeCounts.road) parts.push(`${typeCounts.road} access road${typeCounts.road !== 1 ? "s" : ""}`);
      const breakdown = parts.join(", ");

      setOptimizerResult({ success: true, breakdown, reasoning: data.reasoning || "" });
      setMessages((m) => [
        ...m,
        { role: "ai", text: `Layout generated: ${breakdown} placed based on construction best practices. ${data.reasoning || ""}` },
      ]);
    } catch {
      setOptimizerResult({ success: false, error: "Failed to generate layout. Check that the backend is running." });
    } finally {
      setOptimizerLoading(false);
    }
  };

  const fetchProjects = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/projects`);
      if (res.ok) setSavedProjects(await res.json());
    } catch {}
  };

  const saveProject = async () => {
    const name = projectNameInput.trim();
    if (!name) return;
    try {
      const res = await fetch(`${API_BASE}/api/projects/save`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, zones: buildZones(), project_duration: projectDuration, config: savedConfig }),
      });
      if (res.ok) {
        setProjectNameInput("");
        await fetchProjects();
      }
    } catch {}
  };

  const loadProject = async (project) => {
    try {
      const res = await fetch(`${API_BASE}/api/projects/load`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project_id: project.id }),
      });
      if (!res.ok) return;
      const data = await res.json();
      const next = Array(GRID * GRID).fill(null);
      (data.zones || []).forEach((z) => {
        const zone = ZONES.find((def) => def.id === z.type);
        if (!zone) return;
        const { w, h } = ZONE_SIZES[z.type];
        const ox = z.x, oy = z.y;
        const idx = oy * GRID + ox;
        if (idx < 0 || ox + w > GRID || oy + h > GRID) return;
        let blocked = false;
        for (let dy = 0; dy < h && !blocked; dy++)
          for (let dx = 0; dx < w && !blocked; dx++)
            if (next[(oy + dy) * GRID + (ox + dx)] !== null) blocked = true;
        if (blocked) return;
        next[idx] = { ...zone, width: w, height: h, isOrigin: true };
        for (let dy = 0; dy < h; dy++)
          for (let dx = 0; dx < w; dx++) {
            const ti = (oy + dy) * GRID + (ox + dx);
            if (ti !== idx) next[ti] = { ref: idx, id: zone.id };
          }
      });
      setCells(next);
      if (data.project_duration) setProjectDuration(data.project_duration);
      const loadedConfig = data.config && typeof data.config === "object" && data.config.phases
        ? data.config
        : DEFAULT_CONFIG;
      setSavedConfig(loadedConfig);
      setProjectConfig(loadedConfig);
      setIsPlaying(false);
      setDay(1);
      setAnalytics([]);
      setSimulationState(null);
      setSimConflicts([]);
      setProjectsModalOpen(false);
      setOptimizerWorkers(0);
      setActiveTrucks([]);
      setMessages((m) => [
        ...m,
        { role: "ai", text: `Loaded project "${data.name}". ${(data.zones || []).length} zones restored.${data.config ? " Configuration restored." : ""} Ready to simulate.` },
      ]);
    } catch {}
  };

  const deleteProject = async (id) => {
    try {
      const res = await fetch(`${API_BASE}/api/projects/${id}`, { method: "DELETE" });
      if (res.ok) await fetchProjects();
    } catch {}
  };

  const progress = ((day - 1) / (projectDuration - 1)) * 100;
  const placedCount = cells.filter((c) => c && c.isOrigin).length;
  const zoneCounts = ZONES.map((z) => ({
    ...z,
    count: cells.filter((c) => c?.isOrigin && c.id === z.id).length,
  }));
  const currentPhase = [...ganttPhases].reverse().find((gp) => day >= gp.start)?.label ?? "Pre-Construction";

  /* ────────── grid simulation-driven visuals ────────── */
  const buildPct = (day / projectDuration) * 100;

  const roadAdjMap = {};
  cells.forEach((c, i) => {
    if (!c || c.id !== "road" || !c.isOrigin) return;
    const [x, y] = cellXY(i);
    roadAdjMap[i] = {
      up: y > 0 && cells[(y - 1) * GRID + x]?.id === "road",
      down: y < GRID - 1 && cells[(y + 1) * GRID + x]?.id === "road",
      left: x > 0 && cells[y * GRID + (x - 1)]?.id === "road",
      right: x < GRID - 1 && cells[y * GRID + (x + 1)]?.id === "road",
    };
  });

  const simCranes = simulationState?.cranes || [];
  const activeCranes = simCranes.filter((c) => c.active);
  const blockedRoadCells = new Set();
  cells.forEach((c, i) => {
    if (!c || c.id !== "road" || !c.isOrigin) return;
    const [x, y] = cellXY(i);
    for (const crane of activeCranes) {
      if ((crane.swing_radius || 0) + 0.5 - Math.sqrt((crane.x - x) ** 2 + (crane.y - y) ** 2) > 0) {
        blockedRoadCells.add(i);
        break;
      }
    }
  });

  const matStatusByZone = {};
  Object.values(simulationState?.materials || {}).forEach((m) => {
    (matStatusByZone[m.zone_id] ||= []).push(m);
  });

  const workersByZone = simulationState?.workers || {};

  const craneByPos = {};
  simCranes.forEach((c) => { craneByPos[`${c.x}-${c.y}`] = c; });

  const stagedTruckCount = (!simulationState || !projectConfig?.deliveries) ? 0 :
  projectConfig.deliveries.reduce((sum, del) => {
    const days = _parseDayList(del.days);
    return sum + (days.includes(day) ? (del.truckCount || 1) : 0);
  }, 0);

  const hasActiveDelivery = Object.values(
    simulationState?.materials_consumed || {},
  ).some((v) => v > 0);

  const roadIndices = [];
  const matCellIndices = [];
  cells.forEach((c, i) => {
    if (!c || !c.isOrigin) return;
    if (c.id === "road") roadIndices.push(i);
    else if (c.id === "materials") matCellIndices.push(i);
  });
  const deliveryRoutes = matCellIndices
    .map((mi) => {
      const [mx, my] = cellXY(mi);
      let best = -1, bestD = Infinity;
      for (const ri of roadIndices) {
        const [rx, ry] = cellXY(ri);
        const d = Math.abs(rx - mx) + Math.abs(ry - my);
        if (d < bestD) { bestD = d; best = ri; }
      }
      if (best < 0) return null;
      const [rx, ry] = cellXY(best);
      return { x1: rx * 34 + 17, y1: ry * 34 + 17, x2: mx * 34 + 17, y2: my * 34 + 17 };
    })
    .filter(Boolean);

  /* ────────── row / col labels ────────── */
  const colLabels = Array.from({ length: GRID }, (_, i) =>
    i < 26 ? String.fromCharCode(65 + i) : "A" + String.fromCharCode(65 + i - 26)
  );
  const rowLabels = Array.from({ length: GRID }, (_, i) => String(i + 1));

  /* ───────────────────── render ───────────────────── */

  return (
    <div style={S.root}>
      {/* ════════ TOP NAV ════════ */}
      <nav style={S.nav}>
        <div style={S.navLeft}>
          <div style={S.logoBox}>C</div>
          <span style={S.logoText}>ConstructIQ</span>
          <span style={S.badge}>Beta</span>
        </div>
        <div style={S.navCenter}>
          <NavTab label="SITE PLAN" active={activeTab === "site"} onClick={() => setActiveTab("site")} />
          <NavTab label="SCHEDULE" active={activeTab === "schedule"} onClick={() => setActiveTab("schedule")} />
          <NavTab label="ANALYTICS" active={activeTab === "analytics"} onClick={() => setActiveTab("analytics")} />
          <NavTab label="CONFIGURE" active={activeTab === "configure"} onClick={() => setActiveTab("configure")} badge={configErrorCount} />
        </div>
        <div style={S.navRight}>
          <span style={{ fontSize: 12, color: "#8B8FA3", maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {user.email}
          </span>
          <div style={{ position: "relative" }}>
            <div
              onClick={signOut}
              style={{
                width: 30, height: 30, borderRadius: "50%",
                background: "rgba(99,102,241,0.15)", border: "1px solid rgba(99,102,241,0.2)",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 11, fontWeight: 600, color: "#6366F1", cursor: "pointer",
                transition: "all 0.15s",
              }}
              title="Sign out"
            >
              {(user.email || "U")[0].toUpperCase()}
            </div>
          </div>
        </div>
      </nav>

      {/* ════════ MAIN CONTENT ════════ */}
      <div style={S.main}>
        {/* ──── LEFT COLUMN ──── */}
        <div style={S.leftCol}>
          {activeTab === "site" ? (
          <>
          {/* Zone Toolbar */}
          <div style={{ ...S.toolbar, flexWrap: "wrap", rowGap: 4 }}>
            {ZONES.filter(z => z.id !== "eraser").map((z) => {
              const active = activeTool === z.id;
              return (
                <button
                  key={z.id}
                  onClick={() => setActiveTool(active ? null : z.id)}
                  style={{
                    ...S.toolBtn,
                    color: active ? "#e2e8f0" : "#8B8FA3",
                    background: active ? "rgba(255,255,255,0.04)" : "transparent",
                  }}
                >
                  <span style={{
                    width: 8, height: 8, borderRadius: "50%", background: z.color,
                    opacity: active ? 1 : 0.6, flexShrink: 0,
                    transition: "opacity 0.15s",
                  }} />
                  {z.label}
                </button>
              );
            })}
            <div style={{ width: 1, height: 20, background: "rgba(255,255,255,0.06)", margin: "0 4px" }} />
            <button
              onClick={() => setActiveTool(activeTool === "eraser" ? null : "eraser")}
              style={{
                ...S.toolBtn,
                color: activeTool === "eraser" ? "#e2e8f0" : "#8B8FA3",
                background: activeTool === "eraser" ? "rgba(255,255,255,0.04)" : "transparent",
              }}
            >
              Eraser
            </button>
            <button
              onClick={clearSite}
              style={{ ...S.toolBtn, color: "#8B8FA3" }}
            >
              Clear Site
            </button>
            <button
              onClick={() => { setOptimizerOpen(true); setOptimizerResult(null); }}
              style={{ ...S.toolBtn, color: "#8B8FA3" }}
            >
              AI Optimize
            </button>
            <button
              onClick={() => setProjectsModalOpen(true)}
              style={{ ...S.toolBtn, color: "#8B8FA3" }}
            >
              Projects
            </button>
            <div style={{ flex: 1 }} />
            <div style={S.zoneCounter}>
              {placedCount > 0 && (
                <span style={{ fontSize: 11, color: "#4A4E63" }}>
                  {placedCount} zone{placedCount !== 1 ? "s" : ""} placed
                </span>
              )}
            </div>
          </div>

          {/* Grid Area */}
          <div style={S.gridArea}>
            {/* Site Plan Header */}
            <div style={S.gridHeader}>
              <span style={{ fontSize: 10, fontWeight: 500, color: "#4A4E63", letterSpacing: "0.08em" }}>
                SITE PLAN — {GRID}x{GRID} GRID
              </span>
              <span style={{ fontSize: 10, color: "#4A4E63" }}>
                Phase: <span style={{ color: "#8B8FA3" }}>{currentPhase}</span>
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
              <div style={{ position: "relative" }}>
                <div
                  ref={gridRef}
                  onMouseMove={handleResizeMove}
                  onMouseUp={() => { isPaintingRef.current = false; handleResizeUp(); }}
                  onMouseLeave={handleResizeUp}
                  style={{
                    display: "grid",
                    gridTemplateColumns: `repeat(${GRID}, 1fr)`,
                    width: GRID * 34,
                    border: "1px solid rgba(255,255,255,0.04)",
                    borderRadius: 6,
                    overflow: "hidden",
                  }}
                >
                  {(() => {
                    const hoverFootprint = new Map();
                    if (activeTool && hoveredCell >= 0 && !cells[hoveredCell]) {
                      const hz = ZONES.find((z) => z.id === activeTool);
                      const { w, h } = ZONE_SIZES[activeTool];
                      const hx = hoveredCell % GRID;
                      const hy = Math.floor(hoveredCell / GRID);
                      const oob = hx + w > GRID || hy + h > GRID;
                      let blocked = oob;
                      if (!oob) {
                        for (let dy = 0; dy < h && !blocked; dy++)
                          for (let dx = 0; dx < w && !blocked; dx++) {
                            const ti = (hy + dy) * GRID + (hx + dx);
                            if (cells[ti] !== null) blocked = true;
                          }
                      }
                      for (let dy = 0; dy < h; dy++)
                        for (let dx = 0; dx < w; dx++) {
                          const ti = (hy + dy) * GRID + (hx + dx);
                          if (ti >= 0 && ti < GRID * GRID && (hx + dx) < GRID)
                            hoverFootprint.set(ti, { color: hz.color, valid: !blocked });
                        }
                    }
                    return cells.map((cell, i) => {
                    const [cx, cy] = cellXY(i);
                    const hfp = hoverFootprint.get(i);

                    if (cell && cell.ref !== undefined) {
                      const originZone = ZONES.find((z) => z.id === cell.id);
                      const zClr = originZone?.color || "#64748b";
                      return (
                        <div
                          key={i}
                          onClick={() => placeZone(cell.ref)}
                          onMouseEnter={() => setHoveredCell(i)}
                          onMouseLeave={() => setHoveredCell(-1)}
                          style={{
                            width: 34,
                            height: 34,
                            background: zClr + "12",
                            borderRight: "1px solid rgba(255,255,255,0.04)",
                            borderBottom: "1px solid rgba(255,255,255,0.04)",
                            cursor: activeTool ? "crosshair" : "default",
                            transition: "background 0.15s",
                            position: "relative",
                            boxShadow: `inset 0 0 0 1px ${zClr}1a`,
                          }}
                        >
                          {hfp && (
                            <div style={{
                              position: "absolute", inset: 0,
                              background: hfp.valid ? hfp.color + "1a" : "#ef44441a",
                              pointerEvents: "none", zIndex: 3,
                            }} />
                          )}
                        </div>
                      );
                    }

                    const isHover = hoveredCell === i && activeTool && !cell;
                    const hoverZone = isHover ? ZONES.find((z) => z.id === activeTool) : null;

                    let cellBg = cell ? (cell.color + "12") : "#161822";
                    let cellBorderR = "1px solid rgba(255,255,255,0.04)";
                    let cellBorderB = "1px solid rgba(255,255,255,0.04)";
                    let cellBorderL = undefined;
                    let cellBorderT = undefined;
                    let cellAnim = undefined;
                    let cellBoxShadow = undefined;
                    let content = null;

                    if (cell?.id === "building") {
                      const stage = getBuildingStage(buildPct);
                      cellBg = cell.color + "12";
                      cellBorderR = `1px solid ${cell.color}30`;
                      cellBorderB = `1px solid ${cell.color}30`;
                      content = (
                        <>
                          <span style={{ fontSize: 9, fontWeight: 700, color: cell.color + "cc", lineHeight: 1, letterSpacing: "0.04em", fontFamily: "monospace" }}>BD</span>
                          <span style={{ fontSize: 7, fontWeight: 600, color: stage.border, lineHeight: 1, marginTop: 2, opacity: 0.7 }}>
                            {stage.label}
                          </span>
                          <div style={{ position: "absolute", bottom: 3, left: 5, right: 5, height: 2, background: "rgba(255,255,255,0.04)", borderRadius: 1 }}>
                            <div style={{ width: `${Math.min(buildPct, 100)}%`, height: "100%", background: stage.border, borderRadius: 1, transition: "width 0.3s", opacity: 0.7 }} />
                          </div>
                        </>
                      );

                    } else if (cell?.id === "materials") {
                      const mats = matStatusByZone[simZoneId("materials", cx, cy)] || [];
                      const avgPct = mats.length > 0 ? mats.reduce((s, m) => s + m.pct_remaining, 0) / mats.length : 100;
                      const matLow = mats.some((m) => m.pct_remaining < 20);
                      const barClr = avgPct > 50 ? "#22c55e" : avgPct > 20 ? "#eab308" : "#ef4444";
                      cellBg = cell.color + "12";
                      cellBorderR = `1px solid ${cell.color}30`;
                      cellBorderB = `1px solid ${cell.color}30`;
                      if (matLow) {
                        cellAnim = "pulse-red 1.5s infinite";
                      }
                      content = (
                        <>
                          <span style={{ fontSize: 9, fontWeight: 700, color: cell.color + "cc", lineHeight: 1, letterSpacing: "0.04em", fontFamily: "monospace" }}>MT</span>
                          <span style={{ fontSize: 7, color: barClr, fontWeight: 600, lineHeight: 1, marginTop: 1 }}>
                            {Math.round(avgPct)}%
                          </span>
                          <div style={{ position: "absolute", bottom: 3, left: 5, right: 5, height: 3, background: "rgba(255,255,255,0.04)", borderRadius: 1.5 }}>
                            <div style={{ width: `${avgPct}%`, height: "100%", background: barClr, borderRadius: 1.5, transition: avgPct < 50 ? "width 0.5s ease, background 0.5s ease" : "width 0.3s", opacity: 0.7 }} />
                          </div>
                        </>
                      );

                    } else if (cell?.id === "workers") {
                      const numWZ = cells.filter((c) => c?.isOrigin && c.id === "workers").length;
                      const wCount = simulationState ? (workersByZone[simZoneId('workers', cx, cy)]?.count || 0) : (numWZ > 0 && optimizerWorkers > 0 ? Math.round(optimizerWorkers / numWZ) : 25);
                      cellBg = cell.color + "12";
                      cellBorderR = `1px solid ${cell.color}30`;
                      cellBorderB = `1px solid ${cell.color}30`;
                      content = (
                        <>
                          <span style={{ fontSize: 9, fontWeight: 700, color: cell.color + "cc", lineHeight: 1, letterSpacing: "0.04em", fontFamily: "monospace" }}>WK</span>
                          <span style={{ fontSize: 7, fontWeight: 700, color: cell.color + "cc", lineHeight: 1, marginTop: 1 }}>{wCount}</span>
                        </>
                      );

                    } else if (cell?.id === "crane") {
                      const craneData = craneByPos[`${cx}-${cy}`];
                      const isBroken = craneData?.breakdown || false;
                      cellBg = cell.color + "12";
                      cellBorderR = `1px solid ${cell.color}30`;
                      cellBorderB = `1px solid ${cell.color}30`;
                      content = (
                        <>
                          <span style={{ fontSize: 9, fontWeight: 700, color: isBroken ? "#ef4444cc" : cell.color + "cc", lineHeight: 1, letterSpacing: "0.04em", fontFamily: "monospace" }}>CR</span>
                          {isBroken && (
                            <div style={{
                              position: "absolute", inset: 0, background: "#ef444418",
                              display: "flex", alignItems: "center", justifyContent: "center",
                            }}>
                              <span style={{ color: "#ef4444", fontWeight: 700, fontSize: 16, lineHeight: 1 }}>{"\u2715"}</span>
                            </div>
                          )}
                        </>
                      );

                    } else if (cell?.id === "road") {
                      const adj = roadAdjMap[i] || {};
                      const isEdge = cx === 0 || cx === GRID - 1 || cy === 0 || cy === GRID - 1;
                      const isBlocked = blockedRoadCells.has(i);
                      const entryDir = isEdge
                        ? cx === 0 ? "right" : cx === GRID - 1 ? "left" : cy === 0 ? "down" : "up"
                        : null;

                      cellBg = isBlocked ? "#ef444415" : cell.color + "18";
                      cellBorderR = `1px solid ${cell.color}25`;
                      cellBorderB = `1px solid ${cell.color}25`;
                      if (isBlocked) {
                        cellBorderR = "1px solid #ef444440";
                        cellBorderB = cellBorderR;
                      }
                      if (hasActiveDelivery && !isBlocked) {
                        cellAnim = "pulse-amber 2s infinite";
                      }
                      content = (
                        <>
                          {(adj.up || adj.down) && (
                            <div style={{
                              position: "absolute", left: "50%", top: adj.up ? 0 : "30%",
                              bottom: adj.down ? 0 : "30%", width: 0,
                              borderLeft: "1px dashed rgba(255,255,255,0.06)",
                              transform: "translateX(-0.5px)", pointerEvents: "none",
                            }} />
                          )}
                          {(adj.left || adj.right) && (
                            <div style={{
                              position: "absolute", top: "50%", left: adj.left ? 0 : "30%",
                              right: adj.right ? 0 : "30%", height: 0,
                              borderTop: "1px dashed rgba(255,255,255,0.06)",
                              transform: "translateY(-0.5px)", pointerEvents: "none",
                            }} />
                          )}
                          {isEdge && entryDir ? (
                            <span style={{ fontSize: 12, color: "#8B8FA3", fontWeight: 600, lineHeight: 1, zIndex: 1 }}>
                              {ENTRY_ARROWS[entryDir]}
                            </span>
                          ) : (
                            <span style={{ fontSize: 9, fontWeight: 700, color: cell.color + "80", lineHeight: 1, zIndex: 1, fontFamily: "monospace" }}>RD</span>
                          )}
                          {isBlocked && (
                            <div style={{
                              position: "absolute", inset: 0, display: "flex",
                              alignItems: "center", justifyContent: "center",
                              background: "#ef444412", zIndex: 2,
                            }}>
                              <span style={{ color: "#ef4444", fontSize: 12, fontWeight: 700, lineHeight: 1 }}>{"\u2715"}</span>
                            </div>
                          )}
                        </>
                      );

                    } else if (cell?.id === "truck_staging") {
                      const trucksHere = stagedTruckCount;
                      const active = trucksHere > 0;
                      cellBg = cell.color + "12";
                      cellBorderR = `1px solid ${cell.color}30`;
                      cellBorderB = `1px solid ${cell.color}30`;
                      if (active) cellAnim = "pulse-amber 2.5s infinite";
                      content = (
                        <>
                          <span style={{ fontSize: 9, fontWeight: 700, color: cell.color + "cc", lineHeight: 1, letterSpacing: "0.04em", fontFamily: "monospace" }}>TS</span>
                          <span style={{
                            fontSize: 7, fontWeight: 700, lineHeight: 1, marginTop: 1,
                            color: active ? "#84cc16" : "#4A4E63",
                          }}>
                            {trucksHere}
                          </span>
                        </>
                      );

                    } else if (cell?.id === "boundary") {
                      cellBg = "repeating-linear-gradient(45deg, #ef444410 0px, #ef444410 3px, transparent 3px, transparent 9px)";
                      cellBorderR = "1px solid #ef444440";
                      cellBorderB = "1px solid #ef444440";
                      cellBorderL = "1px solid #ef444440";
                      cellBorderT = "1px solid #ef444440";
                      content = (
                        <span style={{ fontSize: 7, fontWeight: 700, color: "#ef444480", letterSpacing: "0.04em", lineHeight: 1, fontFamily: "monospace" }}>
                          SB
                        </span>
                      );

                    } else if (cell) {
                      const zoneCode = ZONES.find(z => z.id === cell.id)?.code || "";
                      cellBg = cell.color + "12";
                      cellBorderR = `1px solid ${cell.color}30`;
                      cellBorderB = `1px solid ${cell.color}30`;
                      content = (
                        <span style={{ fontSize: 9, fontWeight: 700, color: cell.color + "cc", lineHeight: 1, letterSpacing: "0.04em", fontFamily: "monospace" }}>{zoneCode}</span>
                      );
                    }

                    return (
                      <div
                        key={i}
                        onClick={() => {
                          if (activeTool === 'road' || activeTool === 'boundary' || activeTool === 'fence' || activeTool === 'eraser') return;
                          placeZone(i);
                        }}
                        onMouseDown={() => {
                          if (activeTool === 'road' || activeTool === 'boundary' || activeTool === 'fence' || activeTool === 'eraser') {
                            isPaintingRef.current = true;
                            placeZone(i);
                          }
                        }}
                        onMouseEnter={() => {
                          setHoveredCell(i);
                          if (isPaintingRef.current) placeZone(i);
                        }}
                        onMouseLeave={() => setHoveredCell(-1)}
                        style={{
                          width: 34,
                          height: 34,
                          display: "flex",
                          flexDirection: "column",
                          alignItems: "center",
                          justifyContent: "center",
                          background: cellBg,
                          borderRight: cellBorderR,
                          borderBottom: cellBorderB,
                          ...(cellBorderL ? { borderLeft: cellBorderL } : {}),
                          ...(cellBorderT ? { borderTop: cellBorderT } : {}),
                          cursor: activeTool ? "crosshair" : "default",
                          transition: "background 0.15s, border-color 0.15s, box-shadow 0.3s",
                          position: "relative",
                          animation: cellAnim,
                          ...(cellBoxShadow ? { boxShadow: cellBoxShadow } : {}),
                        }}
                      >
                        {content}
                        {hfp && (
                          <div style={{
                            position: "absolute", inset: 0,
                            background: hfp.valid ? hfp.color + "1a" : "#ef44441a",
                            pointerEvents: "none", zIndex: 3,
                            display: "flex", alignItems: "center", justifyContent: "center",
                          }}>
                            {!cell && i === hoveredCell && hoverZone && hoverZone.id !== "boundary" && (
                              <span style={{ fontSize: 9, opacity: 0.4, color: hoverZone.color, fontWeight: 700, fontFamily: "monospace" }}>{hoverZone.code}</span>
                            )}
                          </div>
                        )}
                        {cell && cell.isOrigin && (cell.width > 1 || cell.height > 1) && (
                          <div
                            onMouseDown={(e) => {
                              e.stopPropagation();
                              e.preventDefault();
                              dragRef.current = {
                                originIndex: i,
                                startX: e.clientX,
                                startY: e.clientY,
                                origW: cell.width,
                                origH: cell.height,
                              };
                            }}
                            style={{
                              position: "absolute",
                              bottom: 0,
                              right: 0,
                              width: 10,
                              height: 10,
                              background: cell.color,
                              opacity: 0.8,
                              cursor: "se-resize",
                              zIndex: 10,
                              borderRadius: "2px 0 2px 0",
                            }}
                          />
                        )}
                      </div>
                    );
                  });
                  })()}
                </div>
                {(deliveryRoutes.length > 0 || activeCranes.length > 0) && (
                  <svg
                    style={{
                      position: "absolute", top: 0, left: 0,
                      width: GRID * 34, height: GRID * 34,
                      pointerEvents: "none",
                    }}
                  >
                    {deliveryRoutes.map((r, idx) => (
                      <line
                        key={idx}
                        x1={r.x1} y1={r.y1} x2={r.x2} y2={r.y2}
                        stroke="#f9731640" strokeWidth="1.5"
                        strokeDasharray="4 3"
                      />
                    ))}
                    {activeCranes.map((crane) => (
                      <circle
                        key={crane.id}
                        cx={crane.x * 34 + 17}
                        cy={crane.y * 34 + 17}
                        r={crane.swing_radius * 34}
                        fill="none"
                        stroke={crane.breakdown ? "#ef444440" : "#eab30840"}
                        strokeWidth="1.5"
                        strokeDasharray="6 3"
                      />
                    ))}
                  </svg>
                )}
                {activeTrucks.map((truck) => {
                  const p = Math.max(0, Math.min(truck.progress, 0.99));
                  const path = truck.path;
                  if (!path || path.length === 0) return null;

                  const blockedIdx = path.findIndex((ci) => blockedRoadCells.has(ci));
                  const pathPos = Math.min(Math.floor(p * path.length), path.length - 1);
                  const isBlocked = blockedIdx >= 0 && pathPos >= blockedIdx;
                  const effectivePos = isBlocked ? blockedIdx : pathPos;
                  const ci = path[effectivePos];
                  const tx = (ci % GRID) * 34;
                  const ty = Math.floor(ci / GRID) * 34;

                  return (
                    <div
                      key={truck.id}
                      style={{
                        position: "absolute",
                        left: tx,
                        top: ty,
                        width: 34,
                        height: 34,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        zIndex: 20,
                        pointerEvents: "none",
                        transition: "left 0.2s, top 0.2s",
                      }}
                    >
                      <div style={{
                        background: isBlocked ? "#ef444418" : "#84cc1618",
                        border: `1px solid ${isBlocked ? "#ef444440" : "#84cc1640"}`,
                        borderRadius: 3,
                        padding: "2px 4px",
                        fontSize: 8,
                        fontWeight: 700,
                        lineHeight: 1,
                        color: isBlocked ? "#ef4444" : "#84cc16",
                        fontFamily: "monospace",
                      }}>
                        TK
                      </div>
                    </div>
                  );
                })}
                {simulationState && (
                  <div style={{
                    position: 'absolute', top: 8, right: 8,
                    background: 'rgba(15,17,23,0.85)', backdropFilter: 'blur(8px)',
                    border: '1px solid rgba(255,255,255,0.06)', borderRadius: 8,
                    padding: '10px 14px', zIndex: 30, minWidth: 150,
                    display: 'flex', flexDirection: 'column', gap: 5,
                  }}>
                    <div style={{ fontSize: 10, fontWeight: 600, color: '#4A4E63', letterSpacing: '0.06em' }}>SITE STATUS</div>
                    {[
                      { label: 'Phase', value: simulationState.phase?.replace(/_/g, ' ').toUpperCase(), color: '#8B8FA3' },
                      { label: 'Workers', value: simulationState.total_workers, color: '#8B8FA3' },
                      { label: 'Tasks', value: simulationState.active_tasks?.length || 0, color: '#8B8FA3' },
                      { label: 'Risk', value: '$' + (simConflicts.reduce((s,c) => s + (c.cost_impact||0), 0)).toLocaleString(), color: simConflicts.some(c => c.severity === 'HIGH') ? '#ef4444' : '#8B8FA3' },
                    ].map(({ label, value, color }) => (
                      <div key={label} style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                        <span style={{ fontSize: 10, color: '#4A4E63' }}>{label}</span>
                        <span style={{ fontSize: 10, fontWeight: 600, color }}>{value}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Zone Legend */}
            <div style={S.legend}>
              {zoneCounts.filter(z => z.id !== "eraser").map((z) => (
                <div key={z.id} style={S.legendItem}>
                  <div style={{ width: 6, height: 6, borderRadius: "50%", background: z.color, opacity: 0.7 }} />
                  <span style={{ fontSize: 10, color: "#4A4E63" }}>
                    {z.label}{z.count > 0 ? ` (${z.count})` : ""}
                  </span>
                </div>
              ))}
              <div style={{ marginLeft: "auto", paddingRight: 24 }}>
                <span style={{ fontSize: 10, color: "#4A4E63" }}>
                  1 tile = 10 ft
                </span>
              </div>
            </div>
          </div>
          </>
          ) : activeTab === "schedule" ? (
            <ScheduleView analytics={analytics} day={day} currentPhase={currentPhase} projectDuration={projectDuration} ganttPhases={ganttPhases} />
          ) : activeTab === "configure" ? (
            <ConfigurePanel cells={cells} projectDuration={projectDuration} onConfigSave={setProjectConfig} onValidationChange={setConfigErrorCount} config={savedConfig} onConfigChange={setSavedConfig} />
          ) : (
            <AnalyticsDashboard analytics={analytics} />
          )}

          {/* Timeline */}
          <div style={S.timeline}>
            <button onClick={rewind} style={{ ...S.playBtn }} title="Rewind to Day 1">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M6 6h2v12H6zm3.5 6l8.5 6V6z"/></svg>
            </button>
            <button
              onClick={() => { setIsPlaying(!isPlaying); }}
              style={{
                ...S.playBtn,
                background: isPlaying ? "transparent" : "#6366F1",
                borderColor: isPlaying ? "rgba(255,255,255,0.06)" : "#6366F1",
                color: "#fff",
              }}
            >
              {isPlaying ? (
                <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>
              ) : (
                <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
              )}
            </button>
            <div style={S.dayInfo}>
              <span style={{ fontSize: 13, fontWeight: 600, color: "#e2e8f0" }}>
                Day {day}
              </span>
              <span style={{ fontSize: 10, color: "#4A4E63" }}>of {projectDuration}</span>
            </div>
            <button
              onClick={() => skipDays(7)}
              disabled={day >= projectDuration}
              style={{
                ...S.toolBtn,
                color: "#8B8FA3",
                fontSize: 11,
                padding: "4px 8px",
                opacity: day >= projectDuration ? 0.3 : 1,
                cursor: day >= projectDuration ? "not-allowed" : "pointer",
              }}
              title="Skip forward 7 days"
            >
              +7d
            </button>

            <div style={S.durationPicker}>
              {DURATION_OPTIONS.map((d) => (
                <button
                  key={d}
                  onClick={() => handleDurationChange(d)}
                  style={{
                    ...S.durationBtn,
                    ...(d === projectDuration ? S.durationBtnActive : {}),
                  }}
                >
                  {d}d
                </button>
              ))}
            </div>

            <div style={S.progressWrapper}>
              <div style={S.phaseLabels}>
                {ganttPhases.map((gp) => {
                  const pct = ((gp.start - 1) / (projectDuration - 1)) * 100;
                  return (
                    <span
                      key={gp.label}
                      style={{
                        fontSize: 9,
                        color: progress >= pct ? "#8B8FA3" : "#4A4E63",
                        fontWeight: 500,
                        position: "absolute",
                        left: `${pct}%`,
                        transform: "translateX(-50%)",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {gp.label}
                    </span>
                  );
                })}
              </div>
              <div style={S.progressTrack}>
                <div
                  style={{
                    ...S.progressFill,
                    width: `${progress}%`,
                  }}
                />
                {ganttPhases.slice(1, -1).map((gp) => (
                  <div
                    key={gp.label}
                    style={{
                      position: "absolute",
                      left: `${((gp.start - 1) / (projectDuration - 1)) * 100}%`,
                      top: 0,
                      bottom: 0,
                      width: 1,
                      background: "rgba(255,255,255,0.04)",
                    }}
                  />
                ))}
              </div>
            </div>

            <div style={S.pctDisplay}>
              <span style={{ fontSize: 14, fontWeight: 600, color: "#8B8FA3", fontVariantNumeric: "tabular-nums" }}>
                {Math.round(progress)}%
              </span>
            </div>
          </div>
        </div>

        {/* ──── RIGHT COLUMN — AI CHAT ──── */}
        <div style={{
          ...S.rightCol,
          borderLeft: hasNewAlert ? "1px solid rgba(239,68,68,0.3)" : "1px solid rgba(255,255,255,0.06)",
          transition: "border-left 0.3s ease",
        }}>
          {/* Chat Header */}
          <div style={S.chatHeader}>
            <div style={S.avatar}>MC</div>
            <div>
              <div style={{ fontSize: 14, fontWeight: 600, color: "#e2e8f0" }}>
                Mike Callahan
              </div>
              <div style={{ fontSize: 11, color: "#8B8FA3" }}>
                AI Construction Advisor
              </div>
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
            {messages.map((msg, i) =>
              msg.role === "divider" ? (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 0" }}>
                  <div style={{ flex: 1, height: 1, background: "linear-gradient(90deg, transparent, #6366F1, transparent)" }} />
                  <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: 1.5, color: "#6366F1", textTransform: "uppercase", whiteSpace: "nowrap" }}>{msg.text}</span>
                  <div style={{ flex: 1, height: 1, background: "linear-gradient(90deg, transparent, #6366F1, transparent)" }} />
                </div>
              ) : (
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
                    borderRadius: 8,
                    background: msg.isDebrief ? "rgba(99,102,241,0.06)" : "rgba(255,255,255,0.03)",
                    border: msg.isDebrief ? "1px solid rgba(99,102,241,0.2)" : "1px solid rgba(255,255,255,0.06)",
                    borderLeft: msg.role === "ai" ? `2px solid ${msg.isDebrief ? "#818cf8" : "#6366F1"}` : "1px solid rgba(255,255,255,0.06)",
                    fontSize: 13,
                    lineHeight: 1.55,
                    color: "#e2e8f0",
                  }}
                >
                  {msg.role === "ai" ? (
                    <ReactMarkdown components={MD_COMPONENTS}>{msg.text}</ReactMarkdown>
                  ) : (
                    msg.text
                  )}
                </div>
              </div>
              )
            )}
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
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="5" y1="12" x2="19" y2="12" />
                <polyline points="12 5 19 12 12 19" />
              </svg>
            </button>
          </div>
        </div>
      </div>

      {optimizerOpen && (
        <OptimizerModal
          loading={optimizerLoading}
          result={optimizerResult}
          onGenerate={runOptimizer}
          onClose={() => setOptimizerOpen(false)}
        />
      )}

      {projectsModalOpen && (
        <ProjectsModal
          projects={savedProjects}
          nameInput={projectNameInput}
          onNameChange={setProjectNameInput}
          onSave={saveProject}
          onLoad={loadProject}
          onDelete={deleteProject}
          onOpen={fetchProjects}
          onClose={() => setProjectsModalOpen(false)}
        />
      )}
    </div>
  );
}

/* ───────────────────── sub-components ───────────────────── */

function NavTab({ label, active, onClick, badge }) {
  return (
    <button
      onClick={onClick}
      style={{
        background: "none",
        border: "none",
        borderBottom: active ? "2px solid #6366F1" : "2px solid transparent",
        fontSize: 12,
        fontWeight: 500,
        letterSpacing: "0.03em",
        color: active ? "#ffffff" : "#8B8FA3",
        padding: "8px 14px",
        borderRadius: 0,
        cursor: "pointer",
        position: "relative",
        transition: "color 0.15s, border-color 0.15s",
        marginBottom: -1,
      }}
    >
      {label}
      {badge > 0 && (
        <span style={{
          position: "absolute", top: 2, right: 2,
          minWidth: 14, height: 14, borderRadius: 7,
          background: "rgba(239,68,68,0.15)", color: "#ef4444",
          fontSize: 9, fontWeight: 600,
          display: "flex", alignItems: "center", justifyContent: "center",
          padding: "0 3px", lineHeight: 1,
          border: "1px solid rgba(239,68,68,0.2)",
        }}>{badge}</span>
      )}
    </button>
  );
}

/* ───────────────────── optimizer modal ───────────────────── */

function OptimizerModal({ loading, result, onGenerate, onClose }) {
  const [desc, setDesc] = useState("10-story data center");
  const [cranes, setCranes] = useState(2);
  const [workers, setWorkers] = useState(40);
  const [materials, setMaterials] = useState(3);

  const handleSubmit = (e) => {
    e.preventDefault();
    onGenerate({ description: desc, cranes, workers, materials });
  };

  const inputStyle = {
    width: "100%",
    height: 40,
    padding: "0 12px",
    borderRadius: 6,
    background: "#1A1D2B",
    border: "1px solid rgba(255,255,255,0.06)",
    color: "#e2e8f0",
    fontSize: 13,
    outline: "none",
    fontFamily: "inherit",
  };

  const labelStyle = {
    fontSize: 11,
    fontWeight: 500,
    color: "#8B8FA3",
    marginBottom: 4,
    display: "block",
  };

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, zIndex: 1000,
        background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)",
        display: "flex", alignItems: "center", justifyContent: "center",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 460, background: "#0F1117", borderRadius: 10,
          border: "1px solid rgba(255,255,255,0.06)", boxShadow: "0 24px 80px rgba(0,0,0,0.5)",
          overflow: "hidden",
        }}
      >
        {/* Header */}
        <div style={{
          padding: "20px 24px 16px", borderBottom: "1px solid rgba(255,255,255,0.06)",
          display: "flex", alignItems: "flex-start", justifyContent: "space-between",
        }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 600, color: "#e2e8f0" }}>
              AI Layout Optimizer
            </div>
            <div style={{ fontSize: 12, color: "#8B8FA3", marginTop: 4, lineHeight: 1.4 }}>
              Describe your project and available resources. Mike will generate the optimal site layout.
            </div>
          </div>
          <button
            onClick={onClose}
            style={{
              background: "none", border: "none", color: "#64748b",
              fontSize: 18, cursor: "pointer", padding: "2px 6px",
              borderRadius: 6, lineHeight: 1,
            }}
          >
            {"\u2715"}
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} style={{ padding: "20px 24px", display: "flex", flexDirection: "column", gap: 14 }}>
          <div>
            <label style={labelStyle}>What are you building?</label>
            <input
              value={desc}
              onChange={(e) => setDesc(e.target.value)}
              placeholder="e.g. 10-story data center, warehouse, office building"
              style={inputStyle}
              required
            />
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
            <div>
              <label style={labelStyle}>Number of cranes</label>
              <input
                type="number" min={1} max={6} value={cranes}
                onChange={(e) => setCranes(Number(e.target.value))}
                style={inputStyle}
              />
            </div>
            <div>
              <label style={labelStyle}>Total workers available</label>
              <input
                type="number" min={1} max={200} value={workers}
                onChange={(e) => setWorkers(Number(e.target.value))}
                style={inputStyle}
              />
              <span style={{ fontSize: 10, color: "#475569", marginTop: 3, display: "block" }}>Each worker zone holds up to 25 workers</span>
            </div>
            <div>
              <label style={labelStyle}>Material storage zones</label>
              <input
                type="number" min={1} max={8} value={materials}
                onChange={(e) => setMaterials(Number(e.target.value))}
                style={inputStyle}
              />
            </div>
          </div>

          {/* Result message */}
          {result && (
            <div style={{
              padding: "10px 14px", borderRadius: 8,
              background: result.success ? "#16653420" : "#7f1d1d20",
              border: `1px solid ${result.success ? "#22c55e30" : "#ef444430"}`,
              fontSize: 12, lineHeight: 1.5,
              color: result.success ? "#4ade80" : "#fca5a5",
            }}>
              {result.success
                ? `Layout generated: ${result.breakdown} placed based on construction best practices.`
                : result.error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading || !desc.trim()}
            style={{
              height: 44, borderRadius: 8, border: "none",
              background: loading ? "rgba(255,255,255,0.04)" : "#6366F1",
              color: "#fff", fontSize: 14, fontWeight: 600,
              cursor: loading ? "not-allowed" : "pointer",
              fontFamily: "inherit",
              display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
              opacity: loading || !desc.trim() ? 0.6 : 1,
              transition: "all 0.15s",
            }}
          >
            {loading ? (
              <>
                <span style={{ display: "inline-block", width: 14, height: 14, border: "2px solid #ffffff40", borderTopColor: "#fff", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
                Mike is analyzing your project...
              </>
            ) : (
              "Generate Optimal Layout"
            )}
          </button>
        </form>
      </div>
    </div>
  );
}

/* ───────────────────── projects modal ───────────────────── */

function ProjectsModal({ projects, nameInput, onNameChange, onSave, onLoad, onDelete, onOpen, onClose }) {
  useEffect(() => { onOpen(); }, []);

  const fmtDate = (iso) => {
    try { return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }); }
    catch { return "—"; }
  };

  const inputStyle = {
    flex: 1,
    height: 38,
    padding: "0 12px",
    borderRadius: 6,
    background: "#1A1D2B",
    border: "1px solid rgba(255,255,255,0.06)",
    color: "#e2e8f0",
    fontSize: 13,
    outline: "none",
    fontFamily: "inherit",
  };

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, zIndex: 1000,
        background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)",
        display: "flex", alignItems: "center", justifyContent: "center",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 520, maxHeight: "80vh", background: "#0F1117", borderRadius: 10,
          border: "1px solid rgba(255,255,255,0.06)", boxShadow: "0 24px 80px rgba(0,0,0,0.5)",
          display: "flex", flexDirection: "column", overflow: "hidden",
        }}
      >
        {/* Header */}
        <div style={{
          padding: "20px 24px 16px", borderBottom: "1px solid rgba(255,255,255,0.06)",
          display: "flex", alignItems: "center", justifyContent: "space-between",
          flexShrink: 0,
        }}>
          <div style={{ fontSize: 15, fontWeight: 600, color: "#e2e8f0" }}>
            Projects
          </div>
          <button
            onClick={onClose}
            style={{
              background: "none", border: "none", color: "#64748b",
              fontSize: 18, cursor: "pointer", padding: "2px 6px",
              borderRadius: 6, lineHeight: 1,
            }}
          >
            {"\u2715"}
          </button>
        </div>

        {/* Save Section */}
        <div style={{
          padding: "16px 24px", borderBottom: "1px solid rgba(255,255,255,0.06)",
          display: "flex", gap: 8, alignItems: "center", flexShrink: 0,
        }}>
          <input
            value={nameInput}
            onChange={(e) => onNameChange(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && onSave()}
            placeholder="Project name..."
            style={inputStyle}
          />
          <button
            onClick={onSave}
            disabled={!nameInput.trim()}
            style={{
              height: 38, borderRadius: 6, border: "none",
              background: !nameInput.trim() ? "rgba(255,255,255,0.04)" : "#6366F1",
              color: "#fff", fontSize: 13, fontWeight: 600,
              padding: "0 18px", cursor: !nameInput.trim() ? "not-allowed" : "pointer",
              fontFamily: "inherit", whiteSpace: "nowrap",
              opacity: !nameInput.trim() ? 0.5 : 1,
              transition: "all 0.15s",
            }}
          >
            Save Current Layout
          </button>
        </div>

        {/* Project List */}
        <div style={{ flex: 1, overflowY: "auto", minHeight: 0 }}>
          {projects.length === 0 ? (
            <div style={{
              padding: "40px 24px", textAlign: "center",
              display: "flex", flexDirection: "column", alignItems: "center", gap: 8,
            }}>
              <span style={{ fontSize: 13, color: "#4A4E63", lineHeight: 1.5 }}>
                No saved projects. Save your current layout to get started.
              </span>
            </div>
          ) : (
            projects.map((p) => (
              <div
                key={p.id}
                style={{
                  padding: "12px 24px",
                  borderBottom: "1px solid rgba(255,255,255,0.04)",
                  display: "flex", alignItems: "center", gap: 12,
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 500, color: "#e2e8f0", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {p.name}
                  </div>
                  <div style={{ fontSize: 11, color: "#4A4E63", marginTop: 2 }}>
                    {p.zone_count} zone{p.zone_count !== 1 ? "s" : ""} &middot; {fmtDate(p.created_at)}
                  </div>
                </div>
                <button
                  onClick={() => onLoad(p)}
                  style={{
                    fontSize: 11, fontWeight: 500, color: "#8B8FA3",
                    background: "transparent", border: "1px solid rgba(255,255,255,0.06)",
                    borderRadius: 5, padding: "5px 12px", cursor: "pointer",
                    fontFamily: "inherit", transition: "all 0.15s",
                  }}
                >
                  Load
                </button>
                <button
                  onClick={() => onDelete(p.id)}
                  style={{
                    fontSize: 11, fontWeight: 500, color: "#4A4E63",
                    background: "transparent", border: "1px solid rgba(255,255,255,0.06)",
                    borderRadius: 5, padding: "5px 10px", cursor: "pointer",
                    fontFamily: "inherit", transition: "all 0.15s",
                  }}
                >
                  {"\u2715"}
                </button>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

/* ───────────────────── login screen ───────────────────── */

function LoginScreen() {
  const [activeTab, setActiveTab] = useState("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [successMsg, setSuccessMsg] = useState(null);

  const switchTab = (tab) => {
    setActiveTab(tab);
    setError(null);
    setSuccessMsg(null);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setSuccessMsg(null);

    try {
      if (activeTab === "signup") {
        const { error: signUpError } = await supabase.auth.signUp({ email, password });
        if (signUpError) throw signUpError;
        setSuccessMsg("Account created! Check your email to confirm, then log in.");
      } else {
        const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
        if (signInError) throw signInError;
      }
    } catch (err) {
      setError(err.message || "An unexpected error occurred");
    } finally {
      setLoading(false);
    }
  };

  const isLogin = activeTab === "login";

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 9999,
      background: "#0F1117",
      display: "flex", alignItems: "center", justifyContent: "center",
    }}>
      <div style={{
        width: 400, background: "#0F1117", borderRadius: 10,
        border: "1px solid rgba(255,255,255,0.06)",
        boxShadow: "0 24px 80px rgba(0,0,0,0.4)",
        overflow: "hidden",
      }}>
        {/* Logo + Title */}
        <div style={{ padding: "32px 32px 20px", textAlign: "center" }}>
          <div style={{
            display: "flex", alignItems: "center", justifyContent: "center",
            gap: 10, marginBottom: 8,
          }}>
            <div style={{
              width: 34, height: 34, borderRadius: 8,
              background: "#6366F1",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 16, fontWeight: 800, color: "#fff",
            }}>
              C
            </div>
            <span style={{
              fontSize: 20, fontWeight: 600, color: "#ffffff",
              letterSpacing: "-0.02em",
            }}>
              ConstructIQ
            </span>
          </div>
          <p style={{ fontSize: 13, color: "#8B8FA3", margin: 0 }}>
            AI-Powered Construction Intelligence
          </p>
        </div>

        {/* Tabs */}
        <div style={{
          display: "flex", margin: "0 32px", borderRadius: 8,
          background: "#1A1D2B", border: "1px solid rgba(255,255,255,0.06)",
          overflow: "hidden",
        }}>
          {["login", "signup"].map((tab) => (
            <button
              key={tab}
              onClick={() => switchTab(tab)}
              style={{
                flex: 1, padding: "10px 0", fontSize: 13, fontWeight: 600,
                color: activeTab === tab ? "#e2e8f0" : "#8B8FA3",
                background: activeTab === tab ? "#6366F1" : "transparent",
                border: "none", cursor: "pointer", fontFamily: "inherit",
                transition: "all 0.15s",
              }}
            >
              {tab === "login" ? "Login" : "Sign Up"}
            </button>
          ))}
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} style={{
          padding: "24px 32px 32px",
          display: "flex", flexDirection: "column", gap: 16,
        }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <label style={{ fontSize: 12, fontWeight: 500, color: "#8B8FA3" }}>Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              required
              style={{
                width: "100%", height: 42, padding: "0 14px", borderRadius: 8,
                background: "#1A1D2B", border: "1px solid rgba(255,255,255,0.06)", color: "#e2e8f0",
                fontSize: 13, outline: "none", fontFamily: "inherit",
                transition: "border-color 0.15s, box-shadow 0.15s",
              }}
            />
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <label style={{ fontSize: 12, fontWeight: 500, color: "#8B8FA3" }}>Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={isLogin ? "Enter your password" : "Min 6 characters"}
              required
              minLength={isLogin ? undefined : 6}
              style={{
                width: "100%", height: 42, padding: "0 14px", borderRadius: 8,
                background: "#1A1D2B", border: "1px solid rgba(255,255,255,0.06)", color: "#e2e8f0",
                fontSize: 13, outline: "none", fontFamily: "inherit",
                transition: "border-color 0.15s, box-shadow 0.15s",
              }}
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            style={{
              width: "100%", height: 44, borderRadius: 8, border: "none",
              background: loading ? "rgba(255,255,255,0.04)" : "#6366F1",
              color: "#fff", fontSize: 14, fontWeight: 600,
              cursor: loading ? "not-allowed" : "pointer", fontFamily: "inherit",
              display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
              opacity: loading ? 0.6 : 1, transition: "all 0.15s",
              marginTop: 4,
            }}
          >
            {loading ? (
              <>
                <span style={{
                  display: "inline-block", width: 14, height: 14,
                  border: "2px solid #ffffff40", borderTopColor: "#fff",
                  borderRadius: "50%", animation: "spin 0.8s linear infinite",
                }} />
                {isLogin ? "Signing in..." : "Creating account..."}
              </>
            ) : (
              isLogin ? "Login" : "Sign Up"
            )}
          </button>

          {error && (
            <p style={{
              fontSize: 13, color: "#ef4444", margin: 0,
              textAlign: "center", lineHeight: 1.4,
            }}>
              {error}
            </p>
          )}

          {successMsg && (
            <p style={{
              fontSize: 13, color: "#4ade80", margin: 0,
              textAlign: "center", lineHeight: 1.4,
            }}>
              {successMsg}
            </p>
          )}
        </form>
      </div>
    </div>
  );
}

/* ───────────────────── analytics dashboard ───────────────────── */

function AnalyticsDashboard({ analytics }) {
  if (!analytics.length) {
    return (
      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 8, background: "#12141E" }}>
        <span style={{ fontSize: 14, fontWeight: 500, color: "#8B8FA3" }}>No analytics data yet</span>
        <span style={{ fontSize: 12, color: "#4A4E63" }}>Press play to start the simulation</span>
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
          <line x1={P.l} y1={y} x2={W - P.r} y2={y} stroke="rgba(255,255,255,0.04)" strokeWidth="1" />
          <text x={P.l - 4} y={y + 3} fill="#4A4E63" fontSize="9" textAnchor="end" fontFamily="monospace">{label}</text>
        </g>
      );
    });

  const baseline = <line x1={P.l} y1={P.t + iH} x2={W - P.r} y2={P.t + iH} stroke="rgba(255,255,255,0.06)" strokeWidth="1" />;

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
    background: "#0F1117",
    borderRadius: 8,
    border: "1px solid rgba(255,255,255,0.06)",
    padding: "12px 14px",
    display: "flex",
    flexDirection: "column",
    gap: 6,
    overflow: "hidden",
  };
  const titleSt = { fontSize: 10, fontWeight: 600, color: "#4A4E63", letterSpacing: "0.06em" };

  return (
    <div style={{ flex: 1, overflow: "auto", background: "#12141E", padding: "16px 20px", display: "flex", flexDirection: "column", gap: 14 }}>
      {/* KPI row */}
      <div style={{ display: "flex", gap: 10 }}>
        {[
          { label: "DAYS RECORDED", val: analytics.length, color: "#8B8FA3" },
          { label: "TOTAL CONFLICTS", val: totalConflicts, color: "#f59e0b" },
          { label: "PEAK WORKERS", val: peakWorkers, color: "#8B8FA3" },
          { label: "RISK EXPOSURE", val: fmtK(totalCost), color: "#ef4444" },
        ].map((k) => (
          <div key={k.label} style={{ flex: 1, background: "#0F1117", borderRadius: 6, border: "1px solid rgba(255,255,255,0.06)", padding: "10px 14px" }}>
            <div style={{ fontSize: 10, color: "#4A4E63", fontWeight: 500, letterSpacing: "0.06em", marginBottom: 2 }}>{k.label}</div>
            <div style={{ fontSize: 18, fontWeight: 700, color: k.color, fontVariantNumeric: "tabular-nums" }}>{k.val}</div>
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
                    <rect x={P.l + matLabelW} y={y + 4} width={matBarMax} height={matRowH - 8} rx={3} fill="rgba(255,255,255,0.04)" />
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

function ScheduleView({ analytics, day, currentPhase, projectDuration, ganttPhases }) {
  const W = 760, H = 280;
  const P = { t: 32, r: 20, b: 36, l: 110 };
  const iW = W - P.l - P.r;
  const iH = H - P.t - P.b;
  const barH = iH / ganttPhases.length;
  const barPad = 6;

  const dayToX = (d) => P.l + ((d - 1) / (projectDuration - 1)) * iW;
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
    { label: "Project Start", value: "Day 1", color: "#6366F1" },
    {
      label: "First Conflict Detected",
      value: firstConflict ? `Day ${firstConflict.day}` : "—",
      color: "#f59e0b",
    },
    {
      label: "Peak Risk Day",
      value: peakRiskEntry && peakRiskEntry.costImpact > 0 ? `Day ${peakRiskEntry.day}` : "—",
      color: "#ef4444",
    },
    {
      label: "Critical Material Warning",
      value: critMaterial ? `Day ${critMaterial.day}` : "—",
      color: "#f97316",
    },
    {
      label: "Current Phase",
      value: currentPhase,
      color: "#8B8FA3",
    },
  ];

  const tickInterval = projectDuration <= 30 ? 5 : projectDuration <= 60 ? 10 : projectDuration <= 90 ? 15 : 30;
  const ticks = [];
  for (let d = 1; d <= projectDuration; d += tickInterval) ticks.push(d);
  if (ticks[ticks.length - 1] !== projectDuration) ticks.push(projectDuration);

  return (
    <div style={{ flex: 1, overflow: "auto", background: "#12141E", padding: "20px 24px", display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 600, color: "#e2e8f0", marginBottom: 2 }}>Project Schedule</div>
          <div style={{ fontSize: 11, color: "#8B8FA3" }}>{projectDuration}-day timeline — Day {day}</div>
        </div>
        <div style={{ display: "flex", gap: 12 }}>
          {ganttPhases.map((p) => (
            <div key={p.label} style={{ display: "flex", alignItems: "center", gap: 5 }}>
              <div style={{ width: 8, height: 8, borderRadius: "50%", background: p.color, opacity: 0.7 }} />
              <span style={{ fontSize: 10, color: "#8B8FA3" }}>{p.label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Gantt Chart */}
      <div style={{ background: "#0F1117", borderRadius: 8, border: "1px solid rgba(255,255,255,0.06)", padding: "16px 18px" }}>
        <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: "block" }}>
          {/* Timeline gridlines + labels */}
          {ticks.map((d) => {
            const x = dayToX(d);
            return (
              <g key={d}>
                <line x1={x} y1={P.t - 4} x2={x} y2={P.t + iH} stroke="rgba(255,255,255,0.04)" strokeWidth="1" />
                <text x={x} y={P.t + iH + 14} fill="#4A4E63" fontSize="9" fontFamily="monospace" textAnchor="middle">{d}</text>
              </g>
            );
          })}

          {/* Phase bars */}
          {ganttPhases.map((phase, i) => {
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
                  fill={isActive ? "#e2e8f0" : "#8B8FA3"}
                  fontSize="11"
                  fontWeight={isActive ? "600" : "400"}
                  textAnchor="end"
                  fontFamily="inherit"
                >
                  {phase.label}
                </text>

                {/* Background track */}
                <rect x={P.l} y={y} width={iW} height={h} rx={4} fill="rgba(255,255,255,0.02)" />

                {/* Phase bar */}
                <rect
                  x={x1}
                  y={y}
                  width={x2 - x1}
                  height={h}
                  rx={4}
                  fill={phase.color}
                  opacity={isPast ? 0.3 : isActive ? 0.7 : 0.45}
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
            const phaseIdx = ganttPhases.findIndex((p) => cd >= p.start && cd <= p.end);
            if (phaseIdx < 0) return null;
            const cy = P.t + phaseIdx * barH + barPad - 5;
            return (
              <circle
                key={`c-${i}`}
                cx={cx}
                cy={cy}
                r={2.5}
                fill="#ef4444"
                stroke="#0F1117"
                strokeWidth="1"
                opacity={0.7}
              />
            );
          })}

          {/* Today line */}
          <line
            x1={todayX}
            y1={P.t - 4}
            x2={todayX}
            y2={P.t + iH + 4}
            stroke="#6366F1"
            strokeWidth="1"
          />
          <text
            x={todayX}
            y={P.t - 8}
            fill="#6366F1"
            fontSize="8"
            fontWeight="600"
            textAnchor="middle"
            fontFamily="monospace"
          >
            {day}
          </text>
        </svg>
      </div>

      {/* Milestone Table */}
      <div style={{ background: "#0F1117", borderRadius: 8, border: "1px solid rgba(255,255,255,0.06)", overflow: "hidden" }}>
        <div style={{ padding: "12px 18px", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
          <span style={{ fontSize: 10, fontWeight: 600, color: "#4A4E63", letterSpacing: "0.06em" }}>PROJECT MILESTONES</span>
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
                    fontWeight: 500,
                    color: "#4A4E63",
                    borderBottom: "1px solid rgba(255,255,255,0.06)",
                    letterSpacing: "0.04em",
                  }}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {milestones.map((m, i) => (
              <tr key={i} style={{ borderBottom: i < milestones.length - 1 ? "1px solid rgba(255,255,255,0.04)" : "none" }}>
                <td style={{ padding: "10px 18px", width: 32 }}>
                  <div style={{ width: 6, height: 6, borderRadius: "50%", background: m.color, opacity: 0.6 }} />
                </td>
                <td style={{ padding: "10px 0", fontSize: 12, fontWeight: 500, color: "#e2e8f0" }}>{m.label}</td>
                <td style={{ padding: "10px 18px" }}>
                  <span style={{
                    fontSize: 12,
                    fontWeight: 600,
                    color: m.value === "—" ? "#4A4E63" : m.color,
                    fontVariantNumeric: "tabular-nums",
                    fontFamily: "monospace",
                  }}>
                    {m.value}
                  </span>
                </td>
                <td style={{ padding: "10px 18px", width: 24 }} />
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ───────────────────── configure panel ───────────────────── */

const CONFIGURE_SECTIONS = ["Phases", "Cranes", "Deliveries", "Workforce", "Equipment", "Milestones"];

const PRESET_COLORS = ["#3b82f6", "#8b5cf6", "#22c55e", "#f59e0b", "#ef4444", "#64748b", "#06b6d4", "#ec4899"];

const MATERIAL_TYPES = ["Concrete", "Rebar", "Structural Steel", "MEP Conduit", "Lumber", "Masonry"];
const DELIVERY_RECURRING = ["None", "Weekly", "Biweekly"];
const DELIVERY_TIME_WINDOWS = ["Early Morning 6-8am", "Morning 8-10am", "Midday 11am-1pm", "Afternoon 2-4pm"];

const EQUIPMENT_TYPES = ["Excavator", "Concrete Pump", "Man Lift", "Scissor Lift", "Telehandler", "Forklift", "Compactor", "Generator", "Water Pump"];

const MILESTONE_TYPES = ["Concrete Pour", "Steel Erection Start", "MEP Rough-In Start", "Inspection Day", "Owner Walkthrough", "Weather Buffer", "Subcontractor Mobilization", "Substantial Completion"];
const MILESTONE_IMPACTS = ["No Heavy Equipment", "Extra Labor Required", "Delivery Blackout", "Critical Path Event"];

const milestoneColor = (type) => {
  if (type === "Concrete Pour") return "#3b82f6";
  if (type === "Inspection Day") return "#eab308";
  if (type === "Critical Path Event") return "#ef4444";
  return "#64748b";
};

const cfgInput = {
  height: 32, background: "#1A1D2B", border: "1px solid rgba(255,255,255,0.06)", color: "#e2e8f0",
  borderRadius: 6, fontSize: 12, fontFamily: "inherit", padding: "0 8px", outline: "none",
};
const cfgLabel = { fontSize: 10, color: "#8B8FA3", textTransform: "uppercase", marginBottom: 2 };
const cfgCard = {
  background: "transparent", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 6, padding: 14,
};

function getValidationIssues(config, cells) {
  const issues = [];
  const colLabel = (x) => String.fromCharCode(65 + (x % 26));
  const posLabel = (x, y) => `${colLabel(x)}${y + 1}`;
  const parseDays = (s) => {
    if (!s) return [];
    return s.split(",").map((d) => parseInt(d.trim(), 10)).filter((d) => !isNaN(d));
  };

  // ── PHASE ERRORS ──
  const phases = config.phases;
  for (let i = 0; i < phases.length; i++) {
    for (let j = i + 1; j < phases.length; j++) {
      const a = phases[i], b = phases[j];
      const oStart = Math.max(a.startDay, b.startDay);
      const oEnd = Math.min(a.endDay, b.endDay);
      if (oStart <= oEnd) {
        issues.push({ severity: "error", section: "phases",
          message: `Phases "${a.name || a.id}" and "${b.name || b.id}" overlap on days ${oStart}-${oEnd}` });
      }
    }
  }
  if (phases.length > 0) {
    const sorted = [...phases].sort((a, b) => a.startDay - b.startDay);
    for (let i = 1; i < sorted.length; i++) {
      const gap0 = sorted[i - 1].endDay + 1;
      const gap1 = sorted[i].startDay - 1;
      if (gap0 <= gap1) {
        issues.push({ severity: "error", section: "phases",
          message: `Days ${gap0}-${gap1} are not assigned to any phase` });
      }
    }
  }

  // ── DELIVERY ERRORS ──
  const blackoutDays = new Set(
    config.milestones.filter((m) => m.impact === "Delivery Blackout").map((m) => m.day)
  );
  const dayEntryCount = {};

  config.deliveries.forEach((del, idx) => {
    const n = idx + 1;
    if (!del.entryPoint) {
      issues.push({ severity: "error", section: "deliveries",
        message: `Delivery #${n} has no entry point — trucks cannot access the site` });
    }

    if (del.destination) {
      const destIdx = Number(del.destination);
      const destCell = cells[destIdx];
      if (destCell) {
        const ox = destIdx % GRID, oy = Math.floor(destIdx / GRID);
        const w = destCell.width || 1, h = destCell.height || 1;
        let hasRoad = false;
        for (let dy = 0; dy < h && !hasRoad; dy++) {
          for (let dx = 0; dx < w && !hasRoad; dx++) {
            for (const [nx, ny] of [[ox+dx-1,oy+dy],[ox+dx+1,oy+dy],[ox+dx,oy+dy-1],[ox+dx,oy+dy+1]]) {
              if (nx < 0 || nx >= GRID || ny < 0 || ny >= GRID) continue;
              if (nx >= ox && nx < ox + w && ny >= oy && ny < oy + h) continue;
              const nc = cells[ny * GRID + nx];
              if (nc && nc.id === "road") { hasRoad = true; break; }
            }
          }
        }
        if (!hasRoad) {
          issues.push({ severity: "error", section: "deliveries",
            message: `Delivery #${n} destination zone has no adjacent road — trucks cannot unload` });
        }
      }
    }

    const days = parseDays(del.days);
    days.forEach((d) => {
      if (del.entryPoint) {
        const k = `${d}::${del.entryPoint}`;
        dayEntryCount[k] = (dayEntryCount[k] || 0) + 1;
      }
      if (blackoutDays.has(d)) {
        issues.push({ severity: "error", section: "deliveries",
          message: `Delivery on Day ${d} conflicts with a delivery blackout milestone` });
      }
    });
  });

  for (const [k, cnt] of Object.entries(dayEntryCount)) {
    if (cnt > 1) {
      const d = k.split("::")[0];
      issues.push({ severity: "warning", section: "deliveries",
        message: `Day ${d} has ${cnt} deliveries through the same entry point — trucks will queue` });
    }
  }

  // ── CRANE ERRORS ──
  config.cranes.forEach((crane) => {
    const pos = posLabel(crane.x, crane.y);
    if (crane.departureDay < crane.arrivalDay) {
      issues.push({ severity: "error", section: "cranes",
        message: `Crane at ${pos} has departure day before arrival day` });
    }
    if (crane.type === "Mobile Crane" && !crane.entryRoad) {
      issues.push({ severity: "error", section: "cranes",
        message: `Mobile crane at ${pos} has no entry road — cannot be mobilized` });
    }
  });

  for (let i = 0; i < config.cranes.length; i++) {
    for (let j = i + 1; j < config.cranes.length; j++) {
      const a = config.cranes[i], b = config.cranes[j];
      const oStart = Math.max(a.arrivalDay, b.arrivalDay);
      const oEnd = Math.min(a.departureDay, b.departureDay);
      if (oStart <= oEnd) {
        const dist = Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
        if (dist <= 3) {
          issues.push({ severity: "warning", section: "cranes",
            message: `Cranes at ${posLabel(a.x, a.y)} and ${posLabel(b.x, b.y)} may have overlapping swing radii during Days ${oStart}-${oEnd} — verify anti-collision system` });
        }
      }
    }
  }

  // ── WORKFORCE WARNINGS ──
  const workerZoneCount = cells.filter((c) => c && c.isOrigin && c.id === "workers").length;
  const maxCap = workerZoneCount * 25;

  config.phases.forEach((phase) => {
    const wf = config.workforce[phase.id];
    if (!wf || wf.total === 0) {
      issues.push({ severity: "warning", section: "workforce",
        message: `Phase "${phase.name || phase.id}" has no workforce configured` });
    } else if (workerZoneCount > 0 && wf.total > maxCap) {
      issues.push({ severity: "warning", section: "workforce",
        message: `Phase "${phase.name || phase.id}" workforce (${wf.total}) exceeds site capacity (${maxCap}) — add worker zones or reduce headcount` });
    }
  });

  // ── EQUIPMENT WARNINGS ──
  const concreteDays = new Set();
  config.deliveries.forEach((del) => {
    if (del.material === "Concrete") parseDays(del.days).forEach((d) => concreteDays.add(d));
  });
  config.equipment.forEach((eq) => {
    if (eq.type === "Concrete Pump") {
      let hasOverlap = false;
      for (let d = eq.arrivalDay; d <= eq.departureDay; d++) {
        if (concreteDays.has(d)) { hasOverlap = true; break; }
      }
      if (!hasOverlap) {
        issues.push({ severity: "warning", section: "equipment",
          message: `Concrete pump (Day ${eq.arrivalDay}–${eq.departureDay}) has no concrete deliveries scheduled during its active window — equipment may be idle` });
      }
    }
  });

  return issues;
}

function ConfigurePanel({ cells, projectDuration, onConfigSave, onValidationChange, config, onConfigChange }) {
  const [section, setSection] = useState("Phases");
  const [saved, setSaved] = useState(false);

  const craneZones = (cells || []).reduce((acc, cell, idx) => {
    if (cell && cell.isOrigin && cell.id === 'crane') acc.push({ cell, index: idx, idx, x: idx % GRID, y: Math.floor(idx / GRID) });
    return acc;
  }, []);

  const roadZones = cells
    .map((c, i) => ({ cell: c, index: i }))
    .filter(({ cell }) => cell && cell.isOrigin && cell.id === 'road')
    .map(({ index }) => ({ idx: index, x: index % GRID, y: Math.floor(index / GRID) }));

  const edgeRoads = roadZones.filter(
    (r) => r.x === 0 || r.x === GRID - 1 || r.y === 0 || r.y === GRID - 1
  );

  const materialZones = cells
    .map((c, i) => ({ cell: c, index: i }))
    .filter(({ cell }) => cell && cell.isOrigin && cell.id === 'materials')
    .map(({ index }) => ({ idx: index, x: index % GRID, y: Math.floor(index / GRID) }));

  const nonRoadZones = cells
    .map((c, i) => ({ cell: c, index: i }))
    .filter(({ cell }) => cell && cell.isOrigin && cell.id !== 'road')
    .map(({ cell, index }) => ({ idx: index, x: index % GRID, y: Math.floor(index / GRID), type: cell.id }));

  const colLabel = (x) => String.fromCharCode(65 + (x % 26));
  const posLabel = (x, y) => `${colLabel(x)}${y + 1}`;

  const updatePhase = (idx, field, value) => {
    onConfigChange((prev) => {
      const phases = [...prev.phases];
      phases[idx] = { ...phases[idx], [field]: value };
      return { ...prev, phases };
    });
  };

  const addPhase = () => {
    onConfigChange((prev) => ({
      ...prev,
      phases: [...prev.phases, { id: `phase-${Date.now()}`, name: "", startDay: 1, endDay: 10, color: "#64748b" }],
    }));
  };

  const removePhase = (idx) => {
    onConfigChange((prev) => ({ ...prev, phases: prev.phases.filter((_, i) => i !== idx) }));
  };

  const updateDelivery = (idx, field, value) => {
    onConfigChange((prev) => {
      const deliveries = [...prev.deliveries];
      deliveries[idx] = { ...deliveries[idx], [field]: value };
      return { ...prev, deliveries };
    });
  };

  const addDelivery = () => {
    onConfigChange((prev) => ({
      ...prev,
      deliveries: [
        ...prev.deliveries,
        { id: `del-${Date.now()}`, material: "Concrete", destination: "", days: "", recurring: "None", truckCount: 1, entryPoint: "", timeWindow: "Morning 8-10am", notes: "" },
      ],
    }));
  };

  const removeDelivery = (idx) => {
    onConfigChange((prev) => ({ ...prev, deliveries: prev.deliveries.filter((_, i) => i !== idx) }));
  };

  const updateWorkforce = (phaseId, field, value) => {
    onConfigChange((prev) => ({
      ...prev,
      workforce: { ...prev.workforce, [phaseId]: { ...prev.workforce[phaseId], [field]: Number(value) || 0 } },
    }));
  };

  const updateEquipment = (idx, field, value) => {
    onConfigChange((prev) => {
      const equipment = [...prev.equipment];
      equipment[idx] = { ...equipment[idx], [field]: value };
      return { ...prev, equipment };
    });
  };

  const addEquipment = () => {
    onConfigChange((prev) => ({
      ...prev,
      equipment: [
        ...prev.equipment,
        { id: `eq-${Date.now()}`, type: "Excavator", zone: "", arrivalDay: 1, departureDay: 30, phase: "foundation", notes: "" },
      ],
    }));
  };

  const removeEquipment = (idx) => {
    onConfigChange((prev) => ({ ...prev, equipment: prev.equipment.filter((_, i) => i !== idx) }));
  };

  const updateMilestone = (idx, field, value) => {
    onConfigChange((prev) => {
      const milestones = [...prev.milestones];
      milestones[idx] = { ...milestones[idx], [field]: value };
      return { ...prev, milestones };
    });
  };

  const addMilestone = () => {
    onConfigChange((prev) => ({
      ...prev,
      milestones: [
        ...prev.milestones,
        { id: `ms-${Date.now()}`, name: "", day: 1, type: "Concrete Pour", impact: "No Heavy Equipment", notes: "" },
      ],
    }));
  };

  const removeMilestone = (idx) => {
    onConfigChange((prev) => ({ ...prev, milestones: prev.milestones.filter((_, i) => i !== idx) }));
  };

  const updateCrane = (idx, field, value) => {
    onConfigChange((prev) => {
      const cranes = [...prev.cranes];
      cranes[idx] = { ...cranes[idx], [field]: value };
      return { ...prev, cranes };
    });
  };

  useEffect(() => {
    if (craneZones.length > 0 && config.cranes.length === 0) {
      onConfigChange((prev) => ({
        ...prev,
        cranes: craneZones.map((cz) => ({
          id: `crane-${cz.x}-${cz.y}`, x: cz.x, y: cz.y, type: "Tower Crane",
          arrivalDay: 1, departureDay: projectDuration, entryRoad: "", notes: "",
        })),
      }));
    }
  }, [craneZones.length]);

  const handleSave = () => {
    onConfigSave(config);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const sectionCounts = {
    Phases: config.phases.length,
    Cranes: config.cranes.length,
    Deliveries: config.deliveries.length,
    Workforce: Object.keys(config.workforce).length,
    Equipment: config.equipment.length,
    Milestones: config.milestones.length,
  };

  const workforceTradesFor = (phaseId) => {
    const base = ["laborers", "operators"];
    if (phaseId === "site-prep" || phaseId === "closeout") return base;
    if (phaseId === "foundation" || phaseId === "structural") return ["laborers", "carpenters", "ironworkers", "operators", "other"];
    if (phaseId === "mep") return ["laborers", "electricians", "plumbers", "hvac", "operators", "other"];
    if (phaseId === "finishing") return ["laborers", "carpenters", "painters", "glaziers", "operators", "other"];
    return ["laborers", "operators", "other"];
  };

  const tradeColors = {
    laborers: "#64748b", carpenters: "#f59e0b", ironworkers: "#8b5cf6", operators: "#3b82f6",
    electricians: "#eab308", plumbers: "#06b6d4", hvac: "#ef4444", painters: "#22c55e",
    glaziers: "#ec4899", other: "#475569",
  };

  const validationIssues = useMemo(() => getValidationIssues(config, cells), [config, cells]);
  const errorCount = validationIssues.filter((i) => i.severity === "error").length;
  const warningCount = validationIssues.filter((i) => i.severity === "warning").length;

  useEffect(() => {
    if (onValidationChange) onValidationChange(errorCount);
  }, [errorCount, onValidationChange]);

  return (
    <div style={{ display: "flex", height: "100%", background: "#12141E", overflow: "hidden" }}>
      {/* Sidebar */}
      <div style={{ width: 200, background: "#0F1117", borderRight: "1px solid rgba(255,255,255,0.06)", display: "flex", flexDirection: "column", flexShrink: 0 }}>
        <div style={{ padding: "16px 12px 8px", fontSize: 10, color: "#4A4E63", textTransform: "uppercase", letterSpacing: "0.06em" }}>
          Configuration
        </div>
        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 1, padding: "0 8px" }}>
          {CONFIGURE_SECTIONS.map((s) => (
            <button
              key={s}
              onClick={() => setSection(s)}
              style={{
                background: section === s ? "rgba(99,102,241,0.1)" : "transparent",
                borderLeft: section === s ? "2px solid #6366F1" : "2px solid transparent",
                borderTop: "none",
                borderRight: "none",
                borderBottom: "none",
                borderLeft: section === s ? "2px solid #6366F1" : "2px solid transparent",
                color: section === s ? "#e2e8f0" : "#8B8FA3",
                fontSize: 12, fontWeight: 500, padding: "8px 10px", borderRadius: 4,
                cursor: "pointer", textAlign: "left", fontFamily: "inherit",
                display: "flex", justifyContent: "space-between", alignItems: "center",
                transition: "all 0.15s",
              }}
            >
              {s}
              {sectionCounts[s] > 0 && (
                <span style={{ fontSize: 10, color: "#4A4E63", background: "rgba(255,255,255,0.04)", borderRadius: 8, padding: "1px 6px" }}>
                  {sectionCounts[s]}
                </span>
              )}
            </button>
          ))}
        </div>
        <div style={{ padding: 12, borderTop: "1px solid rgba(255,255,255,0.06)" }}>
          <button
            onClick={handleSave}
            style={{
              width: "100%", height: 36, borderRadius: 8, border: "none",
              background: saved ? "#22c55e" : "#6366F1",
              color: "#fff", fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "inherit",
              display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
              transition: "background 0.2s",
            }}
          >
            {saved ? "Saved" : "Save Configuration"}
          </button>
        </div>
      </div>

      {/* Main content */}
      <div style={{ flex: 1, overflowY: "auto", padding: 20 }}>
        {section === "Phases" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: "#e2e8f0", marginBottom: 4 }}>Construction Phases</div>
            {config.phases.map((phase, idx) => (
              <PhaseCard key={phase.id} phase={phase} idx={idx}
                onUpdate={updatePhase} onRemove={removePhase} />
            ))}
            <button onClick={addPhase} style={{
              height: 36, borderRadius: 6, border: "1px dashed rgba(255,255,255,0.08)", background: "transparent",
              color: "#8B8FA3", fontSize: 12, cursor: "pointer", fontFamily: "inherit",
            }}>
              + Add Phase
            </button>
          </div>
        )}

        {section === "Cranes" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: "#e2e8f0", marginBottom: 4 }}>Crane Configuration</div>
            {craneZones.length === 0 ? (
              <div style={{ ...cfgCard, color: "#64748b", fontSize: 13, textAlign: "center", padding: 32 }}>
                Place crane zones on the site plan first
              </div>
            ) : (
              config.cranes.map((crane, idx) => (
                <div key={crane.id} style={{ ...cfgCard, borderLeft: "2px solid #eab308" }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: "#e2e8f0", marginBottom: 10 }}>
                    Crane at {posLabel(crane.x, crane.y)}
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                    <div>
                      <div style={cfgLabel}>Type</div>
                      <select value={crane.type} onChange={(e) => updateCrane(idx, "type", e.target.value)}
                        style={{ ...cfgInput, width: "100%" }}>
                        <option>Tower Crane</option>
                        <option>Mobile Crane</option>
                        <option>Boom Truck</option>
                      </select>
                    </div>
                    <div>
                      <div style={cfgLabel}>Entry Road</div>
                      <select value={crane.entryRoad} onChange={(e) => updateCrane(idx, "entryRoad", e.target.value)}
                        style={{ ...cfgInput, width: "100%" }}>
                        <option value="">Select...</option>
                        {roadZones.map((rz) => (
                          <option key={rz.idx} value={rz.idx}>Road at {posLabel(rz.x, rz.y)}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <div style={cfgLabel}>Arrival Day</div>
                      <input type="number" min={1} max={projectDuration} value={crane.arrivalDay}
                        onChange={(e) => updateCrane(idx, "arrivalDay", Number(e.target.value))}
                        style={{ ...cfgInput, width: "100%" }} />
                    </div>
                    <div>
                      <div style={cfgLabel}>Departure Day</div>
                      <input type="number" min={1} max={projectDuration} value={crane.departureDay}
                        onChange={(e) => updateCrane(idx, "departureDay", Number(e.target.value))}
                        style={{ ...cfgInput, width: "100%" }} />
                    </div>
                  </div>
                  <div style={{ marginTop: 10 }}>
                    <div style={cfgLabel}>Notes</div>
                    <textarea value={crane.notes} onChange={(e) => updateCrane(idx, "notes", e.target.value)}
                      rows={2} style={{ ...cfgInput, width: "100%", height: "auto", padding: 8, resize: "vertical" }} />
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {section === "Deliveries" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: "#e2e8f0", marginBottom: 4 }}>Delivery Schedule</div>
            {config.deliveries.map((del, idx) => (
              <div key={del.id} style={{ ...cfgCard, borderLeft: "2px solid #f97316", position: "relative" }}>
                <button onClick={() => removeDelivery(idx)} style={{
                  position: "absolute", top: 8, right: 8, background: "none", border: "none",
                  color: "#475569", cursor: "pointer", fontSize: 14, fontFamily: "inherit",
                }}>✕</button>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
                  <div>
                    <div style={cfgLabel}>Material Type</div>
                    <select value={del.material} onChange={(e) => updateDelivery(idx, "material", e.target.value)}
                      style={{ ...cfgInput, width: "100%" }}>
                      {MATERIAL_TYPES.map((m) => <option key={m}>{m}</option>)}
                    </select>
                  </div>
                  <div>
                    <div style={cfgLabel}>Destination Zone</div>
                    <select value={del.destination} onChange={(e) => updateDelivery(idx, "destination", e.target.value)}
                      style={{ ...cfgInput, width: "100%" }}>
                      <option value="">Select...</option>
                      {materialZones.map((mz) => (
                        <option key={mz.idx} value={mz.idx}>Materials at {posLabel(mz.x, mz.y)}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <div style={cfgLabel}>Scheduled Days</div>
                    <input value={del.days} onChange={(e) => updateDelivery(idx, "days", e.target.value)}
                      placeholder="8, 15, 22, 29" style={{ ...cfgInput, width: "100%" }} />
                  </div>
                  <div>
                    <div style={cfgLabel}>Recurring</div>
                    <select value={del.recurring} onChange={(e) => updateDelivery(idx, "recurring", e.target.value)}
                      style={{ ...cfgInput, width: "100%" }}>
                      {DELIVERY_RECURRING.map((r) => <option key={r}>{r}</option>)}
                    </select>
                  </div>
                  <div>
                    <div style={cfgLabel}>Truck Count</div>
                    <input type="number" min={1} max={5} value={del.truckCount}
                      onChange={(e) => updateDelivery(idx, "truckCount", Number(e.target.value))}
                      style={{ ...cfgInput, width: "100%" }} />
                  </div>
                  <div>
                    <div style={cfgLabel}>Entry Point</div>
                    <select value={del.entryPoint} onChange={(e) => updateDelivery(idx, "entryPoint", e.target.value)}
                      style={{ ...cfgInput, width: "100%" }}>
                      <option value="">Select...</option>
                      {edgeRoads.map((er) => (
                        <option key={er.idx} value={er.idx}>Road at {posLabel(er.x, er.y)}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <div style={cfgLabel}>Time Window</div>
                    <select value={del.timeWindow} onChange={(e) => updateDelivery(idx, "timeWindow", e.target.value)}
                      style={{ ...cfgInput, width: "100%" }}>
                      {DELIVERY_TIME_WINDOWS.map((tw) => <option key={tw}>{tw}</option>)}
                    </select>
                  </div>
                  <div style={{ gridColumn: "span 2" }}>
                    <div style={cfgLabel}>Notes</div>
                    <input value={del.notes} onChange={(e) => updateDelivery(idx, "notes", e.target.value)}
                      style={{ ...cfgInput, width: "100%" }} />
                  </div>
                </div>
              </div>
            ))}
            <button onClick={addDelivery} style={{
              height: 36, borderRadius: 6, border: "1px dashed rgba(255,255,255,0.08)", background: "transparent",
              color: "#8B8FA3", fontSize: 12, cursor: "pointer", fontFamily: "inherit",
            }}>
              + Add Delivery
            </button>
          </div>
        )}

        {section === "Workforce" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: "#e2e8f0", marginBottom: 4 }}>Workforce Planning</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 12 }}>
              {config.phases.map((phase) => {
                const wf = config.workforce[phase.id] || { total: 0 };
                const trades = workforceTradesFor(phase.id);
                const total = wf.total || 1;
                return (
                  <div key={phase.id} style={{ ...cfgCard, borderTop: `2px solid ${phase.color}` }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: "#e2e8f0", marginBottom: 10 }}>
                      {phase.name || phase.id}
                    </div>
                    <div style={{ marginBottom: 8 }}>
                      <div style={cfgLabel}>Total Workers</div>
                      <input type="number" min={0} value={wf.total || 0}
                        onChange={(e) => updateWorkforce(phase.id, "total", e.target.value)}
                        style={{ ...cfgInput, width: 80 }} />
                    </div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                      {trades.map((trade) => (
                        <div key={trade} style={{ minWidth: 70 }}>
                          <div style={cfgLabel}>{trade}</div>
                          <input type="number" min={0} value={wf[trade] || 0}
                            onChange={(e) => updateWorkforce(phase.id, trade, e.target.value)}
                            style={{ ...cfgInput, width: 60 }} />
                        </div>
                      ))}
                    </div>
                    <div style={{ marginTop: 10, height: 6, borderRadius: 3, overflow: "hidden", display: "flex", background: "rgba(255,255,255,0.04)" }}>
                      {trades.map((trade) => {
                        const val = wf[trade] || 0;
                        if (val === 0) return null;
                        return (
                          <div key={trade} style={{
                            width: `${(val / total) * 100}%`, background: tradeColors[trade] || "#475569",
                            minWidth: 2, transition: "width 0.2s",
                          }} title={`${trade}: ${val}`} />
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {section === "Equipment" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: "#e2e8f0", marginBottom: 4 }}>Equipment Management</div>
            {config.equipment.map((eq, idx) => (
              <div key={eq.id} style={{ ...cfgCard, borderLeft: "2px solid #06b6d4", position: "relative" }}>
                <button onClick={() => removeEquipment(idx)} style={{
                  position: "absolute", top: 8, right: 8, background: "none", border: "none",
                  color: "#475569", cursor: "pointer", fontSize: 14, fontFamily: "inherit",
                }}>✕</button>
                {(eq.type === "Excavator" || eq.type === "Concrete Pump") && (
                  <div style={{
                    fontSize: 11, color: "#f59e0b", background: "rgba(245,158,11,0.06)", border: "1px solid rgba(245,158,11,0.1)",
                    borderRadius: 4, padding: "4px 10px", marginBottom: 10, display: "inline-block",
                  }}>
                    High coordination required — schedule deliveries around this equipment
                  </div>
                )}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
                  <div>
                    <div style={cfgLabel}>Equipment Type</div>
                    <select value={eq.type} onChange={(e) => updateEquipment(idx, "type", e.target.value)}
                      style={{ ...cfgInput, width: "100%" }}>
                      {EQUIPMENT_TYPES.map((t) => <option key={t}>{t}</option>)}
                    </select>
                  </div>
                  <div>
                    <div style={cfgLabel}>GRID POSITION</div>
                    <input value={eq.zone} onChange={(e) => updateEquipment(idx, "zone", e.target.value.toUpperCase())}
                      placeholder="e.g. J12"
                      style={{ ...cfgInput, width: "100%" }} />
                  </div>
                  <div>
                    <div style={cfgLabel}>Active Phase</div>
                    <select value={eq.phase} onChange={(e) => updateEquipment(idx, "phase", e.target.value)}
                      style={{ ...cfgInput, width: "100%" }}>
                      {config.phases.map((p) => <option key={p.id} value={p.id}>{p.name || p.id}</option>)}
                    </select>
                  </div>
                  <div>
                    <div style={cfgLabel}>Arrival Day</div>
                    <input type="number" min={1} max={projectDuration} value={eq.arrivalDay}
                      onChange={(e) => updateEquipment(idx, "arrivalDay", Number(e.target.value))}
                      style={{ ...cfgInput, width: "100%" }} />
                  </div>
                  <div>
                    <div style={cfgLabel}>Departure Day</div>
                    <input type="number" min={1} max={projectDuration} value={eq.departureDay}
                      onChange={(e) => updateEquipment(idx, "departureDay", Number(e.target.value))}
                      style={{ ...cfgInput, width: "100%" }} />
                  </div>
                  <div>
                    <div style={cfgLabel}>Notes</div>
                    <input value={eq.notes} onChange={(e) => updateEquipment(idx, "notes", e.target.value)}
                      style={{ ...cfgInput, width: "100%" }} />
                  </div>
                </div>
              </div>
            ))}
            <button onClick={addEquipment} style={{
              height: 36, borderRadius: 6, border: "1px dashed rgba(255,255,255,0.08)", background: "transparent",
              color: "#8B8FA3", fontSize: 12, cursor: "pointer", fontFamily: "inherit",
            }}>
              + Add Equipment
            </button>
          </div>
        )}

        {section === "Milestones" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: "#e2e8f0", marginBottom: 4 }}>Project Milestones</div>
            {config.milestones.map((ms, idx) => (
                <div key={ms.id} style={{ ...cfgCard, borderLeft: `2px solid ${milestoneColor(ms.type)}`, position: "relative" }}>
                  <button onClick={() => removeMilestone(idx)} style={{
                    position: "absolute", top: 8, right: 8, background: "none", border: "none",
                    color: "#475569", cursor: "pointer", fontSize: 14, fontFamily: "inherit",
                  }}>✕</button>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
                    <div>
                      <div style={cfgLabel}>Name</div>
                      <input value={ms.name} onChange={(e) => updateMilestone(idx, "name", e.target.value)}
                        placeholder="Milestone name" style={{ ...cfgInput, width: "100%" }} />
                    </div>
                    <div>
                      <div style={cfgLabel}>Day</div>
                      <input type="number" min={1} max={projectDuration} value={ms.day}
                        onChange={(e) => updateMilestone(idx, "day", Number(e.target.value))}
                        style={{ ...cfgInput, width: "100%" }} />
                    </div>
                    <div>
                      <div style={cfgLabel}>Type</div>
                      <select value={ms.type} onChange={(e) => updateMilestone(idx, "type", e.target.value)}
                        style={{ ...cfgInput, width: "100%" }}>
                        {MILESTONE_TYPES.map((t) => <option key={t}>{t}</option>)}
                      </select>
                    </div>
                    <div>
                      <div style={cfgLabel}>Impact</div>
                      <select value={ms.impact} onChange={(e) => updateMilestone(idx, "impact", e.target.value)}
                        style={{ ...cfgInput, width: "100%" }}>
                        {MILESTONE_IMPACTS.map((imp) => <option key={imp}>{imp}</option>)}
                      </select>
                    </div>
                    <div style={{ gridColumn: "span 2" }}>
                      <div style={cfgLabel}>Notes</div>
                      <textarea value={ms.notes} onChange={(e) => updateMilestone(idx, "notes", e.target.value)}
                        rows={2} style={{ ...cfgInput, width: "100%", height: "auto", padding: 8, resize: "vertical" }} />
                    </div>
                  </div>
                </div>
            ))}
            <button onClick={addMilestone} style={{
              height: 36, borderRadius: 6, border: "1px dashed rgba(255,255,255,0.08)", background: "transparent",
              color: "#8B8FA3", fontSize: 12, cursor: "pointer", fontFamily: "inherit",
            }}>
              + Add Milestone
            </button>
          </div>
        )}

        {/* ── Validation Panel ── */}
        <div style={{ marginTop: 24, borderTop: "1px solid rgba(255,255,255,0.06)", paddingTop: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
            <span style={{ fontSize: 10, fontWeight: 600, color: "#4A4E63", letterSpacing: "0.06em" }}>PLAN VALIDATION</span>
            {errorCount > 0 && (
              <span style={{
                fontSize: 10, fontWeight: 600, color: "#ef4444", background: "rgba(239,68,68,0.1)",
                borderRadius: 8, padding: "1px 7px", lineHeight: "16px",
                border: "1px solid rgba(239,68,68,0.15)",
              }}>{errorCount} {errorCount === 1 ? "error" : "errors"}</span>
            )}
            {warningCount > 0 && (
              <span style={{
                fontSize: 10, fontWeight: 600, color: "#eab308", background: "rgba(234,179,8,0.1)",
                borderRadius: 8, padding: "1px 7px", lineHeight: "16px",
                border: "1px solid rgba(234,179,8,0.15)",
              }}>{warningCount} {warningCount === 1 ? "warning" : "warnings"}</span>
            )}
          </div>
          {validationIssues.length === 0 ? (
            <div style={{
              ...cfgCard, display: "flex", alignItems: "center", gap: 8,
              color: "#6B8F71", fontSize: 12,
            }}>
              <span style={{ fontSize: 14 }}>✓</span> Plan looks good
            </div>
          ) : (
            <div style={{ maxHeight: 220, overflowY: "auto", display: "flex", flexDirection: "column", gap: 4 }}>
              {validationIssues.map((issue, i) => (
                <div key={i} style={{
                  ...cfgCard, display: "flex", alignItems: "flex-start", gap: 8,
                  padding: "8px 12px", fontSize: 12, color: "#b0b4c3",
                }}>
                  <span style={{
                    width: 6, height: 6, borderRadius: "50%", flexShrink: 0, marginTop: 5,
                    background: issue.severity === "error" ? "#ef4444" : issue.severity === "warning" ? "#eab308" : "#6366F1",
                    opacity: 0.7,
                  }} />
                  <span style={{ flex: 1 }}>{issue.message}</span>
                  <span style={{
                    fontSize: 9, color: "#4A4E63", background: "rgba(255,255,255,0.04)", borderRadius: 4,
                    padding: "1px 6px", flexShrink: 0, textTransform: "uppercase", letterSpacing: "0.04em",
                  }}>{issue.section}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function PhaseCard({ phase, idx, onUpdate, onRemove }) {
  const [pickerOpen, setPickerOpen] = useState(false);
  return (
    <div style={{ ...cfgCard, borderLeft: `2px solid ${phase.color}`, display: "flex", alignItems: "center", gap: 12, position: "relative" }}>
      <div style={{ position: "relative" }}>
        <div
          onClick={() => setPickerOpen(!pickerOpen)}
          style={{ width: 24, height: 24, borderRadius: 6, background: phase.color, cursor: "pointer", border: "2px solid rgba(255,255,255,0.06)" }}
        />
        {pickerOpen && (
          <div style={{
            position: "absolute", top: 30, left: 0, zIndex: 10, background: "#1A1D2B",
            border: "1px solid rgba(255,255,255,0.06)", borderRadius: 6, padding: 8,
            display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 4,
          }}>
            {PRESET_COLORS.map((c) => (
              <div key={c} onClick={() => { onUpdate(idx, "color", c); setPickerOpen(false); }}
                style={{ width: 22, height: 22, borderRadius: 4, background: c, cursor: "pointer",
                  border: phase.color === c ? "2px solid #e2e8f0" : "2px solid transparent" }} />
            ))}
          </div>
        )}
      </div>
      <input value={phase.name} onChange={(e) => onUpdate(idx, "name", e.target.value)}
        placeholder="Phase name" style={{ ...cfgInput, flex: 1 }} />
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <div style={cfgLabel}>Start</div>
        <input type="number" min={1} value={phase.startDay}
          onChange={(e) => onUpdate(idx, "startDay", Number(e.target.value))}
          style={{ ...cfgInput, width: 60, textAlign: "center" }} />
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <div style={cfgLabel}>End</div>
        <input type="number" min={1} value={phase.endDay}
          onChange={(e) => onUpdate(idx, "endDay", Number(e.target.value))}
          style={{ ...cfgInput, width: 60, textAlign: "center" }} />
      </div>
      <button onClick={() => onRemove(idx)} style={{
        background: "none", border: "none", color: "#475569", cursor: "pointer",
        fontSize: 14, fontFamily: "inherit", padding: 4,
      }}>✕</button>
    </div>
  );
}

/* ───────────────────── styles ───────────────────── */

const S = {
  root: {
    height: "100vh",
    display: "flex",
    flexDirection: "column",
    background: "#0F1117",
    color: "#e2e8f0",
    overflow: "hidden",
  },

  nav: {
    height: 52,
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "0 24px",
    background: "#0F1117",
    borderBottom: "1px solid rgba(255,255,255,0.06)",
    flexShrink: 0,
  },
  navLeft: { display: "flex", alignItems: "center", gap: 10 },
  logoBox: {
    width: 28,
    height: 28,
    borderRadius: 6,
    background: "#6366F1",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: 14,
    fontWeight: 800,
    color: "#fff",
  },
  logoText: {
    fontSize: 16,
    fontWeight: 600,
    color: "#ffffff",
    letterSpacing: "-0.02em",
  },
  badge: {
    fontSize: 11,
    fontWeight: 500,
    color: "#8B8FA3",
    letterSpacing: "0",
  },
  navCenter: { display: "flex", alignItems: "center", gap: 2 },
  navRight: { display: "flex", alignItems: "center", gap: 12 },
  liveGroup: { display: "none" },
  liveDot: { display: "none" },
  navDivider: { width: 1, height: 20, background: "rgba(255,255,255,0.06)" },
  logoutBtn: {
    fontSize: 12,
    fontWeight: 500,
    color: "#8B8FA3",
    background: "transparent",
    border: "none",
    borderRadius: 6,
    padding: "5px 12px",
    cursor: "pointer",
    fontFamily: "inherit",
    transition: "all 0.15s",
  },

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
    borderLeft: "1px solid rgba(255,255,255,0.06)",
    background: "#0F1117",
  },

  toolbar: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    padding: "10px 20px",
    borderBottom: "1px solid rgba(255,255,255,0.06)",
    background: "#0F1117",
    flexShrink: 0,
  },
  sectionLabel: {
    fontSize: 10,
    fontWeight: 600,
    color: "#4A4E63",
    letterSpacing: "0.1em",
    marginRight: 4,
  },
  toolBtn: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    padding: "5px 10px",
    borderRadius: 5,
    border: "1px solid transparent",
    fontSize: 12,
    fontWeight: 500,
    cursor: "pointer",
    transition: "all 0.15s ease",
    fontFamily: "inherit",
    background: "transparent",
  },
  zoneCounter: { display: "flex", alignItems: "center" },

  gridArea: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    padding: 8,
    background: "#12141E",
    gap: 6,
  },
  gridHeader: {
    width: GRID * 34 + 24,
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 2,
    paddingLeft: 24,
  },
  colLabelRow: {
    display: "grid",
    gridTemplateColumns: `repeat(${GRID}, 34px)`,
    marginBottom: 2,
  },
  colLabel: {
    textAlign: "center",
    fontSize: 10,
    color: "#4A4E63",
    fontFamily: "monospace",
    fontWeight: 500,
  },
  rowLabelCol: {
    display: "flex",
    flexDirection: "column",
    marginRight: 4,
  },
  rowLabel: {
    height: 34,
    display: "flex",
    alignItems: "center",
    justifyContent: "flex-end",
    width: 18,
    fontSize: 10,
    color: "#4A4E63",
    fontFamily: "monospace",
    fontWeight: 500,
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

  timeline: {
    height: 56,
    display: "flex",
    alignItems: "center",
    gap: 14,
    padding: "0 24px",
    background: "#0F1117",
    borderTop: "1px solid rgba(255,255,255,0.06)",
    flexShrink: 0,
  },
  playBtn: {
    width: 34,
    height: 34,
    borderRadius: "50%",
    border: "1px solid rgba(255,255,255,0.06)",
    color: "#e2e8f0",
    fontSize: 13,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    cursor: "pointer",
    transition: "all 0.2s ease",
    flexShrink: 0,
    background: "transparent",
  },
  dayInfo: {
    display: "flex",
    flexDirection: "column",
    gap: 1,
    minWidth: 56,
    flexShrink: 0,
  },
  durationPicker: {
    display: "flex",
    alignItems: "center",
    background: "transparent",
    borderRadius: 5,
    border: "none",
    padding: 0,
    gap: 1,
    flexShrink: 0,
    marginRight: 16,
  },
  durationBtn: {
    fontSize: 11,
    fontWeight: 500,
    color: "#4A4E63",
    background: "transparent",
    border: "none",
    borderRadius: 4,
    padding: "3px 7px",
    cursor: "pointer",
    fontFamily: "inherit",
    transition: "all 0.15s ease",
    lineHeight: 1,
  },
  durationBtnActive: {
    color: "#e2e8f0",
    background: "rgba(99,102,241,0.15)",
  },
  progressWrapper: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    gap: 4,
    position: "relative",
    minWidth: 0,
    marginLeft: 8,
  },
  phaseLabels: {
    position: "relative",
    height: 14,
  },
  progressTrack: {
    width: "100%",
    height: 2,
    background: "rgba(255,255,255,0.06)",
    borderRadius: 1,
    overflow: "hidden",
    position: "relative",
  },
  progressFill: {
    height: "100%",
    borderRadius: 1,
    background: "#6366F1",
    transition: "width 0.12s linear",
  },
  pctDisplay: {
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-end",
    flexShrink: 0,
    minWidth: 48,
  },

  chatHeader: {
    padding: "16px 20px",
    borderBottom: "1px solid rgba(255,255,255,0.06)",
    display: "flex",
    alignItems: "center",
    gap: 12,
    flexShrink: 0,
    background: "#0F1117",
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 8,
    background: "#6366F1",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: 12,
    fontWeight: 700,
    color: "#fff",
    letterSpacing: "0.02em",
  },
  onlineBadge: {
    display: "none",
  },
  quickActions: {
    display: "flex",
    gap: 6,
    padding: "10px 20px",
    borderBottom: "1px solid rgba(255,255,255,0.06)",
    flexShrink: 0,
  },
  quickBtn: {
    fontSize: 11,
    fontWeight: 500,
    color: "#8B8FA3",
    background: "transparent",
    border: "1px solid rgba(255,255,255,0.06)",
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
    borderTop: "1px solid rgba(255,255,255,0.06)",
    display: "flex",
    gap: 8,
    flexShrink: 0,
    background: "#0F1117",
  },
  input: {
    flex: 1,
    height: 40,
    padding: "0 14px",
    borderRadius: 8,
    background: "transparent",
    border: "1px solid rgba(255,255,255,0.06)",
    color: "#e2e8f0",
    fontSize: 13,
    outline: "none",
    fontFamily: "inherit",
    transition: "border-color 0.15s, box-shadow 0.15s",
  },
  sendBtn: {
    width: 40,
    height: 40,
    borderRadius: 8,
    background: "transparent",
    border: "1px solid rgba(255,255,255,0.06)",
    color: "#8B8FA3",
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    transition: "all 0.15s",
    flexShrink: 0,
  },
};
