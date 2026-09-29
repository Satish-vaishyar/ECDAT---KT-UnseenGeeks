"""Direct unit tests for gateway.client heuristics (no server, no docker).

Covers the standalone-fallback engines the IDE relies on when the
docker model services are unreachable.
"""
import time

import pytest

from gateway import client as C
from gateway.compliance_catalog import compliance_reference_matches


def test_shannon_entropy_basics():
    assert C.shannon("aaaa") == 0.0
    assert C.shannon("sk_live_abc123XYZ789qrs-_!@#") > 4.0


def test_scan_source_finds_weak_hash():
    findings, top = C.scan_source("import hashlib\nh = hashlib.md5(data)", "python")
    assert isinstance(findings, list) and findings
    assert isinstance(top, str) and top
    algos = {str(f.get("algorithm", "")).upper() for f in findings}
    assert any("MD5" in a for a in algos)


def test_scan_source_clean_code():
    findings, _top = C.scan_source("from oqs import Kyber\nkem = Kyber('ML-KEM-768')", "python")
    assert isinstance(findings, list)


def test_scan_binary_reports_hashes_and_size():
    raw = b"\x7fELF" + b"\x00" * 64 + b"RSA_generate_key"
    findings, top, meta = C.scan_binary(raw)
    assert isinstance(findings, list)
    assert meta["hashes"]["sha256"]
    assert meta["size_bytes"] == len(raw)
    assert meta["entropy"] >= 0.0


def test_b64decode_strict():
    assert C.b64decode_strict("aGk=") == b"hi"
    with pytest.raises(ValueError):
        C.b64decode_strict("!!!not-base64!!!")


def test_quantum_cost_table():
    q = C.quantum_cost("RSA-2048", 2048)
    assert q["quantum_risk"] in ("CRITICAL", "HIGH", "MEDIUM", "LOW", "NONE")
    q2 = C.quantum_cost("TOTALLY-UNKNOWN-ALGO")
    assert isinstance(q2, dict) and q2.get("quantum_risk")


def test_qars_score_range():
    q = C.qars_score("RSA-2048", 2048)
    assert 0 <= q["score"] <= 100
    assert q["tier"]
    assert q["quantum_risk"]


def test_calculate_migration_cost_shape():
    mc = C.calculate_migration_cost("RSA-2048")
    assert mc["costs"]["inr"]["formatted"]
    assert mc["costs"]["usd"]["formatted"]
    assert mc["family"]
    assert mc["recommended_pqc_replacement"]
    assert mc["quantum_risk"]


def test_classify_3level_and_misuse_shapes():
    c3 = C.classify_3level("import hashlib\nhashlib.md5(x)", "python")
    assert isinstance(c3, dict)
    findings, top = C.detect_misuse("import hashlib\nhashlib.md5(x)")
    assert isinstance(findings, list) and isinstance(top, str)


def test_local_crypto_api_lookup():
    r = C.local_crypto_api("hashlib.md5", "python")
    assert isinstance(r, dict) and "found" in r
    r2 = C.local_crypto_api("no.such.api", "python")
    assert r2.get("found") is False


def test_local_trapdoor_shape():
    r = C.local_trapdoor(code="x = 1", algorithm="RSA-2048")
    assert isinstance(r, dict)


def test_now_ms_monotonic():
    t0 = time.perf_counter()
    assert C.now_ms(t0) >= 0.0


async def test_downstream_infer_none_when_services_down():
    assert await C.downstream_infer("ast_cryptonet", {"source_code": "x"}) is None


def test_compliance_catalog_matches():
    docs = compliance_reference_matches("RSA-2048", limit=3)
    assert isinstance(docs, list)
    assert len(docs) <= 3
