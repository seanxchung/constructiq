"use client";

import { useState, useRef, useEffect, useMemo } from "react";
import ReactMarkdown from "react-markdown";
import { supabase } from "./auth";

/* ───────────────────── constants ───────────────────── */

const ZONES = [
  { id: "crane", label: "Crane", emoji: "🏗️", color: "#eab308", bg: "#eab30815" },
  { id: "workers", label: "Workers", emoji: "👷", color: "#3b82f6", bg: "#3b82f615" },
  { id: "materials", label: "Materials", emoji: "📦", color: "#f97316", bg: "#f9731615" },
  { id: "road", label: "Access Road", emoji: "🛣️", color: "#64748b", bg: "#64748b15" },
  { id: "building", label: "Building", emoji: "🏢", color: "#22c55e", bg: "#22c55e15" },
  { id: "office", label: "Site Office", emoji: "🏠", color: "#8b5cf6", bg: "#8b5cf615" },
  { id: "parking", label: "Parking", emoji: "🚗", color: "#64748b", bg: "#64748b15" },
  { id: "fence", label: "Fence/Boundary", emoji: "🚧", color: "#f59e0b", bg: "#f59e0b15" },
  { id: "manlift", label: "Man Lift", emoji: "🔧", color: "#06b6d4", bg: "#06b6d415" },
  { id: "delivery", label: "Delivery Zone", emoji: "🚛", color: "#84cc16", bg: "#84cc1615" },
  { id: "boundary", label: "Site Boundary", emoji: "🚫", color: "#ef4444", bg: "#ef444415" },
  { id: "truck_staging", label: "Truck Staging", emoji: "🅿️", color: "#84cc16", bg: "#84cc1615" },
  { id: "eraser", label: "Eraser", emoji: "🗑️", color: "#ef4444", bg: "#ef444415" },
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
  { role: "ai", text: "Good morning. I'm Sean Chung, your AI construction advisor. I've analyzed the site geotechnical report and I'm ready to help you optimize this build from day one." },
  { role: "ai", text: "Recommendation: Start by laying Access Roads along the perimeter for logistics flow, then position Cranes for maximum lift coverage. I'll flag conflicts in real-time." },
];

const API_BASE = "http://localhost:8000";

const BUILDING_STAGES = [
  { maxPct: 15, bg: "#1e293b", border: "#334155", dashed: true, label: "Excavation" },
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
  const [savedConfig, setSavedConfig] = useState({
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
      body: JSON.stringify({ day, zones: buildZones(), project_duration: projectDuration, project_config: projectConfig }),
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

        if (data?.ai_analysis) {
          const currentTypes = new Set(conflicts.map((c) => c.type).filter(Boolean));
          const prevTypes = prevConflictTypesRef.current;
          const hasNewType = [...currentTypes].some((t) => !prevTypes.has(t));
          const hasHighConflict = conflicts.some((c) => c.severity === "HIGH");
          const materialLow = Object.values(data.simulation?.materials || {}).some((m) => m.pct_remaining < 20);
          const hasBreakdown = conflicts.some((c) => c.type === "equipment_risk");

          if (hasNewType || hasHighConflict || materialLow || hasBreakdown) {
            setMessages((m) => [...m, { role: "ai", text: `**Day ${day}:** ${data.ai_analysis}` }]);
          }
          prevConflictTypesRef.current = currentTypes;
        }

        if (data.simulation?.phase && data.simulation.phase !== prevPhaseRef.current && prevPhaseRef.current !== "") {
          setMessages((m) => [...m, {
            role: "ai",
            text: `**Day ${day} — Phase Transition:** Moving into ${data.simulation.phase} phase. Crew composition and equipment requirements are shifting.`,
          }]);
        }
        prevPhaseRef.current = data.simulation?.phase || "";
      })
      .catch(() => {})
      .finally(() => { simulatingRef.current = false; });
  }, [day, isPlaying, projectDuration]);

  useEffect(() => {
    if (day < projectDuration || analytics.length === 0) return;
    if (debriefFiredRef.current) return;
    debriefFiredRef.current = true;

    fetch(`${API_BASE}/api/ai/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: `Give me a complete project debrief for this ${projectDuration}-day simulation`,
        day,
        zones: buildZones(),
        project_duration: projectDuration,
        current_conflicts: simConflicts,
        analytics,
      }),
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.reply) {
          setMessages((m) => [...m, { role: "ai", text: `**Day ${projectDuration} — Project Complete**\n\n${data.reply}` }]);
        }
      })
      .catch(() => {
        setMessages((m) => [...m, {
          role: "ai",
          text: "Simulation complete. Unable to generate AI debrief — please check that the backend is running.",
        }]);
      });
  }, [day, projectDuration]);

  // Spawn delivery trucks when day matches a scheduled delivery day
  useEffect(() => {
    if (!projectConfig?.deliveries || !isPlaying) return;
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
        background: "#060a14", flexDirection: "column", gap: 16,
      }}>
        <div style={{
          width: 40, height: 40, border: "3px solid #1e293b", borderTopColor: "#3b82f6",
          borderRadius: "50%", animation: "spin 0.8s linear infinite",
        }} />
        <span style={{ fontSize: 14, color: "#64748b", fontWeight: 500 }}>Loading ConstructIQ...</span>
      </div>
    );
  }

  if (!user) {
    return <LoginScreen />;
  }

  const ganttPhases = buildGanttPhases(projectDuration);

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

  const skipDays = (n) => {
    const target = Math.min(day + n, projectDuration);
    skipInProgressRef.current = true;
    setDay(target);
    fetch(`${API_BASE}/api/simulate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ day: target, zones: buildZones(), project_duration: projectDuration, project_config: projectConfig }),
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

        if (data?.ai_analysis) {
          const currentTypes = new Set(conflicts.map((c) => c.type).filter(Boolean));
          const prevTypes = prevConflictTypesRef.current;
          const hasNewType = [...currentTypes].some((t) => !prevTypes.has(t));
          const hasHighConflict = conflicts.some((c) => c.severity === "HIGH");
          const materialLow = Object.values(data.simulation?.materials || {}).some((m) => m.pct_remaining < 20);
          const hasBreakdown = conflicts.some((c) => c.type === "equipment_risk");

          if (hasNewType || hasHighConflict || materialLow || hasBreakdown) {
            setMessages((m) => [...m, { role: "ai", text: data.ai_analysis }]);
          }
          prevConflictTypesRef.current = currentTypes;
        }

        if (data.simulation?.phase && data.simulation.phase !== prevPhaseRef.current && prevPhaseRef.current !== "") {
          setMessages((m) => [...m, {
            role: "ai",
            text: `**Day ${target} — Phase Transition:** Moving into ${data.simulation.phase} phase. Crew composition and equipment requirements are shifting.`,
          }]);
        }
        prevPhaseRef.current = data.simulation?.phase || "";
      })
      .catch(() => {})
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
        body: JSON.stringify({ name, zones: buildZones(), project_duration: projectDuration }),
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
        { role: "ai", text: `Loaded project "${data.name}". ${(data.zones || []).length} zones restored. Ready to simulate.` },
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
          <span style={S.badge}>BETA</span>
        </div>
        <div style={S.navCenter}>
          <NavTab label="SITE PLAN" active={activeTab === "site"} onClick={() => setActiveTab("site")} />
          <NavTab label="SCHEDULE" active={activeTab === "schedule"} onClick={() => setActiveTab("schedule")} />
          <NavTab label="ANALYTICS" active={activeTab === "analytics"} onClick={() => setActiveTab("analytics")} />
          <NavTab label="CONFIGURE" active={activeTab === "configure"} onClick={() => setActiveTab("configure")} badge={configErrorCount} />
        </div>
        <div style={S.navRight}>
          <div style={S.liveGroup}>
            <div style={S.liveDot} />
            <span style={{ fontSize: 12, color: "#64748b" }}>Live Simulation</span>
          </div>
          <div style={S.navDivider} />
          <span style={{ fontSize: 12, color: "#64748b", maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {user.email}
          </span>
          <button onClick={signOut} style={S.logoutBtn}>
            Sign Out
          </button>
        </div>
      </nav>

      {/* ════════ MAIN CONTENT ════════ */}
      <div style={S.main}>
        {/* ──── LEFT COLUMN ──── */}
        <div style={S.leftCol}>
          {activeTab === "site" ? (
          <>
          {/* Zone Toolbar */}
          <div style={{ ...S.toolbar, flexWrap: "wrap", rowGap: 6 }}>
            <span style={{ ...S.sectionLabel, width: "100%", marginBottom: -2 }}>ZONES</span>
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
            <button
              onClick={() => { setOptimizerOpen(true); setOptimizerResult(null); }}
              style={{
                ...S.toolBtn,
                borderColor: "#8b5cf6",
                background: "#8b5cf615",
                color: "#a78bfa",
                boxShadow: "0 0 12px #8b5cf615",
              }}
            >
              <span style={{ fontSize: 15 }}>{"✨"}</span>
              AI Optimize
            </button>
            <button
              onClick={() => setProjectsModalOpen(true)}
              style={{
                ...S.toolBtn,
                borderColor: "#3b82f6",
                background: "#3b82f615",
                color: "#60a5fa",
                boxShadow: "0 0 12px #3b82f615",
              }}
            >
              <span style={{ fontSize: 15 }}>{"\uD83D\uDCC1"}</span>
              Projects
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
                    border: "1px solid #1e293b",
                    borderRadius: 8,
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
                      return (
                        <div
                          key={i}
                          onClick={() => placeZone(cell.ref)}
                          onMouseEnter={() => setHoveredCell(i)}
                          onMouseLeave={() => setHoveredCell(-1)}
                          style={{
                            width: 34,
                            height: 34,
                            background: (originZone?.color || "#64748b") + "1a",
                            borderRight: "1px solid #1e293b30",
                            borderBottom: "1px solid #1e293b30",
                            cursor: activeTool ? "crosshair" : "default",
                            transition: "background 0.15s",
                            position: "relative",
                          }}
                        >
                          {hfp && (
                            <div style={{
                              position: "absolute", inset: 0,
                              background: hfp.valid ? hfp.color + "26" : "#ef444426",
                              pointerEvents: "none", zIndex: 3,
                            }} />
                          )}
                        </div>
                      );
                    }

                    const isHover = hoveredCell === i && activeTool && !cell;
                    const hoverZone = isHover ? ZONES.find((z) => z.id === activeTool) : null;

                    let cellBg = cell ? cell.bg : "#0c1221";
                    let cellBorderR = "1px solid #1e293b30";
                    let cellBorderB = "1px solid #1e293b30";
                    let cellBorderL = undefined;
                    let cellBorderT = undefined;
                    let cellAnim = undefined;
                    let cellBoxShadow = undefined;
                    let content = null;

                    if (cell?.id === "building") {
                      const stage = getBuildingStage(buildPct);
                      cellBg = stage.bg;
                      const bdr = `2px ${stage.dashed ? "dashed" : "solid"} ${stage.border}`;
                      cellBorderR = bdr;
                      cellBorderB = bdr;
                      cellBoxShadow = `0 0 12px ${stage.border}40`;
                      content = (
                        <>
                          <span style={{ fontSize: 15, lineHeight: 1 }}>{cell.emoji}</span>
                          <span style={{ fontSize: 8, fontWeight: 700, color: stage.border, lineHeight: 1, marginTop: 1 }}>
                            {stage.label}
                          </span>
                          <div style={{ position: "absolute", bottom: 3, left: 5, right: 5, height: 2, background: "#0c122180", borderRadius: 1 }}>
                            <div style={{ width: `${Math.min(buildPct, 100)}%`, height: "100%", background: stage.border, borderRadius: 1, transition: "width 0.3s" }} />
                          </div>
                        </>
                      );

                    } else if (cell?.id === "materials") {
                      const mats = matStatusByZone[simZoneId("materials", cx, cy)] || [];
                      const avgPct = mats.length > 0 ? mats.reduce((s, m) => s + m.pct_remaining, 0) / mats.length : 100;
                      const matLow = mats.some((m) => m.pct_remaining < 20);
                      const barClr = avgPct > 50 ? "#22c55e" : avgPct > 20 ? "#eab308" : "#ef4444";
                      if (matLow) {
                        cellBorderR = "1.5px solid #ef4444";
                        cellBorderB = cellBorderR;
                        cellAnim = "pulse-red 1.5s infinite";
                      }
                      content = (
                        <>
                          <span style={{ fontSize: 15, lineHeight: 1 }}>{cell.emoji}</span>
                          <span style={{ fontSize: 7, color: barClr, fontWeight: 600, lineHeight: 1, marginTop: 1 }}>
                            {Math.round(avgPct)}%
                          </span>
                          <div style={{ position: "absolute", bottom: 3, left: 5, right: 5, height: 3, background: "#1e293b", borderRadius: 1.5 }}>
                            <div style={{ width: `${avgPct}%`, height: "100%", background: barClr, borderRadius: 1.5, transition: "width 0.3s" }} />
                          </div>
                        </>
                      );

                    } else if (cell?.id === "workers") {
                      if (simulationState) {
                        const wCount = workersByZone[simZoneId("workers", cx, cy)]?.count || 0;
                        content = (
                          <>
                            <span style={{ fontSize: 13, fontWeight: 800, color: "#60a5fa", lineHeight: 1 }}>{wCount}</span>
                            <span style={{ fontSize: 6, color: "#64748b", fontWeight: 600, lineHeight: 1, marginTop: 1, letterSpacing: "0.04em" }}>CREW</span>
                          </>
                        );
                      } else {
                        const numWZ = cells.filter((c) => c?.isOrigin && c.id === "workers").length;
                        const cap = numWZ > 0 && optimizerWorkers > 0 ? Math.round(optimizerWorkers / numWZ) : 25;
                        content = (
                          <>
                            <span style={{ fontSize: 13, fontWeight: 800, color: "#3b82f6", lineHeight: 1 }}>{cap}</span>
                            <span style={{ fontSize: 6, color: "#64748b", fontWeight: 600, lineHeight: 1, marginTop: 1, letterSpacing: "0.04em" }}>CAP</span>
                          </>
                        );
                      }

                    } else if (cell?.id === "crane") {
                      const craneData = craneByPos[`${cx}-${cy}`];
                      const isBroken = craneData?.breakdown || false;
                      content = (
                        <>
                          <span style={{ fontSize: 17, lineHeight: 1 }}>{cell.emoji}</span>
                          <div style={{ width: 8, height: 2, borderRadius: 1, background: isBroken ? "#ef4444" : cell.color, marginTop: 2, opacity: 0.5 }} />
                          {isBroken && (
                            <div style={{
                              position: "absolute", inset: 0, background: "#ef444435",
                              display: "flex", alignItems: "center", justifyContent: "center",
                            }}>
                              <span style={{ color: "#ef4444", fontWeight: 900, fontSize: 20, lineHeight: 1, textShadow: "0 0 6px #ef444480" }}>{"\u2715"}</span>
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

                      cellBg = isBlocked ? "#ef444420" : isEdge ? "#334155" : "#293548";
                      if (isBlocked) {
                        cellBorderR = "1.5px solid #ef4444";
                        cellBorderB = cellBorderR;
                      } else if (isEdge) {
                        cellBorderR = "1px solid #475569";
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
                              borderLeft: "1px dashed #94a3b830",
                              transform: "translateX(-0.5px)", pointerEvents: "none",
                            }} />
                          )}
                          {(adj.left || adj.right) && (
                            <div style={{
                              position: "absolute", top: "50%", left: adj.left ? 0 : "30%",
                              right: adj.right ? 0 : "30%", height: 0,
                              borderTop: "1px dashed #94a3b830",
                              transform: "translateY(-0.5px)", pointerEvents: "none",
                            }} />
                          )}
                          {isEdge && entryDir ? (
                            <span style={{ fontSize: 14, color: "#94a3b8", fontWeight: 700, lineHeight: 1, zIndex: 1 }}>
                              {ENTRY_ARROWS[entryDir]}
                            </span>
                          ) : (
                            <span style={{ fontSize: 12, lineHeight: 1, opacity: 0.35, zIndex: 1 }}>{cell.emoji}</span>
                          )}
                          {isBlocked && (
                            <div style={{
                              position: "absolute", inset: 0, display: "flex",
                              alignItems: "center", justifyContent: "center",
                              background: "#ef444418", zIndex: 2,
                            }}>
                              <span style={{ fontSize: 14, lineHeight: 1 }}>{"\ud83d\udeab"}</span>
                            </div>
                          )}
                        </>
                      );

                    } else if (cell?.id === "truck_staging") {
                      const trucksHere = stagedTruckCount;
                      const active = trucksHere > 0;
                      const borderClr = active ? "#84cc16" : "#64748b";
                      cellBorderR = `1.5px ${active ? "solid" : "dashed"} ${borderClr}`;
                      cellBorderB = cellBorderR;
                      if (active) cellAnim = "pulse-amber 2.5s infinite";
                      content = (
                        <>
                          <span style={{ fontSize: 15, lineHeight: 1 }}>{cell.emoji}</span>
                          <span style={{
                            fontSize: 8, fontWeight: 800, lineHeight: 1, marginTop: 1,
                            color: active ? "#84cc16" : "#64748b",
                          }}>
                            {trucksHere}
                          </span>
                        </>
                      );

                    } else if (cell?.id === "boundary") {
                      cellBg = "repeating-linear-gradient(45deg, #ef444420 0px, #ef444420 3px, transparent 3px, transparent 9px)";
                      cellBorderR = "2px solid #ef4444";
                      cellBorderB = "2px solid #ef4444";
                      cellBorderL = "2px solid #ef4444";
                      cellBorderT = "2px solid #ef4444";
                      content = (
                        <span style={{ fontSize: 7, fontWeight: 800, color: "#ef4444", letterSpacing: "0.04em", lineHeight: 1 }}>
                          BNDRY
                        </span>
                      );

                    } else if (cell) {
                      content = (
                        <>
                          <span style={{ fontSize: 17, lineHeight: 1 }}>{cell.emoji}</span>
                          <div style={{ width: 8, height: 2, borderRadius: 1, background: cell.color, marginTop: 2, opacity: 0.5 }} />
                        </>
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
                            background: hfp.valid ? hfp.color + "26" : "#ef444426",
                            pointerEvents: "none", zIndex: 3,
                            display: "flex", alignItems: "center", justifyContent: "center",
                          }}>
                            {!cell && i === hoveredCell && hoverZone && hoverZone.id !== "boundary" && (
                              <span style={{ fontSize: 14, opacity: 0.4 }}>{hoverZone.emoji}</span>
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
                {deliveryRoutes.length > 0 && (
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
                        background: isBlocked ? "#ef444420" : "#84cc1620",
                        border: `1px solid ${isBlocked ? "#ef4444" : "#84cc16"}`,
                        borderRadius: 4,
                        padding: 2,
                        fontSize: 14,
                        lineHeight: 1,
                      }}>
                        🚛
                      </div>
                    </div>
                  );
                })}
                {simulationState && (
                  <div style={{
                    position: 'absolute', top: 8, right: 8,
                    background: '#0f152099', backdropFilter: 'blur(8px)',
                    border: '1px solid #1e293b', borderRadius: 10,
                    padding: '10px 14px', zIndex: 30, minWidth: 160,
                    display: 'flex', flexDirection: 'column', gap: 6,
                  }}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: '#475569', letterSpacing: '0.08em' }}>LIVE SITE STATUS</div>
                    {[
                      { label: 'Phase', value: simulationState.phase?.replace(/_/g, ' ').toUpperCase(), color: '#60a5fa' },
                      { label: 'Workers On Site', value: simulationState.total_workers, color: '#3b82f6' },
                      { label: 'Active Tasks', value: simulationState.active_tasks?.length || 0, color: '#22c55e' },
                      { label: 'Today Risk', value: '$' + (simConflicts.reduce((s,c) => s + (c.cost_impact||0), 0)).toLocaleString(), color: simConflicts.some(c => c.severity === 'HIGH') ? '#ef4444' : '#f59e0b' },
                    ].map(({ label, value, color }) => (
                      <div key={label} style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                        <span style={{ fontSize: 11, color: '#64748b' }}>{label}</span>
                        <span style={{ fontSize: 11, fontWeight: 700, color }}>{value}</span>
                      </div>
                    ))}
                  </div>
                )}
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
              <div style={{ marginLeft: "auto", paddingRight: 24 }}>
                <span style={{ fontSize: 11, color: "#334155" }}>
                  1 tile = 10 ft · Site = 300 × 300 ft
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
            <button onClick={rewind} style={{ ...S.playBtn, background: "#1e293b", fontSize: 14 }} title="Rewind to Day 1">
              ⏮
            </button>
            <button
              onClick={() => {
                setIsPlaying(!isPlaying);
              }}
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
              <span style={{ fontSize: 11, color: "#475569" }}>of {projectDuration}</span>
            </div>
            <button
              onClick={() => skipDays(7)}
              disabled={day >= projectDuration}
              style={{
                ...S.toolBtn,
                borderColor: "#334155",
                background: "#1e293b",
                color: "#94a3b8",
                fontSize: 11,
                padding: "5px 10px",
                opacity: day >= projectDuration ? 0.4 : 1,
                cursor: day >= projectDuration ? "not-allowed" : "pointer",
              }}
              title="Skip forward 7 days"
            >
              +7 days
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
                        fontSize: 10,
                        color: progress >= pct ? "#60a5fa" : "#334155",
                        fontWeight: progress >= pct ? 600 : 400,
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
                Sean Chung
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
                      Sean Chung
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
      {badge > 0 && (
        <span style={{
          position: "absolute", top: -4, right: -4,
          minWidth: 16, height: 16, borderRadius: 8,
          background: "#ef4444", color: "#fff",
          fontSize: 9, fontWeight: 700,
          display: "flex", alignItems: "center", justifyContent: "center",
          padding: "0 4px", lineHeight: 1,
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
    borderRadius: 7,
    background: "#0c1221",
    border: "1px solid #1e293b",
    color: "#e2e8f0",
    fontSize: 13,
    outline: "none",
    fontFamily: "inherit",
  };

  const labelStyle = {
    fontSize: 11,
    fontWeight: 600,
    color: "#94a3b8",
    marginBottom: 4,
    display: "block",
  };

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, zIndex: 1000,
        background: "rgba(0,0,0,0.7)", backdropFilter: "blur(4px)",
        display: "flex", alignItems: "center", justifyContent: "center",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 460, background: "#0f1520", borderRadius: 14,
          border: "1px solid #1e293b", boxShadow: "0 24px 80px rgba(0,0,0,0.6)",
          overflow: "hidden",
        }}
      >
        {/* Header */}
        <div style={{
          padding: "20px 24px 16px", borderBottom: "1px solid #1e293b",
          display: "flex", alignItems: "flex-start", justifyContent: "space-between",
        }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, color: "#f1f5f9", display: "flex", alignItems: "center", gap: 8 }}>
              <span>{"✨"}</span> AI Layout Optimizer
            </div>
            <div style={{ fontSize: 12, color: "#64748b", marginTop: 4, lineHeight: 1.4 }}>
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
              background: loading ? "#1e293b" : "linear-gradient(135deg, #8b5cf6, #6d28d9)",
              color: "#fff", fontSize: 14, fontWeight: 600,
              cursor: loading ? "not-allowed" : "pointer",
              fontFamily: "inherit",
              display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
              opacity: loading || !desc.trim() ? 0.6 : 1,
              transition: "all 0.15s",
              boxShadow: loading ? "none" : "0 0 20px #8b5cf625",
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
    borderRadius: 7,
    background: "#0c1221",
    border: "1px solid #1e293b",
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
        background: "rgba(0,0,0,0.7)", backdropFilter: "blur(4px)",
        display: "flex", alignItems: "center", justifyContent: "center",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 520, maxHeight: "80vh", background: "#0f1520", borderRadius: 14,
          border: "1px solid #1e293b", boxShadow: "0 24px 80px rgba(0,0,0,0.6)",
          display: "flex", flexDirection: "column", overflow: "hidden",
        }}
      >
        {/* Header */}
        <div style={{
          padding: "20px 24px 16px", borderBottom: "1px solid #1e293b",
          display: "flex", alignItems: "center", justifyContent: "space-between",
          flexShrink: 0,
        }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: "#f1f5f9", display: "flex", alignItems: "center", gap: 8 }}>
            <span>{"\uD83D\uDCC1"}</span> Projects
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
          padding: "16px 24px", borderBottom: "1px solid #1e293b",
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
              height: 38, borderRadius: 7, border: "none",
              background: !nameInput.trim() ? "#1e293b" : "linear-gradient(135deg, #3b82f6, #2563eb)",
              color: "#fff", fontSize: 13, fontWeight: 600,
              padding: "0 18px", cursor: !nameInput.trim() ? "not-allowed" : "pointer",
              fontFamily: "inherit", whiteSpace: "nowrap",
              opacity: !nameInput.trim() ? 0.5 : 1,
              boxShadow: !nameInput.trim() ? "none" : "0 0 12px #3b82f630",
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
              <span style={{ fontSize: 32, opacity: 0.4 }}>{"\uD83D\uDCC2"}</span>
              <span style={{ fontSize: 13, color: "#475569", lineHeight: 1.5 }}>
                No saved projects. Save your current layout to get started.
              </span>
            </div>
          ) : (
            projects.map((p) => (
              <div
                key={p.id}
                style={{
                  padding: "12px 24px",
                  borderBottom: "1px solid #1e293b20",
                  display: "flex", alignItems: "center", gap: 12,
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: "#e2e8f0", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {p.name}
                  </div>
                  <div style={{ fontSize: 11, color: "#475569", marginTop: 2 }}>
                    {p.zone_count} zone{p.zone_count !== 1 ? "s" : ""} &middot; {fmtDate(p.created_at)}
                  </div>
                </div>
                <button
                  onClick={() => onLoad(p)}
                  style={{
                    fontSize: 11, fontWeight: 600, color: "#60a5fa",
                    background: "#3b82f615", border: "1px solid #3b82f630",
                    borderRadius: 5, padding: "5px 12px", cursor: "pointer",
                    fontFamily: "inherit", transition: "all 0.15s",
                  }}
                >
                  Load
                </button>
                <button
                  onClick={() => onDelete(p.id)}
                  style={{
                    fontSize: 11, fontWeight: 600, color: "#ef4444",
                    background: "transparent", border: "1px solid #ef444430",
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
      background: "#060a14",
      display: "flex", alignItems: "center", justifyContent: "center",
    }}>
      <div style={{
        width: 400, background: "#0f1520", borderRadius: 14,
        border: "1px solid #1e293b",
        boxShadow: "0 24px 80px rgba(0,0,0,0.6)",
        overflow: "hidden",
      }}>
        {/* Logo + Title */}
        <div style={{ padding: "32px 32px 20px", textAlign: "center" }}>
          <div style={{
            display: "flex", alignItems: "center", justifyContent: "center",
            gap: 10, marginBottom: 8,
          }}>
            <div style={{
              width: 36, height: 36, borderRadius: 8,
              background: "linear-gradient(135deg, #3b82f6, #1d4ed8)",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 18, fontWeight: 800, color: "#fff",
            }}>
              C
            </div>
            <span style={{
              fontSize: 22, fontWeight: 700, color: "#60a5fa",
              letterSpacing: "-0.03em",
            }}>
              ConstructIQ
            </span>
          </div>
          <p style={{ fontSize: 13, color: "#475569", margin: 0 }}>
            AI-Powered Construction Intelligence
          </p>
        </div>

        {/* Tabs */}
        <div style={{
          display: "flex", margin: "0 32px", borderRadius: 8,
          background: "#0c1221", border: "1px solid #1e293b",
          overflow: "hidden",
        }}>
          {["login", "signup"].map((tab) => (
            <button
              key={tab}
              onClick={() => switchTab(tab)}
              style={{
                flex: 1, padding: "10px 0", fontSize: 13, fontWeight: 600,
                color: activeTab === tab ? "#e2e8f0" : "#475569",
                background: activeTab === tab ? "#1d4ed8" : "transparent",
                border: "none", cursor: "pointer", fontFamily: "inherit",
                transition: "all 0.15s",
                boxShadow: activeTab === tab ? "0 0 12px #3b82f630" : "none",
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
            <label style={{ fontSize: 12, fontWeight: 600, color: "#94a3b8" }}>Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              required
              style={{
                width: "100%", height: 42, padding: "0 14px", borderRadius: 8,
                background: "#0c1221", border: "1px solid #1e293b", color: "#e2e8f0",
                fontSize: 13, outline: "none", fontFamily: "inherit",
                transition: "border-color 0.15s, box-shadow 0.15s",
              }}
            />
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <label style={{ fontSize: 12, fontWeight: 600, color: "#94a3b8" }}>Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={isLogin ? "Enter your password" : "Min 6 characters"}
              required
              minLength={isLogin ? undefined : 6}
              style={{
                width: "100%", height: 42, padding: "0 14px", borderRadius: 8,
                background: "#0c1221", border: "1px solid #1e293b", color: "#e2e8f0",
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
              background: loading ? "#1e293b" : "linear-gradient(135deg, #3b82f6, #2563eb)",
              color: "#fff", fontSize: 14, fontWeight: 600,
              cursor: loading ? "not-allowed" : "pointer", fontFamily: "inherit",
              display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
              opacity: loading ? 0.6 : 1, transition: "all 0.15s",
              boxShadow: loading ? "none" : "0 0 20px #3b82f625",
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

  const tickInterval = projectDuration <= 30 ? 5 : projectDuration <= 60 ? 10 : projectDuration <= 90 ? 15 : 30;
  const ticks = [];
  for (let d = 1; d <= projectDuration; d += tickInterval) ticks.push(d);
  if (ticks[ticks.length - 1] !== projectDuration) ticks.push(projectDuration);

  return (
    <div style={{ flex: 1, overflow: "auto", background: "#080c18", padding: "20px 24px", display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 700, color: "#f1f5f9", marginBottom: 2 }}>Project Schedule</div>
          <div style={{ fontSize: 12, color: "#475569" }}>{projectDuration}-day construction timeline — Day {day}</div>
        </div>
        <div style={{ display: "flex", gap: 12 }}>
          {ganttPhases.map((p) => (
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
          {/* Timeline gridlines + labels */}
          {ticks.map((d) => {
            const x = dayToX(d);
            return (
              <g key={d}>
                <line x1={x} y1={P.t - 4} x2={x} y2={P.t + iH} stroke="#1e293b" strokeWidth="1" />
                <text x={x} y={P.t + iH + 14} fill="#475569" fontSize="9" fontFamily="monospace" textAnchor="middle">{d}</text>
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
            const phaseIdx = ganttPhases.findIndex((p) => cd >= p.start && cd <= p.end);
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
  height: 32, background: "#0c1221", border: "1px solid #1e293b", color: "#e2e8f0",
  borderRadius: 6, fontSize: 12, fontFamily: "inherit", padding: "0 8px", outline: "none",
};
const cfgLabel = { fontSize: 10, color: "#94a3b8", textTransform: "uppercase", marginBottom: 2 };
const cfgCard = {
  background: "#0f1520", border: "1px solid #1e293b", borderRadius: 8, padding: 14,
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
      let idleDay = null;
      for (let d = eq.arrivalDay; d <= eq.departureDay; d++) {
        if (!concreteDays.has(d)) { idleDay = d; break; }
      }
      if (idleDay !== null) {
        issues.push({ severity: "warning", section: "equipment",
          message: `Concrete pump active on Day ${idleDay} but no concrete delivery scheduled — equipment may be idle` });
      }
    }
  });

  return issues;
}

function ConfigurePanel({ cells, projectDuration, onConfigSave, onValidationChange, config, onConfigChange }) {
  console.log('cells received:', cells?.length, cells?.filter(c => c?.isOrigin && c?.id === 'crane').length, 'cranes');
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

  const sortedMilestones = [...config.milestones].sort((a, b) => a.day - b.day);

  const validationIssues = useMemo(() => getValidationIssues(config, cells), [config, cells]);
  const errorCount = validationIssues.filter((i) => i.severity === "error").length;
  const warningCount = validationIssues.filter((i) => i.severity === "warning").length;

  useEffect(() => {
    if (onValidationChange) onValidationChange(errorCount);
  }, [errorCount, onValidationChange]);

  return (
    <div style={{ display: "flex", height: "100%", background: "#080c18", overflow: "hidden" }}>
      {/* Sidebar */}
      <div style={{ width: 200, background: "#0f1520", borderRight: "1px solid #1e293b", display: "flex", flexDirection: "column", flexShrink: 0 }}>
        <div style={{ padding: "16px 12px 8px", fontSize: 11, color: "#475569", textTransform: "uppercase", letterSpacing: "0.06em" }}>
          Configuration
        </div>
        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 2, padding: "0 8px" }}>
          {CONFIGURE_SECTIONS.map((s) => (
            <button
              key={s}
              onClick={() => setSection(s)}
              style={{
                background: section === s ? "#1e293b" : "transparent",
                border: "none", color: section === s ? "#e2e8f0" : "#94a3b8",
                fontSize: 12, fontWeight: 500, padding: "8px 10px", borderRadius: 6,
                cursor: "pointer", textAlign: "left", fontFamily: "inherit",
                display: "flex", justifyContent: "space-between", alignItems: "center",
              }}
            >
              {s}
              {sectionCounts[s] > 0 && (
                <span style={{ fontSize: 10, color: "#64748b", background: "#1e293b", borderRadius: 8, padding: "1px 6px" }}>
                  {sectionCounts[s]}
                </span>
              )}
            </button>
          ))}
        </div>
        <div style={{ padding: 12, borderTop: "1px solid #1e293b" }}>
          <button
            onClick={handleSave}
            style={{
              width: "100%", height: 36, borderRadius: 8, border: "none",
              background: saved ? "linear-gradient(135deg, #22c55e, #16a34a)" : "linear-gradient(135deg, #3b82f6, #2563eb)",
              color: "#fff", fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "inherit",
              display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
              transition: "background 0.2s",
            }}
          >
            {saved ? "✓ Saved!" : "Save Configuration"}
          </button>
        </div>
      </div>

      {/* Main content */}
      <div style={{ flex: 1, overflowY: "auto", padding: 20 }}>
        {section === "Phases" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: "#e2e8f0", marginBottom: 4 }}>Construction Phases</div>
            {config.phases.map((phase, idx) => (
              <PhaseCard key={phase.id} phase={phase} idx={idx}
                onUpdate={updatePhase} onRemove={removePhase} />
            ))}
            <button onClick={addPhase} style={{
              height: 36, borderRadius: 8, border: "1px dashed #1e293b", background: "transparent",
              color: "#64748b", fontSize: 12, cursor: "pointer", fontFamily: "inherit",
            }}>
              + Add Phase
            </button>
          </div>
        )}

        {section === "Cranes" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: "#e2e8f0", marginBottom: 4 }}>Crane Configuration</div>
            {craneZones.length === 0 ? (
              <div style={{ ...cfgCard, color: "#64748b", fontSize: 13, textAlign: "center", padding: 32 }}>
                Place crane zones on the site plan first
              </div>
            ) : (
              config.cranes.map((crane, idx) => (
                <div key={crane.id} style={{ ...cfgCard, borderLeft: "3px solid #eab308" }}>
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
            <div style={{ fontSize: 14, fontWeight: 600, color: "#e2e8f0", marginBottom: 4 }}>Delivery Schedule</div>
            {config.deliveries.map((del, idx) => (
              <div key={del.id} style={{ ...cfgCard, borderLeft: "3px solid #f97316", position: "relative" }}>
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
              height: 36, borderRadius: 8, border: "1px dashed #1e293b", background: "transparent",
              color: "#64748b", fontSize: 12, cursor: "pointer", fontFamily: "inherit",
            }}>
              + Add Delivery
            </button>
          </div>
        )}

        {section === "Workforce" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: "#e2e8f0", marginBottom: 4 }}>Workforce Planning</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 12 }}>
              {config.phases.map((phase) => {
                const wf = config.workforce[phase.id] || { total: 0 };
                const trades = workforceTradesFor(phase.id);
                const total = wf.total || 1;
                return (
                  <div key={phase.id} style={{ ...cfgCard, borderTop: `3px solid ${phase.color}` }}>
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
                    <div style={{ marginTop: 10, height: 8, borderRadius: 4, overflow: "hidden", display: "flex", background: "#1e293b" }}>
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
            <div style={{ fontSize: 14, fontWeight: 600, color: "#e2e8f0", marginBottom: 4 }}>Equipment Management</div>
            {config.equipment.map((eq, idx) => (
              <div key={eq.id} style={{ ...cfgCard, borderLeft: "3px solid #06b6d4", position: "relative" }}>
                <button onClick={() => removeEquipment(idx)} style={{
                  position: "absolute", top: 8, right: 8, background: "none", border: "none",
                  color: "#475569", cursor: "pointer", fontSize: 14, fontFamily: "inherit",
                }}>✕</button>
                {(eq.type === "Excavator" || eq.type === "Concrete Pump") && (
                  <div style={{
                    fontSize: 11, color: "#f59e0b", background: "#f59e0b15", border: "1px solid #f59e0b30",
                    borderRadius: 6, padding: "4px 10px", marginBottom: 10, display: "inline-block",
                  }}>
                    ⚠ High coordination required — schedule deliveries around this equipment
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
                    <div style={cfgLabel}>Position Zone</div>
                    <select value={eq.zone} onChange={(e) => updateEquipment(idx, "zone", e.target.value)}
                      style={{ ...cfgInput, width: "100%" }}>
                      <option value="">Select...</option>
                      {nonRoadZones.map((nz) => (
                        <option key={nz.idx} value={nz.idx}>{nz.type} at {posLabel(nz.x, nz.y)}</option>
                      ))}
                    </select>
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
              height: 36, borderRadius: 8, border: "1px dashed #1e293b", background: "transparent",
              color: "#64748b", fontSize: 12, cursor: "pointer", fontFamily: "inherit",
            }}>
              + Add Equipment
            </button>
          </div>
        )}

        {section === "Milestones" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: "#e2e8f0", marginBottom: 4 }}>Project Milestones</div>
            {sortedMilestones.map((ms) => {
              const realIdx = config.milestones.findIndex((m) => m.id === ms.id);
              return (
                <div key={ms.id} style={{ ...cfgCard, borderLeft: `3px solid ${milestoneColor(ms.type)}`, position: "relative" }}>
                  <button onClick={() => removeMilestone(realIdx)} style={{
                    position: "absolute", top: 8, right: 8, background: "none", border: "none",
                    color: "#475569", cursor: "pointer", fontSize: 14, fontFamily: "inherit",
                  }}>✕</button>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
                    <div>
                      <div style={cfgLabel}>Name</div>
                      <input value={ms.name} onChange={(e) => updateMilestone(realIdx, "name", e.target.value)}
                        placeholder="Milestone name" style={{ ...cfgInput, width: "100%" }} />
                    </div>
                    <div>
                      <div style={cfgLabel}>Day</div>
                      <input type="number" min={1} max={projectDuration} value={ms.day}
                        onChange={(e) => updateMilestone(realIdx, "day", Number(e.target.value))}
                        style={{ ...cfgInput, width: "100%" }} />
                    </div>
                    <div>
                      <div style={cfgLabel}>Type</div>
                      <select value={ms.type} onChange={(e) => updateMilestone(realIdx, "type", e.target.value)}
                        style={{ ...cfgInput, width: "100%" }}>
                        {MILESTONE_TYPES.map((t) => <option key={t}>{t}</option>)}
                      </select>
                    </div>
                    <div>
                      <div style={cfgLabel}>Impact</div>
                      <select value={ms.impact} onChange={(e) => updateMilestone(realIdx, "impact", e.target.value)}
                        style={{ ...cfgInput, width: "100%" }}>
                        {MILESTONE_IMPACTS.map((imp) => <option key={imp}>{imp}</option>)}
                      </select>
                    </div>
                    <div style={{ gridColumn: "span 2" }}>
                      <div style={cfgLabel}>Notes</div>
                      <textarea value={ms.notes} onChange={(e) => updateMilestone(realIdx, "notes", e.target.value)}
                        rows={2} style={{ ...cfgInput, width: "100%", height: "auto", padding: 8, resize: "vertical" }} />
                    </div>
                  </div>
                </div>
              );
            })}
            <button onClick={addMilestone} style={{
              height: 36, borderRadius: 8, border: "1px dashed #1e293b", background: "transparent",
              color: "#64748b", fontSize: 12, cursor: "pointer", fontFamily: "inherit",
            }}>
              + Add Milestone
            </button>
          </div>
        )}

        {/* ── Validation Panel ── */}
        <div style={{ marginTop: 24, borderTop: "1px solid #1e293b", paddingTop: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: "#64748b", letterSpacing: "0.06em" }}>PLAN VALIDATION</span>
            {errorCount > 0 && (
              <span style={{
                fontSize: 10, fontWeight: 700, color: "#fff", background: "#ef4444",
                borderRadius: 8, padding: "1px 7px", lineHeight: "16px",
              }}>{errorCount} {errorCount === 1 ? "error" : "errors"}</span>
            )}
            {warningCount > 0 && (
              <span style={{
                fontSize: 10, fontWeight: 700, color: "#000", background: "#eab308",
                borderRadius: 8, padding: "1px 7px", lineHeight: "16px",
              }}>{warningCount} {warningCount === 1 ? "warning" : "warnings"}</span>
            )}
          </div>
          {validationIssues.length === 0 ? (
            <div style={{
              ...cfgCard, display: "flex", alignItems: "center", gap: 8,
              color: "#22c55e", fontSize: 13,
            }}>
              <span style={{ fontSize: 16 }}>✓</span> Plan looks good
            </div>
          ) : (
            <div style={{ maxHeight: 220, overflowY: "auto", display: "flex", flexDirection: "column", gap: 4 }}>
              {validationIssues.map((issue, i) => (
                <div key={i} style={{
                  ...cfgCard, display: "flex", alignItems: "flex-start", gap: 8,
                  padding: "8px 12px", fontSize: 12, color: "#cbd5e1",
                }}>
                  <span style={{
                    width: 8, height: 8, borderRadius: "50%", flexShrink: 0, marginTop: 4,
                    background: issue.severity === "error" ? "#ef4444" : issue.severity === "warning" ? "#eab308" : "#3b82f6",
                  }} />
                  <span style={{ flex: 1 }}>{issue.message}</span>
                  <span style={{
                    fontSize: 9, color: "#475569", background: "#1e293b", borderRadius: 4,
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
    <div style={{ ...cfgCard, borderLeft: `3px solid ${phase.color}`, display: "flex", alignItems: "center", gap: 12, position: "relative" }}>
      <div style={{ position: "relative" }}>
        <div
          onClick={() => setPickerOpen(!pickerOpen)}
          style={{ width: 24, height: 24, borderRadius: 6, background: phase.color, cursor: "pointer", border: "2px solid #1e293b" }}
        />
        {pickerOpen && (
          <div style={{
            position: "absolute", top: 30, left: 0, zIndex: 10, background: "#0f1520",
            border: "1px solid #1e293b", borderRadius: 8, padding: 8,
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
  logoutBtn: {
    fontSize: 12,
    fontWeight: 600,
    color: "#ef4444",
    background: "#ef444415",
    border: "1px solid #ef444430",
    borderRadius: 6,
    padding: "5px 12px",
    cursor: "pointer",
    fontFamily: "inherit",
    transition: "all 0.15s",
  },

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
    padding: 8,
    background: "#080c18",
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
    height: 34,
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
  durationPicker: {
    display: "flex",
    alignItems: "center",
    background: "#0c1221",
    borderRadius: 7,
    border: "1px solid #1e293b",
    padding: 2,
    gap: 2,
    flexShrink: 0,
  },
  durationBtn: {
    fontSize: 11,
    fontWeight: 600,
    color: "#475569",
    background: "transparent",
    border: "none",
    borderRadius: 5,
    padding: "4px 8px",
    cursor: "pointer",
    fontFamily: "inherit",
    transition: "all 0.15s ease",
    lineHeight: 1,
  },
  durationBtnActive: {
    background: "#1d4ed8",
    color: "#e2e8f0",
    boxShadow: "0 0 8px #3b82f630",
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
