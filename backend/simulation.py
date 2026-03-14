"""ConstructIQ — Construction Site Simulation Engine

Deterministic per-day simulation of construction site activity with
automated conflict detection aligned to OSHA safety standards.
"""

from __future__ import annotations

import math
import random
from typing import Any

# ── Simulation constants ─────────────────────────────────────────────────────

OSHA_MAX_WORKERS_PER_ZONE = 25
MATERIAL_LOW_THRESHOLD_PCT = 0.20          # 20% of max stock
RESTOCK_CYCLE_DAYS = 14
TARGET_CAPACITY_PCT = 0.80                 # workers fill to 80% of zone cap
CRANE_SAFETY_BUFFER_M = 5.0               # required gap between swing arcs
WORKER_ROLES = [
    "Ironworker", "Carpenter", "Electrician", "Plumber",
    "Equipment Operator", "Laborer", "Mason", "Welder",
    "Sheet Metal Worker", "Foreman",
]

# ── Default site layout ─────────────────────────────────────────────────────
# Realistic mid-rise commercial build — 4 work zones + 2 access roads.
# Positions are in metres on a 120 × 100 site grid.

DEFAULT_ZONES: list[dict[str, Any]] = [
    {
        "id": "zone-A",
        "name": "Foundation East",
        "type": "work_zone",
        "x": 20.0, "y": 40.0, "radius": 18.0,
        "max_workers": 30,
        "cranes": [
            {"id": "TC-001", "name": "Liebherr LTM 1300", "x": 28.0, "y": 48.0, "swing_radius": 22.0},
        ],
        "materials": [
            {"id": "mat-concrete", "name": "Ready-Mix Concrete", "unit": "m³", "max_quantity": 500, "daily_usage": 32},
            {"id": "mat-rebar", "name": "Steel Rebar (#5 bar)", "unit": "tons", "max_quantity": 80, "daily_usage": 4.5},
        ],
    },
    {
        "id": "zone-B",
        "name": "Structural Core",
        "type": "work_zone",
        "x": 60.0, "y": 40.0, "radius": 20.0,
        "max_workers": 35,
        "cranes": [
            {"id": "TC-002", "name": "Potain MDT 389", "x": 55.0, "y": 35.0, "swing_radius": 25.0},
            {"id": "TC-003", "name": "Potain MCT 85", "x": 68.0, "y": 48.0, "swing_radius": 18.0},
        ],
        "materials": [
            {"id": "mat-steel", "name": "Structural Steel (W-beams)", "unit": "tons", "max_quantity": 120, "daily_usage": 6.0},
            {"id": "mat-bolts", "name": "High-Strength Bolts (A325)", "unit": "boxes", "max_quantity": 200, "daily_usage": 12},
        ],
    },
    {
        "id": "zone-C",
        "name": "MEP Rough-In",
        "type": "work_zone",
        "x": 45.0, "y": 80.0, "radius": 15.0,
        "max_workers": 28,
        "cranes": [],
        "materials": [
            {"id": "mat-conduit", "name": "EMT Conduit (3/4\")", "unit": "sticks", "max_quantity": 1500, "daily_usage": 85},
            {"id": "mat-pipe", "name": "Copper Pipe (Type L)", "unit": "m", "max_quantity": 2000, "daily_usage": 95},
        ],
    },
    {
        "id": "zone-D",
        "name": "Exterior Envelope",
        "type": "work_zone",
        "x": 90.0, "y": 50.0, "radius": 16.0,
        "max_workers": 20,
        "cranes": [
            {"id": "TC-004", "name": "Terex CTT 472", "x": 95.0, "y": 55.0, "swing_radius": 20.0},
        ],
        "materials": [
            {"id": "mat-curtainwall", "name": "Curtain Wall Panels", "unit": "panels", "max_quantity": 300, "daily_usage": 8},
            {"id": "mat-sealant", "name": "Structural Sealant", "unit": "tubes", "max_quantity": 400, "daily_usage": 22},
        ],
    },
    {
        "id": "road-N",
        "name": "North Access Road",
        "type": "access_road",
        "x": 50.0, "y": 5.0, "radius": 10.0,
        "max_workers": 0,
        "cranes": [],
        "materials": [],
    },
    {
        "id": "road-E",
        "name": "East Haul Road",
        "type": "access_road",
        "x": 110.0, "y": 50.0, "radius": 10.0,
        "max_workers": 0,
        "cranes": [],
        "materials": [],
    },
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


# ── 1. run_simulation_tick ───────────────────────────────────────────────────

def run_simulation_tick(
    zones: list[dict[str, Any]],
    day: int,
) -> dict[str, Any]:
    """Simulate one calendar day of construction site activity.

    Workers fill each work zone to ~80 % of its capacity (with daily
    variance and occasional surges).  Materials deplete every day and
    restock to full every 14 days.  Cranes are tracked as active /
    inactive with their swing radius.

    Parameters
    ----------
    zones : list[dict]
        Site layout (use ``DEFAULT_ZONES`` or provide your own).
    day : int, 1-indexed
        The calendar day to simulate.

    Returns
    -------
    dict  –  Full site state keyed by ``workers``, ``materials``,
             ``cranes``, plus summary fields.  Deterministic for any
             given *(zones, day)* pair.
    """
    rng = random.Random(day)

    days_since_restock = (day - 1) % RESTOCK_CYCLE_DAYS
    next_restock = RESTOCK_CYCLE_DAYS - days_since_restock

    # ── Workers ───────────────────────────────────────────────────────
    workers: dict[str, Any] = {}
    total_workers = 0

    for zone in zones:
        if zone["type"] == "access_road":
            continue

        target = int(zone["max_workers"] * TARGET_CAPACITY_PCT)
        variance = max(1, target // 6)
        count = target + rng.randint(-variance, variance)

        if rng.random() < 0.18:
            count += rng.randint(3, 10)
        count = max(0, count)

        role_pool = rng.sample(
            WORKER_ROLES, k=min(len(WORKER_ROLES), max(count, 1)),
        )
        roles = [rng.choice(role_pool) for _ in range(count)]

        workers[zone["id"]] = {
            "count": count,
            "roles": _tally(roles),
        }
        total_workers += count

    # ── Materials ─────────────────────────────────────────────────────
    materials: dict[str, Any] = {}

    for zone in zones:
        for mat in zone.get("materials", []):
            consumed = mat["daily_usage"] * days_since_restock
            noise = rng.uniform(
                -mat["daily_usage"] * 0.10,
                 mat["daily_usage"] * 0.10,
            )
            quantity = max(0.0, mat["max_quantity"] - consumed + noise)
            pct = (quantity / mat["max_quantity"] * 100) if mat["max_quantity"] else 0

            materials[mat["id"]] = {
                "name": mat["name"],
                "unit": mat["unit"],
                "quantity": round(quantity, 1),
                "max_quantity": mat["max_quantity"],
                "daily_usage": mat["daily_usage"],
                "pct_remaining": round(pct, 1),
                "days_until_restock": next_restock,
                "zone_id": zone["id"],
            }

    # ── Cranes ────────────────────────────────────────────────────────
    cranes: list[dict[str, Any]] = []

    for zone in zones:
        for cr in zone.get("cranes", []):
            cranes.append({
                "id": cr["id"],
                "name": cr["name"],
                "x": cr["x"],
                "y": cr["y"],
                "swing_radius": cr["swing_radius"],
                "zone_id": zone["id"],
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
       occupied work zone it is *not* assigned to.
    2. **crane_road_blocked** – crane swing arc covers an access road.
    3. **worker_density_exceeded** – zone headcount exceeds OSHA limit
       of 25 workers.
    4. **material_low** – material stock is below 20 % of capacity.
    5. **crane_overlap** – two active cranes are closer than the sum of
       their swing radii plus a safety buffer.

    Each conflict dict contains:
        type, severity ("HIGH" | "MEDIUM"), message, cost_impact, suggestion
    """
    conflicts: list[dict[str, Any]] = []
    zone_map = {z["id"]: z for z in zones}
    active_cranes = [c for c in state["cranes"] if c["active"]]

    # ── 1. Crane swing overlapping worker zones ───────────────────────
    for crane in active_cranes:
        for zone in zones:
            if zone["type"] == "access_road":
                continue
            if zone["id"] == crane["zone_id"]:
                continue

            worker_count = state["workers"].get(zone["id"], {}).get("count", 0)
            if worker_count == 0:
                continue

            dist = _dist(crane["x"], crane["y"], zone["x"], zone["y"])
            intrusion = crane["swing_radius"] + zone["radius"] - dist
            if intrusion <= 0:
                continue

            severity = "HIGH" if intrusion > 10 or worker_count > 15 else "MEDIUM"
            conflicts.append({
                "type": "crane_worker_overlap",
                "severity": severity,
                "message": (
                    f"Day {day}: {crane['name']} (id: {crane['id']}) swing "
                    f"radius intrudes {intrusion:.1f} m into {zone['name']} "
                    f"where {worker_count} workers are active. Risk of "
                    f"struck-by incident per OSHA 29 CFR 1926.1400."
                ),
                "cost_impact": _usd(intrusion * 1_200 + worker_count * 350),
                "suggestion": (
                    f"Establish a {intrusion:.0f} m exclusion zone around "
                    f"{crane['name']}'s swing path or install a zoned "
                    f"anti-collision system to lock out rotation toward "
                    f"{zone['name']} while workers are present."
                ),
            })

    # ── 2. Crane blocking access road ─────────────────────────────────
    road_zones = [z for z in zones if z["type"] == "access_road"]
    for crane in active_cranes:
        for road in road_zones:
            dist = _dist(crane["x"], crane["y"], road["x"], road["y"])
            intrusion = crane["swing_radius"] + road["radius"] - dist
            if intrusion <= 0:
                continue

            conflicts.append({
                "type": "crane_road_blocked",
                "severity": "HIGH",
                "message": (
                    f"Day {day}: {crane['name']} (id: {crane['id']}) swing "
                    f"arc extends {intrusion:.1f} m over {road['name']}, "
                    f"blocking delivery trucks and emergency vehicle access."
                ),
                "cost_impact": _usd(intrusion * 900 + 3_500),
                "suggestion": (
                    f"Program a swing-limit switch on {crane['name']} to "
                    f"prevent rotation over {road['name']}. Alternatively, "
                    f"coordinate lifts with the logistics team so road "
                    f"closures stay under 15 min per site access "
                    f"requirements."
                ),
            })

    # ── 3. Worker density exceeding OSHA limit (25 per zone) ──────────
    for zone in zones:
        if zone["type"] == "access_road":
            continue
        count = state["workers"].get(zone["id"], {}).get("count", 0)
        if count <= OSHA_MAX_WORKERS_PER_ZONE:
            continue

        excess = count - OSHA_MAX_WORKERS_PER_ZONE
        severity = "HIGH" if excess > 5 else "MEDIUM"
        conflicts.append({
            "type": "worker_density_exceeded",
            "severity": severity,
            "message": (
                f"Day {day}: {zone['name']} has {count} workers on site, "
                f"exceeding the OSHA-recommended density limit of "
                f"{OSHA_MAX_WORKERS_PER_ZONE} by {excess}. Elevated risk of "
                f"congestion-related injuries (29 CFR 1926.20)."
            ),
            "cost_impact": _usd(excess * 800 + 2_000),
            "suggestion": (
                f"Split {zone['name']} into sub-zones with a dedicated "
                f"safety corridor, or stagger crew shifts so no more than "
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
        zone_name = zone_map.get(mat["zone_id"], {}).get("name", mat["zone_id"])
        severity = "HIGH" if mat["pct_remaining"] < 10 or days_left < 2 else "MEDIUM"

        conflicts.append({
            "type": "material_low",
            "severity": severity,
            "message": (
                f"Day {day}: {mat['name']} at {zone_name} is down to "
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
                f"{zone_name}."
            ),
        })

    # ── 5. Two cranes with overlapping radii ──────────────────────────
    for i, c1 in enumerate(active_cranes):
        for c2 in active_cranes[i + 1 :]:
            dist = _dist(c1["x"], c1["y"], c2["x"], c2["y"])
            safe_distance = (
                c1["swing_radius"] + c2["swing_radius"] + CRANE_SAFETY_BUFFER_M
            )
            overlap = safe_distance - dist
            if overlap <= 0:
                continue

            severity = "HIGH" if overlap > 12 else "MEDIUM"
            conflicts.append({
                "type": "crane_overlap",
                "severity": severity,
                "message": (
                    f"Day {day}: {c1['name']} and {c2['name']} are "
                    f"{dist:.1f} m apart but require {safe_distance:.1f} m "
                    f"clearance (includes {CRANE_SAFETY_BUFFER_M} m safety "
                    f"buffer). Overlap of {overlap:.1f} m creates a "
                    f"collision risk per ASME B30.3."
                ),
                "cost_impact": _usd(overlap * 2_500 + 5_000),
                "suggestion": (
                    f"Install an anti-collision system (e.g., AMCS or "
                    f"Zeppelin ZAC) on both cranes. As an immediate measure, "
                    f"define non-overlapping swing sectors and assign a "
                    f"dedicated signal person when both cranes operate "
                    f"simultaneously."
                ),
            })

    conflicts.sort(key=lambda c: (0 if c["severity"] == "HIGH" else 1, -c["cost_impact"]))
    return conflicts
