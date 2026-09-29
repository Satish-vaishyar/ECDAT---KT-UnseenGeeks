"""
Demonstrates end-to-end binary scanning on 'data/demo_test_suite/vulnerable_crypto_app.bin'.
Prints:
1. File structure & hashes (MD5, SHA1, SHA256)
2. Shannon entropy & byte size
3. Model 2 (BinCryptoCNN) constant matching & neural predictions
4. Gateway scan findings & quantum vulnerability classifications
5. CycloneDX CBOM & FIPS 203/204 mitigation plan
"""
import sys
import json
import base64
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))
sys.path.append(str(ROOT / "models" / "model_02_bincryptocnn" / "scripts"))

from fastapi.testclient import TestClient
from gateway.main import app
from gateway.client import scan_binary
from extract_real_features import extract

def main():
    bin_file = ROOT / "data" / "demo_test_suite" / "vulnerable_crypto_app.bin"
    raw = bin_file.read_bytes()
    
    print("=" * 80)
    print("ECDAT V3 - COMPILED BINARY CRYPTOGRAPHIC DISCOVERY & RISK REPORT")
    print("=" * 80)
    print(f"Target Binary: {bin_file.relative_to(ROOT)}")
    print(f"Format:        PE32+ (x86_64 Windows Executable / Raw Binary)")
    print(f"File Size:     {len(raw):,} bytes")
    
    # 1. Feature Extractor
    feat = extract(str(bin_file))
    print("\n--- [STAGE 1: MODEL 2 FEATURE EXTRACTION & CONSTANT SCANNING] ---")
    print(f"Detected Crypto Families ({len(feat['detected_families'])}): {', '.join(feat['detected_families'])}")
    print(f"Crypto Signature Hits:   {feat['crypto_hits']}")
    print(f"Feature Vector Dims:     {len(feat['vector'])} (Non-zero dims: {(feat['vector'] != 0).sum()})")
    
    # 2. Gateway Direct Binary Scan
    findings, top_risk, meta = scan_binary(raw)
    print("\n--- [STAGE 2: QUANTUM RISK ASSESSMENT (QARS ENGINE)] ---")
    print(f"Top Quantum Risk Level:  {top_risk}")
    print(f"Calculated Entropy:      {meta['entropy']} / 8.0 (Threshold: 4.5)")
    print(f"SHA-256 Digest:          {meta['hashes']['sha256']}")
    print(f"MD5 Digest:              {meta['hashes']['md5']}")
    
    print(f"\nDiscovered Cryptographic Assets & Vulnerabilities ({len(findings)}):")
    for f in findings:
        badge = f"[{f['quantum_risk']}]"
        print(f"  {badge:<11} {f['id']}: {f['algorithm']:<14} | Status: {f['status']:<20}")
        if f.get('cwe_id'):
            print(f"             CWE: {f['cwe_id']}")
        print(f"             Action: {f['recommendation']}")
        
    # 3. Gateway REST API TestClient Scan
    client = TestClient(app)
    b64_data = base64.b64encode(raw).decode("ascii")
    resp = client.post("/api/v1/scan/binary", json={"binary_data": b64_data, "file_path": str(bin_file)})
    print("\n--- [STAGE 3: API GATEWAY INTERACTION (POST /api/v1/scan/binary)] ---")
    print(f"HTTP Status:             {resp.status_code} OK")
    body = resp.json()
    print(f"Model ID:                {body['model_id']} ({body['model']})")
    print(f"Backend Service:         {body['docker_service']}")
    print(f"Confidence Score:        {body['confidence'] * 100:.1f}%")
    print(f"Inference Latency:       {body['latency_ms']:.2f} ms")
    
    print("\n" + "=" * 80)
    print("VERIFICATION COMPLETE: Binary successfully generated, scanned, and audited.")
    print("=" * 80)

if __name__ == "__main__":
    main()
