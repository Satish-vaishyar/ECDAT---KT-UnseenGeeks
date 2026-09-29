"""Classify routes — Class A Model 06 MisuseDetector (dockerised).

POST /api/v1/classify/misuse -> Model 06 (class-a-cpu/misusedetector), 7-type CWE taxonomy.
NOTE: Model 04 CryptoClassLLM is NOT dockerised (no class image), so /classify
routes to the Class B LLM tier (08/09/10) as the hosted classifier per spec Part 9.
"""
import time
from fastapi import APIRouter

from .. import client as C
from ..schemas import ClassifyRequest, GatewayResponse

router = APIRouter(prefix="/api/v1/classify", tags=["classify"])


@router.post("", response_model=GatewayResponse)
async def classify(req: ClassifyRequest):
    """Model 04 CryptoClassLLM (class-e-ml, 3-level taxonomy).

    Tries class-e OIP first, then the Class B LLM proxy, then heuristics.
    """
    t0 = time.perf_counter()
    hit4 = await C.downstream_infer("cryptoclassllm",
                                    {"code": req.code, "language": req.language})
    if hit4:
        body = hit4["body"]
        out = body.get("output", {})
        lvl2 = out.get("level_2_algorithm", "GENERIC")
        lvl3 = out.get("level_3_quantum", "MEDIUM")
        return GatewayResponse(
            model="cryptoclassllm", model_id="04",
            docker_service=f"class-e-ml ({hit4['_service']})",
            findings=[{"id": "ECDAT-C001", "algorithm": str(lvl2),
                       "category": str(out.get("level_1_family", "UNKNOWN")),
                       "status": "CLASSIFIED", "cwe_id": None, "line_number": None,
                       "code_snippet": req.code[:100], "quantum_risk": str(lvl3),
                       "confidence": float(body.get("confidence", 0.85)),
                       "recommendation": "See taxonomy levels in metadata."}],
            total_findings=1, quantum_risk=str(lvl3),
            confidence=float(body.get("confidence", 0.85)),
            latency_ms=float(body.get("latency_ms", 0.0)),
            metadata={"taxonomy_3level": out,
                      "spec": "ECDAT_AI_ML_MODELS §4.8 POST /api/v1/classify"})
    hit = await C.downstream_infer("deepseek_coder", {
        "model": "deepseek_coder",
        "messages": [{"role": "system", "content": "Classify crypto primitives. Reply JSON list."},
                     {"role": "user", "content": req.code[:3000]}],
        "temperature": 0.0, "max_tokens": 512})
    findings, top = C.scan_source(req.code, req.language)
    md = {"classifier": "class-b-gpu/deepseek_coder (Model 08 proxy)" if hit else
          "fallback heuristic (class-e-ml unreachable)",
          "downstream": bool(hit),
          "spec": "ECDAT_AI_ML_MODELS §4.8 POST /api/v1/classify"}
    if hit:
        try:
            md["llm_output"] = hit["body"]
        except Exception:
            pass
    return GatewayResponse(model="cryptoclassllm", model_id="04",
                           docker_service="class-b-gpu (Model 08 proxy)" if hit else
                           "class-e-ml (standalone-fallback)",
                           findings=findings, total_findings=len(findings),
                           quantum_risk=top, confidence=0.84,
                           latency_ms=C.now_ms(t0), metadata=md)


@router.post("/misuse", response_model=GatewayResponse)
async def misuse(req: ClassifyRequest):
    t0 = time.perf_counter()
    hit = await C.downstream_infer("misusedetector", {"code": req.code,
                                                      "language": req.language})
    if hit:
        body = hit["body"]
        return GatewayResponse(model="misusedetector", model_id="06",
                               docker_service=f"class-a-cpu ({hit['_service']})",
                               findings=body.get("output", {}).get("findings", []),
                               total_findings=body.get("output", {}).get("total_findings", 0),
                               quantum_risk=body.get("output", {}).get("quantum_risk", "NONE"),
                               confidence=body.get("confidence", 0.87),
                               latency_ms=body.get("latency_ms", 0.0),
                               metadata={"taxonomy": "7-type CWE (327/326/321/329/330/295/916)"})
    findings, top = C.detect_misuse(req.code)
    return GatewayResponse(model="misusedetector", model_id="06",
                           docker_service="class-a-cpu (standalone-fallback)",
                           findings=findings, total_findings=len(findings),
                           quantum_risk=top, confidence=0.87,
                           latency_ms=C.now_ms(t0),
                           metadata={"taxonomy": "7-type CWE (327/326/321/329/330/295/916)",
                                     "spec": "ECDAT_AI_ML_MODELS §6.8 POST /api/v1/classify/misuse"})
