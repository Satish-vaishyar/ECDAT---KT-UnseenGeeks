"""Risk routes — Model 25 QARS + Model 26 Monte Carlo (Class A, dockerised)
+ Model 27 Temporal Risk (Class D batch — served synchronously by gateway)."""
import random
import time
from fastapi import APIRouter

from .. import client as C
from ..schemas import GatewayResponse, MonteCarloRequest, RiskForecastRequest, RiskScoreRequest
from src.ecdat.core.all_models_runtime import model25_qars, model26_simulation, model27_forecast

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
    try:
        model_result = model25_qars(req.algorithm, context={**req.context, "key_size": req.key_size})
        if isinstance(model_result, dict):
            return GatewayResponse(model="qars", model_id="25",
                docker_service="all_models/model_25 (artifact-loader)", findings=[], total_findings=0,
                quantum_risk=str(model_result.get("quantum_risk", "UNKNOWN")), confidence=0.9,
                latency_ms=C.now_ms(t0), metadata={"model_output": model_result, "artifact_backed": True})
    except Exception as exc:
        local_error = str(exc)[:240]
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
                  "artifact_error": locals().get("local_error"),
                  "spec": "ECDAT_AI_ML_MODELS §25.8 calculate_qars()"})


WATCHLIST = (("RSA-2048", 2048), ("ECDSA-P256", 256),
             ("AES-128-GCM", 128), ("ML-KEM-768", 0))


@router.get("/portfolio")
async def portfolio():
    """Quantum Risk Lab portfolio summary for the IDE (models 25 + 26).

    Returns {qday: {p5, p50, p95, probability}, worst, risers: [{name, qars, tier}]}.
    probability is a heuristic exposure proxy until Model 26 emits it directly.
    """
    import datetime
    now = datetime.date.today().year
    try:
        mc = model26_simulation(10000, 42)
        qday = {"p5": mc.get("p5_year"), "p50": mc.get("p50_year"),
                "p95": mc.get("p95_year")}
    except Exception as exc:
        return {"error": f"qday unavailable: {str(exc)[:120]}",
                "qday": None, "worst": None, "risers": []}
    p50 = qday["p50"] or now + 12
    probability = round(min(0.99, max(0.05, 1.0 - (p50 - now - 3) / 25.0)), 2)
    qday["probability"] = probability
    risers = []
    for name, key_size in WATCHLIST:
        try:
            q = C.qars_score(name, key_size)
            risers.append({"name": name, "qars": round(q["score"] / 100.0, 2),
                           "tier": q["tier"]})
        except Exception:
            continue
    risers.sort(key=lambda r: r["qars"], reverse=True)
    return {"qday": qday, "worst": risers[0]["name"] if risers else None,
            "risers": risers}


@router.post("/forecast", response_model=GatewayResponse)
async def forecast(req: RiskForecastRequest):
    """Model 27 Temporal Risk Predictor (Class D batch image; gateway serves online)."""
    t0 = time.perf_counter()
    base = C.qars_score(req.algorithm)["score"]
    hist = req.history or [min(100, base + i * 0.4) for i in range(90)]
    try:
        forecast_result = model27_forecast(hist, req.algorithm)
        values = forecast_result["qars_forecast"][:max(1, min(req.horizon_days, 30))]
        last = values[-1]
        return GatewayResponse(
            model="temporal_risk", model_id="27",
            docker_service="all_models/model_27 (artifact-loader)", findings=[], total_findings=0,
            quantum_risk="HIGH" if last >= 70 else "MEDIUM" if last >= 40 else "LOW",
            confidence=0.9, latency_ms=C.now_ms(t0),
            metadata={"algorithm": req.algorithm, "horizon_days": req.horizon_days,
                      "forecast": values, "forecast_last": last,
                      "artifact_backed": True, "feature_window": "90x30"})
    except Exception as exc:
        artifact_error = str(exc)[:240]
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
                  "spec": "ECDAT_AI_ML_MODELS §27.8 predict_risk()",
                  "artifact_error": locals().get("artifact_error")})


@router.post("/monte-carlo", response_model=GatewayResponse)
async def monte_carlo(req: MonteCarloRequest):
    """Model 26 Monte Carlo Q-Day simulation (Class A, dockerised)."""
    t0 = time.perf_counter()
    hit = await C.downstream_infer("monte_carlo", {"iterations": req.iterations})
    try:
        result = model26_simulation(min(req.iterations, 100000), req.seed or 42)
        return GatewayResponse(model="monte_carlo", model_id="26",
            docker_service="all_models/model_26 (artifact-loader)", findings=[], total_findings=0,
            quantum_risk="HIGH", confidence=0.9, latency_ms=C.now_ms(t0),
            metadata={"qday": result, "iterations": req.iterations, "artifact_backed": True,
                      "spec": "ECDAT_AI_ML_MODELS §26.8 run_simulation()"})
    except Exception as exc:
        local_error = str(exc)[:240]
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
                  "downstream": bool(hit), "artifact_error": locals().get("local_error"),
                  "spec": "ECDAT_AI_ML_MODELS §26.8 run_simulation()"})
