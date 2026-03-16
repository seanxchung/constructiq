"""ConstructIQ — AI Site Manager Agent

Powered by Claude via the Anthropic API. Provides two capabilities:
  1. Proactive conflict analysis with actionable alerts
  2. Conversational Q&A grounded in live simulation state
"""

from __future__ import annotations

import json
import math
import os
from typing import Any

from anthropic import Anthropic
from dotenv import load_dotenv

load_dotenv()

client = Anthropic(api_key=os.getenv("ANTHROPIC_API_KEY"))

MODEL = "claude-sonnet-4-20250514"

SITE_MANAGER_SYSTEM_PROMPT = """You are Mike Callahan, senior superintendent, 25 years in the field. Started as an ironworker, ran jobs for Turner, Skanska, and Kiewit ranging from $50M to $400M. You have seen every version of every problem a construction site can produce and nothing rattles you.

Background you draw on when needed (do not volunteer unless asked):
- OSHA 30-Hour certified, 29 CFR 1926 chapter and verse
- Crane ops: ASME B30.3, B30.5 — you know swing radii, load charts, and anti-collision spacing
- Real cost knowledge: crane downtime $8K–$15K/day, serious OSHA citation $15,876, expedited material premium 15–30%
- Material procurement lead times, supplier pricing, restock logistics

Communication style — this is non-negotiable:
- Calm. You have seen worse. Everything has a fix; just pick the right one.
- Never use all caps. Never say "immediate shutdown", "stop work", or "emergency halt." Those phrases cause panic on a job site and you do not cause panic.
- One sentence on the situation. One sentence on the impact in days or dollars. One realistic next step. That is a standard response.
- Plain language. Short sentences. No corporate filler, no drama, no exclamation marks.
- Prioritize by risk: life safety, then schedule, then cost — but state it matter-of-factly.

Conflict alert format (follow exactly for each conflict):
  Line 1: Conflict type and location
  Line 2: Impact — days of delay or dollar exposure
  Line 3: Recommended action — one specific, realistic step
Maximum 5 lines total for a standard alert. Separate multiple conflicts with a blank line.

Expanding on detail:
- If the user asks for more information, then provide specifics: relevant OSHA citations (e.g. 1926.550, 1926.251), ASME references, realistic cost breakdowns, schedule math.
- Keep expanded answers under 12 lines unless the user explicitly asks for a full report.

Realism rules — never break these:
- Never recommend something physically impossible on a real job site. You cannot "remove all cranes immediately," you cannot "shut down the entire site" over a single conflict, you cannot relocate a tower crane in an afternoon.
- Every action you recommend must be something a foreman could actually execute in the timeframe you state.
- If a problem is serious, the realistic step is to set up a exclusion zone, re-sequence lifts, shift crews, or call for an engineering review — not to halt production.

Site parameters:
- Max worker density: 25 per zone (OSHA)
- Material restock cycle: 14 days
- You have real-time simulation data: worker counts, material levels, crane positions, detected conflicts
- Reference only zones, cranes, and equipment present in the data you receive — never invent assets

Grounding rules:
- Use the simulation data provided. Do not fabricate numbers.
- Lead with the highest-risk item when multiple conflicts exist.
- Give a concrete next step, not a suggestion to "consider" or "evaluate."
- If asked about cost, give a dollar range based on what you know. Never say "it depends" without a number."""


def _format_state_context(simulation_state: dict[str, Any], day: int) -> str:
    """Build a concise text snapshot of the simulation for the LLM context window."""
    lines = [f"=== SITE STATUS: DAY {day} ==="]

    lines.append(f"\nTotal workers on site: {simulation_state.get('total_workers', 'N/A')}")
    lines.append(f"Days since last restock: {simulation_state.get('days_since_restock', 'N/A')}")
    lines.append(f"Next restock scheduled: Day {simulation_state.get('next_restock_day', 'N/A')}")

    workers = simulation_state.get("workers", {})
    if workers:
        lines.append("\n-- WORKER DEPLOYMENT --")
        for zone_id, info in workers.items():
            roles_str = ", ".join(f"{r} x{c}" for r, c in info.get("roles", {}).items())
            lines.append(f"  {zone_id}: {info['count']} workers [{roles_str}]")

    materials = simulation_state.get("materials", {})
    if materials:
        lines.append("\n-- MATERIAL INVENTORY --")
        for mat_id, mat in materials.items():
            flag = " ⚠ LOW" if mat["pct_remaining"] < 20 else ""
            days_left = round(mat["quantity"] / mat["daily_usage"], 1) if mat["daily_usage"] > 0 else "∞"
            lines.append(
                f"  {mat['name']} ({mat['zone_id']}): "
                f"{mat['quantity']}/{mat['max_quantity']} {mat['unit']} "
                f"({mat['pct_remaining']}% remaining, ~{days_left} days left){flag}"
            )

    cranes = simulation_state.get("cranes", [])
    if cranes:
        lines.append("\n-- CRANE STATUS --")
        for cr in cranes:
            status = "ACTIVE" if cr["active"] else "IDLE"
            lines.append(
                f"  {cr['name']} ({cr['id']}): {status} | "
                f"pos ({cr['x']}, {cr['y']}) | swing {cr['swing_radius']}m | {cr['zone_id']}"
            )

    return "\n".join(lines)


def _format_conflicts(conflicts: list[dict[str, Any]]) -> str:
    """Format conflict list into a readable block for the LLM."""
    if not conflicts:
        return "No active conflicts detected."

    lines = [f"=== {len(conflicts)} ACTIVE CONFLICT(S) ===\n"]
    for i, c in enumerate(conflicts, 1):
        lines.append(f"[{i}] {c['severity']} — {c['type'].upper().replace('_', ' ')}")
        lines.append(f"    {c['message']}")
        lines.append(f"    Estimated cost impact: ${c['cost_impact']:,}")
        lines.append(f"    Suggested action: {c['suggestion']}")
        lines.append("")

    return "\n".join(lines)


def analyze_conflicts(
    conflicts: list[dict[str, Any]],
    simulation_state: dict[str, Any],
    day: int,
) -> str:
    """Generate a proactive site-manager alert from detected conflicts.

    Returns a direct, actionable message prioritized by risk severity —
    the kind of briefing a superintendent would deliver at a morning standup.
    """
    if not conflicts:
        return (
            f"Day {day} — all clear. No safety or logistics conflicts detected. "
            "Crews are within density limits, materials are stocked, cranes are clear. "
            "Good day to push production."
        )

    state_context = _format_state_context(simulation_state, day)
    conflict_context = _format_conflicts(conflicts)

    high_count = sum(1 for c in conflicts if c["severity"] == "HIGH")
    total_cost = sum(c["cost_impact"] for c in conflicts)

    user_prompt = f"""Site state and detected conflicts below. Give me your read on the situation using the conflict alert format: conflict type and location on line 1, impact on line 2, recommended action on line 3. Max 5 lines per conflict. Lead with highest risk, close with total dollar exposure in one line.

{state_context}

{conflict_context}

Summary: {len(conflicts)} conflicts ({high_count} high severity). Total estimated cost exposure: ${total_cost:,}.

Reference actual crane IDs, zone names, worker counts, and material levels from the data. Keep it brief — what needs to happen first, what can wait, and the bottom-line number."""

    response = client.messages.create(
        model=MODEL,
        max_tokens=1024,
        system=SITE_MANAGER_SYSTEM_PROMPT,
        messages=[{"role": "user", "content": user_prompt}],
    )

    return response.content[0].text


def chat_with_agent(
    message: str,
    simulation_state: dict[str, Any],
    day: int,
    current_conflicts: list[dict[str, Any]] | None = None,
) -> str:
    """Answer a project manager's question using live simulation state as context."""
    state_context = _format_state_context(simulation_state, day)
    conflict_context = _format_conflicts(current_conflicts or [])

    user_prompt = f"""Here is the current site state you have access to:

{state_context}

{conflict_context}

The project manager asks: {message}

Answer using the actual data above. Cite zone names, material quantities, crane IDs, worker counts. If cost is involved give a dollar range. If the user asks for detail, include OSHA or ASME references. Factor in any active conflicts. Keep it brief unless they ask you to expand."""

    response = client.messages.create(
        model=MODEL,
        max_tokens=1024,
        system=SITE_MANAGER_SYSTEM_PROMPT,
        messages=[{"role": "user", "content": user_prompt}],
    )

    return response.content[0].text


def _build_layout_prompt(
    building_description: str,
    num_cranes: int,
    num_workers: int,
    num_material_zones: int,
    project_duration: int,
    grid_size: int,
) -> str:
    """Build the prompt that asks Claude for an optimal site layout as JSON."""
    col_labels = [chr(ord("A") + i) for i in range(grid_size)]
    col_list = ", ".join(col_labels)
    num_worker_zones = math.ceil(num_workers / 25)

    return f"""You are Sean Chung, senior site superintendent. A project manager needs you to generate an optimal construction site layout.

PROJECT PARAMETERS:
- Building: {building_description}
- Cranes: {num_cranes}
- Place {num_worker_zones} worker zones, each representing 25 workers (total workforce: {num_workers} workers)
- Material staging zones: {num_material_zones}
- Project duration: {project_duration} days
- Grid: {grid_size}x{grid_size} (columns {col_list}, rows 1–{grid_size})

CONSTRUCTION SITE PLANNING PRINCIPLES:
1. Buildings define the work target — place them centrally so all support zones can reach them.
2. Cranes must be placed for maximum coverage of the building footprint. Position them adjacent to the building on different sides so their swing radii collectively cover the full structure.
3. Worker staging zones should be near the building but outside crane swing radii to avoid struck-by hazards.
4. Material staging zones should be near access roads for easy truck delivery and near cranes for efficient hoisting.
5. Access roads should run along the site boundary to create a continuous logistics loop without crossing active work areas.

RESPOND WITH ONLY A JSON ARRAY of zone objects. No explanation, no markdown fences, no extra text — just the raw JSON array.

Each zone object must have exactly these fields:
- "type": one of "crane", "workers", "materials", "road", "building"
- "x": integer 0–{grid_size - 1} (column index)
- "y": integer 0–{grid_size - 1} (row index)
- "reason": brief explanation (one sentence) of why this zone is placed here

Generate the full layout now."""


def generate_optimal_layout(
    building_description: str,
    num_cranes: int,
    num_workers: int,
    num_material_zones: int,
    project_duration: int,
    grid_size: int = 12,
) -> dict[str, Any]:
    """Ask Claude to produce an optimal construction site layout on a grid.

    Returns a dict with:
      - zones: list of zone dicts (type, x, y, reason)
      - summary: string describing the layout rationale
    """
    prompt = _build_layout_prompt(
        building_description,
        num_cranes,
        num_workers,
        num_material_zones,
        project_duration,
        grid_size,
    )

    def _request_layout(prompt_text: str) -> list[dict[str, Any]]:
        response = client.messages.create(
            model=MODEL,
            max_tokens=4096,
            messages=[{"role": "user", "content": prompt_text}],
        )
        raw = response.content[0].text.strip()
        return json.loads(raw)

    try:
        zones = _request_layout(prompt)
    except (json.JSONDecodeError, ValueError):
        strict_prompt = (
            prompt
            + "\n\nCRITICAL: Your previous response was not valid JSON. "
            "Return ONLY the raw JSON array — no markdown code fences, "
            "no commentary, no trailing commas. Start with '[' and end with ']'."
        )
        zones = _request_layout(strict_prompt)

    num_worker_zones = math.ceil(num_workers / 25)

    type_counts: dict[str, int] = {}
    for z in zones:
        type_counts[z["type"]] = type_counts.get(z["type"], 0) + 1

    summary_parts = [
        f"Layout generated for: {building_description}.",
        f"Grid: {grid_size}x{grid_size} with {len(zones)} total zones placed.",
    ]
    for zone_type, count in sorted(type_counts.items()):
        if zone_type == "workers":
            summary_parts.append(
                f"  Worker zones: {count} (representing {num_workers} workers at 25 per zone)"
            )
        else:
            summary_parts.append(f"  {zone_type}: {count}")
    summary_parts.append(
        f"Project duration: {project_duration} days. "
        "Cranes positioned for maximum building coverage; "
        "workers staged outside swing radii; "
        "materials placed near roads for delivery access."
    )

    return {
        "zones": zones,
        "summary": "\n".join(summary_parts),
    }
