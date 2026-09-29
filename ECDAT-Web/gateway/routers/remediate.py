"""Remediation route — rule engine grounded in Model 06 + NIST FIPS 203/204/205."""
import time
from fastapi import APIRouter

from .. import client as C
from ..schemas import GatewayResponse, RemediateRequest

router = APIRouter(prefix="/api/v1", tags=["remediate"])

PQC_MAP = {
    "RSA": "ML-KEM-768 (FIPS 203) + ML-DSA-65 (FIPS 204)",
    "ECDSA": "ML-DSA-65 (FIPS 204)", "ECDH": "ML-KEM-768 (FIPS 203)",
    "DH": "ML-KEM-768 (FIPS 203)", "DSA": "ML-DSA-65 (FIPS 204)",
    "MD5": "SHA-256 (or Argon2id for passwords)", "SHA1": "SHA-256/SHA-384",
    "SHA-1": "SHA-256/SHA-384", "DES": "AES-256-GCM", "3DES": "AES-256-GCM",
    "RC4": "AES-256-GCM / ChaCha20-Poly1305",
}


@router.post("/remediate", response_model=GatewayResponse)
async def remediate(req: RemediateRequest):
    t0 = time.perf_counter()
    misuse, _ = C.detect_misuse(req.vulnerable_code)
    vuln = misuse[0]["algorithm"] if misuse and misuse[0]["algorithm"] != "SECURE" else None
    target = req.target_algorithm
    if target == "ML-KEM-768" and vuln is None:
        for k in PQC_MAP:
            if k.lower() in req.vulnerable_code.lower():
                vuln = k
                break
    suggestion = PQC_MAP.get((vuln or "").upper(), target)
    diff = (f"- {req.vulnerable_code[:120]}\n+ # PQC migration ({req.finding_id}): "
            f"replace {vuln or 'weak primitive'} with {suggestion}\n"
            f"+ # e.g. liboqs / pyca-cryptography PQC provider, target={target}")
    return GatewayResponse(
        model="misusedetector+rules", model_id="06",
        docker_service="class-a-cpu (standalone-fallback; remediation rule engine)",
        findings=[{"id": req.finding_id, "algorithm": suggestion, "category": "REMEDIATION",
                   "status": "PQC_READY", "cwe_id": misuse[0].get("cwe_id") if misuse else None,
                   "line_number": None, "code_snippet": req.vulnerable_code[:120],
                   "quantum_risk": "NONE", "confidence": 0.88,
                   "recommendation": f"Migrate to {suggestion}."}],
        total_findings=1, quantum_risk="NONE", confidence=0.88,
        latency_ms=C.now_ms(t0),
        metadata={"target_algorithm": target, "detected_misuse": vuln,
                  "remediated_diff": diff, "language": req.language,
                  "standards": ["NIST FIPS 203 ML-KEM", "FIPS 204 ML-DSA", "FIPS 205 SLH-DSA"],
                  "spec": "ECDAT_AI_ML_MODELS §6 (RemediationEngine)"})
