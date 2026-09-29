"""Gateway tests — one per dockerised-model route (standalone fallback, no docker needed)."""
import base64
from fastapi.testclient import TestClient

from gateway.main import app

client = TestClient(app)

RSA = "from Crypto.PublicKey import RSA\nkey = RSA.generate(2048)"
PQC = "from oqs import Kyber\nkem = Kyber('ML-KEM-768')"


def test_root_lists_all_routes():
    r = client.get("/")
    assert r.status_code == 200
    assert len(r.json()["routes"]) >= 22
    assert r.json()["not_dockerised"] == []


def test_health():
    assert client.get("/healthz").status_code == 200
    assert client.get("/readyz").status_code == 200
    assert client.get("/api/v1/health").status_code == 200


def test_scan_source_m01():
    r = client.post("/api/v1/scan/source", json={"code": RSA, "language": "python"})
    assert r.status_code == 200
    assert r.json()["model"] == "ast_cryptonet"


def test_scan_binary_m02():
    raw = base64.b64encode(b"\x7fELF" + b"\x00" * 64 + b"RSA_generate_key").decode()
    r = client.post("/api/v1/scan/binary", json={"binary_data": raw})
    assert r.status_code == 200
    assert r.json()["model"] == "bincryptocnn"


def test_entropy_m03():
    r = client.post("/api/v1/scan/entropy", json={"code": "api_key=sk_live_abc123XYZ789qrs"})
    assert r.status_code == 200
    assert r.json()["model"] == "entropyguard"


def test_misuse_m06():
    r = client.post("/api/v1/classify/misuse",
                    json={"code": "import hashlib\nh = hashlib.md5(pw).hexdigest()"})
    assert r.status_code == 200
    assert r.json()["model"] == "misusedetector"


def test_classify_proxy():
    r = client.post("/api/v1/classify", json={"code": PQC})
    assert r.status_code == 200


def test_risk_m25_m26_m27():
    assert client.post("/api/v1/risk/score", json={"algorithm": "RSA-2048"}).status_code == 200
    r = client.post("/api/v1/risk/monte-carlo", json={"iterations": 100})
    assert r.status_code == 200 and "p50" in str(r.json())
    assert client.post("/api/v1/risk/forecast",
                       json={"algorithm": "RSA-2048", "horizon_days": 7}).status_code == 200
    assert client.post("/api/v1/risk/gnn", json={"algorithm_id": "RSA-2048"}).status_code == 200


def test_quantum_m20():
    assert client.get("/api/v1/quantum/attack-costs/RSA-2048").status_code == 200
    r = client.post("/api/v1/quantum/cost", json={"algorithm": "AES-256", "key_size": 256})
    assert r.status_code == 200
    assert client.post("/api/v1/quantum/mosca", json={}).status_code == 200


def test_knowledge_m12_13_14_15_17_18_22_24():
    assert client.post("/api/v1/knowledge/query", json={"query": "migrate RSA"}).status_code == 200
    assert client.post("/api/v1/rag/search", json={"query": "FIPS 203"}).status_code == 200
    assert client.post("/api/v1/knowledge/hybrid", json={"query": "AES"}).status_code == 200
    assert client.post("/api/v1/knowledge/vector", json={"query": "Kyber"}).status_code == 200
    assert client.post("/api/v1/knowledge/trust",
                       json={"source": "NIST", "claim": "ML-KEM standard"}).status_code == 200
    assert client.post("/api/v1/knowledge/temporal",
                       json={"algorithm": "RSA-2048"}).status_code == 200
    assert client.post("/api/v1/knowledge/vuln", json={"query": "openssl"}).status_code == 200
    assert client.post("/api/v1/knowledge/compliance",
                       json={"algorithm": "RSA-2048", "region": "IN"}).status_code == 200


def test_crypto_api_m21():
    r = client.post("/api/v1/knowledge/crypto-api",
                    json={"api_name": "Cipher", "language": "python"})
    assert r.status_code == 200
    body = r.json()
    assert body["model"] == "crypto_api"
    assert body["total_findings"] == 1
    assert body["findings"][0]["algorithm"] == "AES"


def test_trapdoor_m23():
    r = client.post("/api/v1/security/trapdoor",
                    json={"code_snippet": "ctx = Dual_EC_DRBG(seed)"})
    assert r.status_code == 200
    body = r.json()
    assert body["model"] == "trapdoor"
    assert body["metadata"]["match"] is True
    assert body["total_findings"] >= 1
    r2 = client.post("/api/v1/security/trapdoor",
                     json={"code_snippet": "AESGCM(key).encrypt(nonce, pt, None)"})
    assert r2.json()["metadata"]["match"] is False


def test_llm_ecdat_lora_m07_shape():
    r = client.post("/api/v1/llm/generate",
                    json={"prompt": "Continue ecdat file", "model": "ecdat_lora"})
    assert r.status_code == 200
    assert r.json()["model"] == "ecdat_lora"


def test_llm_m08_09_10_11_shape():
    # downstream GPU absent in CI -> 200 fallback envelope (not 422/500)
    r = client.post("/api/v1/llm/generate",
                    json={"prompt": "Explain RSA vs ML-KEM", "model": "deepseek_coder"})
    assert r.status_code == 200
    r11 = client.post("/api/v1/llm/generate",
                      json={"prompt": "What is ML-KEM-768?", "model": "gemini_flash"})
    assert r11.status_code == 200
    assert r11.json()["model"] == "gemini_flash"
    assert client.post("/api/v1/llm/generate",
                       json={"prompt": "x", "model": "nope"}).status_code == 422


def test_remediate_robust_redteam_calibrate():
    assert client.post("/api/v1/remediate",
                       json={"vulnerable_code": RSA,
                             "target_algorithm": "ML-KEM-768"}).status_code == 200
    assert client.post("/api/v1/robust/detect",
                       json={"code": "eval(x)"}).status_code == 200
    assert client.post("/api/v1/security/redteam",
                       json={"model_id": "bincryptocnn"}).status_code == 200
    r = client.post("/api/v1/system/calibrate",
                    json={"raw_score": 0.8, "model_id": "ast_cryptonet"})
    assert r.status_code == 200 and "calibrated_prob" in str(r.json())
