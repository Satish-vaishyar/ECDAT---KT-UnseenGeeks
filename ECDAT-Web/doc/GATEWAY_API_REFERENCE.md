# ECDAT Gateway — API Reference (all dockerised models)

> Sources: **AI model spec** `doc/ECDAT_AI_ML_MODELS.md` · **models brief** `models/README.md`
> Serving map: `docker/class-{a-cpu,b-gpu,c-stateful,d-batch,e-ml}/Dockerfile` + `models/adapter_{class_a,class_b,class_c,class_e}.py` + `models/batch_job.py`
> Gateway code: `gateway/` · Tests: `tests/test_gateway.py` (12 passed) · Run: `make run-gateway` (port 8000)

Base URL: `http://localhost:8000`. Auth: optional `X-API-Key`/`Bearer` (only if `GATEWAY_API_KEYS` set).
Rate limit: 120 req/min/IP (`RATE_LIMIT_PER_MINUTE`). Every response carries `X-Process-Time-Ms`.

## How routing works

- Gateway forwards to the owning dockerised service when reachable, else serves a **standalone heuristic**
  grounded in the same spec taxonomy (so local dev works without docker).
- Check which path served you via `docker_service` in every response:
  `class-a-cpu (...)` / `class-b-gpu (...)` / `class-c-stateful (...)` = live downstream,
  `... (standalone-fallback)` = heuristic.
- Downstream contracts: Class A `POST /v2/models/{name}/infer {model,version,input}`,
  Class B `POST /v1/chat/completions {model,messages,temperature,max_tokens}`,
  Class C `POST /v2/models/{name}/infer {model,query,top_k,filters}`.
  Configure via `CLASS_A_URL` (default `http://localhost:8080`),
  `CLASS_B_URL` (default `http://localhost:8082`), `CLASS_C_URL` (default `http://localhost:8081`),
  `CLASS_E_URL` (default `http://localhost:8083`).

## Route → model → docker map

| # | Route | Model used | Docker service / image | Spec ref |
|---|-------|-----------|------------------------|----------|
| 0 | `GET /`, `GET /healthz`, `GET /readyz`, `GET /api/v1/health` | — (gateway) | `docker/gateway` | — |
| 1 | `POST /api/v1/scan/source` | **01 AST-CryptoNet** | `class-a-cpu` → `ast_cryptonet` | §1.8 `scan_file()` |
| 2 | `POST /api/v1/scan/binary` | **02 BinCryptoCNN** (15-class) | `class-a-cpu` → `bincryptocnn` | §2.8 `scan_binary()` |
| 3 | `POST /api/v1/scan/entropy` | **03 EntropyGuard** | `class-a-cpu` → `entropyguard` | §3.8 `classify_entropy()` |
| 4 | `POST /api/v1/classify` | **04 CryptoClassLLM** (3-level; B-proxy fallback) | `class-e-ml` → `cryptoclassllm` | §4.8 |
| 5 | `POST /api/v1/classify/misuse` | **06 MisuseDetector** (XGBoost, 7-type CWE) | `class-a-cpu` → `misusedetector` | §6.8 |
| 6 | `POST /api/v1/llm/generate` (`model` = `deepseek_coder`/`starcoder2`/`codellama`/`gemini_flash`/`ecdat_lora`) | **08 / 09 / 10 / 11** + **07 ECDAT LoRA** | `class-b-gpu` / `class-e-ml` → chat completions | §7–11 |
| 7 | `POST /api/v1/knowledge/query` | **12 CDKG** (Neo4j, 25 849 nodes) | `class-c-stateful` → `cdkg` | §12.8 |
| 8 | `POST /api/v1/rag/search` | **13 RAG KB** (MiniLM + FAISS + reranker) | `class-c-stateful` → `rag_kb` | §13.8 |
| 9 | `POST /api/v1/knowledge/hybrid` | **14 Hybrid Retriever** (BM25+FAISS RRF) | `class-c-stateful` → `hybrid_retriever` | §14.8 |
| 10 | `POST /api/v1/knowledge/vector` | **15 ChromaDB** (+**16 Embedding Pipeline**) | `class-c-stateful` → `chromadb` | §15.8/§16.8 |
| 11 | `POST /api/v1/knowledge/trust` | **17 SourceTrust** | `class-a-cpu` → `source_trust` | §17.8 |
| 12 | `POST /api/v1/knowledge/temporal` | **18 TKG** | `class-a-cpu` → `tkg` | §18.8 |
| 13 | `POST /api/v1/quantum/cost`, `GET /api/v1/quantum/attack-costs/{algo}` | **20 Quantum Cost DB** (Shor/Grover) | `class-a-cpu` → `quantum_cost` | §20.8 |
| 13b | `POST /api/v1/knowledge/crypto-api` | **21 Crypto API KB** (780 APIs, 6 langs) | `class-c-stateful` → `crypto_api` | §21.8 |
| 13c | `POST /api/v1/security/trapdoor` | **23 Trapdoor IOC DB** (6 IOC families) | `class-a-cpu` → `trapdoor` | §23.8 |
| 14 | `POST /api/v1/knowledge/vuln` | **22 VulnIntel** (18k CVE) | `class-a-cpu` → `vuln_intel` | §22.8 |
| 15 | `POST /api/v1/knowledge/compliance` | **24 Compliance KB** (1247 rules) | `class-a-cpu` → `compliance_kb` | §24.8 |
| 16 | `POST /api/v1/risk/score`, `POST /api/v1/quantum/mosca` | **25 QARS** (0–100, CRITICAL>90) | `class-a-cpu` → `qars` | §25.8 |
| 17 | `POST /api/v1/risk/monte-carlo` | **26 Monte Carlo Q-Day** (P5/P50/P95) | `class-a-cpu` → `monte_carlo` | §26.8 |
| 18 | `POST /api/v1/risk/forecast` | **27 Temporal Risk** (batch image, gateway-served) | `class-d-batch` (no HTTP; gateway serves) | §27.8 |
| 19 | `POST /api/v1/system/calibrate` | **28 Confidence Calibration** (Platt) | `class-a-cpu` → `confidence_calibration` | §28.8 |
| 20 | `POST /api/v1/robust/detect` | **05 CryptoRobust** (batch image, gateway-served) | `class-d-batch` (no HTTP; gateway serves) | §5 |
| 21 | `POST /api/v1/risk/gnn` | **19 GNN Risk** (GraphSAGE, batch image, gateway-served) | `class-d-batch` (no HTTP; gateway serves) | §19.8 |
| 22 | `POST /api/v1/security/redteam` | **29 AI Red Team** (batch image, gateway-served) | `class-d-batch` (no HTTP; gateway serves) | §29.8 |
| 23 | `POST /api/v1/remediate` | **06 RemediationEngine + NIST FIPS 203/204/205 rules** | `class-a-cpu` (rule engine) | §6 |

Not dockerised: none — all 29 models are deployable
(04/07 via new `class-e-ml` image, 21 via `class-c-stateful`, 23 via `class-a-cpu`).
Class E note: `docker/class-e-ml` serves 04 (Qwen2.5-Coder-3B + LoRA, adapter weights in-repo)
and 07 (Qwen2.5-Coder-7B + LoRA; base-model-only if no adapter). HF base weights
(~6 GB + ~15 GB) download to `HF_HOME` on first load; the adapter 503s cleanly until then
and the gateway falls back automatically.

Class D note: `docker/class-d-batch` is a CronJob image (`models/batch_job.py`: 05/19/27/29)
with no HTTP server — the gateway exposes synchronous equivalents and documents the batch origin
in `docker_service`.

---

## Common envelope

Every `POST` returns `GatewayResponse`:

```json
{
  "model": "ast_cryptonet", "model_id": "01",
  "docker_service": "class-a-cpu (standalone-fallback)",
  "findings": [ {"id": "ECDAT-F001", "algorithm": "RSA-2048", "category": "ASYMMETRIC",
    "status": "QUANTUM_VULNERABLE", "cwe_id": "CWE-326", "line_number": 1,
    "code_snippet": "from Crypto.PublicKey import RSA", "quantum_risk": "CRITICAL",
    "confidence": 0.88, "recommendation": "Migrate to NIST FIPS 203 ..."} ],
  "total_findings": 2, "quantum_risk": "CRITICAL", "confidence": 0.88,
  "latency_ms": 12.4, "metadata": {}
}
```

## 1. `POST /api/v1/scan/source` — Model 01 AST-CryptoNet (`class-a-cpu`)

Request (`code` **or** readable `file_path`):

```json
{"code": "from Crypto.PublicKey import RSA\nkey = RSA.generate(2048)",
 "language": "python", "scan_depth": "standard"}
```

Live response (200, verified):

```json
{
  "model": "ast_cryptonet", "model_id": "01",
  "docker_service": "class-a-cpu (standalone-fallback)",
  "findings": [
    {"id": "ECDAT-F001", "algorithm": "RSA-2048", "category": "ASYMMETRIC",
     "status": "QUANTUM_VULNERABLE", "cwe_id": "CWE-326", "line_number": 1,
     "code_snippet": "from Crypto.PublicKey import RSA", "quantum_risk": "CRITICAL",
     "confidence": 0.88, "recommendation": "Migrate to NIST FIPS 203 ML-KEM-768 / FIPS 204 ML-DSA-65"},
    {"id": "ECDAT-F002", "algorithm": "RSA-2048", "category": "ASYMMETRIC",
     "status": "QUANTUM_VULNERABLE", "cwe_id": "CWE-326", "line_number": 2,
     "code_snippet": "key = RSA.generate(2048)", "quantum_risk": "CRITICAL",
     "confidence": 0.88, "recommendation": "Migrate to NIST FIPS 203 ML-KEM-768 / FIPS 204 ML-DSA-65"}
  ],
  "total_findings": 2, "quantum_risk": "CRITICAL", "confidence": 0.88,
  "metadata": {"language": "python", "scan_depth": "standard",
               "spec": "ECDAT_AI_ML_MODELS §1.8 POST /api/v1/scan/source"}
}
```

curl: `curl -X POST localhost:8000/api/v1/scan/source -H 'Content-Type: application/json' -d '{"code":"import hashlib\nh=hashlib.md5(x).hexdigest()","language":"python"}'`

## 2. `POST /api/v1/scan/binary` — Model 02 BinCryptoCNN (`class-a-cpu`)

Request (`binary_data` = base64):

```json
{"binary_data": "<base64 of .so/.exe>", "file_path": "libssl.so"}
```

Response: `model: bincryptocnn (02)`, `metadata: {hashes: {md5,sha1,sha256}, entropy, size_bytes,
taxonomy: "15-class (RSA/ECDSA/ECDH/AES/DES/SHA/…)"}`. Errors: `422` on invalid base64.

## 3. `POST /api/v1/scan/entropy` — Model 03 EntropyGuard (`class-a-cpu`)

Request: `{"code": "api_key=sk_live_abc123XYZ789qrs"}` (or `{"data": "..."}`).
Response: `model: entropyguard (03)`, one finding `HIGH_ENTROPY_SECRET (CWE-798)` if
Shannon entropy > 4.5 else `LOW_ENTROPY`; `metadata.shannon_entropy`, `threshold: 4.5`.

## 4. `POST /api/v1/classify` — Model 04 CryptoClassLLM (`class-e-ml`)

Request: `{"code": "<snippet>", "language": "python"}`.
Live Model 04 response: `model: cryptoclassllm (04)`,
`metadata.taxonomy_3level: {level_1_family, level_2_algorithm, level_3_quantum + confidences}`.
Class E unreachable → automatic fallback to the Model 08 Class B proxy, then heuristics
(`docker_service` shows which path served you).

## 5. `POST /api/v1/classify/misuse` — Model 06 MisuseDetector (`class-a-cpu`)

Request: `{"code": "import hashlib\nh = hashlib.md5(secret).hexdigest()"}`.
Live response (200, verified): `model: misusedetector (06)`,
finding `BROKEN_ALGORITHM (CWE-327)`, `quantum_risk: HIGH`,
`metadata.taxonomy: "7-type CWE (327/326/321/329/330/295/916)"`.

## 6. `POST /api/v1/llm/generate` — Models 08/09/10/11 (`class-b-gpu`)

Request:

```json
{"prompt": "Explain RSA vs ML-KEM", "model": "deepseek_coder",
 "temperature": 0.2, "max_tokens": 1024, "system": "You are a crypto analyst."}
```

`model ∈ {deepseek_coder (08), starcoder2 (09), codellama (10), gemini_flash (11), ecdat_lora (07)}`
else `422`. `ecdat_lora` routes to `class-e-ml` (`CLASS_E_URL`) instead of `class-b-gpu`.
`gemini_flash` (Model 11, gemini-3.6-flash) serves via Google AI Studio (`GEMINI_API_KEY`;
free tier rate-limited, else Tier-3 offline engine) — no GPU needed.
Live downstream response: `metadata: {text, usage}`. GPU stack absent → `200` fallback envelope
(`metadata.text` explains `CLASS_B_URL` unreachable) unless `STANDALONE_FALLBACK=false` (then `503`).

## 7–10. Knowledge — Models 12/13/14/15(+16) (`class-c-stateful`)

- `POST /api/v1/knowledge/query` `{"query": "migrate RSA", "top_k": 10}` → `model: cdkg (12)`,
  `metadata: {patterns: [MIGRATES_TO, VULNERABLE_TO], migration_hint}`.
- `POST /api/v1/rag/search` `{"query": "FIPS 203", "top_k": 10}` → `model: rag_kb (13)`,
  `metadata: {retriever: "MiniLM-L6-v2 + FAISS", rerank: "bge-reranker-base"}`.
- `POST /api/v1/knowledge/hybrid` → `model: hybrid_retriever (14)`, `metadata.fusion: "RRF k=60"`.
- `POST /api/v1/knowledge/vector` → `model: chromadb (15)`,
  `metadata: {embedding: "all-MiniLM-L6-v2 (384-dim)", pipeline_model: "16 embedding_pipeline"}`.

## 11. `POST /api/v1/knowledge/trust` — Model 17 SourceTrust (`class-a-cpu`)

Request: `{"source": "NIST", "claim": "ML-KEM standard"}`.
Response: `model: source_trust (17)`, `metadata: {trust_score (NIST/ISO 1.0, CVE 0.9, CERT-In 0.78…),
tier: T1/T3/T4}`.

## 12. `POST /api/v1/knowledge/temporal` — Model 18 TKG (`class-a-cpu`)

Request: `{"algorithm": "RSA-2048", "date": "2028-01-01"}`.
Response: `model: tkg (18)`, `metadata: {date, state, deprecation_signal}`.

## 13. Quantum — Model 20 Quantum Cost DB (`class-a-cpu`)

- `GET /api/v1/quantum/attack-costs/{algo}` e.g. `/attack-costs/RSA-2048`.
- `POST /api/v1/quantum/cost` `{"algorithm": "RSA-2048", "key_size": 2048}` — live response (200, verified):

```json
{"model": "quantum_cost", "model_id": "20",
 "docker_service": "class-a-cpu (standalone-fallback)",
 "findings": [], "total_findings": 0, "quantum_risk": "CRITICAL", "confidence": 0.95,
 "metadata": {"algorithm": "RSA-2048", "key_size": 2048, "attack": "Shor",
  "complexity": "polynomial", "logical_qubits": 4098,
  "verdict": "broken once CRQC exists", "downstream": false,
  "spec": "ECDAT_AI_ML_MODELS §20.8 calculate_quantum_cost()"}}
```

- `POST /api/v1/quantum/mosca` `{"shelf_life_years": 10, "migration_years": 5, "qday_years": 12}`
  → `model: qars (25)`, `metadata: {inequality: "X+Y>Z", exposed: bool}`.

## 13b. `POST /api/v1/knowledge/crypto-api` — Model 21 Crypto API KB (`class-c-stateful`)

Request: `{"api_name": "Cipher", "language": "python"}` (prefix `"java:"` etc. also accepted via query form).
Response (200, verified): `model: crypto_api (21)`, finding `algorithm: AES`,
`metadata.kb_hit: {library: cryptography, algorithm_variant: AES-CBC, quantum_class: quantum_weak,
replacement, deprecation}` — backed by `crypto_api_kb.sqlite` (780 APIs, 76 algorithms,
90 aliases, 53 replacements, 45 deprecations).

## 13c. `POST /api/v1/security/trapdoor` — Model 23 Trapdoor IOC DB (`class-a-cpu`)

Request: `{"code_snippet": "ctx = Dual_EC_DRBG(seed)"}` (or `algorithm` / `fingerprint`).
Response (200, verified): `model: trapdoor (23)`,
`metadata: {match: true, digest}`, findings e.g. `TRAP-001 Dual_EC_DRBG default points (CWE-327,
CRITICAL)`. No match → `total_findings: 0`, `quantum_risk: NONE`.

## 14. `POST /api/v1/knowledge/vuln` — Model 22 VulnIntel (`class-a-cpu`)

Request: `{"query": "openssl", "top_k": 10}` → `model: vuln_intel (22)`,
`metadata.sources: [NVD 2.0, GitHub Advisory, CERT-In]`.

## 15. `POST /api/v1/knowledge/compliance` — Model 24 Compliance KB (`class-a-cpu`)

Request: `{"algorithm": "RSA-2048", "region": "IN"}` → `model: compliance_kb (24)`,
`metadata: {region, framework ("IN→CERT-In v2.0 + DPDP Act 2023"), rules_mapped: 1247}`.

## 16. `POST /api/v1/risk/score` — Model 25 QARS (`class-a-cpu`)

Request: `{"algorithm": "RSA-2048", "key_size": 2048}`. Live response (200, verified):

```json
{"model": "qars", "model_id": "25", "docker_service": "class-a-cpu (standalone-fallback)",
 "findings": [{"id": "ECDAT-Q001", "algorithm": "RSA-2048", "category": "RISK",
   "status": "CRITICAL", "quantum_risk": "CRITICAL", "confidence": 0.9,
   "recommendation": "Prioritise PQC migration."}],
 "total_findings": 1, "quantum_risk": "CRITICAL", "confidence": 0.9,
 "metadata": {"qars_score": 92, "tier": "CRITICAL",
  "formula": "QARS = 0.30V+0.20Q+0.15A+0.15M+0.10P+0.10E",
  "spec": "ECDAT_AI_ML_MODELS §25.8 calculate_qars()"}}
```

Tiers: CRITICAL >90, HIGH 70–90, MEDIUM 40–70, LOW <40.

## 17. `POST /api/v1/risk/monte-carlo` — Model 26 (`class-a-cpu`)

Request: `{"iterations": 10000, "seed": 42}` → `model: monte_carlo (26)`,
`metadata: {qday_years: {p5, p50, p95}, iterations, downstream}`.

## 18. `POST /api/v1/risk/forecast` — Model 27 (`class-d-batch`, gateway-served)

Request: `{"algorithm": "RSA-2048", "horizon_days": 30}` → `model: temporal_risk (27)`,
`metadata: {forecast[..10], forecast_last}`.

## 19. `POST /api/v1/system/calibrate` — Model 28 (`class-a-cpu`)

Request: `{"raw_score": 0.8, "model_id": "ast_cryptonet"}` — live response (200, verified):

```json
{"model": "confidence_calibration", "model_id": "28",
 "metadata": {"model_id": "ast_cryptonet", "raw_score": 0.8,
  "calibrated_prob": 0.8808, "downstream": false,
  "method": "Platt scaling P=1/(1+exp(As+B))",
  "spec": "ECDAT_AI_ML_MODELS §28.8 calibrate()"}}
```

## 20–22. Batch-served — Models 05/19/29 (`class-d-batch`, gateway-served)

- `POST /api/v1/robust/detect` `{"code": "eval(x)", "defense": "ensemble"}`
  → `model: cryptorobust (05)`, finding `ADVERSARIAL_SUSPECT`/`CLEAN`.
- `POST /api/v1/risk/gnn` `{"algorithm_id": "RSA-2048", "neighbors": ["TLS-1.2"]}`
  → `model: gnn_risk (19)`, `metadata.propagation_score`.
- `POST /api/v1/security/redteam` `{"model_id": "bincryptocnn", "attack": "FGSM", "samples": 100}`
  → `model: red_team (29)`, `metadata.plan[]`.

## 23. `POST /api/v1/remediate` — Model 06 engine + FIPS rules (`class-a-cpu`)

Request: `{"finding_id": "ECDAT-2026-R001", "vulnerable_code": "RSA.generate(2048)",
"language": "python", "target_algorithm": "ML-KEM-768"}`.
Response (200, verified shape): finding `algorithm: "ML-KEM-768 (FIPS 203) + ML-DSA-65 (FIPS 204)"`,
`metadata: {target_algorithm, detected_misuse, remediated_diff, standards: [FIPS 203, 204, 205]}`.

## Health

- `GET /` — full route catalog (see `root()` in `gateway/main.py`).
- `GET /healthz`, `GET /readyz` — gateway probes.
- `GET /api/v1/health` — gateway + Class A/B/C reachability
  (`{gateway, services: {class-a-cpu, class-b-gpu, class-c-stateful}}`).

## Errors

| Code | When |
|------|------|
| `401` | bad/missing API key (only when `GATEWAY_API_KEYS` set) |
| `404` | unknown downstream model name |
| `422` | missing `code`/`file_path`, invalid base64, bad `model` enum |
| `429` | >120 req/min/IP |
| `503` | LLM downstream down **and** `STANDALONE_FALLBACK=false` |

## Deploy / operate

```powershell
make run-gateway            # local: uvicorn gateway.main:app :8000
make test-gateway           # pytest tests/test_gateway.py
make docker-build-gateway   # docker build -f docker/gateway/Dockerfile
```

## Two-box deploy (Vultr CPU + AWS GPU)

- **Vultr 4vCPU/8GB (all CPU models: 01/02/03/05/06/12–18/20–29):**
  `docker compose -f docker-compose.yml -f docker-compose.vultr.yml up -d --build`
  (adds 8 GB-safe memory caps + `class-d-batch` on `--profile batch`; chroma moved to host port 8001)
- **AWS g5.xlarge (Class B only: 08/09/10 via Ollama, 11 via Gemini API):**
  `cp .env.example .env` (fill `GEMINI_API_KEY`), then
  `docker compose -f docker-compose.aws.yml up -d --build` (auto-pulls the 3 Ollama models)
- Link them: `AWS_GPU_HOST=<aws-ip>` in Vultr `.env` (+ SG opens 8082/8083 to the Vultr IP).
  AWS unset → gateway fallbacks cover LLM routes; demo never breaks.
- k8s: `kubectl apply -k k8s/overlays/prod` (gateway-deployment.yaml; ingress routes /api/v1,/docs,/openapi.json,/ → ecdat-gateway:8000)

