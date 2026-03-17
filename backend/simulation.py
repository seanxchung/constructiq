"""ConstructIQ — Construction Site Simulation Engine

Critical-path-driven, day-by-day simulation of a mid-rise commercial
building / data center construction project.  Models task dependencies,
crew allocation, material consumption, equipment status, and schedule
risk using forward/backward-pass CPM scheduling.

Zone types from the frontend grid: "crane", "workers", "materials",
"road", "building".  Zones represent WHERE work happens on the 12×12
board; tasks represent WHAT happens and WHEN.
"""

from __future__ import annotations

import math
import random
from copy import deepcopy
from typing import Any

# ── Phase ordering ────────────────────────────────────────────────────────────

PHASES = (
    "site_prep", "foundation", "structure", "mep", "finishing", "commissioning",
)

# ── 1. Task Dependency Engine ─────────────────────────────────────────────────
#
# Each task models a real construction activity for a mid-rise commercial
# build.  `duration_days` is the *base* duration before project-duration
# scaling.  `depends_on` encodes hard finish-to-start dependencies.

BASE_TASKS: list[dict[str, Any]] = [
    {
        "name": "Site Preparation",
        "duration_days": 5,
        "depends_on": [],
        "required_crew": {"laborer": 6},
        "required_materials": {},
        "phase": "site_prep",
    },
    {
        "name": "Excavation",
        "duration_days": 8,
        "depends_on": ["Site Preparation"],
        "required_crew": {"equipment_operator": 3, "laborer": 4},
        "required_materials": {},
        "phase": "site_prep",
    },
    {
        "name": "Foundation Forming",
        "duration_days": 10,
        "depends_on": ["Excavation"],
        "required_crew": {"carpenter": 6, "laborer": 4},
        "required_materials": {"lumber": 80},
        "phase": "foundation",
    },
    {
        "name": "Rebar Placement",
        "duration_days": 7,
        "depends_on": ["Foundation Forming"],
        "required_crew": {"ironworker": 5},
        "required_materials": {"rebar": 4},
        "phase": "foundation",
    },
    {
        "name": "Concrete Pour",
        "duration_days": 4,
        "depends_on": ["Rebar Placement"],
        "required_crew": {"laborer": 8},
        "required_materials": {"concrete": 30},
        "phase": "foundation",
    },
    {
        "name": "Concrete Cure",
        "duration_days": 7,
        "depends_on": ["Concrete Pour"],
        "required_crew": {},
        "required_materials": {},
        "phase": "foundation",
    },
    {
        "name": "Steel Erection",
        "duration_days": 15,
        "depends_on": ["Concrete Cure"],
        "required_crew": {"ironworker": 6, "crane_operator": 2},
        "required_materials": {"structural_steel": 5},
        "phase": "structure",
    },
    {
        "name": "Exterior Envelope",
        "duration_days": 12,
        "depends_on": ["Steel Erection"],
        "required_crew": {"mason": 4, "carpenter": 4},
        "required_materials": {"lumber": 60, "masonry": 40},
        "phase": "structure",
    },
    {
        "name": "MEP Rough-In",
        "duration_days": 18,
        "depends_on": ["Steel Erection"],
        "required_crew": {"electrician": 5, "plumber": 4},
        "required_materials": {"conduit": 70, "copper_pipe": 80},
        "phase": "mep",
    },
    {
        "name": "Interior Framing",
        "duration_days": 10,
        "depends_on": ["MEP Rough-In"],
        "required_crew": {"carpenter": 6},
        "required_materials": {"lumber": 90},
        "phase": "finishing",
    },
    {
        "name": "Finishing",
        "duration_days": 14,
        "depends_on": ["Interior Framing"],
        "required_crew": {"carpenter": 3, "electrician": 2, "plumber": 2, "painter": 4},
        "required_materials": {"lumber": 30, "conduit": 20, "copper_pipe": 15},
        "phase": "finishing",
    },
    {
        "name": "Commissioning",
        "duration_days": 7,
        "depends_on": ["Finishing"],
        "required_crew": {"specialist": 3},
        "required_materials": {},
        "phase": "commissioning",
    },
]

# ── Zone / site constants ─────────────────────────────────────────────────────

OSHA_MAX_WORKERS_PER_ZONE = 25
CRANE_SWING_RADIUS = 1.5        # grid cells
CRANE_SAFETY_BUFFER = 0.5       # grid cells
EQUIPMENT_BREAKDOWN_PROB = 0.02  # per crane per day
WEEKEND_CREW_FACTOR = 0.20
RESTOCK_CYCLE_DAYS = 14
MATERIAL_LOW_THRESHOLD_PCT = 0.20

MATERIAL_CATALOG: dict[str, dict[str, Any]] = {
    "concrete":         {"name": "Ready-Mix Concrete",       "unit": "m³",       "max_stock": 500},
    "rebar":            {"name": "Steel Rebar (#5 bar)",     "unit": "tons",     "max_stock": 80},
    "structural_steel": {"name": "Structural Steel (W-beams)", "unit": "tons",   "max_stock": 120},
    "conduit":          {"name": "EMT Conduit (3/4\")",      "unit": "sticks",   "max_stock": 1500},
    "copper_pipe":      {"name": "Copper Pipe (Type L)",     "unit": "m",        "max_stock": 2000},
    "lumber":           {"name": "Lumber (2×4 SPF)",         "unit": "board-ft", "max_stock": 3000},
    "masonry":          {"name": "CMU Block (8\")",          "unit": "units",    "max_stock": 5000},
}

DEFAULT_CREW_POOL: dict[str, int] = {
    "laborer": 12,
    "carpenter": 8,
    "ironworker": 6,
    "electrician": 6,
    "plumber": 5,
    "mason": 4,
    "equipment_operator": 4,
    "crane_operator": 3,
    "painter": 4,
    "specialist": 3,
}

DEFAULT_PROJECT_CONFIG: dict[str, Any] = {
    "project_duration": 180,
    "crew_size": DEFAULT_CREW_POOL,
    "daily_budget": 45_000.0,
    "project_type": "commercial",
}

# ── Helpers ───────────────────────────────────────────────────────────────────


def _dist(x1: float, y1: float, x2: float, y2: float) -> float:
    return math.hypot(x2 - x1, y2 - y1)


def _usd(amount: float) -> int:
    return int(round(amount))


def _zone_id(z: dict) -> str:
    return f"{z['type']}-{z['x']}-{z['y']}"


def _zone_label(z: dict) -> str:
    labels = {
        "crane": "Crane",
        "workers": "Worker Zone",
        "materials": "Material Yard",
        "road": "Access Road",
        "building": "Building",
    }
    col = chr(65 + int(z["x"]))
    row = int(z["y"]) + 1
    return f"{labels.get(z['type'], z['type'])} ({col}{row})"


def _is_weekend(day: int) -> bool:
    return (day % 7) in (0, 6)


# ── Task scaling ──────────────────────────────────────────────────────────────


def _base_critical_path_length(tasks: list[dict]) -> int:
    """Quick forward pass to get the makespan of unscaled tasks."""
    by_name = {t["name"]: t for t in tasks}
    cache: dict[str, int] = {}

    def _ef(name: str) -> int:
        if name in cache:
            return cache[name]
        t = by_name[name]
        es = max((_ef(dep) for dep in t["depends_on"]), default=0)
        cache[name] = es + t["duration_days"]
        return cache[name]

    return max(_ef(t["name"]) for t in tasks)


def scale_tasks(base_tasks: list[dict], project_duration: int) -> list[dict]:
    """Scale task durations proportionally to fit *project_duration*.

    The base schedule has a ~105-day critical path.  A longer project
    stretches durations; a shorter one compresses them (floor of 1 day
    per task, minimum 3 days for Concrete Cure — physics doesn't scale).
    """
    base_cp = _base_critical_path_length(base_tasks)
    if base_cp <= 0:
        return deepcopy(base_tasks)

    scale = project_duration / base_cp
    scaled: list[dict] = []
    for t in base_tasks:
        task = deepcopy(t)
        raw = t["duration_days"] * scale
        if t["name"] == "Concrete Cure":
            task["duration_days"] = max(3, round(raw))
        else:
            task["duration_days"] = max(1, round(raw))
        scaled.append(task)
    return scaled


# ── 2. Critical Path Calculation ──────────────────────────────────────────────


def calculate_critical_path(
    tasks: list[dict[str, Any]],
    project_duration: int,
) -> dict[str, Any]:
    """CPM forward/backward pass over the task network.

    Returns
    -------
    dict with keys:
        schedule         – list of task dicts augmented with ES, EF, LS, LF, float
        critical_path    – ordered list of task names with zero total float
        makespan         – total computed duration (days)
        schedule_risk    – True when makespan > project_duration
        overrun_days     – how many days over budget (0 if on time)
    """
    scaled = scale_tasks(tasks, project_duration)
    by_name: dict[str, dict] = {t["name"]: t for t in scaled}

    # --- Forward pass (earliest start / finish) ---
    es: dict[str, int] = {}
    ef: dict[str, int] = {}

    def _forward(name: str) -> int:
        if name in ef:
            return ef[name]
        t = by_name[name]
        es[name] = max((_forward(dep) for dep in t["depends_on"]), default=0)
        ef[name] = es[name] + t["duration_days"]
        return ef[name]

    for t in scaled:
        _forward(t["name"])

    makespan = max(ef.values()) if ef else 0

    # --- Backward pass (latest start / finish) ---
    successors: dict[str, list[str]] = {t["name"]: [] for t in scaled}
    for t in scaled:
        for dep in t["depends_on"]:
            successors[dep].append(t["name"])

    lf: dict[str, int] = {}
    ls: dict[str, int] = {}

    def _backward(name: str) -> int:
        if name in ls:
            return ls[name]
        t = by_name[name]
        if not successors[name]:
            lf[name] = makespan
        else:
            lf[name] = min(_backward(s) for s in successors[name])
        ls[name] = lf[name] - t["duration_days"]
        return ls[name]

    for t in scaled:
        _backward(t["name"])

    # --- Build augmented schedule with float ---
    schedule: list[dict[str, Any]] = []
    critical_path_names: list[str] = []

    for t in scaled:
        name = t["name"]
        total_float = ls[name] - es[name]
        is_critical = total_float == 0
        if is_critical:
            critical_path_names.append(name)
        schedule.append({
            **t,
            "earliest_start": es[name],
            "earliest_finish": ef[name],
            "latest_start": ls[name],
            "latest_finish": lf[name],
            "total_float": total_float,
            "is_critical": is_critical,
        })

    critical_path_names.sort(key=lambda n: es[n])
    overrun = max(0, makespan - project_duration)
    # Tolerate up to 2 days of rounding drift from duration scaling
    rounding_tolerance = 2

    return {
        "schedule": schedule,
        "critical_path": critical_path_names,
        "makespan": makespan,
        "schedule_risk": overrun > rounding_tolerance,
        "overrun_days": overrun,
    }


# ── 3. Daily Simulation Tick ──────────────────────────────────────────────────


def run_simulation_tick(
    zones: list[dict[str, Any]],
    day: int,
    project_duration: int = 180,
    project_config: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Simulate one calendar day of construction activity.

    Combines task-driven scheduling (what's happening, who's needed,
    what materials are consumed) with zone-based site state (where
    things are physically located on the grid).
    """
    config = {**DEFAULT_PROJECT_CONFIG, **(project_config or {})}
    config["project_duration"] = project_duration
    crew_pool = config.get("crew_size", DEFAULT_CREW_POOL)

    if not zones:
        return _empty_state(day, config)

    rng = random.Random(day * 31 + len(zones))
    cp_result = calculate_critical_path(BASE_TASKS, project_duration)
    schedule = cp_result["schedule"]

    # --- Active tasks for this day (ES < day <= EF) ---
    active_tasks: list[dict[str, Any]] = []
    for task in schedule:
        if task["earliest_start"] < day <= task["earliest_finish"]:
            active_tasks.append(task)

    current_phase = _determine_phase(active_tasks, day, schedule)

    # --- Workforce from project_config phases ---
    _TRADE_TO_ROLE: dict[str, str] = {
        "laborers": "laborer",
        "carpenters": "carpenter",
        "ironworkers": "ironworker",
        "electricians": "electrician",
        "plumbers": "plumber",
        "operators": "equipment_operator",
        "painters": "painter",
        "hvac": "specialist",
    }
    if project_config and project_config.get("phases") and project_config.get("workforce"):
        phase_id: str | None = None
        for phase_cfg in project_config["phases"]:
            if phase_cfg.get("startDay", 0) <= day <= phase_cfg.get("endDay", 0):
                phase_id = phase_cfg.get("id")
                break
        if phase_id:
            wf = project_config["workforce"].get(phase_id, {})
            configured_pool: dict[str, int] = {}
            for trade, role in _TRADE_TO_ROLE.items():
                count = wf.get(trade, 0)
                if count > 0:
                    configured_pool[role] = configured_pool.get(role, 0) + count
            other_count = wf.get("other", 0)
            if other_count > 0:
                configured_pool["laborer"] = configured_pool.get("laborer", 0) + other_count
            if sum(configured_pool.values()) > 0:
                crew_pool = {**DEFAULT_CREW_POOL, **configured_pool}

    # --- Crew demand from active tasks ---
    crew_required: dict[str, int] = {}
    for task in active_tasks:
        for role, count in task["required_crew"].items():
            crew_required[role] = crew_required.get(role, 0) + count

    # Apply weekend modifier, then cap at available pool
    weekend = _is_weekend(day)
    crew_on_site: dict[str, int] = {}
    for role, needed in crew_required.items():
        if weekend:
            needed = max(1, round(needed * WEEKEND_CREW_FACTOR))
        available = crew_pool.get(role, 0)
        crew_on_site[role] = min(needed, available)

    total_workers = sum(crew_on_site.values())

    # --- Material consumption ---
    materials_consumed: dict[str, float] = {}
    for task in active_tasks:
        for mat, units_per_day in task["required_materials"].items():
            factor = WEEKEND_CREW_FACTOR if weekend else 1.0
            materials_consumed[mat] = (
                materials_consumed.get(mat, 0) + units_per_day * factor
            )

    # --- Material inventory at yard zones ---
    delivery_schedule: dict[str, list[int]] | None = None
    if project_config and project_config.get("deliveries"):
        delivery_schedule = _parse_delivery_schedule(project_config["deliveries"])

    days_since_restock = (day - 1) % RESTOCK_CYCLE_DAYS
    next_restock = RESTOCK_CYCLE_DAYS - days_since_restock
    material_inventory = _build_material_inventory(
        zones, day, materials_consumed, days_since_restock, next_restock, rng,
        delivery_schedule=delivery_schedule,
    )

    # --- Crane / equipment status ---
    crane_config_list: list[dict[str, Any]] | None = None
    if project_config and project_config.get("cranes"):
        crane_config_list = project_config["cranes"]

    crane_needed = any("crane_operator" in t["required_crew"] for t in active_tasks)
    cranes = _build_crane_status(zones, crane_needed, rng, day, crane_config_list)

    equipment_events: list[dict[str, Any]] = []
    for crane in cranes:
        if crane["breakdown"]:
            equipment_events.append({
                "equipment": crane["id"],
                "event": "breakdown",
                "impact": "critical" if crane_needed else "none",
            })

    # --- Distribute workers to physical zones ---
    workers = _distribute_workers_to_zones(zones, crew_on_site, rng)

    return {
        "day": day,
        "project_duration": project_duration,
        "phase": current_phase,
        "weekend": weekend,
        "total_workers": total_workers,
        "active_tasks": [
            {
                "name": t["name"],
                "phase": t["phase"],
                "is_critical": t["is_critical"],
                "earliest_start": t["earliest_start"],
                "earliest_finish": t["earliest_finish"],
            }
            for t in active_tasks
        ],
        "crew_on_site": crew_on_site,
        "crew_required": crew_required,
        "materials_consumed": {k: round(v, 1) for k, v in materials_consumed.items()},
        "equipment_status": cranes,
        "equipment_events": equipment_events,
        "days_since_restock": days_since_restock,
        "next_restock_day": day + next_restock,
        "schedule": {
            "makespan": cp_result["makespan"],
            "critical_path": cp_result["critical_path"],
            "schedule_risk": cp_result["schedule_risk"],
            "overrun_days": cp_result["overrun_days"],
        },
        # Backward-compatible keys consumed by frontend + AI agent
        "workers": workers,
        "materials": material_inventory,
        "cranes": list(cranes),
    }


def _empty_state(day: int, config: dict) -> dict[str, Any]:
    return {
        "day": day,
        "project_duration": config["project_duration"],
        "phase": "pre_construction",
        "weekend": _is_weekend(day),
        "total_workers": 0,
        "active_tasks": [],
        "crew_on_site": {},
        "crew_required": {},
        "materials_consumed": {},
        "equipment_status": [],
        "equipment_events": [],
        "days_since_restock": 0,
        "next_restock_day": day,
        "schedule": {
            "makespan": 0,
            "critical_path": [],
            "schedule_risk": False,
            "overrun_days": 0,
        },
        "workers": {},
        "materials": {},
        "cranes": [],
    }


def _determine_phase(
    active_tasks: list[dict],
    day: int,
    schedule: list[dict],
) -> str:
    if active_tasks:
        phase_rank = {p: i for i, p in enumerate(PHASES)}
        return max(
            (t["phase"] for t in active_tasks),
            key=lambda p: phase_rank.get(p, 0),
        )
    if schedule and day > max(t["earliest_finish"] for t in schedule):
        return "complete"
    return "pre_construction"


def _parse_delivery_schedule(
    deliveries: list[dict[str, Any]],
) -> dict[str, list[int]]:
    """Build a map of zone_id → sorted list of scheduled delivery days."""
    schedule: dict[str, list[int]] = {}
    for d in deliveries:
        zone_key = d.get("zone") or d.get("zoneId") or ""
        raw_days = d.get("scheduledDays", "")
        if not raw_days or not zone_key:
            continue
        days = sorted(
            int(s.strip()) for s in str(raw_days).split(",") if s.strip().isdigit()
        )
        schedule.setdefault(zone_key, []).extend(days)
    for k in schedule:
        schedule[k] = sorted(set(schedule[k]))
    return schedule


def _build_material_inventory(
    zones: list[dict],
    day: int,
    consumption: dict[str, float],
    days_since_restock: int,
    next_restock: int,
    rng: random.Random,
    delivery_schedule: dict[str, list[int]] | None = None,
) -> dict[str, Any]:
    """Track material inventory across material-yard zones."""
    mat_zones = [z for z in zones if z["type"] == "materials"]
    if not mat_zones:
        return {}

    inventory: dict[str, Any] = {}
    mat_keys = list(MATERIAL_CATALOG.keys())

    for i, z in enumerate(mat_zones):
        zid = _zone_id(z)

        restock_today = False
        zone_next_restock = next_restock
        zone_days_since = days_since_restock

        if delivery_schedule:
            zone_delivery_days = delivery_schedule.get(zid, [])
            if zone_delivery_days:
                restock_today = day in zone_delivery_days
                future = [d for d in zone_delivery_days if d > day]
                zone_next_restock = (future[0] - day) if future else 999
                past = [d for d in zone_delivery_days if d <= day]
                zone_days_since = (day - past[-1]) if past else day
            else:
                zone_days_since = days_since_restock
                zone_next_restock = next_restock
        else:
            restock_today = days_since_restock == 0

        assigned = [k for j, k in enumerate(mat_keys)
                     if j % max(1, len(mat_zones)) == i]
        if not assigned:
            assigned = [mat_keys[i % len(mat_keys)]]

        for mat_key in assigned:
            cat = MATERIAL_CATALOG[mat_key]
            daily_use = consumption.get(mat_key, 0)

            if restock_today:
                quantity = float(cat["max_stock"])
            else:
                cumulative = daily_use * zone_days_since
                noise = rng.uniform(-daily_use * 0.1, daily_use * 0.1) if daily_use > 0 else 0
                quantity = max(0.0, cat["max_stock"] - cumulative + noise)

            pct = (quantity / cat["max_stock"] * 100) if cat["max_stock"] else 0

            mat_id = f"mat-{zid}-{mat_key}"
            inventory[mat_id] = {
                "name": cat["name"],
                "key": mat_key,
                "unit": cat["unit"],
                "quantity": round(quantity, 1),
                "max_quantity": cat["max_stock"],
                "daily_usage": round(daily_use, 1),
                "pct_remaining": round(pct, 1),
                "days_until_restock": zone_next_restock,
                "zone_id": zid,
            }

    return inventory


def _build_crane_status(
    zones: list[dict],
    crane_needed: bool,
    rng: random.Random,
    day: int = 1,
    crane_config_list: list[dict[str, Any]] | None = None,
) -> list[dict[str, Any]]:
    crane_day_lookup: dict[tuple[int, int], dict] = {}
    if crane_config_list:
        for cc in crane_config_list:
            pos = cc.get("position") or {}
            cx, cy = pos.get("x"), pos.get("y")
            if cx is not None and cy is not None:
                crane_day_lookup[(int(cx), int(cy))] = cc

    cranes: list[dict[str, Any]] = []
    for z in zones:
        if z["type"] != "crane":
            continue
        zid = _zone_id(z)
        col = chr(65 + int(z["x"]))
        row = int(z["y"]) + 1
        broken = rng.random() < EQUIPMENT_BREAKDOWN_PROB

        config_active = True
        if crane_day_lookup:
            cc = crane_day_lookup.get((int(z["x"]), int(z["y"])))
            if cc:
                arrival = cc.get("arrivalDay", 1)
                departure = cc.get("departureDay", 9999)
                config_active = arrival <= day <= departure
            else:
                config_active = True

        cranes.append({
            "id": zid,
            "name": f"Crane ({col}{row})",
            "x": z["x"],
            "y": z["y"],
            "swing_radius": CRANE_SWING_RADIUS,
            "zone_id": zid,
            "active": config_active and not broken,
            "needed": crane_needed,
            "breakdown": broken,
        })
    return cranes


def _distribute_workers_to_zones(
    zones: list[dict],
    crew: dict[str, int],
    rng: random.Random,
) -> dict[str, Any]:
    """Map task-driven crew counts to physical worker zones on the grid."""
    worker_zones = [z for z in zones if z["type"] == "workers"]
    if not worker_zones or not crew:
        return {}

    total = sum(crew.values())
    workers: dict[str, Any] = {}

    for idx, z in enumerate(worker_zones):
        zid = _zone_id(z)
        if idx < len(worker_zones) - 1:
            share = max(0, total // len(worker_zones) + rng.randint(-2, 2))
        else:
            already = sum(w["count"] for w in workers.values())
            share = max(0, total - already)

        role_counts: dict[str, int] = {}
        for role, n in crew.items():
            per_zone = max(1, round(n / len(worker_zones)))
            role_counts[role] = per_zone
        workers[zid] = {"count": share, "roles": role_counts}

    return workers


# ── 4. Conflict and Risk Detection ────────────────────────────────────────────


def detect_conflicts(
    zones: list[dict[str, Any]],
    state: dict[str, Any],
    day: int,
    project_duration: int = 180,
    critical_path: list[str] | None = None,
    project_config: dict[str, Any] | None = None,
) -> list[dict[str, Any]]:
    """Detect schedule, resource, equipment, and spatial conflicts.

    Six task-level risk categories plus four zone-level spatial checks.
    Every conflict dict contains at minimum:
        type, severity, message, cost_impact, schedule_impact_days, suggestion
    """
    conflicts: list[dict[str, Any]] = []
    cp_result = calculate_critical_path(BASE_TASKS, project_duration)
    if critical_path is None:
        critical_path = cp_result["critical_path"]
    schedule = cp_result["schedule"]
    schedule_by_name = {t["name"]: t for t in schedule}

    active_names = {t["name"] for t in state.get("active_tasks", [])}
    crew_on_site = state.get("crew_on_site", {})
    crew_required = state.get("crew_required", {})

    # ── 4a. Schedule overrun risk ─────────────────────────────────────
    if cp_result["schedule_risk"]:
        conflicts.append({
            "type": "schedule_risk",
            "severity": "HIGH",
            "message": (
                f"Day {day}: Critical path spans {cp_result['makespan']} days "
                f"but project duration is {project_duration} days — "
                f"{cp_result['overrun_days']}-day overrun projected."
            ),
            "cost_impact": _usd(cp_result["overrun_days"] * 12_000),
            "schedule_impact_days": cp_result["overrun_days"],
            "suggestion": (
                f"Fast-track by overlapping tasks, add overtime shifts, or "
                f"negotiate a schedule extension. Focus acceleration on: "
                f"{', '.join(critical_path[:3])}."
            ),
        })

    # ── 4b. Critical-path task not running when it should be ──────────
    for cp_name in critical_path:
        task = schedule_by_name.get(cp_name)
        if not task:
            continue
        if task["earliest_start"] < day <= task["earliest_finish"]:
            if cp_name not in active_names:
                slip = day - task["earliest_start"]
                conflicts.append({
                    "type": "schedule_risk",
                    "severity": "HIGH",
                    "message": (
                        f"Day {day}: Critical path task '{cp_name}' should be "
                        f"active (ES day {task['earliest_start']}, EF day "
                        f"{task['earliest_finish']}) but is not running. "
                        f"Potential {slip}-day slip."
                    ),
                    "cost_impact": _usd(slip * 8_500),
                    "schedule_impact_days": slip,
                    "suggestion": (
                        f"Immediately mobilize crew for '{cp_name}'. Every day "
                        f"of delay on a critical path task pushes the entire "
                        f"project completion date."
                    ),
                })

    # ── 4c. Crew shortage ─────────────────────────────────────────────
    for role, needed in crew_required.items():
        on_site = crew_on_site.get(role, 0)
        if on_site >= needed * 0.6:
            continue
        shortfall = needed - on_site
        productivity_loss = round((shortfall / max(needed, 1)) * 100)
        conflicts.append({
            "type": "crew_shortage",
            "severity": "HIGH" if productivity_loss > 30 else "MEDIUM",
            "message": (
                f"Day {day}: Need {needed} {role}(s) for active tasks but "
                f"only {on_site} on site ({shortfall} short). Productivity "
                f"reduced by ~{productivity_loss}%."
            ),
            "cost_impact": _usd(shortfall * 350 + productivity_loss * 100),
            "schedule_impact_days": max(1, shortfall),
            "suggestion": (
                f"Call in {shortfall} additional {role}(s) or redistribute "
                f"from non-critical tasks. Consider overtime for existing crew."
            ),
        })

    # ── 4d. Material shortage ─────────────────────────────────────────
    for mat_id, mat in state.get("materials", {}).items():
        if mat.get("pct_remaining", 100) >= MATERIAL_LOW_THRESHOLD_PCT * 100:
            continue
        daily = mat.get("daily_usage", 0)
        quantity = mat.get("quantity", 0)
        days_left = quantity / daily if daily > 0 else 999
        restock_in = mat.get("days_until_restock", RESTOCK_CYCLE_DAYS)

        if days_left >= restock_in:
            continue

        severity = "HIGH" if days_left < 3 else "MEDIUM"
        conflicts.append({
            "type": "material_shortage",
            "severity": severity,
            "message": (
                f"Day {day}: {mat['name']} at {mat.get('pct_remaining', 0)}% "
                f"({quantity} {mat.get('unit', '')} remaining). At "
                f"{daily} {mat.get('unit', '')}/day burn rate, stockout in "
                f"~{days_left:.1f} days. Next restock in {restock_in} days."
            ),
            "cost_impact": _usd(4_500 + (100 - mat.get("pct_remaining", 0)) * 150),
            "schedule_impact_days": max(0, round(restock_in - days_left)),
            "suggestion": (
                f"Place emergency order for {mat['name']} with expedited "
                f"delivery (2–3 business days). Reduce consumption by "
                f"deferring non-critical work using this material."
            ),
        })

    # ── 4e. Equipment risk (crane breakdown during active need) ───────
    for event in state.get("equipment_events", []):
        if event.get("event") == "breakdown" and event.get("impact") == "critical":
            conflicts.append({
                "type": "equipment_risk",
                "severity": "HIGH",
                "message": (
                    f"Day {day}: {event['equipment']} has broken down while "
                    f"crane operations are required for active tasks. Heavy "
                    f"lifts and steel erection are halted."
                ),
                "cost_impact": _usd(12_000),
                "schedule_impact_days": 1,
                "suggestion": (
                    f"Deploy maintenance crew to {event['equipment']} "
                    f"immediately. If repair exceeds 4 hours, mobilize a "
                    f"backup crane or reschedule lifts to next available day."
                ),
            })

    # ── 4f. Parallel task conflicts (same crew type contention) ───────
    if len(state.get("active_tasks", [])) > 1:
        role_demands: dict[str, list[str]] = {}
        for t_info in state.get("active_tasks", []):
            task = schedule_by_name.get(t_info["name"], {})
            for role in task.get("required_crew", {}):
                role_demands.setdefault(role, []).append(t_info["name"])

        pool = DEFAULT_CREW_POOL
        for role, task_names in role_demands.items():
            if len(task_names) < 2:
                continue
            total_needed = sum(
                schedule_by_name.get(n, {}).get("required_crew", {}).get(role, 0)
                for n in task_names
            )
            available = pool.get(role, 0)
            if total_needed <= available:
                continue
            conflicts.append({
                "type": "parallel_task_conflict",
                "severity": "MEDIUM",
                "message": (
                    f"Day {day}: Tasks {' and '.join(task_names)} both need "
                    f"{role}s — combined demand of {total_needed} exceeds "
                    f"available pool of {available}."
                ),
                "cost_impact": _usd((total_needed - available) * 500),
                "schedule_impact_days": 0,
                "suggestion": (
                    f"Stagger {task_names[0]} and {task_names[1]}, or bring in "
                    f"{total_needed - available} temporary {role}(s) to run "
                    f"both tasks in parallel."
                ),
            })

    # ── 4g. Cascade delay ─────────────────────────────────────────────
    for cp_name in critical_path:
        if cp_name not in active_names:
            continue
        task = schedule_by_name.get(cp_name, {})
        for role, needed in task.get("required_crew", {}).items():
            on_site = crew_on_site.get(role, 0)
            if on_site >= needed:
                continue
            ratio = on_site / max(needed, 1)
            if ratio >= 0.5:
                continue
            extension = round(task.get("duration_days", 0) * (1 - ratio))
            conflicts.append({
                "type": "cascade_delay",
                "severity": "HIGH",
                "message": (
                    f"Day {day}: Critical task '{cp_name}' is under-crewed "
                    f"({on_site}/{needed} {role}s). At current manning the "
                    f"task extends ~{extension} days, cascading to all "
                    f"downstream tasks."
                ),
                "cost_impact": _usd(extension * 5_000),
                "schedule_impact_days": extension,
                "suggestion": (
                    f"Critical path task — every day it slips pushes the whole "
                    f"project. Get {needed - on_site} more {role}(s) on site "
                    f"today or authorize overtime."
                ),
            })

    # ── 4h. Milestone impacts ─────────────────────────────────────────
    if project_config and project_config.get("milestones"):
        for ms in project_config["milestones"]:
            ms_day = ms.get("day")
            if ms_day is None or int(ms_day) != day:
                continue
            impact = ms.get("impact", "")
            ms_name = ms.get("name", "Milestone")

            if impact == "No Heavy Equipment":
                conflicts.append({
                    "type": "milestone_restriction",
                    "severity": "LOW",
                    "message": (
                        f"Day {day}: {ms_name} — no heavy equipment "
                        f"operations scheduled"
                    ),
                    "cost_impact": 0,
                    "schedule_impact_days": 0,
                    "suggestion": (
                        f"Ensure all crane and heavy machinery operations are "
                        f"suspended for '{ms_name}'."
                    ),
                })
            elif impact == "Delivery Blackout":
                conflicts.append({
                    "type": "milestone_delivery_blackout",
                    "severity": "MEDIUM",
                    "message": (
                        f"Day {day}: {ms_name} — delivery blackout in effect. "
                        f"Any deliveries scheduled today must be rescheduled."
                    ),
                    "cost_impact": _usd(3_000),
                    "schedule_impact_days": 1,
                    "suggestion": (
                        f"Reschedule all material deliveries away from day "
                        f"{day} due to '{ms_name}'. Coordinate with suppliers "
                        f"for alternate dates."
                    ),
                })
            elif impact == "Critical Path Event":
                pass

    # ── Zone-based spatial conflicts ──────────────────────────────────
    _detect_zone_conflicts(zones, state, day, conflicts)

    conflicts.sort(
        key=lambda c: (
            {"HIGH": 0, "MEDIUM": 1, "LOW": 2}.get(c["severity"], 3),
            -c["cost_impact"],
        ),
    )
    return conflicts


# ── Zone-level spatial checks (crane swing, density, overlap) ─────────────────


def _detect_zone_conflicts(
    zones: list[dict[str, Any]],
    state: dict[str, Any],
    day: int,
    conflicts: list[dict[str, Any]],
) -> None:
    active_cranes = [c for c in state.get("cranes", []) if c.get("active")]
    worker_zones = [z for z in zones if z["type"] == "workers"]
    road_zones = [z for z in zones if z["type"] == "road"]

    # Crane swing → worker zone overlap
    for crane in active_cranes:
        for wz in worker_zones:
            wz_id = _zone_id(wz)
            if wz_id == crane["zone_id"]:
                continue
            worker_count = state.get("workers", {}).get(wz_id, {}).get("count", 0)
            if worker_count == 0:
                continue
            dist = _dist(crane["x"], crane["y"], wz["x"], wz["y"])
            intrusion = crane["swing_radius"] + 0.5 - dist
            if intrusion <= 0:
                continue
            label = _zone_label(wz)
            severity = "HIGH" if intrusion > 0.8 or worker_count > 15 else "MEDIUM"
            conflicts.append({
                "type": "crane_worker_overlap",
                "severity": severity,
                "message": (
                    f"Day {day}: {crane['name']} swing radius intrudes "
                    f"{intrusion:.1f} cells into {label} where {worker_count} "
                    f"workers are active. Risk of struck-by incident per "
                    f"OSHA 29 CFR 1926.1400."
                ),
                "cost_impact": _usd(intrusion * 12_000 + worker_count * 350),
                "schedule_impact_days": 0,
                "suggestion": (
                    f"Establish an exclusion zone around {crane['name']}'s "
                    f"swing path or install a zoned anti-collision system to "
                    f"lock out rotation toward {label} while workers are present."
                ),
            })

    # Crane swing → access road
    for crane in active_cranes:
        for road in road_zones:
            dist = _dist(crane["x"], crane["y"], road["x"], road["y"])
            intrusion = crane["swing_radius"] + 0.5 - dist
            if intrusion <= 0:
                continue
            label = _zone_label(road)
            conflicts.append({
                "type": "crane_road_blocked",
                "severity": "HIGH",
                "message": (
                    f"Day {day}: {crane['name']} swing arc extends over "
                    f"{label}, blocking delivery trucks and emergency "
                    f"vehicle access."
                ),
                "cost_impact": _usd(intrusion * 9_000 + 3_500),
                "schedule_impact_days": 0,
                "suggestion": (
                    f"Program a swing-limit switch on {crane['name']} to "
                    f"prevent rotation over {label}. Coordinate lifts with "
                    f"logistics so road closures stay under 15 min."
                ),
            })

    # Worker density exceeding OSHA limit
    for wz in worker_zones:
        wz_id = _zone_id(wz)
        count = state.get("workers", {}).get(wz_id, {}).get("count", 0)
        if count <= OSHA_MAX_WORKERS_PER_ZONE:
            continue
        excess = count - OSHA_MAX_WORKERS_PER_ZONE
        label = _zone_label(wz)
        severity = "HIGH" if excess > 5 else "MEDIUM"
        conflicts.append({
            "type": "worker_density_exceeded",
            "severity": severity,
            "message": (
                f"Day {day}: {label} has {count} workers on site, exceeding "
                f"the OSHA-recommended density limit of "
                f"{OSHA_MAX_WORKERS_PER_ZONE} by {excess}. Elevated risk of "
                f"congestion-related injuries (29 CFR 1926.20)."
            ),
            "cost_impact": _usd(excess * 800 + 2_000),
            "schedule_impact_days": 0,
            "suggestion": (
                f"Split {label} into sub-zones with a dedicated safety "
                f"corridor, or stagger crew shifts so no more than "
                f"{OSHA_MAX_WORKERS_PER_ZONE} workers overlap at any time."
            ),
        })

    # Two cranes with overlapping swing radii
    for i, c1 in enumerate(active_cranes):
        for c2 in active_cranes[i + 1:]:
            dist = _dist(c1["x"], c1["y"], c2["x"], c2["y"])
            safe = c1["swing_radius"] + c2["swing_radius"] + CRANE_SAFETY_BUFFER
            overlap = safe - dist
            if overlap <= 0:
                continue
            severity = "HIGH" if overlap > 1.0 else "MEDIUM"
            conflicts.append({
                "type": "crane_overlap",
                "severity": severity,
                "message": (
                    f"Day {day}: {c1['name']} and {c2['name']} are "
                    f"{dist:.1f} cells apart but require {safe:.1f} cells "
                    f"clearance. Overlap of {overlap:.1f} cells creates a "
                    f"collision risk per ASME B30.3."
                ),
                "cost_impact": _usd(overlap * 25_000 + 5_000),
                "schedule_impact_days": 0,
                "suggestion": (
                    f"Install an anti-collision system on both cranes. Define "
                    f"non-overlapping swing sectors and assign a dedicated "
                    f"signal person when both operate simultaneously."
                ),
            })

    # Crane to building distance check
    building_zones = [z for z in zones if z['type'] == 'building']
    for crane in active_cranes:
        for bz in building_zones:
            dist = _dist(crane['x'], crane['y'], bz['x'], bz['y'])
            if dist > 12:
                conflicts.append({
                    'type': 'crane_out_of_reach',
                    'severity': 'HIGH',
                    'message': f"Day {day}: {crane['name']} is {dist:.1f} grid cells from the building — outside effective lift radius. Materials cannot be placed on upper floors.",
                    'cost_impact': _usd(8000),
                    'schedule_impact_days': 2,
                    'suggestion': f"Relocate {crane['name']} within 10 grid cells of the building footprint to maintain full lift coverage.",
                })
            elif dist < 2:
                conflicts.append({
                    'type': 'crane_too_close',
                    'severity': 'MEDIUM',
                    'message': f"Day {day}: {crane['name']} is only {dist:.1f} grid cells from the building foundation — risk of structural interference and reduced boom angle.",
                    'cost_impact': _usd(4000),
                    'schedule_impact_days': 0,
                    'suggestion': f"Move {crane['name']} at least 2 grid cells from the building foundation for safe operations.",
                })


# ── 6. Scenario Comparison ────────────────────────────────────────────────────


def compare_scenarios(
    scenario_a_config: dict[str, Any],
    scenario_b_config: dict[str, Any],
    zones: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """Run two project configurations through the full simulation and compare.

    Returns side-by-side metrics for each scenario:
        total_duration, total_cost, critical_path_tasks,
        highest_risk_day, bottleneck_task
    """
    zones = zones or []
    results: dict[str, Any] = {}

    for label, config in [("scenario_a", scenario_a_config),
                          ("scenario_b", scenario_b_config)]:
        duration = config.get("project_duration", 180)
        cp = calculate_critical_path(BASE_TASKS, duration)

        total_cost = 0
        peak_risk_day = 0
        peak_risk_cost = 0
        bottleneck_task: str | None = None
        max_slip = 0

        sample_interval = max(1, duration // 60)
        sample_days = list(range(1, duration + 1, sample_interval))
        if duration not in sample_days:
            sample_days.append(duration)

        for d in sample_days:
            state = run_simulation_tick(zones, d, duration, config)
            day_conflicts = detect_conflicts(
                zones, state, d, duration, cp["critical_path"],
                project_config=config,
            )
            day_cost = sum(c["cost_impact"] for c in day_conflicts)
            total_cost += day_cost

            if day_cost > peak_risk_cost:
                peak_risk_cost = day_cost
                peak_risk_day = d

            for c in day_conflicts:
                slip = c.get("schedule_impact_days", 0)
                if slip > max_slip:
                    max_slip = slip
                    msg = c.get("message", "")
                    if "'" in msg:
                        parts = msg.split("'")
                        if len(parts) >= 2:
                            bottleneck_task = parts[1]

        results[label] = {
            "total_duration": cp["makespan"],
            "total_cost": _usd(total_cost),
            "critical_path_tasks": cp["critical_path"],
            "schedule_risk": cp["schedule_risk"],
            "overrun_days": cp["overrun_days"],
            "highest_risk_day": peak_risk_day,
            "bottleneck_task": bottleneck_task,
        }

    return results
