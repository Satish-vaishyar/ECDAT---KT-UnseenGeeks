"""Classify routes — Class A Model 06 MisuseDetector (dockerised).

POST /api/v1/classify/misuse -> Model 06 (class-a-cpu/misusedetector), 7-type CWE taxonomy.
NOTE: Model 04 CryptoClassLLM is NOT dockerised (no class image), so /classify
routes to the Class B LLM tier (08/09/10) as the hosted classifier per spec Part 9.
"""
import os
import time
from fastapi import APIRouter

from .. import client as C
from ..schemas import ClassifyRequest, GatewayResponse
from src.ecdat.core.all_models_runtime import model04_classify, model06_misuse

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
    if os.environ.get("ECDAT_ENABLE_MODEL04_LOCAL", "0") == "1":
        try:
            local = model04_classify(req.code, req.language)
            lvl1 = str(local.get("level_1_family", "UNKNOWN"))
            lvl2 = str(local.get("level_2_algorithm", "UNKNOWN"))
            lvl3 = str(local.get("level_3_quantum", "UNKNOWN"))
            conf = float(local.get("confidence", local.get("level_2_confidence", 0.0)))
            return GatewayResponse(
                model="cryptoclassllm", model_id="04",
                docker_service="all_models/model_04 (local adapter)",
                findings=[{"id": "ECDAT-C004", "algorithm": lvl2, "category": lvl1,
                           "status": "CLASSIFIED", "cwe_id": None, "line_number": 1,
                           "code_snippet": req.code[:100], "quantum_risk": lvl3,
                           "confidence": conf, "recommendation": "Use the Model 04 taxonomy output."}],
                total_findings=1, quantum_risk=lvl3, confidence=conf,
                latency_ms=C.now_ms(t0), metadata={"model_output": local,
                "artifact_backed": True, "backend": "local_adapter"})
        except Exception as exc:
            local_error = str(exc)[:240]
    # Standalone / Laptop Mode Hierarchical Classification (Model 04 3-level taxonomy)
    tax = C.classify_3level(req.code, req.language)
    lvl1 = tax.get("level_1_family", "NONE")
    lvl2 = tax.get("level_2_algorithm", "NO_CRYPTO")
    lvl3 = tax.get("level_3_quantum", "NONE")
    conf = float(tax.get("confidence", 0.95))
    rec = tax.get("recommendation", "Standard cryptographic taxonomy classification.")

    finding = {
        "id": "ECDAT-C001",
        "algorithm": lvl2,
        "category": lvl1,
        "status": tax.get("status", "CLASSIFIED"),
        "cwe_id": None,
        "line_number": 1,
        "code_snippet": req.code[:100],
        "quantum_risk": lvl3,
        "confidence": conf,
        "recommendation": rec
    }

    return GatewayResponse(
        model="cryptoclassllm",
        model_id="04",
        docker_service="class-e-ml (standalone-fallback)",
        findings=[finding],
        total_findings=1,
        quantum_risk=lvl3,
        confidence=conf,
        latency_ms=C.now_ms(t0),
        metadata={
            "taxonomy_3level": tax,
            "classifier": "hierarchical_taxonomy_reasoner (Model 04 standalone)",
            "local_artifact_error": locals().get("local_error"),
            "spec": "ECDAT_AI_ML_MODELS §4.8 POST /api/v1/classify"
        }
    )


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
    try:
        local = model06_misuse(req.code, req.language)
        is_misuse = bool(local.get("is_misuse"))
        prediction = str(local.get("prediction", "UNKNOWN"))
        finding = {"id": "ECDAT-M006", "algorithm": prediction,
                   "category": "MISUSE", "status": "INSECURE" if is_misuse else "SECURE",
                   "cwe_id": None, "line_number": None, "code_snippet": req.code[:100],
                   "quantum_risk": "HIGH" if is_misuse else "NONE",
                   "confidence": float(local.get("confidence", 0.0)),
                   "recommendation": "Review and replace the flagged cryptographic use."
                   if is_misuse else "No misuse detected by Model 06."}
        return GatewayResponse(model="misusedetector", model_id="06",
                               docker_service="all_models/model_06 (artifact-loader)",
                               findings=[finding], total_findings=int(is_misuse),
                               quantum_risk="HIGH" if is_misuse else "NONE",
                               confidence=float(local.get("confidence", 0.0)),
                               latency_ms=C.now_ms(t0),
                               metadata={"model_output": local, "artifact_backed": True,
                                         "taxonomy": "Model 06 8-class misuse classifier"})
    except Exception as exc:
        local_error = str(exc)[:240]
    findings, top = C.detect_misuse(req.code)
    return GatewayResponse(model="misusedetector", model_id="06",
                           docker_service="class-a-cpu (standalone-fallback)",
                           findings=findings, total_findings=len(findings),
                           quantum_risk=top, confidence=0.87,
                           latency_ms=C.now_ms(t0),
                           metadata={"taxonomy": "7-type CWE (327/326/321/329/330/295/916)",
                                     "artifact_error": locals().get("local_error"),
                                     "spec": "ECDAT_AI_ML_MODELS §6.8 POST /api/v1/classify/misuse"})
