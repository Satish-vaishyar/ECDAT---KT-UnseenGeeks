"""Scan routes — Class A dockerised models 01 / 02 / 03.

POST /api/v1/scan/source  -> Model 01 AST-CryptoNet  (class-a-cpu/ast_cryptonet)
POST /api/v1/scan/binary  -> Model 02 BinCryptoCNN   (class-a-cpu/bincryptocnn)
POST /api/v1/scan/entropy -> Model 03 EntropyGuard   (class-a-cpu/entropyguard)
"""
import re
import time
from fastapi import APIRouter, HTTPException

from .. import client as C
from ..config import config
from ..schemas import BinaryScanRequest, EntropyRequest, GatewayResponse, SourceScanRequest
from src.ecdat.core.all_models_runtime import model01_classify, model02_binary, model03_entropy

router = APIRouter(prefix="/api/v1/scan", tags=["scan"])


@router.post("/source", response_model=GatewayResponse)
async def scan_source(req: SourceScanRequest):
    t0 = time.perf_counter()
    code = req.code or ""
    if not code and req.file_path:
        try:
            with open(req.file_path, encoding="utf-8", errors="replace") as f:
                code = f.read()
        except OSError as e:
            raise HTTPException(status_code=400, detail=f"cannot read file_path: {e}")
    if not code:
        raise HTTPException(status_code=422, detail="provide 'code' or readable 'file_path'")
    if config.STANDALONE_FALLBACK is False:
        hit = await C.downstream_infer("ast_cryptonet", {"source_code": code,
                                                         "file_path": req.file_path or "",
                                                         "language": req.language})
        if hit:
            body = hit["body"]
            return GatewayResponse(model="ast_cryptonet", model_id="01",
                                   docker_service=f"class-a-cpu ({hit['_service']})",
                                   findings=body.get("output", {}).get("findings", []),
                                   total_findings=body.get("output", {}).get("total_findings", 0),
                                   quantum_risk=body.get("output", {}).get("quantum_risk", "NONE"),
                                   confidence=body.get("confidence", 0.85),
                                   latency_ms=body.get("latency_ms", 0.0),
                                   metadata={"scan_depth": req.scan_depth})
    else:
        hit = await C.downstream_infer("ast_cryptonet", {"source_code": code,
                                                         "file_path": req.file_path or "",
                                                         "language": req.language})
        if hit:
            body = hit["body"]
            return GatewayResponse(model="ast_cryptonet", model_id="01",
                                   docker_service=f"class-a-cpu ({hit['_service']})",
                                   findings=body.get("output", {}).get("findings", []),
                                   total_findings=body.get("output", {}).get("total_findings", 0),
                                   quantum_risk=body.get("output", {}).get("quantum_risk", "NONE"),
                                   confidence=body.get("confidence", 0.85),
                                   latency_ms=body.get("latency_ms", 0.0),
                                   metadata={"scan_depth": req.scan_depth})
    findings, top = C.scan_source(code, req.language)
    # Model 01 AST-CryptoNet calibration: 12 signal floats from the same code
    # (same recipe as pipeline_orchestrator stage 1) -> (probability, label).
    m1_probability, m1_label, m1_status = None, None, "HEURISTIC"
    try:
        has_findings = float(bool(findings))
        signals = [
            has_findings,
            has_findings,
            float(bool(re.search(r"(?im)^\s*(from|import)\s+(cryptography|Crypto|oqs)", code))),
            float(bool(re.search(r"(?i)(key[_ ]?size|modulusLength|2048|4096)", code))),
            1.0,
            float(bool(re.search(r"(?i)(cryptography|Crypto|oqs)", code))),
            0.0, 0.0, 0.0, 0.0, 0.0, 0.0,
        ]
        m1_probability, m1_label = model01_classify(signals)
        m1_status = "ACTUAL"
    except Exception as exc:
        m1_error = str(exc)[:240]
    return GatewayResponse(model="ast_cryptonet", model_id="01",
                           docker_service="class-a-cpu (standalone-fallback)",
                           findings=findings, total_findings=len(findings),
                           quantum_risk=top, confidence=0.88,
                           latency_ms=C.now_ms(t0),
                           metadata={"language": req.language, "scan_depth": req.scan_depth,
                                     "model01_probability": m1_probability,
                                     "model01_label": m1_label,
                                     "model01_status": m1_status,
                                     "model01_error": locals().get("m1_error"),
                                     "artifact_backed": m1_status == "ACTUAL",
                                     "spec": "ECDAT_AI_ML_MODELS §1.8 POST /api/v1/scan/source"})


@router.post("/binary", response_model=GatewayResponse)
async def scan_binary(req: BinaryScanRequest):
    t0 = time.perf_counter()
    try:
        raw = C.b64decode_strict(req.binary_data)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    hit = await C.downstream_infer("bincryptocnn", {"code": raw[:200].decode("latin1", "ignore"),
                                                   "file_path": req.file_path})
    if hit:
        body = hit["body"]
        return GatewayResponse(model="bincryptocnn", model_id="02",
                               docker_service=f"class-a-cpu ({hit['_service']})",
                               findings=body.get("output", {}).get("findings", []),
                               total_findings=body.get("output", {}).get("total_findings", 0),
                               quantum_risk=body.get("output", {}).get("quantum_risk", "NONE"),
                               confidence=body.get("confidence", 0.85),
                               latency_ms=body.get("latency_ms", 0.0),
                                   metadata={"file_path": req.file_path})
    try:
        pred = model02_binary(raw)
        conflict = bool(pred.get("prediction_conflict"))
        families = {str(value).upper() for value in pred.get("detected_families", [])}
        risk = ("CRITICAL" if families.intersection({"RSA", "ECDSA", "ECDH", "DH_DSA", "KEYSTORE"})
                else "HIGH" if pred.get("crypto_hits", 0) else "NONE")
        finding = {"id": "ECDAT-BM02", "algorithm": str(pred.get("class", "UNKNOWN")),
                   "category": "BINARY_MODEL", "status": "REVIEW_REQUIRED" if conflict else "ANALYZED", "cwe_id": None,
                   "line_number": None, "code_snippet": req.file_path,
                   "quantum_risk": risk, "confidence": float(pred.get("probability", 0.0)),
                   "recommendation": ("Model prediction conflicts with extractor evidence; manual review required."
                                      if conflict else "Review the Model 02 binary classification and related crypto hits.")}
        return GatewayResponse(model="bincryptocnn", model_id="02",
                               docker_service="all_models/model_02 (artifact-loader)",
                               findings=[finding], total_findings=1,
                               quantum_risk=risk, confidence=finding["confidence"],
                               latency_ms=C.now_ms(t0),
                               metadata={"model_prediction": pred, "file_path": req.file_path,
                                         "artifact_backed": True})
    except Exception as exc:
        # Keep the established heuristic fallback available when an optional
        # binary dependency/artifact is unavailable.
        artifact_error = str(exc)[:240]
    findings, top, meta = C.scan_binary(raw)
    return GatewayResponse(model="bincryptocnn", model_id="02",
                           docker_service="class-a-cpu (standalone-fallback)",
                           findings=findings, total_findings=len(findings),
                           quantum_risk=top, confidence=0.80,
                           latency_ms=C.now_ms(t0),
                           metadata={**meta, "file_path": req.file_path,
                                     "spec": "ECDAT_AI_ML_MODELS §2.8 POST /api/v1/scan/binary",
                                     "taxonomy": "15-class (RSA/ECDSA/ECDH/AES/DES/SHA/…)",
                                     "artifact_error": locals().get("artifact_error")})


@router.post("/entropy", response_model=GatewayResponse)
async def scan_entropy(req: EntropyRequest):
    t0 = time.perf_counter()
    text = req.code or req.data or ""
    if not text:
        raise HTTPException(status_code=422, detail="provide 'code' or 'data'")
    hit = await C.downstream_infer("entropyguard", {"code": text})
    if hit:
        body = hit["body"]
        return GatewayResponse(model="entropyguard", model_id="03",
                               docker_service=f"class-a-cpu ({hit['_service']})",
                               findings=[], total_findings=0,
                               quantum_risk="NONE",
                               confidence=body.get("confidence", 0.9),
                               latency_ms=body.get("latency_ms", 0.0),
                               metadata={"downstream": body.get("output", {})})
    try:
        result = model03_entropy(text, req.context or "unknown", ".env" if req.context == ".env" else ".py")
        risk = "HIGH" if result["label"] in ("ENCODED_SECRET", "HIGH_ENTROPY_SECRET") else "NONE"
        return GatewayResponse(model="entropyguard", model_id="03",
                               docker_service="all_models/model_03 (artifact-loader)",
                               findings=[{"id": "ECDAT-E003", "algorithm": result["label"],
                                          "category": "ENTROPY", "status": "ANALYZED", "cwe_id": None,
                                          "line_number": None, "code_snippet": text[:80],
                                          "quantum_risk": risk, "confidence": result["confidence"],
                                          "recommendation": result["rl_action"]}],
                               total_findings=1, quantum_risk=risk,
                               confidence=result["confidence"], latency_ms=C.now_ms(t0),
                               metadata={"artifact_backed": True, "model_output": result})
    except Exception as exc:
        artifact_error = str(exc)[:240]
    ent = C.shannon(text)
    secret = ent > 4.5
    return GatewayResponse(
        model="entropyguard", model_id="03",
        docker_service="class-a-cpu (standalone-fallback)",
        findings=[{"id": "ECDAT-E001", "algorithm": "HIGH_ENTROPY_SECRET" if secret else "LOW_ENTROPY",
                   "category": "ENTROPY", "status": "INSECURE" if secret else "SECURE",
                   "cwe_id": "CWE-798" if secret else None, "line_number": None,
                   "code_snippet": text[:80], "quantum_risk": "HIGH" if secret else "NONE",
                   "confidence": 0.85,
                   "recommendation": "Possible hardcoded secret — rotate & vault." if secret
                   else "Entropy within normal range."}],
        total_findings=1, quantum_risk="HIGH" if secret else "NONE", confidence=0.85,
        latency_ms=C.now_ms(t0),
        metadata={"shannon_entropy": round(ent, 3), "threshold": 4.5,
                  "spec": "ECDAT_AI_ML_MODELS §3.8 classify_entropy()",
                  "artifact_error": locals().get("artifact_error")})
