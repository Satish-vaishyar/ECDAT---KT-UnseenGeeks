"""Route tests for Phase 1 orphan wiring + Phase 2 AI chat (standalone, no docker)."""
import sys
from pathlib import Path

from fastapi.testclient import TestClient

from gateway.main import app
from src.ecdat.core.all_models_runtime import _model_backend

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "all_models"))

client = TestClient(app)


def test_models_status_all_wired():
    r = client.get("/api/v1/models/status")
    assert r.status_code == 200
    body = r.json()
    assert body["count"] == 29 and body["wired"] == 29
    by_id = {m["id"]: m for m in body["models"]}
    for mid in ("01", "08", "16", "20", "21", "22", "28"):
        assert by_id[mid]["wired"] is True
        assert by_id[mid]["route"]


def test_risk_portfolio_shape():
    r = client.get("/api/v1/risk/portfolio")
    assert r.status_code == 200
    body = r.json()
    assert body["qday"]["p50"] > 2000
    assert body["worst"]
    assert len(body["risers"]) >= 4


def test_ai_chat_json_and_validation(monkeypatch):
    # Force offline simulation: never spend cloud credits in unit tests.
    monkeypatch.delenv("FEATHERLESS_API_KEY", raising=False)
    monkeypatch.delenv("NVIDIA_API_KEY", raising=False)
    monkeypatch.delenv("GROQ_API_KEY", raising=False)
    ok = client.post("/api/v1/ai/chat", json={
        "model": "deepseek_coder",
        "messages": [{"role": "user", "content": "hashlib.md5(x)"}],
    })
    assert ok.status_code == 200
    assert ok.json()["metadata"]["backend"] == "simulation_fallback"
    bad = client.post("/api/v1/ai/chat", json={
        "model": "nope", "messages": [{"role": "user", "content": "hi"}]})
    assert bad.status_code == 422
    empty = client.post("/api/v1/ai/chat", json={"model": "deepseek_coder", "messages": []})
    assert empty.status_code == 422


def test_ai_chat_stream_sse(monkeypatch):
    monkeypatch.delenv("FEATHERLESS_API_KEY", raising=False)
    monkeypatch.delenv("NVIDIA_API_KEY", raising=False)
    monkeypatch.delenv("GROQ_API_KEY", raising=False)
    r = client.post("/api/v1/ai/chat", json={
        "model": "starcoder2",
        "messages": [{"role": "user", "content": "explain RSA"}],
        "stream": True,
    })
    assert r.status_code == 200
    assert "text/event-stream" in r.headers["content-type"]
    assert "data: [DONE]" in r.text
    assert r.text.count("data: ") >= 2


def test_knowledge_embed_route():
    r = client.post("/api/v1/knowledge/embed", json={"query": "key encapsulation", "top_k": 2})
    assert r.status_code == 200
    assert r.json()["model_id"] == "16"


def test_crypto_api_uses_all_models_copy():
    r = client.post("/api/v1/knowledge/crypto-api",
                    json={"api_name": "hashlib.md5", "language": "python"})
    assert r.status_code == 200
    assert r.json()["metadata"]["kb_hit"]["kb_source"] == "all_models/model_21"


def test_vuln_search_and_rerank_status():
    r = client.post("/api/v1/knowledge/vuln", json={"query": "RSA", "top_k": 3})
    assert r.status_code == 200
    assert r.json()["metadata"]["rerank_status"] in ("ACTUAL", "SKIPPED", "FALLBACK")


def test_migration_cost_includes_costnet():
    r = client.post("/api/v1/migration/cost", json={
        "algorithm": "RSA-2048", "key_size": 2048,
        "instances_count": 10, "deployment_env": "production"})
    assert r.status_code == 200
    assert r.json()["metadata"]["costnet_status"] == "ACTUAL"


def test_scan_source_model01_calibration():
    r = client.post("/api/v1/scan/source",
                    json={"code": "import hashlib\nh = hashlib.md5(data)", "language": "python"})
    assert r.status_code == 200
    assert r.json()["metadata"]["model01_status"] == "ACTUAL"


def test_quantum_cost_model20_estimate():
    r = client.post("/api/v1/quantum/cost", json={"algorithm": "RSA-2048", "key_size": 2048})
    assert r.status_code == 200
    assert r.json()["metadata"]["model20_status"] == "ACTUAL"
    g = client.get("/api/v1/quantum/attack-costs/RSA-2048")
    assert g.status_code == 200


def test_root_lists_new_routes():
    routes = [e["route"] for e in client.get("/").json()["routes"]]
    assert "GET /api/v1/models/status" in routes
    assert "POST /api/v1/ai/chat" in routes
    assert "POST /api/v1/knowledge/embed" in routes


def test_featherless_backend_selection(monkeypatch):
    monkeypatch.setenv("FEATHERLESS_API_KEY", "test-key")
    monkeypatch.delenv("NVIDIA_API_KEY", raising=False)
    monkeypatch.delenv("GROQ_API_KEY", raising=False)
    assert _model_backend(8) == "featherless"
    monkeypatch.delenv("FEATHERLESS_API_KEY")
    assert _model_backend(8) in ("auto", "simulation")


def test_deepseek_client_featherless_resolution(monkeypatch):
    from model_08.client import DeepSeekClient
    monkeypatch.setenv("FEATHERLESS_API_KEY", "test-key")
    monkeypatch.delenv("NVIDIA_API_KEY", raising=False)
    monkeypatch.delenv("GROQ_API_KEY", raising=False)
    monkeypatch.delenv("MODEL8_BACKEND", raising=False)
    c = DeepSeekClient(backend="auto")
    assert c._is_featherless() is True
    assert c.get_active_backend() == "featherless"
    assert c.remote_model == "deepseek-ai/DeepSeek-R1-Distill-Qwen-14B"
    monkeypatch.delenv("FEATHERLESS_API_KEY")
    c3 = DeepSeekClient(backend="featherless")
    assert c3.get_active_backend() == "simulation_fallback"
    assert list(c3.chat_stream([{"role": "user", "content": "hi"}]))


def test_deepseek_reasoning_field_extraction():
    from model_08.client import DeepSeekClient
    c = DeepSeekClient(backend="simulation")
    out = c._extract_json('{"level_1_family": "HASH", "level_2_algorithm": "MD5", "level_3_quantum_risk": "HIGH"}')
    assert out and c._validate_response(out) is True
    assert c._extract_json("not json at all") is None
