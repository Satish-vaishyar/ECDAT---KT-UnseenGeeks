"""Model 7 ECDATLoRAClient — CI-safe tests (simulation backend, no network/HF)."""
import os
import sys
from pathlib import Path

import pytest

os.environ["MODEL7_BACKEND"] = "simulation"
sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))

from model_07_ecdat_lora.client import ECDATLoRAClient


@pytest.fixture()
def client():
    return ECDATLoRAClient(backend="simulation")


def test_backend_is_simulation(client):
    assert client.get_active_backend() == "simulation"


def test_analyze_rsa_taxonomy(client):
    res = client.analyze_crypto_code(
        "from Crypto.PublicKey import RSA\nkey = RSA.generate(2048)")
    assert res["level_2_algorithm"] == "RSA"
    assert res["level_3_quantum_risk"] == "CRITICAL"
    assert res["backend_used"] == "simulation_ast_reasoner"
    assert "cwe_misuse" in res and "pqc_remediation" in res


def test_analyze_clean_code(client):
    res = client.analyze_crypto_code("def add(a, b):\n    return a + b")
    assert res["level_2_algorithm"] == "NO_CRYPTO"
    assert res["level_3_quantum_risk"] == "NONE"


def test_continue_file_offline(client):
    text = client.continue_codebase_file("ecdat/classification/classifier.py")
    assert isinstance(text, str) and len(text) > 0


def test_adapter_infer_and_chat():
    """Class-E adapter serves Model 7 with zero GPU/downloads (sim backend)."""
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent.parent))
    from fastapi.testclient import TestClient
    import adapter_class_e

    adapter_class_e.MODELS["ecdat_lora"] = ECDATLoRAClient(backend="simulation")
    tc = TestClient(adapter_class_e.app)

    r = tc.post("/v2/models/ecdat_lora/infer", json={
        "model": "ecdat_lora", "version": "v1",
        "input": {"code": "from Crypto.PublicKey import RSA", "language": "python"}})
    assert r.status_code == 200
    assert r.json()["output"]["level_2_algorithm"] == "RSA"

    c = tc.post("/v1/chat/completions", json={
        "model": "ecdat_lora",
        "messages": [{"role": "user", "content": "RSA.generate(2048)"}]})
    assert c.status_code == 200
    assert "RSA" in c.json()["choices"][0]["message"]["content"]

    assert tc.get("/healthz").status_code == 200
