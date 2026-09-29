"""Quantum routes — Class A Model 20 Quantum Cost DB (dockerised).

GET  /api/v1/quantum/attack-costs/{algo} -> Model 20 lookup
POST /api/v1/quantum/cost               -> Model 20 calculate_quantum_cost()
POST /api/v1/quantum/mosca              -> Mosca inequality X+Y>Z (QARS-adjacent)
"""
import time
from fastapi import APIRouter

from .. import client as C
from ..schemas import GatewayResponse, MoscaRequest, QuantumCostRequest

router = APIRouter(prefix="/api/v1/quantum", tags=["quantum"])


@router.get("/attack-costs/{algo}", response_model=GatewayResponse)
async def attack_costs(algo: str):
    t0 = time.perf_counter()
    q = C.quantum_cost(algo)
    return GatewayResponse(model="quantum_cost", model_id="20",
                           docker_service="class-a-cpu (standalone-fallback)",
                           findings=[], total_findings=0,
                           quantum_risk=q["quantum_risk"], confidence=0.95,
                           latency_ms=C.now_ms(t0),
                           metadata={"algorithm": algo, **q,
                                     "spec": "ECDAT_AI_ML_MODELS §20.8"})


@router.post("/cost", response_model=GatewayResponse)
async def cost(req: QuantumCostRequest):
    t0 = time.perf_counter()
    hit = await C.downstream_infer("quantum_cost", {"algorithm": req.algorithm,
                                                    "key_size": req.key_size})
    q = C.quantum_cost(req.algorithm, req.key_size)
    return GatewayResponse(model="quantum_cost", model_id="20",
                           docker_service=f"class-a-cpu ({hit['_service']})" if hit
                           else "class-a-cpu (standalone-fallback)",
                           findings=[], total_findings=0,
                           quantum_risk=q["quantum_risk"], confidence=0.95,
                           latency_ms=C.now_ms(t0),
                           metadata={"algorithm": req.algorithm, "key_size": req.key_size,
                                     **q, "downstream": bool(hit),
                                     "spec": "ECDAT_AI_ML_MODELS §20.8 calculate_quantum_cost()"})


@router.post("/mosca", response_model=GatewayResponse)
async def mosca(req: MoscaRequest):
    t0 = time.perf_counter()
    exposed = req.shelf_life_years + req.migration_years > req.qday_years
    return GatewayResponse(
        model="qars", model_id="25", docker_service="class-a-cpu (standalone-fallback)",
        findings=[], total_findings=0,
        quantum_risk="CRITICAL" if exposed else "LOW", confidence=0.9,
        latency_ms=C.now_ms(t0),
        metadata={"inequality": "X+Y>Z", "exposed": exposed,
                  "shelf_life": req.shelf_life_years, "migration": req.migration_years,
                  "qday": req.qday_years,
                  "spec": "ECDAT_AI_ML_MODELS §25/§26 (Mosca exposure)"})
