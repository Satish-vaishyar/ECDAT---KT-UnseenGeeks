"""Edge branches: AI error paths, portfolio degradation, file-path scans."""
from fastapi.testclient import TestClient

import gateway.routers.ai as ai_router
import gateway.routers.risk as risk_router
from gateway.main import app

client = TestClient(app)


def test_ai_chat_backend_failure_paths(monkeypatch):
    async def boom(*a, **k):
        raise RuntimeError("gpu gone")

    monkeypatch.setattr(ai_router, "model_reason_stream", boom)
    r = client.post("/api/v1/ai/chat", json={
        "model": "deepseek_coder",
        "messages": [{"role": "user", "content": "hi"}]})
    assert r.status_code == 503
    s = client.post("/api/v1/ai/chat", json={
        "model": "deepseek_coder",
        "messages": [{"role": "user", "content": "hi"}],
        "stream": True})
    assert s.status_code == 200
    assert "Stream error" in s.text or "[DONE]" in s.text


def test_ai_chat_non_json_text_wrapped(monkeypatch):
    def plain(*a, **k):
        yield from ["just ", "text"]

    monkeypatch.setattr(ai_router, "model_reason_stream", plain)
    r = client.post("/api/v1/ai/chat", json={
        "model": "deepseek_coder",
        "messages": [{"role": "user", "content": "hi"}]})
    assert r.status_code == 200
    assert r.json()["metadata"]["model_output"] == {"text": "just text"}


def test_portfolio_degraded_when_qday_fails(monkeypatch):
    def boom(*a, **k):
        raise RuntimeError("no sim")

    monkeypatch.setattr(risk_router, "model26_simulation", boom)
    r = client.get("/api/v1/risk/portfolio")
    assert r.status_code == 200
    assert r.json()["risers"] == []
    assert r.json()["qday"] is None


def test_scan_source_file_path_and_validation(tmp_path):
    target = tmp_path / "weak.py"
    target.write_text("import hashlib\nh = hashlib.md5(x)", encoding="utf-8")
    r = client.post("/api/v1/scan/source", json={"code": "", "file_path": str(target)})
    assert r.status_code == 200
    assert r.json()["total_findings"] >= 1
    assert client.post("/api/v1/scan/source",
                       json={"code": "", "file_path": str(tmp_path / "nope.py")}).status_code == 400
    assert client.post("/api/v1/scan/source", json={"code": ""}).status_code == 422
