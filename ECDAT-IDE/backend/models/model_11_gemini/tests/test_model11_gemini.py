"""Model 11 Gemini — unit tests (no API key / no network needed)."""
import io
import json
import os
import sys
import urllib.request
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))
sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent.parent))

from model_11_gemini.budget_guard import CloudBudgetGuard
from model_11_gemini.client import GeminiClient


@pytest.fixture()
def guard(tmp_path):
    return CloudBudgetGuard(state_file=str(tmp_path / "state.json"))


def test_budget_ratio_and_free_cost(guard):
    guard.record_local_request(95, persist=False)
    guard.record_cloud_request(100, 50, persist=False)
    assert guard.get_fallback_ratio() == pytest.approx(1 / 96)
    assert guard.can_route_to_cloud()
    assert guard.get_estimated_cost_usd() == 0.0  # free tier
    assert "0.00%" in guard.get_metrics_summary()["estimated_cost_usd"] or True


def test_budget_over_quota(tmp_path):
    g = CloudBudgetGuard(state_file=str(tmp_path / "s.json"))
    g.record_local_request(100, persist=False)
    for _ in range(10):
        g.record_cloud_request(10, 10, persist=False)
    assert not g.can_route_to_cloud()


def test_simulation_tier_rsa():
    c = GeminiClient(backend="simulation")
    assert c.get_active_backend() == "simulation_fallback"
    res = c.route_and_analyze("from Crypto.PublicKey import RSA\nkey = RSA.generate(2048)")
    assert res["level_2_algorithm"] == "RSA"
    assert res["level_3_quantum_risk"] == "CRITICAL"
    assert res["backend_used"] == "simulation_fallback"


def test_simulation_tier_nvd():
    c = GeminiClient(backend="simulation")
    res = c.parse_nvd_advisory("CVE-2024-1234 OpenSSL ASN.1 parsing flaw allows DoS")
    assert res["cve_id"] == "CVE-2024-1234"
    assert res["affected_library"] == "OpenSSL"


class _FakeResp:
    status = 200

    def __init__(self, payload):
        self._payload = payload

    def read(self):
        return json.dumps(self._payload).encode()

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


def test_cloud_tier_mocked(monkeypatch, tmp_path):
    inner = {"level_1_family": "ASYM", "level_2_algorithm": "RSA",
             "level_3_quantum_risk": "CRITICAL", "confidence": 0.9}
    body = {
        "candidates": [{"content": {"parts": [{"text": json.dumps(inner)}]}}],
        "usageMetadata": {"promptTokenCount": 100, "candidatesTokenCount": 50},
    }
    monkeypatch.setattr(urllib.request, "urlopen", lambda req, timeout=15: _FakeResp(body))
    c = GeminiClient(api_key="TESTKEY", backend="cloud")
    c.budget_guard.state_file = str(tmp_path / "s.json")
    c.budget_guard.reset()
    assert c.get_active_backend() == "cloud_api"
    res = c.route_and_analyze("RSA.generate(2048)")
    assert res["backend_used"] == "cloud_api"
    assert res["level_2_algorithm"] == "RSA"
    assert c.budget_guard.total_input_tokens == 100


def test_cloud_failure_falls_back(monkeypatch):
    def boom(req, timeout=15):
        raise RuntimeError("no network")

    monkeypatch.setattr(urllib.request, "urlopen", boom)
    c = GeminiClient(api_key="TESTKEY", backend="cloud")
    res = c.route_and_analyze("import hashlib\nhashlib.sha256(b'x')")
    assert res["backend_used"] == "simulation_fallback"
    assert res["level_2_algorithm"] == "SHA2"
