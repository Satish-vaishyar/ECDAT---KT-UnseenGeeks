"""Focused gateway checks for models added to all_models."""
from fastapi.testclient import TestClient

from gateway.main import app


client = TestClient(app)


def test_model06_local_classifier_is_used():
    response = client.post("/api/v1/classify/misuse",
                           json={"code": "key = RSA.generate(512)"})
    assert response.status_code == 200
    body = response.json()
    assert body["model_id"] == "06"
    assert "all_models/model_06" in body["docker_service"]
    assert body["metadata"]["artifact_backed"] is True


def test_models08_to_11_simulation_route_is_available(monkeypatch):
    # Offline intent: never spend cloud credits when a key exists in .env.
    monkeypatch.delenv("FEATHERLESS_API_KEY", raising=False)
    monkeypatch.delenv("NVIDIA_API_KEY", raising=False)
    monkeypatch.delenv("GROQ_API_KEY", raising=False)
    response = client.post("/api/v1/llm/generate",
                           json={"model": "deepseek_coder", "prompt": "use RSA-2048"})
    assert response.status_code == 200
    body = response.json()
    assert body["model_id"] == "08"
    assert body["metadata"]["backend"].startswith("simulation")


def test_models25_and_26_use_local_artifacts():
    score = client.post("/api/v1/risk/score", json={"algorithm": "RSA-2048"})
    monte_carlo = client.post("/api/v1/risk/monte-carlo",
                              json={"iterations": 100, "seed": 12345})
    assert score.status_code == 200
    assert monte_carlo.status_code == 200
    assert score.json()["metadata"]["artifact_backed"] is True
    assert monte_carlo.json()["metadata"]["artifact_backed"] is True


def test_model12_uses_bundled_cdkg_graph():
    response = client.post("/api/v1/knowledge/query", json={"query": "RSA-2048"})
    assert response.status_code == 200
    body = response.json()
    assert body["model_id"] == "12"
    assert body["metadata"]["artifact_backed"] is True
    assert body["metadata"]["model_output"]["quantum_risk_level"] == "CRITICAL"


def test_models19_and_29_local_artifacts_are_reachable():
    gnn = client.post("/api/v1/risk/gnn", json={"algorithm_id": "RSA-2048"})
    redteam = client.post("/api/v1/security/redteam",
                          json={"model_id": "demo", "features": [0.0] * 147})
    assert gnn.status_code == 200
    assert redteam.status_code == 200
    assert gnn.json()["metadata"]["artifact_backed"] is True
    assert redteam.json()["metadata"]["artifact_backed"] is True


def test_model18_uses_bundled_temporal_graph():
    response = client.post("/api/v1/knowledge/temporal",
                           json={"algorithm": "ALG-RSA-2048", "date": "2024-12-31"})
    assert response.status_code == 200
    body = response.json()
    result = body["metadata"]["model_output"]
    assert body["metadata"]["artifact_backed"] is True
    assert result["result"]["algorithm"] == "RSA-2048"
    assert result["result"]["status"] in {"active", "deprecated", "unknown"}


def test_model19_uses_bundled_risk_dataset():
    response = client.post("/api/v1/risk/gnn", json={"algorithm_id": "RSA-2048"})
    assert response.status_code == 200
    result = response.json()["metadata"]["model_output"]
    assert result["dataset_backed"] is True
    assert result["dataset_node_id"] == "ALG-RSA-2048"
