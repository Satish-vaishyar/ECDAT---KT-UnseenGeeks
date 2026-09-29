"""Scan routes — Class A dockerised models 01 / 02 / 03.

POST /api/v1/scan/source  -> Model 01 AST-CryptoNet  (class-a-cpu/ast_cryptonet)
POST /api/v1/scan/binary  -> Model 02 BinCryptoCNN   (class-a-cpu/bincryptocnn)
POST /api/v1/scan/entropy -> Model 03 EntropyGuard   (class-a-cpu/entropyguard)
"""
import time
from fastapi import APIRouter, HTTPException

from .. import client as C
from ..config import config
from ..schemas import BinaryScanRequest, EntropyRequest, GatewayResponse, SourceScanRequest

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
    return GatewayResponse(model="ast_cryptonet", model_id="01",
                           docker_service="class-a-cpu (standalone-fallback)",
                           findings=findings, total_findings=len(findings),
                           quantum_risk=top, confidence=0.88,
                           latency_ms=C.now_ms(t0),
                           metadata={"language": req.language, "scan_depth": req.scan_depth,
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
    findings, top, meta = C.scan_binary(raw)
    return GatewayResponse(model="bincryptocnn", model_id="02",
                           docker_service="class-a-cpu (standalone-fallback)",
                           findings=findings, total_findings=len(findings),
                           quantum_risk=top, confidence=0.80,
                           latency_ms=C.now_ms(t0),
                           metadata={**meta, "file_path": req.file_path,
                                     "spec": "ECDAT_AI_ML_MODELS §2.8 POST /api/v1/scan/binary",
                                     "taxonomy": "15-class (RSA/ECDSA/ECDH/AES/DES/SHA/…)"})


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
                  "spec": "ECDAT_AI_ML_MODELS §3.8 classify_entropy()"})
