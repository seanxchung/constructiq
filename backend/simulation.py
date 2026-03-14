"""ConstructIQ — Construction Site Simulation Engine

Deterministic per-day simulation of construction site activity with
automated conflict detection aligned to OSHA safety standards.

Accepts simplified frontend zones: {type, x, y, capacity, metadata}.
Zone types: "crane", "workers", "materials", "road", "building".
Coordinates are grid-cell indices on a 12×12 board.
"""

from __future__ import annotations

import math
import random
from typing import Any

# ── Simulation constants ─────────────────────────────────────────────────────

OSHA_MAX_WORKERS_PER_ZONE = 25
MATERIAL_LOW_THRESHOLD_PCT = 0.20
RESTOCK_CYCLE_DAYS = 14
TARGET_CAPACITY_PCT = 0.80
CRANE_SWING_RADIUS = 1.5       # grid cells
CRANE_SAFETY_BUFFER = 0.5      # grid cells

WORKER_ROLES = [
    "Ironworker", "Carpenter", "Electrician", "Plumber",
    "Equipment Operator", "Laborer", "Mason", "Welder",
    "Sheet Metal Worker", "Foreman",
]

MATERIAL_TEMPLATES = [
    {"name": "Ready-Mix Concrete", "unit": "m³", "max_quantity": 500, "daily_usage": 32},
    {"name": "Steel Rebar (#5 bar)", "unit": "tons", "max_quantity": 80, "daily_usage": 4.5},
    {"name": "Structural Steel (W-beams)", "unit": "tons", "max_quantity": 120, "daily_usage": 6.0},
    {"name": "EMT Conduit (3/4\")", "unit": "sticks", "max_quantity": 1500, "daily_usage": 85},
    {"name": "Copper Pipe (Type L)", "unit": "m", "max_quantity": 2000, "daily_usage": 95},
    {"name": "Lumber (2×4 SPF)", "unit": "board-ft", "max_quantity": 3000, "daily_usage": 110},
]

# ── Default site layout (simple format, used when frontend sends no zones) ───

DEFAULT_ZONES: list[dict[str, Any]] = [
    {"type": "road", "x": 0, "y": 6, "capacity": 0, "metadata": {}},
    {"type": "road", "x": 1, "y": 6, "capacity": 0, "metadata": {}},
    {"type": "road", "x": 2, "y": 6, "capacity": 0, "metadata": {}},
    {"type": "crane", "x": 3, "y": 3, "capacity": 25, "metadata": {}},
    {"type": "crane", "x": 8, "y": 4, "capacity": 25, "metadata": {}},
    {"type": "workers", "x": 4, "y": 3, "capacity": 25, "metadata": {}},
    {"type": "workers", "x": 5, "y": 3, "capacity": 25, "metadata": {}},
    {"type": "workers", "x": 8, "y": 5, "capacity": 25, "metadata": {}},
    {"type": "materials", "x": 6, "y": 8, "capacity": 25, "metadata": {}},
    {"type": "materials", "x": 7, "y": 8, "capacity": 25, "metadata": {}},
    {"type": "building", "x": 5, "y": 5, "capacity": 25, "metadata": {}},
    {"type": "building", "x": 6, "y": 5, "capacity": 25, "metadata": {}},
    {"type": "building", "x": 5, "y": 4, "capacity": 25, "metadata": {}},
    {"type": "building", "x": 6, "y": 4, "capacity": 25, "metadata": {}},
]

# ── Helpers ──────────────────────────────────────────────────────────────────

def _dist(x1: float, y1: float, x2: float, y2: float) -> float:
    return math.hypot(x2 - x1, y2 - y1)


def _usd(amount: float) -> int:
    return int(round(amount))


def _tally(items: list[str]) -> dict[str, int]:
    counts: dict[str, int] = {}
    for item in items:
        counts[item] = counts.get(item, 0) + 1
    return counts


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


# ── 1. run_simulation_tick ───────────────────────────────────────────────────

def run_simulation_tick(
    zones: list[dict[str, Any]],
    day: int,
) -> dict[str, Any]:
    """Simulate one calendar day of construction site activity.

    Workers fill each worker zone to ~80% of capacity (with daily
    variance and occasional surges).  Materials deplete every day and
    restock every 14 days.  Cranes are tracked as active / inactive.

    Parameters
    ----------
    zones : list[dict]
        Simplified frontend zones — each dict has keys
        ``type``, ``x``, ``y``, ``capacity``, ``metadata``.
    day : int, 1-indexed
        The calendar day to simulate.

    Returns
    -------
    dict  –  Full site state keyed by ``workers``, ``materials``,
             ``cranes``, plus summary fields.  Deterministic for any
             given *(zones, day)* pair.  Returns an empty state when
             *zones* is empty.
    """
    if not zones:
        return {
            "day": day,
            "total_workers": 0,
            "days_since_restock": 0,
            "next_restock_day": day,
            "workers": {},
            "materials": {},
            "cranes": [],
        }

    rng = random.Random(day)

    days_since_restock = (day - 1) % RESTOCK_CYCLE_DAYS
    next_restock = RESTOCK_CYCLE_DAYS - days_since_restock

    # ── Workers ───────────────────────────────────────────────────────
    workers: dict[str, Any] = {}
    total_workers = 0

    for z in zones:
        if z["type"] != "workers":
            continue

        zid = _zone_id(z)
        cap = z.get("capacity", OSHA_MAX_WORKERS_PER_ZONE)
        target = int(cap * TARGET_CAPACITY_PCT)
        variance = max(1, target // 6)
        count = target + rng.randint(-variance, variance)

        if rng.random() < 0.18:
            count += rng.randint(3, 10)
        count = max(0, count)

        role_pool = rng.sample(
            WORKER_ROLES, k=min(len(WORKER_ROLES), max(count, 1)),
        )
        roles = [rng.choice(role_pool) for _ in range(count)]

        workers[zid] = {
            "count": count,
            "roles": _tally(roles),
        }
        total_workers += count

    # ── Materials ─────────────────────────────────────────────────────
    materials: dict[str, Any] = {}

    for z in zones:
        if z["type"] != "materials":
            continue

        zid = _zone_id(z)
        template = MATERIAL_TEMPLATES[
            (int(z["x"]) + int(z["y"]) * 7) % len(MATERIAL_TEMPLATES)
        ]

        consumed = template["daily_usage"] * days_since_restock
        noise = rng.uniform(
            -template["daily_usage"] * 0.10,
             template["daily_usage"] * 0.10,
        )
        quantity = max(0.0, template["max_quantity"] - consumed + noise)
        pct = (quantity / template["max_quantity"] * 100) if template["max_quantity"] else 0

        mat_id = f"mat-{zid}"
        materials[mat_id] = {
            "name": template["name"],
            "unit": template["unit"],
            "quantity": round(quantity, 1),
            "max_quantity": template["max_quantity"],
            "daily_usage": template["daily_usage"],
            "pct_remaining": round(pct, 1),
            "days_until_restock": next_restock,
            "zone_id": zid,
        }

    # ── Cranes ────────────────────────────────────────────────────────
    cranes: list[dict[str, Any]] = []

    for z in zones:
        if z["type"] != "crane":
            continue

        zid = _zone_id(z)
        cranes.append({
            "id": zid,
            "name": f"Crane ({chr(65 + int(z['x']))}{int(z['y']) + 1})",
            "x": z["x"],
            "y": z["y"],
            "swing_radius": CRANE_SWING_RADIUS,
            "zone_id": zid,
            "active": rng.random() < 0.85,
        })

    return {
        "day": day,
        "total_workers": total_workers,
        "days_since_restock": days_since_restock,
        "next_restock_day": day + next_restock,
        "workers": workers,
        "materials": materials,
        "cranes": cranes,
    }


# ── 2. detect_conflicts ─────────────────────────────────────────────────────

def detect_conflicts(
    zones: list[dict[str, Any]],
    state: dict[str, Any],
    day: int,
) -> list[dict[str, Any]]:
    """Detect safety and logistics conflicts in the current site state.

    Five conflict categories are checked:

    1. **crane_worker_overlap** – crane swing radius intrudes on an
       adjacent worker zone.
    2. **crane_road_blocked** – crane swing arc covers an access road cell.
    3. **worker_density_exceeded** – zone headcount exceeds OSHA limit
       of 25 workers.
    4. **material_low** – material stock is below 20% of capacity.
    5. **crane_overlap** – two active cranes are closer than the sum of
       their swing radii plus a safety buffer.

    Each conflict dict contains:
        type, severity ("HIGH" | "MEDIUM"), message, cost_impact, suggestion
    """
    conflicts: list[dict[str, Any]] = []
    zone_by_id = {_zone_id(z): z for z in zones}
    active_cranes = [c for c in state["cranes"] if c["active"]]

    worker_zones = [z for z in zones if z["type"] == "workers"]
    road_zones = [z for z in zones if z["type"] == "road"]

    # ── 1. Crane swing overlapping worker zones ───────────────────────
    for crane in active_cranes:
        for wz in worker_zones:
            wz_id = _zone_id(wz)
            if wz_id == crane["zone_id"]:
                continue

            worker_count = state["workers"].get(wz_id, {}).get("count", 0)
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
                "suggestion": (
                    f"Establish an exclusion zone around {crane['name']}'s "
                    f"swing path or install a zoned anti-collision system to "
                    f"lock out rotation toward {label} while workers are "
                    f"present."
                ),
            })

    # ── 2. Crane blocking access road ─────────────────────────────────
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
                "suggestion": (
                    f"Program a swing-limit switch on {crane['name']} to "
                    f"prevent rotation over {label}. Alternatively, coordinate "
                    f"lifts with the logistics team so road closures stay "
                    f"under 15 min per site access requirements."
                ),
            })

    # ── 3. Worker density exceeding OSHA limit (25 per zone) ──────────
    for wz in worker_zones:
        wz_id = _zone_id(wz)
        count = state["workers"].get(wz_id, {}).get("count", 0)
        if count <= OSHA_MAX_WORKERS_PER_ZONE:
            continue

        excess = count - OSHA_MAX_WORKERS_PER_ZONE
        label = _zone_label(wz)
        severity = "HIGH" if excess > 5 else "MEDIUM"
        conflicts.append({
            "type": "worker_density_exceeded",
            "severity": severity,
            "message": (
                f"Day {day}: {label} has {count} workers on site, "
                f"exceeding the OSHA-recommended density limit of "
                f"{OSHA_MAX_WORKERS_PER_ZONE} by {excess}. Elevated risk of "
                f"congestion-related injuries (29 CFR 1926.20)."
            ),
            "cost_impact": _usd(excess * 800 + 2_000),
            "suggestion": (
                f"Split {label} into sub-zones with a dedicated safety "
                f"corridor, or stagger crew shifts so no more than "
                f"{OSHA_MAX_WORKERS_PER_ZONE} workers overlap at any time."
            ),
        })

    # ── 4. Material stock below 20% ───────────────────────────────────
    for mat_id, mat in state["materials"].items():
        if mat["pct_remaining"] >= MATERIAL_LOW_THRESHOLD_PCT * 100:
            continue

        days_left = (
            mat["quantity"] / mat["daily_usage"]
            if mat["daily_usage"] > 0 else 999
        )
        zone_label = (
            _zone_label(zone_by_id[mat["zone_id"]])
            if mat["zone_id"] in zone_by_id
            else mat["zone_id"]
        )
        severity = "HIGH" if mat["pct_remaining"] < 10 or days_left < 2 else "MEDIUM"

        conflicts.append({
            "type": "material_low",
            "severity": severity,
            "message": (
                f"Day {day}: {mat['name']} at {zone_label} is down to "
                f"{mat['quantity']} {mat['unit']} ({mat['pct_remaining']}% "
                f"remaining). At current burn of {mat['daily_usage']} "
                f"{mat['unit']}/day, stock runs out in ~{days_left:.1f} "
                f"days. Next scheduled restock: day "
                f"{state['next_restock_day']}."
            ),
            "cost_impact": _usd(
                4_500
                + (MATERIAL_LOW_THRESHOLD_PCT * 100 - mat["pct_remaining"]) * 200
            ),
            "suggestion": (
                f"Place an emergency order for {mat['name']} with expedited "
                f"delivery (2–3 business days). If restock is more than "
                f"{max(1, int(days_left))} day(s) away, reduce daily "
                f"consumption by re-sequencing non-critical work in "
                f"{zone_label}."
            ),
        })

    # ── 5. Two cranes with overlapping radii ──────────────────────────
    for i, c1 in enumerate(active_cranes):
        for c2 in active_cranes[i + 1:]:
            dist = _dist(c1["x"], c1["y"], c2["x"], c2["y"])
            safe_distance = (
                c1["swing_radius"] + c2["swing_radius"] + CRANE_SAFETY_BUFFER
            )
            overlap = safe_distance - dist
            if overlap <= 0:
                continue

            severity = "HIGH" if overlap > 1.0 else "MEDIUM"
            conflicts.append({
                "type": "crane_overlap",
                "severity": severity,
                "message": (
                    f"Day {day}: {c1['name']} and {c2['name']} are "
                    f"{dist:.1f} cells apart but require {safe_distance:.1f} "
                    f"cells clearance (includes {CRANE_SAFETY_BUFFER} cell "
                    f"safety buffer). Overlap of {overlap:.1f} cells creates "
                    f"a collision risk per ASME B30.3."
                ),
                "cost_impact": _usd(overlap * 25_000 + 5_000),
                "suggestion": (
                    f"Install an anti-collision system (e.g., AMCS or Zeppelin "
                    f"ZAC) on both cranes. As an immediate measure, define "
                    f"non-overlapping swing sectors and assign a dedicated "
                    f"signal person when both cranes operate simultaneously."
                ),
            })

    conflicts.sort(key=lambda c: (0 if c["severity"] == "HIGH" else 1, -c["cost_impact"]))
    return conflicts
