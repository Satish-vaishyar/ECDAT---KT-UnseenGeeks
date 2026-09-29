"""
Verification of Gateway Pipeline & ScanStore REST Endpoints for Frontend Integration
Tests:
1. GET  /api/v1/system/resources
2. POST /api/v1/pipeline/audit
3. GET  /api/v1/scans
4. GET  /api/v1/scans/{scan_id}
5. GET  /api/v1/scans/{scan_id}/cbom
6. GET  /api/v1/scans/{scan_id}/export/csv
7. POST /api/v1/system/evict
"""
import sys
import json
from contextlib import redirect_stdout
from pathlib import Path

# Add project root to path
PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

from fastapi.testclient import TestClient
from gateway.main import app

client = TestClient(app)


def test_gateway_endpoints():
    print("\n[GATEWAY TEST 1] System Resources Endpoint (GET /api/v1/system/resources)")
    print("-" * 50)
    resp = client.get("/api/v1/system/resources")
    assert resp.status_code == 200, f"Failed: {resp.status_code} - {resp.text}"
    telem = resp.json()
    print(f"  CUDA Available: {telem['has_cuda']}")
    print(f"  GPU Name: {telem['gpu_name']}")
    print(f"  VRAM Free: {telem['free_vram_gb']} GB")
    print(f"  System RAM Available: {telem['system_ram_available_gb']} GB")
    print("  [PASS] Resource telemetry endpoint verified.")

    print("\n[GATEWAY TEST 2] Sequential Pipeline Audit (POST /api/v1/pipeline/audit)")
    print("-" * 50)
    sample_code = """
from cryptography.hazmat.primitives.asymmetric import rsa

def generate_user_key():
    # Insecure 1024-bit RSA key (CWE-326)
    return rsa.generate_private_key(public_exponent=65537, key_size=1024)
"""
    audit_resp = client.post("/api/v1/pipeline/audit", json={
        "code": sample_code,
        "target_name": "user_auth.py",
        "language": "python",
        "enable_remediation": True
    })
    assert audit_resp.status_code == 200, f"Audit failed: {audit_resp.status_code} - {audit_resp.text}"
    data = audit_resp.json()
    scan_id = data["scan_id"]
    print(f"  Audit Scan ID: {scan_id}")
    print(f"  Quantum Risk: {data['quantum_risk']}")
    print(f"  Findings Count: {data['total_findings']}")
    print("  [PASS] Pipeline audit endpoint executed & saved.")

    print("\n[GATEWAY TEST 3] Frontend Scan History (GET /api/v1/scans)")
    print("-" * 50)
    scans_resp = client.get("/api/v1/scans?limit=10")
    assert scans_resp.status_code == 200, f"Failed: {scans_resp.status_code}"
    scans_list = scans_resp.json()
    assert len(scans_list) >= 1
    found = any(s["scan_id"] == scan_id for s in scans_list)
    assert found, f"Scan {scan_id} not found in scan history"
    print(f"  Total historical scans indexed: {len(scans_list)}")
    print("  [PASS] Frontend scan history endpoint verified.")

    print(f"\n[GATEWAY TEST 4] Frontend Detailed Scan Drilldown (GET /api/v1/scans/{scan_id})")
    print("-" * 50)
    detail_resp = client.get(f"/api/v1/scans/{scan_id}")
    assert detail_resp.status_code == 200
    details = detail_resp.json()
    assert details["scan_id"] == scan_id
    assert len(details["findings"]) >= 1
    print(f"  Retrieved {len(details['findings'])} findings with code snippets.")
    print("  [PASS] Frontend detailed scan drilldown endpoint verified.")

    print(f"\n[GATEWAY TEST 5] CycloneDX 1.6 CBOM Export (GET /api/v1/scans/{scan_id}/cbom)")
    print("-" * 50)
    cbom_resp = client.get(f"/api/v1/scans/{scan_id}/cbom")
    assert cbom_resp.status_code == 200
    cbom = cbom_resp.json()
    assert cbom["bomFormat"] == "CycloneDX"
    assert cbom["specVersion"] == "1.6"
    print(f"  CBOM Specification: {cbom['bomFormat']} v{cbom['specVersion']}")
    print(f"  Components Count: {len(cbom['components'])}")
    print("  [PASS] CycloneDX CBOM endpoint verified.")

    print(f"\n[GATEWAY TEST 6] CSV Spreadsheet Export (GET /api/v1/scans/{scan_id}/export/csv)")
    print("-" * 50)
    csv_resp = client.get(f"/api/v1/scans/{scan_id}/export/csv")
    assert csv_resp.status_code == 200
    assert "text/csv" in csv_resp.headers.get("content-type", "")
    print(f"  CSV Download Header: {csv_resp.headers.get('content-disposition', 'ok')}")
    print("  [PASS] CSV export endpoint verified.")

    print(f"\n[GATEWAY TEST 7] Markdown Audit Report (GET /api/v1/scans/{scan_id}/report)")
    print("-" * 50)
    report_resp = client.get(f"/api/v1/scans/{scan_id}/report")
    assert report_resp.status_code == 200
    assert "# 🛡️ QIROVA Cryptographic Security & Post-Quantum Readiness Audit Report" in report_resp.text
    assert "Configured Model Evidence Matrix" in report_resp.text
    print(f"  Report Length: {len(report_resp.text)} characters")
    print("  [PASS] Markdown audit report endpoint verified.")

    print("\n[GATEWAY TEST 8] Administrative VRAM Purge (POST /api/v1/system/evict)")
    print("-" * 50)
    evict_resp = client.post("/api/v1/system/evict")
    assert evict_resp.status_code == 200
    print("  [PASS] Administrative VRAM purge endpoint verified.")

    print("\n" + "=" * 60)
    print("ALL 8 GATEWAY & FRONTEND INTEGRATION ENDPOINTS PASSED!")
    print("=" * 60)
    return {
        "status": "PASSED",
        "tests": 8,
        "scan_id": scan_id,
        "findings": len(details["findings"]),
        "cbom_components": len(cbom["components"]),
    }


if __name__ == "__main__":
    with redirect_stdout(sys.stderr):
        result = test_gateway_endpoints()
    print(json.dumps(result, indent=2))
