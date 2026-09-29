"""CBOM standardization: CycloneDX 1.7 / ECMA-424 compatible output."""
from src.ecdat.core.cbom_standard import (
    STANDARD_STATEMENT, build_cyclonedx_cbom, validate_cbom,
)


def _sample():
    return [
        {"algorithm": "RSA-2048", "category": "ASYM", "quantum_risk": "CRITICAL",
         "code_snippet": "from Crypto.PublicKey import RSA\nkey = RSA.generate(2048)",
         "file_path": "demo.py", "line_number": 2, "cwe_id": "CWE-321"},
        {"algorithm": "AES-256", "category": "SYM", "quantum_risk": "NONE",
         "code_snippet": "cipher = AES.new(k, AES.MODE_GCM)",
         "file_path": "demo.py", "line_number": 9},
        {"algorithm": "TLS", "category": "PROTOCOL", "quantum_risk": "HIGH",
         "code_snippet": "ctx = ssl.create_default_context()\n-----BEGIN CERTIFICATE-----",
         "file_path": "tls.py", "line_number": 3},
        {"algorithm": "HMAC", "category": "MAC", "quantum_risk": "LOW",
         "code_snippet": "-----BEGIN PRIVATE KEY-----\nh = hmac.new(key, msg)",
         "file_path": "auth.py", "line_number": 5},
    ]


def test_cbom_is_cyclonedx_compatible():
    cbom = build_cyclonedx_cbom(
        "scan_test", "demo",
        _sample(),
        {"date_iso": "2026-01-01T00:00:00Z"},
    )
    assert cbom["bomFormat"] == "CycloneDX"
    assert cbom["specVersion"] == "1.7"
    assert cbom["serialNumber"].startswith("urn:uuid:")
    assert isinstance(cbom["components"], list) and cbom["components"]
    assert isinstance(cbom.get("dependencies"), list) and cbom["dependencies"]
    for c in cbom["components"]:
        assert c["type"] == "cryptographic-asset"
        assert "bom-ref" in c
        assert c["cryptoProperties"]["assetType"] in (
            "algorithm", "certificate", "protocol", "related-crypto-material")
    kinds = {c["cryptoProperties"]["assetType"] for c in cbom["components"]}
    # Must cover algorithms + certificates + keys + relationships.
    assert "algorithm" in kinds
    assert "certificate" in kinds or "related-crypto-material" in kinds
    props = {p["name"]: p["value"] for p in cbom["metadata"]["properties"]}
    assert "We generate a CycloneDX-compatible CBOM" in props["cbom:standard"]
    assert STANDARD_STATEMENT.startswith("We generate a CycloneDX-compatible CBOM")
    ok, errors = validate_cbom(cbom)
    assert ok, errors


def test_scan_store_cbom_validates(tmp_path):
    from src.ecdat.core.scan_store import ScanStore
    store = ScanStore(base_dir=tmp_path)
    summary = store.save_scan(
        target_name="demo.py", target_type="source_code", language="python",
        findings=_sample(), quantum_risk="CRITICAL", duration_ms=12.0)
    cbom = store.get_cbom(summary["scan_id"])
    assert cbom["bomFormat"] == "CycloneDX" and cbom["specVersion"] == "1.7"
    ok, errors = validate_cbom(cbom)
    assert ok, errors
