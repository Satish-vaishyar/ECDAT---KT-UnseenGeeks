"""Tests for Gateway Spec-Compliance Router (compat.py).

Verifies all 7 gap areas documented in doc/GATEWAY_SPEC_COMPLIANCE_REPORT.md:
1. Dedicated QARS / HNDL + Batch
2. Mosca Batch
3. Attack-Cost List, PQC Matrix, QSCRS, Temporal Risk
4. Scan Lifecycle (201 create, store, findings, cbom, risk, compliance, migration, report)
5. Intel RAG, Compliance (CERT-In, DPDP, DST), and Audit Log
6. Remediation Rules & Roadmap
7. Per-Component Health Probes
"""
from fastapi.testclient import TestClient
from gateway.main import app

client = TestClient(app)


def test_root_routes_extended():
    r = client.get("/")
    assert r.status_code == 200
    data = r.json()
    assert len(data["routes"]) >= 32


def test_qars_and_hndl():
    # QARS single & batch
    r = client.post("/api/v1/quantum/qars", json={"algorithm": "RSA-2048", "key_size": 2048})
    assert r.status_code == 200
    assert r.json()["qars_score"] == 85.0
    assert r.json()["quantum_vulnerable"] is True

    r = client.post("/api/v1/quantum/qars/batch", json=[
        {"algorithm": "RSA-1024", "key_size": 1024},
        {"algorithm": "AES-256", "key_size": 256},
    ])
    assert r.status_code == 200
    assert r.json()["count"] == 2

    # Weights
    r = client.get("/api/v1/quantum/qars/weights")
    assert r.status_code == 200
    assert "weights" in r.json()

    # HNDL single & batch (Formula: min(100, V * S * R * E / 100))
    r = client.post("/api/v1/quantum/hndl", json={
        "algorithm": "RSA-2048",
        "vulnerability": 8.0,
        "shelf_life": 7.0,
        "reconnaissance": 6.0,
        "economic_value": 8.0,
    })
    assert r.status_code == 200
    # (8 * 7 * 6 * 8) / 100 = 26.88 -> 26.9
    assert r.json()["hndl_score"] == 26.9
    assert r.json()["risk_level"] in ("MEDIUM", "HIGH", "CRITICAL")

    r = client.post("/api/v1/quantum/hndl/batch", json=[
        {"algorithm": "RSA-2048", "vulnerability": 9.0, "shelf_life": 8.0, "reconnaissance": 7.0, "economic_value": 9.0},
        {"algorithm": "AES-256", "vulnerability": 2.0, "shelf_life": 2.0, "reconnaissance": 2.0, "economic_value": 2.0},
    ])
    assert r.status_code == 200
    assert r.json()["count"] == 2


def test_mosca_batch():
    r = client.post("/api/v1/quantum/mosca/batch", json=[
        {"shelf_life_years": 10.0, "migration_years": 5.0, "qday_years": 12.0, "algorithm": "RSA-2048"},
        {"shelf_life_years": 2.0, "migration_years": 1.0, "qday_years": 15.0, "algorithm": "AES-256"},
    ])
    assert r.status_code == 200
    res = r.json()["results"]
    assert res[0]["exposed"] is True   # 10 + 5 > 12
    assert res[1]["exposed"] is False  # 2 + 1 < 15


def test_attack_costs_pqc_matrix_qscrs_temporal():
    # Attack costs list
    r = client.get("/api/v1/quantum/attack-costs")
    assert r.status_code == 200
    assert r.json()["count"] >= 10

    # PQC matrix list and item
    r = client.get("/api/v1/quantum/pqc-matrix")
    assert r.status_code == 200
    assert r.json()["count"] == 12

    r = client.get("/api/v1/quantum/pqc-matrix/RSA-2048")
    assert r.status_code == 200
    assert "ML-KEM" in r.json()["recommended_pqc"]

    # QSCRS list and item
    r = client.get("/api/v1/quantum/qscrs")
    assert r.status_code == 200
    assert r.json()["count"] == 6

    r = client.get("/api/v1/quantum/qscrs/RSA-2048")
    assert r.status_code == 200
    assert "side_channel_evaluation" in r.json()

    # Temporal risk predict & retrain
    r = client.post("/api/v1/quantum/temporal-risk/predict", json={"algorithm": "RSA-2048", "horizon_days": 30})
    assert r.status_code == 200
    assert r.json()["predicted_risk_score"] > 80.0

    r = client.post("/api/v1/quantum/temporal-risk/retrain")
    assert r.status_code == 200
    assert r.json()["status"] == "training_initiated"


def test_scan_lifecycle():
    # 1. Create scan (Must be 201 Created)
    r = client.post("/api/v1/scan", json={"target_path": "c:/pqc sih/test_project", "scanner_types": ["source"]})
    assert r.status_code == 201
    scan_id = r.json()["scan_id"]
    assert scan_id.startswith("scan-")

    # 2. Get status
    r = client.get(f"/api/v1/scan/{scan_id}")
    assert r.status_code == 200
    assert r.json()["status"] == "completed"

    # 3. Get findings
    r = client.get(f"/api/v1/scan/{scan_id}/findings")
    assert r.status_code == 200
    assert r.json()["total"] >= 1

    # 4. Get CBOM (CycloneDX 1.6)
    r = client.get(f"/api/v1/scan/{scan_id}/cbom")
    assert r.status_code == 200
    assert r.json()["bomFormat"] == "CycloneDX"
    assert r.json()["specVersion"] == "1.6"

    # 5. Get Risk
    r = client.get(f"/api/v1/scan/{scan_id}/risk")
    assert r.status_code == 200
    assert "qars_overall" in r.json()

    # 6. Get Compliance
    r = client.get(f"/api/v1/scan/{scan_id}/compliance")
    assert r.status_code == 200
    assert "cert_in_v2_status" in r.json()

    # 7. Get Migration
    r = client.get(f"/api/v1/scan/{scan_id}/migration")
    assert r.status_code == 200
    assert "recommended_targets" in r.json()

    # 8. Post Report
    r = client.post(f"/api/v1/scan/{scan_id}/report")
    assert r.status_code == 200
    assert r.json()["status"] == "ready"


def test_intel_compliance_audit():
    # RAG
    r = client.post("/api/v1/intel/rag/query", json={"query": "Kyber standard"})
    assert r.status_code == 200
    assert r.json()["count"] >= 1

    r = client.post("/api/v1/intel/rag/ingest", json={"documents": [{"text": "Doc 1"}]})
    assert r.status_code == 200
    assert r.json()["status"] == "ingested"

    r = client.post("/api/v1/intel/rag/sync")
    assert r.status_code == 200
    assert r.json()["status"] == "synced"

    # Compliance
    r = client.post("/api/v1/compliance/cert-in", json={})
    assert r.status_code == 200
    assert r.json()["elements_evaluated"] == 8

    r = client.post("/api/v1/compliance/dpdp", json={})
    assert r.status_code == 200
    assert "DPDP Act" in r.json()["framework"]

    r = client.get("/api/v1/compliance/dst/status")
    assert r.status_code == 200
    assert "milestones" in r.json()

    r = client.get("/api/v1/compliance/report/scan-1234")
    assert r.status_code == 200
    assert "frameworks" in r.json()

    # Audit log
    r = client.get("/api/v1/audit/entries")
    assert r.status_code == 200
    assert r.json()["count"] >= 1

    r = client.post("/api/v1/audit/verify")
    assert r.status_code == 200
    assert r.json()["chain_intact"] is True


def test_remediation_rules_and_roadmap():
    # Evaluate rule
    r = client.post("/api/v1/remediation/rules/evaluate", json={"algorithm": "RSA-2048"})
    assert r.status_code == 200
    assert "ML-KEM" in r.json()["recommended_action"]

    # Rules list
    r = client.get("/api/v1/remediation/rules")
    assert r.status_code == 200
    assert r.json()["count"] >= 4

    # Create rule
    r = client.post("/api/v1/remediation/rules", json={
        "name": "Custom Rule",
        "target_family": "ASYM",
        "source_algorithm": "CUSTOM-ALGO",
        "recommended_replacement": "ML-KEM-1024",
    })
    assert r.status_code == 200

    # Roadmap
    r = client.post("/api/v1/remediation/roadmap", json={"scan_id": "scan-1234", "team_size": 5})
    assert r.status_code == 200
    assert len(r.json()["phases"]) == 4

    # Gantt
    r = client.get("/api/v1/remediation/roadmap/scan-1234/gantt")
    assert r.status_code == 200
    assert len(r.json()["gantt"]) >= 4


def test_component_health_probes():
    for comp in ["redis", "postgres", "ollama", "minio", "class-a-cpu"]:
        r = client.get(f"/api/v1/health/{comp}")
        assert r.status_code == 200
        assert r.json()["status"] == "up"
