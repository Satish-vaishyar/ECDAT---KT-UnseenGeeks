"""
Comprehensive Test Suite for Binary File Scanning & Model 2 Classification.

Tests:
1. Generation & structure verification of the binary artifact (data/demo_test_suite/vulnerable_crypto_app.bin).
2. Model 2 (BinCryptoCNN) 4096-dim feature extraction, 64-constant table detection, and neural inference.
3. API Gateway 'POST /api/v1/scan/binary' endpoint with base64 payload.
4. API Gateway 'POST /api/v1/scan' full lifecycle audit (CBOM, QARS, compliance, migration targets).
"""
import os
import sys
import base64
import json
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parent.parent
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

import pytest
from fastapi.testclient import TestClient
from gateway.main import app

client = TestClient(app)

BIN_PATH = Path("data/demo_test_suite/vulnerable_crypto_app.bin")
EXE_PATH = Path("data/demo_test_suite/vulnerable_crypto_app.exe")


def test_binary_file_exists_and_valid():
    """Verify binary artifact exists, has proper PE header and minimum size."""
    assert BIN_PATH.exists(), f"Binary file not found at {BIN_PATH}"
    assert EXE_PATH.exists(), f"Executable file not found at {EXE_PATH}"
    
    raw = BIN_PATH.read_bytes()
    assert len(raw) >= 4096, f"Binary size {len(raw)} bytes is too small"
    assert raw[:2] == b"MZ", "Missing DOS/PE magic header (MZ)"
    assert b"PE\x00\x00" in raw, "Missing PE signature"
    assert b"-----BEGIN RSA PRIVATE KEY-----" in raw, "Missing hardcoded RSA private key"


def test_model2_feature_extractor():
    """Test Model 2 feature extractor against the binary file."""
    sys.path.append("models/model_02_bincryptocnn/scripts")
    try:
        from extract_real_features import extract
    except ImportError:
        pytest.skip("extract_real_features not available")

    res = extract(str(BIN_PATH))
    assert res["vector"].shape == (4096,)
    assert res["crypto_hits"] >= 10, f"Expected >= 10 crypto hits, got {res['crypto_hits']}"
    
    # Check detected algorithm families
    families = res["detected_families"]
    assert "RSA" in families, f"RSA family not detected in {families}"
    assert "KEYSTORE" in families, f"KEYSTORE family not detected in {families}"
    assert "AES" in families, f"AES family not detected in {families}"


def test_gateway_scan_binary_api():
    """Test API Gateway POST /api/v1/scan/binary with base64-encoded binary."""
    raw = BIN_PATH.read_bytes()
    b64_data = base64.b64encode(raw).decode("ascii")

    response = client.post(
        "/api/v1/scan/binary",
        json={
            "binary_data": b64_data,
            "file_path": str(BIN_PATH)
        }
    )
    assert response.status_code == 200, response.text
    data = response.json()

    assert data["model"] == "bincryptocnn"
    assert data["model_id"] == "02"
    assert data["quantum_risk"] == "CRITICAL"
    if data.get("metadata", {}).get("artifact_backed"):
        # Model 02 artifact path (torch installed): single model verdict.
        assert data["total_findings"] == 1
        assert data["findings"][0]["category"] == "BINARY_MODEL"
        return

    assert data["total_findings"] >= 5

    # Check specific algorithm detections
    detected_algos = {f["algorithm"] for f in data["findings"]}
    assert "RSA-2048" in detected_algos
    assert "ECDSA-P256" in detected_algos
    assert "EMBEDDED_KEY" in detected_algos
    assert "DES/3DES" in detected_algos

    # Check metadata
    meta = data["metadata"]
    assert "hashes" in meta
    assert "sha256" in meta["hashes"]
    assert meta["entropy"] > 4.0
    assert meta["size_bytes"] == len(raw)


def test_gateway_full_scan_lifecycle_for_binary():
    """Test full scan lifecycle (POST /api/v1/scan) targeting binary file."""
    res = client.post(
        "/api/v1/scan",
        json={
            "target_path": str(BIN_PATH),
            "scanner_types": ["binary"],
            "classification_level": "restricted"
        }
    )
    assert res.status_code == 201
    body = res.json()
    scan_id = body["scan_id"]

    # 1. Check scan status
    status_res = client.get(f"/api/v1/scan/{scan_id}")
    assert status_res.status_code == 200
    assert status_res.json()["status"] == "completed"

    # 2. Check CBOM
    cbom_res = client.get(f"/api/v1/scan/{scan_id}/cbom")
    assert cbom_res.status_code == 200
    cbom = cbom_res.json()
    assert cbom["bomFormat"] == "CycloneDX"
    assert len(cbom["components"]) >= 1

    # 3. Check Quantum Risk
    risk_res = client.get(f"/api/v1/scan/{scan_id}/risk")
    assert risk_res.status_code == 200
    assert risk_res.json()["quantum_risk_level"] == "CRITICAL"

    # 4. Check Migration Targets
    mig_res = client.get(f"/api/v1/scan/{scan_id}/migration")
    assert mig_res.status_code == 200
    assert "ML-KEM-768" in mig_res.json()["recommended_targets"]


if __name__ == "__main__":
    print("Running Binary Scan Comprehensive Tests...")
    test_binary_file_exists_and_valid()
    print("  [PASS] Binary file exists and valid PE structure")
    test_model2_feature_extractor()
    print("  [PASS] Model 2 feature extractor detected crypto families")
    test_gateway_scan_binary_api()
    print("  [PASS] Gateway POST /api/v1/scan/binary returned CRITICAL quantum risk & all findings")
    test_gateway_full_scan_lifecycle_for_binary()
    print("  [PASS] Gateway full scan lifecycle generated CBOM and PQC migration targets")
    print("\nALL BINARY SCAN TESTS PASSED SUCCESSFULLY!")
