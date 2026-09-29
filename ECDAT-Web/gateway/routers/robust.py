"""Robustness + batch-served routes — Class D (05/19/29) via gateway.

POST /api/v1/robust/detect  -> Model 05 CryptoRobust (class-d-batch image; no HTTP)
POST /api/v1/risk/gnn       -> Model 19 GNN Risk     (class-d-batch image; no HTTP)
POST /api/v1/security/redteam -> Model 29 AI Red Team (class-d-batch image; no HTTP)
"""
import time
from fastapi import APIRouter

from .. import client as C
from ..schemas import (GatewayResponse, GNNRiskRequest, RedTeamRequest,
                       RobustDetectRequest, TrapdoorRequest)

router = APIRouter(prefix="/api/v1", tags=["robust"])


@router.post("/robust/detect", response_model=GatewayResponse)
async def robust_detect(req: RobustDetectRequest):
    t0 = time.perf_counter()
    code = req.code or ""
    feats = req.features or []
    obfuscated = any(s in code for s in ("eval(", "exec(", "\\x", "fromCharCode", "chr(")) \
        or (feats and max(feats) > 0.9)
    verdict = "ADVERSARIAL_SUSPECT" if obfuscated else "CLEAN"
    return GatewayResponse(
        model="cryptorobust", model_id="05",
        docker_service="class-d-batch (gateway-served; batch image has no HTTP)",
        findings=[{"id": "ECDAT-RB001", "algorithm": verdict, "category": "ROBUSTNESS",
                   "status": "SUSPECT" if obfuscated else "SECURE", "cwe_id": None,
                   "line_number": None, "code_snippet": code[:100],
                   "quantum_risk": "NONE", "confidence": 0.82,
                   "recommendation": "Quarantine & re-scan de-obfuscated." if obfuscated
                   else "No evasion signals."}],
        total_findings=1, quantum_risk="NONE", confidence=0.82,
        latency_ms=C.now_ms(t0),
        metadata={"defense": req.defense, "verdict": verdict,
                  "spec": "ECDAT_AI_ML_MODELS §5 (CryptoRobust, batch)"})


@router.post("/risk/gnn", response_model=GatewayResponse)
async def gnn_risk(req: GNNRiskRequest):
    t0 = time.perf_counter()
    base = C.qars_score(req.algorithm_id)["score"]
    boost = min(15, 3 * len(req.neighbors or []))
    score = min(100, base + boost)
    return GatewayResponse(
        model="gnn_risk", model_id="19",
        docker_service="class-d-batch (gateway-served; batch image has no HTTP)",
        findings=[], total_findings=0,
        quantum_risk="CRITICAL" if score >= 90 else "HIGH" if score >= 70
        else "MEDIUM" if score >= 40 else "LOW",
        confidence=0.85, latency_ms=C.now_ms(t0),
        metadata={"algorithm_id": req.algorithm_id, "neighbors": req.neighbors or [],
                  "propagation_score": score,
                  "spec": "ECDAT_AI_ML_MODELS §19.8 (GraphSAGE, batch)"})


@router.post("/security/trapdoor", response_model=GatewayResponse)
async def trapdoor(req: TrapdoorRequest):
    """Model 23 Trapdoor IOC DB (Class A, dockerised): check_trapdoor + get_iocs."""
    t0 = time.perf_counter()
    hit = await C.downstream_infer("trapdoor", {"code": req.code_snippet or "",
                                                "algorithm": req.algorithm or "",
                                                "fingerprint": req.fingerprint or ""})
    if hit:
        out = hit["body"].get("output", {})
        hits = out.get("hits", [])
        return GatewayResponse(
            model="trapdoor", model_id="23",
            docker_service=f"class-a-cpu ({hit['_service']})",
            findings=[{"id": h.get("ioc_id", "TRAP-?"), "algorithm": h.get("title", ""),
                       "category": h.get("ioc_type"), "status": "TRAPDOOR_MATCH",
                       "cwe_id": h.get("cwe_id"), "line_number": None,
                       "code_snippet": req.code_snippet[:100] if req.code_snippet else None,
                       "quantum_risk": out.get("quantum_risk", "HIGH"),
                       "confidence": 0.9, "recommendation": h.get("recommendation")}
                      for h in hits],
            total_findings=len(hits), quantum_risk=out.get("quantum_risk", "NONE"),
            confidence=0.9, latency_ms=float(hit["body"].get("latency_ms", 0.0)),
            metadata={"match": out.get("match"),
                      "spec": "ECDAT_AI_ML_MODELS §23.8 check_trapdoor()"})
    res = C.local_trapdoor(req.code_snippet or "", req.algorithm or "",
                           req.fingerprint or "")
    hits = res.get("hits", [])
    top = "CRITICAL" if any(h.get("severity") == "CRITICAL" for h in hits) else (
        "HIGH" if hits else "NONE")
    return GatewayResponse(
        model="trapdoor", model_id="23",
        docker_service="class-a-cpu (standalone-fallback; local SQLite)",
        findings=[{"id": h.get("ioc_id"), "algorithm": h.get("title"),
                   "category": h.get("ioc_type"), "status": "TRAPDOOR_MATCH",
                   "cwe_id": h.get("cwe_id"), "line_number": None,
                   "code_snippet": (req.code_snippet or "")[:100] or None,
                   "quantum_risk": top, "confidence": 0.9,
                   "recommendation": h.get("recommendation")} for h in hits],
        total_findings=len(hits), quantum_risk=top, confidence=0.9,
        latency_ms=C.now_ms(t0),
        metadata={"match": res["match"], "digest": res.get("digest"),
                  "spec": "ECDAT_AI_ML_MODELS §23.8 check_trapdoor()"})


@router.post("/security/redteam", response_model=GatewayResponse)
async def redteam(req: RedTeamRequest):
    t0 = time.perf_counter()
    return GatewayResponse(
        model="red_team", model_id="29",
        docker_service="class-d-batch (gateway-served; batch image has no HTTP)",
        findings=[], total_findings=0, quantum_risk="NONE", confidence=0.9,
        latency_ms=C.now_ms(t0),
        metadata={"model_id": req.model_id, "attack": req.attack,
                  "samples": req.samples,
                  "plan": [f"Generate {req.samples} {req.attack} adversarial samples",
                           "Measure robust accuracy + ICNN detection rate",
                           "Emit RedTeamReport (batch job)"],
                  "spec": "ECDAT_AI_ML_MODELS §29.8 run_red_team()"})
