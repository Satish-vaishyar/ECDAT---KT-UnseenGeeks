"""Quantum routes — Class A Model 20 Quantum Cost DB (dockerised).

GET  /api/v1/quantum/attack-costs/{algo} -> Model 20 lookup
POST /api/v1/quantum/cost               -> Model 20 calculate_quantum_cost()
POST /api/v1/quantum/mosca              -> Mosca inequality X+Y>Z (QARS-adjacent)
"""
import time
from fastapi import APIRouter

from .. import client as C
from ..schemas import GatewayResponse, MoscaRequest, QuantumCostRequest, MigrationCostRequest
from src.ecdat.core.all_models_runtime import model20_quantum_cost

router = APIRouter(prefix="/api/v1/quantum", tags=["quantum"])


def _model20_estimate(algorithm: str, key_size: int | None):
    """Model 20 artifact estimate; (output, status, error). Table fallback on failure."""
    try:
        out = model20_quantum_cost(algorithm, key_size)
        if not isinstance(out, dict):
            out = {"result": out}
        return out, "ACTUAL", None
    except Exception as exc:
        return None, "TABLE", str(exc)[:240]


@router.get("/attack-costs/{algo}", response_model=GatewayResponse)
async def attack_costs(algo: str):
    t0 = time.perf_counter()
    q = C.quantum_cost(algo)
    m20, m20_status, m20_error = _model20_estimate(algo, None)
    if isinstance(m20, dict) and m20.get("quantum_risk"):
        q = {**q, "quantum_risk": m20["quantum_risk"]}
    return GatewayResponse(model="quantum_cost", model_id="20",
                           docker_service="all_models/model_20 (artifact-loader)"
                           if m20_status == "ACTUAL"
                           else "class-a-cpu (standalone-fallback)",
                           findings=[], total_findings=0,
                           quantum_risk=q["quantum_risk"], confidence=0.95,
                           latency_ms=C.now_ms(t0),
                           metadata={"algorithm": algo, **q,
                                     "model20_output": m20, "model20_status": m20_status,
                                     "model20_error": m20_error, "artifact_backed": m20_status == "ACTUAL",
                                     "spec": "ECDAT_AI_ML_MODELS §20.8"})


@router.post("/cost", response_model=GatewayResponse)
async def cost(req: QuantumCostRequest):
    t0 = time.perf_counter()
    hit = await C.downstream_infer("quantum_cost", {"algorithm": req.algorithm,
                                                    "key_size": req.key_size})
    q = C.quantum_cost(req.algorithm, req.key_size)
    m20, m20_status, m20_error = _model20_estimate(req.algorithm, req.key_size)
    if isinstance(m20, dict) and m20.get("quantum_risk"):
        q = {**q, "quantum_risk": m20["quantum_risk"]}
    return GatewayResponse(model="quantum_cost", model_id="20",
                           docker_service=f"class-a-cpu ({hit['_service']})" if hit
                           else ("all_models/model_20 (artifact-loader)"
                                 if m20_status == "ACTUAL"
                                 else "class-a-cpu (standalone-fallback)"),
                           findings=[], total_findings=0,
                           quantum_risk=q["quantum_risk"], confidence=0.95,
                           latency_ms=C.now_ms(t0),
                           metadata={"algorithm": req.algorithm, "key_size": req.key_size,
                                     **q, "downstream": bool(hit),
                                     "model20_output": m20, "model20_status": m20_status,
                                     "model20_error": m20_error, "artifact_backed": m20_status == "ACTUAL",
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


@router.get("/migration-cost/{algo}", response_model=GatewayResponse)
async def migration_cost_get(algo: str):
    """Calculate enterprise migration and mitigation costs in USD and INR for an unsafe algorithm."""
    t0 = time.perf_counter()
    mc = C.calculate_migration_cost(algo)
    return GatewayResponse(
        model="migration_cost_engine", model_id="20+25",
        docker_service="class-a-cpu (standalone-fallback)",
        findings=[{
            "id": "MIG-COST-001",
            "algorithm": algo,
            "category": mc.get("family", "CRYPTOGRAPHIC_PRIMITIVE"),
            "status": "MIGRATION_REQUIRED" if mc.get("quantum_risk") != "NONE" else "COMPLIANT",
            "cwe_id": "CWE-326" if "ASYM" in mc.get("family", "") else ("CWE-327" if mc.get("quantum_risk") in ("HIGH", "CRITICAL") else None),
            "line_number": None,
            "code_snippet": None,
            "quantum_risk": mc.get("quantum_risk", "MEDIUM"),
            "confidence": 0.95,
            "recommendation": f"Migrate to {mc.get('recommended_pqc_replacement')} ({mc.get('nist_standard')}). Est. Cost: {mc['costs']['inr']['formatted']} / {mc['costs']['usd']['formatted']}."
        }],
        total_findings=1,
        quantum_risk=mc.get("quantum_risk", "MEDIUM"),
        confidence=0.95,
        latency_ms=C.now_ms(t0),
        metadata={
            "algorithm": algo,
            "migration_cost": mc,
            "spec": "ECDAT Migration & Mitigation Cost Engine (USD + INR)"
        }
    )


@router.post("/migration-cost", response_model=GatewayResponse)
async def migration_cost_post(req: MigrationCostRequest):
    """Calculate enterprise migration and mitigation costs in USD and INR with environmental scaling."""
    t0 = time.perf_counter()
    mc = C.calculate_migration_cost(
        algorithm=req.algorithm,
        key_size=req.key_size,
        instances_count=req.instances_count,
        deployment_env=req.deployment_env
    )
    return GatewayResponse(
        model="migration_cost_engine", model_id="20+25",
        docker_service="class-a-cpu (standalone-fallback)",
        findings=[{
            "id": "MIG-COST-001",
            "algorithm": req.algorithm,
            "category": mc.get("family", "CRYPTOGRAPHIC_PRIMITIVE"),
            "status": "MIGRATION_REQUIRED" if mc.get("quantum_risk") != "NONE" else "COMPLIANT",
            "cwe_id": "CWE-326" if "ASYM" in mc.get("family", "") else ("CWE-327" if mc.get("quantum_risk") in ("HIGH", "CRITICAL") else None),
            "line_number": None,
            "code_snippet": None,
            "quantum_risk": mc.get("quantum_risk", "MEDIUM"),
            "confidence": 0.95,
            "recommendation": f"Migrate to {mc.get('recommended_pqc_replacement')} ({mc.get('nist_standard')}). Est. Cost: {mc['costs']['inr']['formatted']} / {mc['costs']['usd']['formatted']}."
        }],
        total_findings=1,
        quantum_risk=mc.get("quantum_risk", "MEDIUM"),
        confidence=0.95,
        latency_ms=C.now_ms(t0),
        metadata={
            "algorithm": req.algorithm,
            "instances_count": req.instances_count,
            "deployment_env": req.deployment_env,
            "migration_cost": mc,
            "spec": "ECDAT Migration & Mitigation Cost Engine (USD + INR)"
        }
    )
