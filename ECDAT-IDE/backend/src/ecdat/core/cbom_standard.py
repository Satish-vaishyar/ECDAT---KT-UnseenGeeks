"""ECDAT standardised CBOM builder — CycloneDX 1.7-compatible CBOM.

Product statement: "We generate a CycloneDX-compatible CBOM."
CycloneDX explicitly supports Cryptography Bill of Materials; the
specification has become ECMA-424. Its CBOM capability represents
algorithms, certificates, keys and their relationships. IBM's CBOM
work was upstreamed into CycloneDX 1.6 — this module targets the
CycloneDX 1.7 schema (bomFormat CycloneDX / specVersion 1.7 / type
cryptographic-asset / cryptoProperties).

No third-party dependency: emits plain JSON matching the CycloneDX
1.7 CBOM schema so output validates offline and loads in CBOMkit /
any CycloneDX consumer.
"""

from __future__ import annotations

import re
import uuid
from typing import Any, Dict, List, Optional, Tuple

BOM_FORMAT = "CycloneDX"
SPEC_VERSION = "1.7"
SCHEMA_URL = "http://cyclonedx.org/schema/spdx.schema.json"
# Canonical CycloneDX CBOM schema reference (served by cyclonedx.org).
CBOM_SCHEMA_URL = "http://cyclonedx.org/schema/cyclonedx.schema-1.7.schema.json"
STANDARD_STATEMENT = "We generate a CycloneDX-compatible CBOM (CycloneDX 1.7, ECMA-424)."
SPEC_REFS = "CycloneDX 1.7 CBOM / ECMA-424 (IBM CBOM upstreamed into CycloneDX 1.6)"

ASSET_TYPES = ("algorithm", "certificate", "protocol", "related-crypto-material")

# Minimal OID catalogue (only well-known values; unknown algos omit oid).
_OIDS = {
    "RSA": "1.2.840.113549.1.1.1",
    "ECDSA": "1.2.840.10045.4.1",
    "ECDH": "1.3.132.1.12",
    "DSA": "1.2.840.10040.4.1",
    "DH": "1.2.840.10046.2.1",
    "ED25519": "1.3.101.112",
    "X25519": "1.3.101.110",
    "AES-128": "2.16.840.1.101.3.4.1.2",
    "AES-256": "2.16.840.1.101.3.4.1.42",
    "SHA-256": "2.16.840.1.101.3.4.2.1",
    "SHA-384": "2.16.840.1.101.3.4.2.2",
    "SHA-512": "2.16.840.1.101.3.4.2.3",
    "SHA-1": "1.3.14.3.2.26",
    "MD5": "1.2.840.113549.2.5",
    "HMAC": "1.2.840.113549.2.7",
    "ML-KEM-768": "2.16.840.1.101.3.4.4.2",
    "ML-DSA-65": "2.16.840.1.101.3.4.3.18",
}

_QV = {"RSA", "ECDSA", "ECDH", "DSA", "DH", "EC", "ED25519", "X25519", "DES", "3DES"}

_PQC_MAP = {
    "RSA": "ML-KEM-768 + ML-DSA-65", "ECDSA": "ML-DSA-65",
    "ECDH": "ML-KEM-768 (hybrid X25519)", "DSA": "ML-DSA-65",
    "DH": "ML-KEM-768", "DES": "AES-256-GCM", "3DES": "AES-256-GCM",
    "MD5": "SHA-256 / BLAKE3", "SHA1": "SHA-256", "SHA-1": "SHA-256",
    "X25519": "ML-KEM-768 hybrid", "ED25519": "ML-DSA-65",
}

_CERT_PAT = re.compile(
    r"BEGIN CERTIFICATE|x509|TrustManager|SSLContext|CERTIFICATE_VERIFY|"
    r"checkServerTrusted|verify_mode\s*=\s*CERT", re.I)
_KEY_PAT = re.compile(
    r"BEGIN (?:RSA |EC |OPENSSH |ENCRYPTED )?PRIVATE KEY|BEGIN PUBLIC KEY|"
    r"private[_-]?key|secret[_-]?key|api[_-]?key|BEGIN.*KEY", re.I)
_TLS_PAT = re.compile(r"TLSv?1\.[23]|SSL_|TLS_|ssl\.PROTOCOL|create_default_context|HTTPSConnection", re.I)


def _norm_algo(name: str) -> str:
    a = (name or "UNKNOWN").strip().upper().replace("_", "-")
    aliases = {"SHA1": "SHA-1", "SHA256": "SHA-256", "SHA384": "SHA-384",
               "SHA512": "SHA-512", "AES128": "AES-128", "AES256": "AES-256"}
    return aliases.get(a, a or "UNKNOWN")


def _key_size(algo: str, snippet: str = "", explicit: Any = None) -> Optional[int]:
    if isinstance(explicit, int) and explicit > 0:
        return explicit
    m = re.search(r"(1024|2048|3072|4096|512|256|128|192|384|521)", f"{algo} {snippet}")
    return int(m.group(1)) if m else None


def _curve(algo: str, snippet: str = "") -> Optional[str]:
    m = re.search(r"(P-256|P-384|P-521|SECP256K1|SECP384R1|CURVE25519|ED25519|X25519)",
                  f"{algo} {snippet}", re.I)
    return m.group(1).upper() if m else None


_FAMILIES = ("ML-KEM", "ML-DSA", "SLH-DSA", "AES", "HMAC", "SHA", "RSA", "ECDSA", "ECDH",
             "DES", "3DES", "CHACHA", "BLAKE", "MD5", "HMAC", "ED25519", "X25519",
             "DH", "DSA", "FALCON", "HQC")


def _family(algo: str) -> str:
    a = (algo or "UNKNOWN").upper()
    for fam in _FAMILIES:
        if fam in a:
            return fam
    return (a.split("-")[0] or "UNKNOWN")


def _primitive(algo: str, mode: str) -> str:
    a = (algo or "").upper()
    if "AES" in a and mode == "GCM":
        return "ae"
    if any(k in a for k in ("AES", "DES", "CHACHA")):
        return "block-cipher"
    if any(k in a for k in ("SHA", "MD5", "BLAKE", "HMAC")):
        return "hash"
    if any(k in a for k in ("RSA", "KEM")):
        return "pke"
    if any(k in a for k in ("DSA", "ED25519")):
        return "signature"
    if any(k in a for k in ("ECDH", "DH", "X25519")):
        return "key-agreement"
    return "other"


def _classical_level(algo: str, ks) -> object:
    a = (algo or "").upper()
    if a == "DES":
        return 56
    if a == "3DES":
        return 112
    if a == "MD5":
        return 64
    if a in ("SHA1", "SHA-1"):
        return 80
    if "SHA-256" in a:
        return 128
    if "SHA-384" in a:
        return 192
    if "SHA-512" in a:
        return 256
    if "AES" in a or "CHACHA" in a:
        return ks or 128
    if "RSA" in a:
        return 112 if (ks or 2048) < 3072 else 192
    if any(k in a for k in ("ECDSA", "ECDH", "ED25519", "X25519", "P-256")):
        return 128
    if "ML-KEM" in a or "ML-DSA" in a:
        return 128
    return None


def _nist_level(algo: str, ks) -> object:
    a = (algo or "").upper()
    if a in ("MD5", "SHA1", "SHA-1", "DES", "3DES"):
        return 0
    if any(k in a for k in ("RSA", "ECDSA", "ECDH", "DSA", "DH", "ED25519", "X25519")):
        return 0
    if "AES-128" in a:
        return 1
    if "AES-192" in a:
        return 3
    if "AES-256" in a or "CHACHA" in a:
        return 5
    if "SHA-256" in a:
        return 2
    if "SHA-384" in a:
        return 4
    if "SHA-512" in a:
        return 5
    if "ML-KEM-768" in a or "ML-DSA-65" in a:
        return 3
    if "ML-KEM-1024" in a or "ML-DSA-87" in a:
        return 5
    if "ML-KEM-512" in a or "ML-DSA-44" in a or "FALCON" in a:
        return 1
    if "SLH-DSA" in a:
        return 2
    return None


def _slug(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", str(text or "").lower()).strip("-")


def _algorithm_component(algo: str, finding: Dict[str, Any], _bom_ref: str) -> Dict[str, Any]:
    snippet = str(finding.get("code_snippet") or "")
    ks = _key_size(algo, snippet, finding.get("key_size") or finding.get("keySize"))
    family = _family(algo)
    mode = ""
    if "AES" in algo.upper():
        mode = "GCM" if "GCM" in snippet.upper() else "CBC"
    param = str(ks) if ks else ""
    name = algo + ("-" + mode if mode and not algo.upper().endswith(mode) else "")
    bom_ref = "crypto/algorithm/" + _slug(family + ("-" + mode if mode else ""))
    primitive = _primitive(algo, mode)
    crypto_fns = (["encrypt", "decrypt"] if primitive in ("pke", "block-cipher", "ae", "key-agreement")
                  else ["sign", "verify"] if primitive == "signature" else ["digest"])
    algo_props: Dict[str, Any] = {
        "algorithmFamily": family,
        "primitive": primitive,
        "parameterSetIdentifier": param or algo,
        "executionEnvironment": "software-plain-ram",
        "cryptoFunctions": crypto_fns,
    }
    if mode:
        algo_props["mode"] = mode.lower()
    classical = _classical_level(algo, ks)
    if classical is not None:
        algo_props["classicalSecurityLevel"] = classical
    nist = _nist_level(algo, ks)
    if nist is not None:
        algo_props["nistQuantumSecurityLevel"] = nist
    return {
        "type": "cryptographic-asset",
        "bom-ref": bom_ref,
        "name": name,
        "cryptoProperties": {"assetType": "algorithm", "algorithmProperties": algo_props},
    }


def _certificate_component(finding: Dict[str, Any], algo_ref: str, bom_ref: str) -> Dict[str, Any]:
    snippet = str(finding.get("code_snippet") or "")
    return {
        "type": "cryptographic-asset", "bom-ref": bom_ref,
        "name": f"certificate-for-{algo_ref}", "version": "1.0",
        "description": "X.509 certificate usage inferred from source evidence (verify against trust store).",
        "evidence": {"occurrences": [{
            "location": finding.get("file_path") or "source",
            "line": finding.get("line_number")}]},
        "cryptoProperties": {
            "assetType": "certificate",
            "certificateProperties": {
                "subjectName": "CN=observed-in-source",
                "signatureAlgorithmRef": algo_ref,
                "subjectPublicKeyRef": algo_ref,
                "certificateFormat": "X.509",
            },
        },
    }


def _key_component(finding: Dict[str, Any], algo_ref: str, bom_ref: str) -> Dict[str, Any]:
    snippet = str(finding.get("code_snippet") or "")
    ks = _key_size(algo_ref, snippet, finding.get("key_size"))
    rel: Dict[str, Any] = {"type": "private-key" if "PRIVATE" in snippet.upper() else "key",
                           "algorithmRef": algo_ref, "state": "active"}
    if ks:
        rel["size"] = ks
    return {
        "type": "cryptographic-asset", "bom-ref": bom_ref,
        "name": f"key-for-{algo_ref}", "version": "1.0",
        "description": (snippet[:120] or "Key material referenced by source; value never stored."),
        "evidence": {"occurrences": [{
            "location": finding.get("file_path") or "source",
            "line": finding.get("line_number")}]},
        "cryptoProperties": {
            "assetType": "related-crypto-material",
            "relatedCryptoMaterialProperties": rel,
        },
    }


def _protocol_component(finding: Dict[str, Any], refs: List[str], bom_ref: str) -> Dict[str, Any]:
    return {
        "type": "cryptographic-asset", "bom-ref": bom_ref,
        "name": "TLS-session", "version": "1.2/1.3",
        "description": "TLS/SSL session inferred from source evidence.",
        "evidence": {"occurrences": [{
            "location": finding.get("file_path") or "source",
            "line": finding.get("line_number")}]},
        "cryptoProperties": {
            "assetType": "protocol",
            "protocolProperties": {
                "type": "tls", "version": "1.2/1.3",
                "cryptoRefArray": refs,
            },
        },
    }


def build_cyclonedx_cbom(scan_id: str, target_name: str,
                         findings: List[Dict[str, Any]],
                         summary: Dict[str, Any]) -> Dict[str, Any]:
    """Build CycloneDX 1.7 / ECMA-424 CBOM: algorithms + certificates + keys + relationships."""
    components: List[Dict[str, Any]] = []
    deps: List[Dict[str, Any]] = []
    app_ref = f"app-{scan_id}"
    app_depends: List[str] = []
    seen_algos: Dict[str, str] = {}
    for idx, f in enumerate(findings, 1):
        algo = _norm_algo(str(f.get("algorithm") or "UNKNOWN"))
        if algo == "NO_CRYPTO":
            continue
        comp = _algorithm_component(algo, f, "")
        a_ref = comp["bom-ref"]
        if a_ref not in seen_algos:
            seen_algos[a_ref] = a_ref
            components.append(comp)
            app_depends.append(a_ref)
        snippet = str(f.get("code_snippet") or "")
        extra_refs = [a_ref]
        if _CERT_PAT.search(snippet) or "CERT" in algo or "TLS" in snippet.upper():
            c_ref = f"cbom-{scan_id}-{idx:04d}-cert"
            components.append(_certificate_component(f, a_ref, c_ref))
            deps.append({"ref": c_ref, "dependsOn": [a_ref]})
            extra_refs.append(c_ref)
        if _KEY_PAT.search(snippet) or f.get("key_size"):
            k_ref = f"cbom-{scan_id}-{idx:04d}-key"
            components.append(_key_component(f, a_ref, k_ref))
            deps.append({"ref": k_ref, "dependsOn": [a_ref]})
            extra_refs.append(k_ref)
        if _TLS_PAT.search(snippet):
            p_ref = f"cbom-{scan_id}-{idx:04d}-tls"
            components.append(_protocol_component(f, [a_ref], p_ref))
            deps.append({"ref": p_ref, "dependsOn": [a_ref]})
            app_depends.append(p_ref)
    deps.insert(0, {"ref": app_ref, "dependsOn": app_depends})
    import datetime as _dt
    timestamp = str(summary.get("date_iso") or (_dt.datetime.now(_dt.timezone.utc).isoformat()))
    return {
        "$schema": CBOM_SCHEMA_URL,
        "bomFormat": BOM_FORMAT,
        "specVersion": SPEC_VERSION,
        "serialNumber": f"urn:uuid:{uuid.uuid4()}",
        "version": 1,
        "metadata": {
            "timestamp": timestamp,
            "tools": [{"vendor": "ECDAT",
                       "name": "Enterprise Cryptographic Discovery & Analysis Tool",
                       "version": "3.0.0"}],
            "component": {"bom-ref": app_ref, "type": "application", "name": target_name,
                          "version": str(summary.get("target_version") or "1.0.0")},
            "properties": [
                {"name": "cbom:standard", "value": STANDARD_STATEMENT},
                {"name": "cbom:spec", "value": SPEC_REFS},
                {"name": "cbom:asset-kinds", "value": "algorithms, certificates, keys, protocols"},
                {"name": "cbom:relationships", "value": "bom-ref dependencies (certificate->algorithm, key->algorithm, protocol->algorithm, application->all)"},
            ],
        },
        "components": components,
        "dependencies": deps,
    }


def validate_cbom(cbom: Dict[str, Any]) -> Tuple[bool, List[str]]:
    """Offline structural validation against CycloneDX 1.7 CBOM requirements."""
    errors: List[str] = []
    if not isinstance(cbom, dict):
        return False, ["CBOM must be an object"]
    if cbom.get("bomFormat") != "CycloneDX":
        errors.append("bomFormat must be 'CycloneDX'")
    if str(cbom.get("specVersion")) != SPEC_VERSION:
        errors.append(f"specVersion must be '{SPEC_VERSION}' (ECMA-424 CBOM)")
    if not str(cbom.get("serialNumber", "")).startswith("urn:uuid:"):
        errors.append("serialNumber must be a urn:uuid:")
    comps = cbom.get("components")
    if not isinstance(comps, list):
        errors.append("components must be an array")
        comps = []
    refs = set()
    for i, c in enumerate(comps):
        if not isinstance(c, dict):
            errors.append(f"components[{i}] must be an object")
            continue
        if c.get("type") != "cryptographic-asset":
            errors.append(f"components[{i}].type must be 'cryptographic-asset'")
        ref = c.get("bom-ref")
        if not ref:
            errors.append(f"components[{i}] missing bom-ref (needed for relationships)")
        elif ref in refs:
            errors.append(f"duplicate bom-ref '{ref}'")
        else:
            refs.add(ref)
        cp = c.get("cryptoProperties")
        if not isinstance(cp, dict):
            errors.append(f"components[{i}] missing cryptoProperties")
            continue
        if cp.get("assetType") not in ASSET_TYPES:
            errors.append(f"components[{i}].cryptoProperties.assetType must be one of {ASSET_TYPES}")
    deps = cbom.get("dependencies")
    if not isinstance(deps, list):
        errors.append("dependencies must be an array (relationships)")
    else:
        for d in deps:
            if not isinstance(d, dict) or "ref" not in d or "dependsOn" not in d:
                errors.append("each dependencies[] entry needs {ref, dependsOn}")
                break
    kinds = {str(c.get("cryptoProperties", {}).get("assetType")) for c in comps if isinstance(c, dict)}
    if "algorithm" not in kinds:
        errors.append("CBOM should contain at least one assetType=algorithm")
    return (len(errors) == 0, errors)
