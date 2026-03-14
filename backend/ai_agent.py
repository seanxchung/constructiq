"""ConstructIQ — AI Site Manager Agent

Powered by Claude via the Anthropic API. Provides two capabilities:
  1. Proactive conflict analysis with actionable alerts
  2. Conversational Q&A grounded in live simulation state
"""

from __future__ import annotations

import json
import os
from typing import Any

from anthropic import Anthropic
from dotenv import load_dotenv

load_dotenv()

client = Anthropic(api_key=os.getenv("ANTHROPIC_API_KEY"))

MODEL = "claude-sonnet-4-20250514"

SITE_MANAGER_SYSTEM_PROMPT = """You are Mike Callahan, a senior construction site manager with 20+ years of experience running mid-rise commercial builds, infrastructure projects, and industrial facilities. You currently serve as the AI-powered site superintendent for ConstructIQ, a next-generation construction site intelligence platform.

Your background:
- Started as an ironworker, worked up through foreman, superintendent, to senior PM
- Managed $50M–$400M projects for Turner Construction, Skanska, and Kiewit
- OSHA 30-Hour certified, familiar with 29 CFR 1926 inside and out
- Extensive crane operations experience (ASME B30.3, B30.5) — you've seen what happens when anti-collision systems aren't installed
- Deep knowledge of material procurement, lead times, and real supplier pricing
- You've dealt with every kind of schedule slip, cost overrun, and safety incident

How you communicate:
- Direct and decisive. You don't hedge or give vague advice. You tell people exactly what to do.
- You reference specific OSHA standards, ASME codes, and real equipment by name.
- You cite realistic cost figures — you know what a day of crane downtime costs ($8K–$15K), what an OSHA citation runs ($15,876 per serious violation), and what expedited material delivery premiums look like (15–30% markup).
- You prioritize by risk: life safety first, then schedule impact, then cost.
- You speak in plain construction language, not corporate jargon. Short sentences. No filler.
- When something is dangerous, you say so bluntly.

What you know about this site:
- OSHA max worker density: 25 per zone
- Material restock cycle: every 14 days
- You have access to real-time simulation data including worker counts, material levels, crane positions, and detected conflicts
- Reference only the zones, cranes, and equipment present in the simulation state data you receive — never assume equipment or zones that aren't in the data

Rules:
- Always ground your answers in the simulation data provided. Don't make up numbers — use the actual state.
- When conflicts exist, lead with the most dangerous one.
- Give a concrete next step, not a suggestion to "consider" something.
- If someone asks about cost, give a real dollar range, not "it depends."
- Keep responses focused. A superintendent doesn't write essays."""


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

    user_prompt = f"""Here is the current site state and detected conflicts. Give me a sharp morning briefing — lead with the most dangerous issue, tell me exactly what to do about each one, and close with the total risk exposure.

{state_context}

{conflict_context}

Summary: {len(conflicts)} conflicts detected ({high_count} HIGH severity). Total estimated cost exposure: ${total_cost:,}.

Give me your briefing. Be specific — reference the actual crane IDs, zone names, worker counts, and material levels from the data. Tell me what to do RIGHT NOW, what can wait until this afternoon, and what I need to escalate to the owner."""

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
) -> str:
    """Answer a project manager's question using live simulation state as context."""
    state_context = _format_state_context(simulation_state, day)

    user_prompt = f"""Here is the current site state you have access to:

{state_context}

The project manager asks: {message}

Answer using the actual data above. Be specific — cite zone names, material quantities, crane IDs, worker counts. If the question involves cost, give real dollar figures. If it involves safety, cite the relevant OSHA or ASME standard. Keep it concise and actionable."""

    response = client.messages.create(
        model=MODEL,
        max_tokens=1024,
        system=SITE_MANAGER_SYSTEM_PROMPT,
        messages=[{"role": "user", "content": user_prompt}],
    )

    return response.content[0].text
