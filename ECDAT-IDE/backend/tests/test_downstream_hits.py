"""Downstream-hit branches: every router's class-a/b/c/e path with a stubbed service.

Monkeypatches gateway.client.downstream_infer so no docker is needed; asserts
each route prefers the downstream hit and labels it honestly.
"""
import pytest
from fastapi.testclient import TestClient

from gateway import client as C
from gateway.main import app

client = TestClient(app)

BODY = {
    "output": {
        "findings": [{"id": "X", "algorithm": "RSA", "category": "T", "status": "S",
                      "quantum_risk": "HIGH", "confidence": 0.9, "recommendation": "R"}],
        "total_findings": 1,
        "quantum_risk": "HIGH",
        "rankings": [{"algorithm": "RSA-2048", "score": 90}],
        "results": [{"found": True, "algorithm": "RSA", "security_status": "WEAK",
                     "quantum_class": "quantum_broken", "api": "hashlib.md5",
                     "replacement": "hashlib.sha256"}],
    },
    "confidence": 0.9,
    "latency_ms": 1.0,
    "choices": [{"message": {"content": "stubbed"}}],
    "usage": {},
}


async def _hit(model, payload):
    return {"body": BODY, "_service": "stub"}


@pytest.fixture(autouse=True)
def _stub_downstream(monkeypatch):
    monkeypatch.setattr(C, "downstream_infer", _hit)


def _svc(r):
    return r.json()["docker_service"]


def test_scan_hit_branches():
    assert "stub" in _svc(client.post("/api/v1/scan/source", json={"code": "x", "language": "python"}))
    import base64
    raw = base64.b64encode(b"\x7fELF" + b"\x00" * 16).decode()
    assert "stub" in _svc(client.post("/api/v1/scan/binary", json={"binary_data": raw}))
    assert "stub" in _svc(client.post("/api/v1/scan/entropy", json={"code": "secret-abc-123"}))


def test_classify_and_llm_hit_branches():
    assert "stub" in _svc(client.post("/api/v1/classify", json={"code": "x"}))
    assert "stub" in _svc(client.post("/api/v1/classify/misuse", json={"code": "x"}))
    r = client.post("/api/v1/llm/generate", json={"model": "deepseek_coder", "prompt": "x"})
    assert r.status_code == 200
    assert r.json()["metadata"]["text"] == "stubbed"


def test_knowledge_hit_branches():
    assert "stub" in _svc(client.post("/api/v1/knowledge/query", json={"query": "q", "top_k": 1}))
    assert "stub" in _svc(client.post("/api/v1/rag/search", json={"query": "q", "top_k": 1}))
    assert "stub" in _svc(client.post("/api/v1/knowledge/hybrid", json={"query": "q", "top_k": 1}))
    assert "stub" in _svc(client.post("/api/v1/knowledge/vector", json={"query": "q", "top_k": 1}))
    assert "stub" in _svc(client.post("/api/v1/knowledge/embed", json={"query": "q", "top_k": 1}))
    assert "stub" in _svc(client.post("/api/v1/knowledge/trust", json={"source": "nist"}))
    assert "stub" in _svc(client.post("/api/v1/knowledge/temporal", json={"algorithm": "RSA-2048"}))
    r = client.post("/api/v1/knowledge/vuln", json={"query": "q", "top_k": 1})
    assert "stub" in _svc(r)
    r = client.post("/api/v1/knowledge/crypto-api", json={"api_name": "hashlib.md5", "language": "python"})
    assert r.json()["total_findings"] == 1
    r = client.post("/api/v1/knowledge/compliance", json={"algorithm": "RSA-2048"})
    assert "stub" in _svc(r)


def test_risk_quantum_trapdoor_hit_branches():
    assert "stub" in _svc(client.post("/api/v1/risk/score", json={"algorithm": "RSA-2048"}))
    assert "stub" in _svc(client.post("/api/v1/quantum/cost", json={"algorithm": "RSA-2048"}))
    r = client.post("/api/v1/security/trapdoor", json={"code_snippet": "x"})
    assert r.status_code == 200
