import os
from typing import Any, Optional

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from supabase import create_client, Client

from simulation import run_simulation_tick, detect_conflicts
from ai_agent import analyze_conflicts, chat_with_agent

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


class ConflictDetail(BaseModel):
    type: str
    severity: str
    message: str
    cost_impact: int
    suggestion: str


class SimulateResponse(BaseModel):
    simulation: dict[str, Any]
    conflicts: list[ConflictDetail]
    ai_analysis: Optional[str] = None


class ChatRequest(BaseModel):
    message: str = Field(..., min_length=1, description="Question for the AI site manager")
    day: int = Field(..., ge=1)
    zones: Optional[list[dict[str, Any]]] = None


class ChatResponse(BaseModel):
    reply: str


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

    state = run_simulation_tick(zones, req.day)
    conflicts = detect_conflicts(zones, state, req.day)

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


@app.post("/api/ai/chat", response_model=ChatResponse)
def ai_chat(req: ChatRequest):
    zones = req.zones or []
    state = run_simulation_tick(zones, req.day)

    try:
        reply = chat_with_agent(req.message, state, req.day)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"AI agent error: {exc}")

    return ChatResponse(reply=reply)
