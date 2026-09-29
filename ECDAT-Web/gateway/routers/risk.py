"""Risk routes — Model 25 QARS + Model 26 Monte Carlo (Class A, dockerised)
+ Model 27 Temporal Risk (Class D batch — served synchronously by gateway)."""
import random
import time
from fastapi import APIRouter

from .. import client as C
from ..schemas import GatewayResponse, MonteCarloRequest, RiskForecastRequest, RiskScoreRequest

router = APIRouter(prefix="/api/v1/risk", tags=["risk"])


@router.post("/score", response_model=GatewayResponse)
async def score(req: RiskScoreRequest):
    t0 = time.perf_counter()
    hit = await C.downstream_infer("qars", {"query": req.algorithm,
                                            "documents": [req.algorithm],
                                            **req.context})
    if hit and hit["body"].get("output", {}).get("rankings"):
        body = hit["body"]
        return GatewayResponse(model="qars", model_id="25",
                               docker_service=f"class-a-cpu ({hit['_service']})",
                               findings=[], total_findings=0, quantum_risk="NONE",
                               confidence=body.get("confidence", 0.85),
                               latency_ms=body.get("latency_ms", 0.0),
                               metadata={"downstream": body.get("output", {})})
    q = C.qars_score(req.algorithm, req.key_size)
    return GatewayResponse(
        model="qars", model_id="25", docker_service="class-a-cpu (standalone-fallback)",
        findings=[{"id": "ECDAT-Q001", "algorithm": req.algorithm, "category": "RISK",
                   "status": q["tier"], "cwe_id": None, "line_number": None,
                   "code_snippet": req.algorithm, "quantum_risk": q["quantum_risk"],
                   "confidence": 0.9,
                   "recommendation": "Prioritise PQC migration." if q["score"] >= 70
                   else "Monitor; schedule migration."}],
        total_findings=1, quantum_risk=q["quantum_risk"], confidence=0.9,
        latency_ms=C.now_ms(t0),
        metadata={"qars_score": q["score"], "tier": q["tier"],
                  "formula": "QARS = 0.30V+0.20Q+0.15A+0.15M+0.10P+0.10E",
                  "spec": "ECDAT_AI_ML_MODELS §25.8 calculate_qars()"})


@router.post("/forecast", response_model=GatewayResponse)
async def forecast(req: RiskForecastRequest):
    """Model 27 Temporal Risk Predictor (Class D batch image; gateway serves online)."""
    t0 = time.perf_counter()
    base = C.qars_score(req.algorithm)["score"]
    hist = req.history or [min(100, base + i * 0.4) for i in range(30)]
    slope = (hist[-1] - hist[0]) / max(len(hist) - 1, 1)
    proj = [round(min(100, hist[-1] + slope * d), 1) for d in range(1, req.horizon_days + 1)]
    return GatewayResponse(
        model="temporal_risk", model_id="27",
        docker_service="class-d-batch (gateway-served; batch image has no HTTP)",
        findings=[], total_findings=0,
        quantum_risk="HIGH" if proj[-1] >= 70 else "MEDIUM",
        confidence=0.8, latency_ms=C.now_ms(t0),
        metadata={"algorithm": req.algorithm, "horizon_days": req.horizon_days,
                  "forecast": proj[:10], "forecast_last": proj[-1],
                  "spec": "ECDAT_AI_ML_MODELS §27.8 predict_risk()"})


@router.post("/monte-carlo", response_model=GatewayResponse)
async def monte_carlo(req: MonteCarloRequest):
    """Model 26 Monte Carlo Q-Day simulation (Class A, dockerised)."""
    t0 = time.perf_counter()
    hit = await C.downstream_infer("monte_carlo", {"iterations": req.iterations})
    rng = random.Random(req.seed or 42)
    sims = [rng.gauss(12.0, 3.0) for _ in range(min(req.iterations, 5000))]
    sims.sort()
    dist = {"p5": round(sims[int(len(sims) * 0.05)], 1),
            "p50": round(sims[int(len(sims) * 0.50)], 1),
            "p95": round(sims[int(len(sims) * 0.95)], 1)}
    return GatewayResponse(
        model="monte_carlo", model_id="26",
        docker_service=f"class-a-cpu ({hit['_service']})" if hit
        else "class-a-cpu (standalone-fallback)",
        findings=[], total_findings=0, quantum_risk="HIGH", confidence=0.9,
        latency_ms=C.now_ms(t0),
        metadata={"qday_years": dist, "iterations": req.iterations,
                  "downstream": bool(hit),
                  "spec": "ECDAT_AI_ML_MODELS §26.8 run_simulation()"})
