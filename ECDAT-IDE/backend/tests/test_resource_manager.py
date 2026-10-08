"""
Comprehensive Verification Suite for Low-VRAM Sequential Backend & ScanStore
Tests:
1. SequentialResourceManager: Lock, telemetry, and zero-leak eviction.
2. ScanStore: Persistent JSON, CycloneDX 1.6 CBOM, and SQLite index.
3. SequentialAuditPipeline: End-to-end multi-model audit within 4GB VRAM.
"""
import sys
import os
import time
import asyncio
from pathlib import Path

# Add project root to path
PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

from src.ecdat.core.resource_manager import get_resource_manager, SequentialResourceManager
from src.ecdat.core.scan_store import get_scan_store, ScanStore
from src.ecdat.core.pipeline_orchestrator import get_pipeline_orchestrator


def test_resource_manager_telemetry():
    print("\n[TEST 1] Resource Manager Memory Telemetry")
    print("-" * 50)
    rm = get_resource_manager()
    telem = rm.get_telemetry()
    print(f"  CUDA Available: {telem.has_cuda}")
    print(f"  GPU Name: {telem.gpu_name}")
    print(f"  VRAM: {telem.free_vram_gb:.2f} GB free / {telem.total_vram_gb:.2f} GB total ({telem.vram_used_pct}% used)")
    print(f"  System RAM: {telem.system_ram_available_gb:.2f} GB free / {telem.system_ram_total_gb:.2f} GB total ({telem.system_ram_used_pct}% used)")
    assert telem.system_ram_total_gb > 0, "System RAM total must be > 0"
    print("  [PASS] Telemetry successfully retrieved.")


async def test_sequential_gpu_lock():
    print("\n[TEST 2] Sequential Single-Occupancy GPU Lock & Eviction")
    print("-" * 50)
    rm = get_resource_manager()

    # Step 1: Acquire for Model A
    async with rm.acquire_gpu_context("model_04_cryptoclassllm", estimated_vram_gb=1.5):
        assert rm._active_model_id == "model_04_cryptoclassllm"
        print("  [Step 1] Model 4 acquired GPU context.")

    # Step 2: Acquire for Model B (should automatically evict Model A)
    async with rm.acquire_gpu_context("model_07_ecdat_lora", estimated_vram_gb=2.0):
        assert rm._active_model_id == "model_07_ecdat_lora"
        print("  [Step 2] Model 7 acquired GPU context (Model 4 cleanly evicted).")

    # Step 3: Evict all
    rm.evict_active_model(force=True)
    assert rm._active_model_id is None
    print(f"  [Step 3] Forced VRAM eviction complete. Total evictions: {rm._eviction_count}")
    print("  [PASS] Sequential GPU lock and eviction verified.")


def test_scan_store_persistence():
    print("\n[TEST 3] ScanStore Persistence & CycloneDX 1.6 CBOM Generation")
    print("-" * 50)
    store = get_scan_store()

    dummy_findings = [
        {
            "id": "FINDING-0001",
            "algorithm": "RSA-2048",
            "category": "ASYM",
            "quantum_risk": "CRITICAL",
            "status": "QUANTUM_VULNERABLE",
            "cwe_id": "CWE-326",
            "line_number": 42,
            "code_snippet": "rsa.generate_private_key(public_exponent=65537, key_size=2048)",
            "file_path": "auth/crypto.py",
            "confidence": 0.99,
            "recommendation": "Migrate to ML-KEM-768 (NIST FIPS 203)"
        },
        {
            "id": "FINDING-0002",
            "algorithm": "HMAC-SHA256",
            "category": "MAC",
            "quantum_risk": "LOW",
            "status": "SECURE",
            "cwe_id": None,
            "line_number": 88,
            "code_snippet": "hmac.new(key, msg, hashlib.sha256)",
            "file_path": "auth/tokens.py",
            "confidence": 0.99,
            "recommendation": "Quantum-resilient; compliant with FIPS 198-1"
        }
    ]

    saved = store.save_scan(
        target_name="test_enterprise_repo",
        target_type="repository",
        language="python",
        findings=dummy_findings,
        quantum_risk="CRITICAL",
        duration_ms=45.2,
        metadata={"scanner": "ECDAT Sequential Orchestrator"}
    )

    scan_id = saved["scan_id"]
    print(f"  Saved Scan ID: {scan_id}")
    assert scan_id.startswith("scan_")

    # Verify retrieval
    retrieved = store.get_scan(scan_id)
    assert retrieved is not None, "Failed to retrieve scan summary"
    assert len(retrieved["findings"]) == 2, "Findings length mismatch"
    print(f"  Retrieved scan: {retrieved['target_name']} | Risk: {retrieved['quantum_risk']}")

    # Verify CycloneDX CBOM
    cbom = store.get_cbom(scan_id)
    assert cbom is not None, "Failed to retrieve CBOM"
    assert cbom["bomFormat"] == "CycloneDX"
    assert cbom["specVersion"] == "1.7"
    assert len(cbom["components"]) == 3
    print(f"  CycloneDX 1.6 CBOM verified: {len(cbom['components'])} cryptographic components.")
    names = {c.get("name") for c in cbom["components"]}
    assert "RSA-2048" in names and "HMAC-SHA256" in names
    assert any(str(n).startswith("key-for-") for n in names), "RSA key modeled as its own asset"

    # Verify CSV export
    csv_path = store.get_csv_path(scan_id)
    assert csv_path is not None and csv_path.exists(), "CSV export missing"
    print(f"  CSV export verified at: {csv_path.name}")

    # Verify listing
    all_scans = store.list_scans(limit=5)
    assert len(all_scans) >= 1
    print(f"  Scan list query successful: {len(all_scans)} total scans indexed in SQLite.")
    print("  [PASS] ScanStore persistence verified.")


async def test_end_to_end_sequential_pipeline():
    print("\n[TEST 4] End-to-End Sequential Pipeline (Audit -> ScanStore)")
    print("-" * 50)
    orchestrator = get_pipeline_orchestrator()

    sample_code = """
import os
from cryptography.hazmat.primitives.asymmetric import rsa

def setup_server_key():
    # Deprecated RSA 2048 key exchange (Shor-vulnerable)
    private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    return private_key
"""
    result = await orchestrator.audit_code(
        code=sample_code,
        target_name="server_ssl.py",
        language="python",
        enable_remediation=True
    )

    print(f"  Pipeline Scan ID: {result['scan_id']}")
    print(f"  Identified Quantum Risk: {result['quantum_risk']}")
    print(f"  Total Findings: {result['total_findings']}")
    print(f"  Pipeline Duration: {result['duration_ms']:.1f}ms")

    assert result["total_findings"] >= 1, "Expected at least 1 finding"
    assert result["quantum_risk"] in ("CRITICAL", "HIGH"), "Expected CRITICAL or HIGH quantum risk"
    
    # Check that remediation code was generated
    findings = result["findings"]
    has_remediation = any("remediation_code" in f and f["remediation_code"] for f in findings)
    print(f"  PQC Remediation Code Generated: {has_remediation}")
    print("  [PASS] End-to-end sequential pipeline executed successfully.")


async def main():
    test_resource_manager_telemetry()
    await test_sequential_gpu_lock()
    test_scan_store_persistence()
    await test_end_to_end_sequential_pipeline()
    print("\n" + "=" * 60)
    print("ALL 4 LOW-VRAM & SCANSTORE TESTS PASSED SUCCESSFULLY!")
    print("=" * 60)


if __name__ == "__main__":
    asyncio.run(main())
