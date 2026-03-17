import os
from typing import Any, Optional

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from supabase import create_client, Client

from simulation import (
    run_simulation_tick,
    detect_conflicts,
    calculate_critical_path,
    compare_scenarios,
    BASE_TASKS,
    DEFAULT_PROJECT_CONFIG,
)
from ai_agent import analyze_conflicts, chat_with_agent, generate_optimal_layout

load_dotenv()
supabase: Client = create_client(
    os.environ["SUPABASE_URL"],
    os.environ["SUPABASE_KEY"],
)

app = FastAPI(title="ConstructIQ", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Request / Response models ────────────────────────────────────────────────

class SimulateRequest(BaseModel):
    day: int = Field(..., ge=1, description="Calendar day to simulate (1-indexed)")
    zones: Optional[list[dict[str, Any]]] = Field(
        None, description="Zone layout from the frontend board"
    )
    project_duration: int = Field(
        180, description="Total project duration in days (30/60/90/180/365)"
    )
    project_config: Optional[dict[str, Any]] = Field(
        None, description="Optional project configuration overrides"
    )


class ConflictDetail(BaseModel):
    type: str
    severity: str
    message: str
    cost_impact: int
    schedule_impact_days: int = 0
    suggestion: str


class SimulateResponse(BaseModel):
    simulation: dict[str, Any]
    conflicts: list[ConflictDetail]
    ai_analysis: Optional[str] = None


class ScenarioConfig(BaseModel):
    project_duration: int = 180
    crew_size: Optional[dict[str, int]] = None
    daily_budget: float = 45_000.0
    project_type: str = "commercial"


class CompareRequest(BaseModel):
    scenario_a: ScenarioConfig
    scenario_b: ScenarioConfig
    zones: Optional[list[dict[str, Any]]] = None


class ChatRequest(BaseModel):
    message: str = Field(..., min_length=1, description="Question for the AI site manager")
    day: int = Field(..., ge=1)
    zones: Optional[list[dict[str, Any]]] = None
    project_duration: int = 180
    current_conflicts: Optional[list[dict[str, Any]]] = None


class ChatResponse(BaseModel):
    reply: str


class OptimizeRequest(BaseModel):
    building_description: str = Field(..., min_length=1, description="Description of the building / project")
    num_cranes: int = Field(..., ge=1, description="Number of cranes on site")
    num_workers: int = Field(..., ge=1, description="Number of worker zones")
    num_material_zones: int = Field(..., ge=1, description="Number of material storage zones")
    project_duration: int = Field(..., ge=1, description="Total project duration in days")
    grid_size: int = Field(12, ge=4, description="Grid dimension (NxN)")


class SaveProjectRequest(BaseModel):
    name: str = Field(..., min_length=1, description="Project name")
    zones: list[dict[str, Any]] = Field(..., description="Zone layout from the frontend board")
    project_duration: int = Field(..., ge=1, description="Total project duration in days")
    config: Optional[dict[str, Any]] = Field(None, description="Full configure-tab state (phases, cranes, deliveries, workforce, equipment, milestones)")


class LoadProjectRequest(BaseModel):
    project_id: str = Field(..., description="ID of the project to load")


# ── Routes ───────────────────────────────────────────────────────────────────

@app.get("/")
def root():
    return {"status": "ConstructIQ backend running"}


@app.post("/api/simulate", response_model=SimulateResponse)
def simulate(req: SimulateRequest):
    zones = req.zones or []

    if not zones:
        return SimulateResponse(
            simulation={},
            conflicts=[],
            ai_analysis=(
                "No zones placed yet. Design your construction site first — "
                "add cranes, worker zones, materials, and access roads to the "
                "grid, then run the simulation."
            ),
        )

    state = run_simulation_tick(
        zones, req.day, req.project_duration, req.project_config,
    )
    cp = calculate_critical_path(BASE_TASKS, req.project_duration)
    conflicts = detect_conflicts(
        zones, state, req.day, req.project_duration, cp["critical_path"],
        project_config=req.project_config,
    )

    ai_analysis = None
    if conflicts:
        try:
            ai_analysis = analyze_conflicts(conflicts, state, req.day)
        except Exception as exc:
            ai_analysis = f"AI analysis unavailable: {exc}"

    return SimulateResponse(
        simulation=state,
        conflicts=[ConflictDetail(**c) for c in conflicts],
        ai_analysis=ai_analysis,
    )


@app.post("/api/compare")
def scenario_compare(req: CompareRequest):
    config_a = req.scenario_a.model_dump(exclude_none=True)
    config_b = req.scenario_b.model_dump(exclude_none=True)
    return compare_scenarios(config_a, config_b, req.zones or [])


@app.post("/api/ai/chat", response_model=ChatResponse)
def ai_chat(req: ChatRequest):
    zones = req.zones or []
    state = run_simulation_tick(zones, req.day, req.project_duration)

    try:
        reply = chat_with_agent(req.message, state, req.day, req.current_conflicts)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"AI agent error: {exc}")

    return ChatResponse(reply=reply)


@app.post("/api/ai/optimize")
def ai_optimize(req: OptimizeRequest):
    try:
        result = generate_optimal_layout(
            building_description=req.building_description,
            num_cranes=req.num_cranes,
            num_workers=req.num_workers,
            num_material_zones=req.num_material_zones,
            project_duration=req.project_duration,
            grid_size=req.grid_size,
        )
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"AI optimization error: {exc}")

    return result


# ── Projects ──────────────────────────────────────────────────────────────────

@app.get("/api/projects")
def list_projects():
    response = (
        supabase.table("projects")
        .select("id, name, zone_count, created_at, zones, project_duration")
        .order("created_at", desc=True)
        .execute()
    )
    return response.data


@app.post("/api/projects/save")
def save_project(req: SaveProjectRequest):
    row = {
        "name": req.name,
        "zones": req.zones,
        "project_duration": req.project_duration,
        "zone_count": len(req.zones),
    }
    if req.config is not None:
        row["config"] = req.config
    try:
        response = supabase.table("projects").insert(row).execute()
    except Exception:
        row.pop("config", None)
        response = supabase.table("projects").insert(row).execute()
    if not response.data:
        raise HTTPException(status_code=500, detail="Failed to save project")
    return response.data[0]


@app.post("/api/projects/load")
def load_project(req: LoadProjectRequest):
    result = (
        supabase.table("projects")
        .select("*")
        .eq("id", req.project_id)
        .single()
        .execute()
    )
    if not result.data:
        raise HTTPException(status_code=404, detail="Project not found")
    return result.data


@app.delete("/api/projects/{project_id}")
def delete_project(project_id: str):
    response = supabase.table("projects").delete().eq("id", project_id).execute()
    if not response.data:
        raise HTTPException(status_code=404, detail="Project not found")
    return {"ok": True}
