"""Downstream proxy to dockerised Class A/B/C + heuristic fallback engine.

Routing (per docker/*/Dockerfile + models/adapter_*):
  Class A (CPU  :8080, OIP /v2/models/{name}/infer):
    01 ast_cryptonet, 02 bincryptocnn, 03 entropyguard, 06 misusedetector,
    17 source_trust, 18 tkg, 20 quantum_cost, 22 vuln_intel,
    24 compliance_kb, 25 qars, 26 monte_carlo, 28 confidence_calibration
  Class B (GPU  :8082, /v1/chat/completions):
    08 deepseek_coder, 09 starcoder2, 10 codellama, 11 gemini_flash
  Class C (Stateful :8081, /v2/models/{name}/infer):
    12 cdkg, 13 rag_kb, 14 hybrid_retriever, 15 chromadb, 16 embedding_pipeline
  Class D (Batch CronJobs, no HTTP — gateway serves synchronously):
    05 cryptorobust, 19 gnn_risk, 27 temporal_risk, 29 red_team
"""
import base64
import binascii
import hashlib
import math
import re
import time
from typing import Any

import httpx

from .config import config

CLASS_A_MODELS = {
    "ast_cryptonet", "bincryptocnn", "entropyguard", "misusedetector",
    "source_trust", "tkg", "quantum_cost", "vuln_intel", "trapdoor",
    "compliance_kb", "qars", "monte_carlo", "confidence_calibration",
}
CLASS_C_MODELS = {"cdkg", "rag_kb", "hybrid_retriever", "chromadb",
                  "embedding_pipeline", "crypto_api"}
CLASS_B_MODELS = {"deepseek_coder", "starcoder2", "codellama", "gemini_flash"}
CLASS_E_MODELS = {"cryptoclassllm", "ecdat_lora"}


def _service_for(model: str) -> str:
    if model in CLASS_A_MODELS:
        return config.CLASS_A_URL
    if model in CLASS_C_MODELS:
        return config.CLASS_C_URL
    if model in CLASS_B_MODELS:
        return config.CLASS_B_URL
    if model in CLASS_E_MODELS:
        return config.CLASS_E_URL
    return config.CLASS_A_URL


async def downstream_infer(model: str, payload: dict[str, Any]) -> dict[str, Any] | None:
    """POST to the owning dockerised service. Returns parsed body or None."""
    base = _service_for(model).rstrip("/")
    try:
        async with httpx.AsyncClient(timeout=config.DOWNSTREAM_TIMEOUT_S) as c:
            if model in CLASS_B_MODELS or model == "ecdat_lora":  # chat-completions shape
                r = await c.post(f"{base}/v1/chat/completions", json=payload)
            elif model in CLASS_C_MODELS:
                r = await c.post(f"{base}/v2/models/{model}/infer", json={
                    "model": model, "query": payload.get("query", ""),
                    "top_k": payload.get("top_k", 10),
                    "filters": payload.get("filters"),
                })
            else:
                r = await c.post(f"{base}/v2/models/{model}/infer", json={
                    "model": model, "version": "v1", "input": payload})
            if r.status_code == 200:
                body = r.json()
                if isinstance(body, dict) and body.get("output") is not None:
                    return {"_downstream": True, "_service": base,
                            "_model": model, "body": body}
    except Exception:
        pass
    return None


# ---------------------------------------------------------------- heuristics
CRYPTO_PATTERNS = [
    (r"(?i)\b(rsa|pkcs#?1|rsassa|rsa\.generate|RSAPublicKey)\b", "RSA-2048", "ASYMMETRIC", "CRITICAL", "CWE-326"),
    (r"(?i)\b(ecdsa|secp256k1|secp256r1|prime256v1|elliptic)\b", "ECDSA-P256", "ASYMMETRIC", "CRITICAL", "CWE-326"),
    (r"(?i)\b(ecdh|diffie.?hellman|x25519|x448)\b", "ECDH-P256", "ASYMMETRIC", "CRITICAL", "CWE-326"),
    (r"(?i)\b(dsa\b|diffie_hellman\(|DH_generate)\b", "DH/DSA-2048", "ASYMMETRIC", "CRITICAL", "CWE-326"),
    (r"(?i)\b(md5|hashlib\.md5)\b", "MD5", "HASH", "HIGH", "CWE-327"),
    (r"(?i)\b(sha1|hashlib\.sha1)\b", "SHA-1", "HASH", "MEDIUM", "CWE-327"),
    (r"(?i)\b(des\b|3des|tripledes|blowfish|rc4)\b", "DES/3DES", "SYMMETRIC", "HIGH", "CWE-327"),
    (r"(?i)\b(aes|camellia|chacha20|poly1305)\b", "AES-256-GCM", "SYMMETRIC", "LOW", None),
    (r"(?i)\b(sha256|sha384|sha512|sha3|blake2)\b", "SHA-256", "HASH", "LOW", None),
    (r"(?i)\b(ml[-_]?kem|kyber|ml[-_]?dsa|dilithium|falcon|sphincs)\b", "ML-KEM-768", "POST_QUANTUM", "NONE", None),
]

MISUSE_RULES = [  # (regex, misuse, cwe) — mirrors Model 06 7-type taxonomy
    (r"(?i)\b(des|rc4|md5|sha1)\b", "BROKEN_ALGORITHM", "CWE-327"),
    (r"RSA\.generate\(\s*512\s*\)|modulusLength['\"]?\s*:\s*512", "INSUFFICIENT_KEY_SIZE", "CWE-326"),
    (r"(?i)(secret\s*=\s*['\"][^'\"]{4,}|api_key\s*=\s*['\"][^'\"]{8,}|MASTER_SECRET|sk_live)", "HARDCODED_KEY", "CWE-321"),
    (r"iv\s*=\s*b?['\"]0+['\"]|iv\s*=\s*b?['\"][0-9a-f]{4,}['\"]", "STATIC_IV", "CWE-329"),
    (r"random\.(random|randint|choice)|Math\.random\(\)", "WEAK_RNG", "CWE-330"),
    (r"verify\s*=\s*False|CERT_NONE|checkServerIdentity\s*=\s*\(\)\s*=>", "IMPROPER_CERT_VALIDATION", "CWE-295"),
    (r"hashlib\.(md5|sha1)\(.*password|md5\(\s*salt", "WEAK_PASSWORD_HASH", "CWE-916"),
]

RISK_ORDER = {"CRITICAL": 4, "HIGH": 3, "MEDIUM": 2, "LOW": 1, "NONE": 0}


def shannon(s: str) -> float:
    if not s:
        return 0.0
    freq: dict[str, int] = {}
    for ch in s:
        freq[ch] = freq.get(ch, 0) + 1
    n = len(s)
    return -sum((v / n) * math.log2(v / n) for v in freq.values())


def scan_source(code: str, language: str = "python") -> tuple[list[dict], str]:
    findings, n = [], 0
    for i, line in enumerate(code.splitlines(), 1):
        for rx, algo, cat, risk, cwe in CRYPTO_PATTERNS:
            if re.search(rx, line):
                n += 1
                rec = ("Migrate to NIST FIPS 203 ML-KEM-768 / FIPS 204 ML-DSA-65"
                       if risk == "CRITICAL" else
                       "Replace with SHA-256/SHA-384 or AES-256-GCM"
                       if risk in ("HIGH", "MEDIUM") else "Quantum-safe; monitor.")
                findings.append({"id": f"ECDAT-F{n:03d}", "algorithm": algo,
                                 "category": cat, "status": "QUANTUM_VULNERABLE"
                                 if risk == "CRITICAL" else "SECURE",
                                 "cwe_id": cwe, "line_number": i,
                                 "code_snippet": line.strip()[:120],
                                 "quantum_risk": risk, "confidence": 0.88,
                                 "recommendation": rec})
    for rx, misuse, cwe in MISUSE_RULES:
        for m in re.finditer(rx, code):
            n += 1
            findings.append({"id": f"ECDAT-F{n:03d}", "algorithm": misuse,
                             "category": "MISUSE", "status": "INSECURE",
                             "cwe_id": cwe, "line_number": code[:m.start()].count("\n") + 1,
                             "code_snippet": m.group(0)[:120],
                             "quantum_risk": "HIGH", "confidence": 0.86,
                             "recommendation": f"Fix {misuse} ({cwe})."})
    if not findings:
        findings.append({"id": "ECDAT-F001", "algorithm": "NO_CRYPTO",
                         "category": "NONE", "status": "SECURE", "cwe_id": None,
                         "line_number": None, "code_snippet": code[:80] or "empty",
                         "quantum_risk": "NONE", "confidence": 0.70,
                         "recommendation": "No crypto primitives detected."})
    top = max((f["quantum_risk"] for f in findings), key=lambda r: RISK_ORDER.get(r, 0))
    return findings, top


def scan_binary(raw: bytes) -> tuple[list[dict], str, dict]:
    text = raw.decode("latin1", errors="ignore")
    markers = {"RSA": "RSA-2048", "ECDSA": "ECDSA-P256", "ECDH": "ECDH-P256",
               "AES": "AES-128", "DES": "DES/3DES", "MD5": "MD5", "SHA256": "SHA-256",
               "ML_KEM": "ML-KEM-768", "oqs": "ML-KEM-768", "PRIVATE KEY": "EMBEDDED_KEY"}
    findings, n = [], 0
    for marker, algo in markers.items():
        if marker.lower() in text.lower():
            n += 1
            risk = "NONE" if "ML-KEM" in algo else ("HIGH" if algo == "EMBEDDED_KEY" else "CRITICAL")
            findings.append({"id": f"ECDAT-B{n:03d}", "algorithm": algo,
                             "category": "BINARY", "status": "QUANTUM_VULNERABLE",
                             "cwe_id": "CWE-798" if algo == "EMBEDDED_KEY" else None,
                             "line_number": None, "code_snippet": f"marker:{marker}",
                             "quantum_risk": risk, "confidence": 0.80,
                             "recommendation": "Review binary crypto usage."})
    if not findings:
        findings.append({"id": "ECDAT-B001", "algorithm": "NO_CRYPTO",
                         "category": "NONE", "status": "SECURE", "cwe_id": None,
                         "line_number": None, "code_snippet": "no markers",
                         "quantum_risk": "NONE", "confidence": 0.65,
                         "recommendation": "No crypto markers found."})
    top = max((f["quantum_risk"] for f in findings), key=lambda r: RISK_ORDER.get(r, 0))
    meta = {"hashes": {a: hashlib.new(a.replace("-", ""), raw).hexdigest()
                       for a in ("md5", "sha1", "sha256")},
            "entropy": round(shannon(text[:4096]), 3), "size_bytes": len(raw)}
    return findings, top, meta


def detect_misuse(code: str) -> tuple[list[dict], str]:
    out = []
    for i, (rx, misuse, cwe) in enumerate(MISUSE_RULES, 1):
        if re.search(rx, code):
            out.append({"id": f"ECDAT-M{i:03d}", "algorithm": misuse,
                        "category": "MISUSE", "status": "INSECURE", "cwe_id": cwe,
                        "line_number": None, "code_snippet": code[:100],
                        "quantum_risk": "HIGH", "confidence": 0.87,
                        "recommendation": f"Remediate {misuse} ({cwe})."})
    if not out:
        out.append({"id": "ECDAT-M000", "algorithm": "SECURE",
                    "category": "MISUSE", "status": "SECURE", "cwe_id": None,
                    "line_number": None, "code_snippet": code[:100],
                    "quantum_risk": "NONE", "confidence": 0.80,
                    "recommendation": "No misuse detected."})
    top = "HIGH" if any(f["algorithm"] != "SECURE" for f in out) else "NONE"
    return out, top


QARS_TABLE = {  # (base score, tier) — mirrors Model 25 rule engine defaults
    "RSA-1024": (98, "CRITICAL"), "RSA-2048": (92, "CRITICAL"),
    "ECDSA-P256": (90, "CRITICAL"), "ECDH-P256": (88, "HIGH"),
    "DH-2048": (90, "CRITICAL"), "DES": (85, "HIGH"), "3DES": (78, "HIGH"),
    "MD5": (75, "HIGH"), "SHA-1": (62, "MEDIUM"), "AES-128": (35, "LOW"),
    "AES-256-GCM": (15, "LOW"), "SHA-256": (20, "LOW"),
    "ML-KEM-768": (5, "NONE"), "ML-DSA-65": (5, "NONE"),
}


def qars_score(algorithm: str, key_size: int | None = None) -> dict:
    key = algorithm.strip()
    if key_size and "RSA" in key.upper() and key_size < 2048:
        return {"score": 98, "tier": "CRITICAL", "quantum_risk": "CRITICAL"}
    score, tier = QARS_TABLE.get(key, (50, "MEDIUM"))
    risk = tier if tier in RISK_ORDER else "MEDIUM"
    return {"score": score, "tier": tier, "quantum_risk": risk}


def quantum_cost(algorithm: str, key_size: int | None = None) -> dict:
    a = algorithm.upper()
    if any(k in a for k in ("RSA", "ECDSA", "ECDH", "DSA", "DH")):
        return {"attack": "Shor", "complexity": "polynomial",
                "logical_qubits": 4098 if "RSA-2048" in a or a == "RSA" else 2330,
                "verdict": "broken once CRQC exists", "quantum_risk": "CRITICAL"}
    if "AES-128" in a:
        return {"attack": "Grover", "complexity": "2^64", "verdict": "halved strength",
                "quantum_risk": "MEDIUM"}
    if "AES-256" in a:
        return {"attack": "Grover", "complexity": "2^128", "verdict": "safe margin",
                "quantum_risk": "LOW"}
    if "SHA-256" in a or "SHA256" in a:
        return {"attack": "Grover", "complexity": "2^128", "verdict": "safe margin",
                "quantum_risk": "LOW"}
    if "MD5" in a or "SHA-1" in a or "SHA1" in a:
        return {"attack": "classical collision + Grover", "complexity": "broken classically",
                "verdict": "replace now", "quantum_risk": "HIGH"}
    if "ML-KEM" in a or "ML-DSA" in a or "KYBER" in a or "DILITHIUM" in a:
        return {"attack": "none known", "complexity": "NIST standard",
                "verdict": "PQC safe", "quantum_risk": "NONE"}
    return {"attack": "unknown", "complexity": "n/a", "verdict": "review",
            "quantum_risk": "MEDIUM"}


def local_crypto_api(api_name: str, language: str = "python") -> dict:
    """Direct Model 21 SQLite lookup (no `ecdat.*` imports)."""
    import sys
    from pathlib import Path
    base = Path(__file__).resolve().parent.parent / "models" / "model_21_crypto_api"
    if str(base) not in sys.path:
        sys.path.insert(0, str(base))
    from inference import CryptoAPIKB
    return CryptoAPIKB().classify_api(api_name, language)


def local_trapdoor(code: str = "", algorithm: str = "", fingerprint: str = "") -> dict:
    """Direct Model 23 trapdoor check (stdlib sqlite)."""
    import sys
    from pathlib import Path
    base = Path(__file__).resolve().parent.parent / "models" / "model_23_trapdoor"
    if str(base) not in sys.path:
        sys.path.insert(0, str(base))
    from trapdoor_db import check_trapdoor
    return check_trapdoor({"code_snippet": code, "algorithm": algorithm,
                           "fingerprint": fingerprint})


def b64decode_strict(data: str) -> bytes:
    try:
        return base64.b64decode(data, validate=True)
    except binascii.Error as e:
        raise ValueError(f"binary_data is not valid base64: {e}")


def now_ms(t0: float) -> float:
    return round((time.perf_counter() - t0) * 1000, 1)
