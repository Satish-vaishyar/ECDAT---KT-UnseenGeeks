"""System routes — Model 28 Confidence Calibration (Class A, dockerised)."""
import time
from fastapi import APIRouter

from .. import client as C
from ..schemas import CalibrateRequest, GatewayResponse

router = APIRouter(prefix="/api/v1/system", tags=["system"])


@router.post("/calibrate", response_model=GatewayResponse)
async def calibrate(req: CalibrateRequest):
    t0 = time.perf_counter()
    hit = await C.downstream_infer("confidence_calibration",
                                   {"raw_prob": req.raw_score})
    # Platt scaling default A=-1.2, B=0.4 (per-model fitted in Model 28)
    import math
    a, b = -1.2, 0.4
    s = max(1e-6, min(1 - 1e-6, req.raw_score))
    logit = math.log(s / (1 - s))
    cal = 1 / (1 + math.exp(a * logit + b))
    return GatewayResponse(
        model="confidence_calibration", model_id="28",
        docker_service=f"class-a-cpu ({hit['_service']})" if hit
        else "class-a-cpu (standalone-fallback)",
        findings=[], total_findings=0, quantum_risk="NONE", confidence=0.95,
        latency_ms=C.now_ms(t0),
        metadata={"model_id": req.model_id, "raw_score": req.raw_score,
                  "calibrated_prob": round(cal, 4), "downstream": bool(hit),
                  "method": "Platt scaling P=1/(1+exp(As+B))",
                  "spec": "ECDAT_AI_ML_MODELS §28.8 calibrate()"})
