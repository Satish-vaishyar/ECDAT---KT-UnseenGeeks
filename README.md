# ECDAT — Enterprise Cryptographic Discovery & Analysis Tool


> ## No Setup Needed — Just Run the App
> **The full application is packed into a single standalone exe kept at `ECDAT-IDE\dist\QIROVA.exe` — just run that exe to use the application. It runs without the source code as well (no Python / npm / VS Code / install required).**

**Smart India Hackathon 2026 (Software Edition)**
**Problem Statement ID: 26164 | Organisation: National Technical Research Organisation (NTRO)**
**Theme: Blockchain & Cybersecurity**

**Team: KT@UnseenGeeks**

> Submission-ready monorepo. Two runnable components of one system:
> `ECDAT-Web/` = enterprise web platform & API · `ECDAT-IDE/` = developer IDE extension (QIROVA IDE).
> Evaluators can start with either — both use the same gateway API and CBOM format.

---

## 1. Problem Statement (PS 26164 — as issued)

### 1.1 Background
> Transitioning to Post-Quantum Cryptography (PQC) based solutions requires preparedness, risk assessment, and financial/operational investment. Discovery and inventory of Cryptographic Artefacts is the critical first step that enables this transition.

### 1.2 Core Requirements (the tool must)
1. **Identify and catalogue** all cryptographic artefacts — algorithms, keys, certificates, protocols, libraries, hardware modules, cloud services — across internal and external-facing applications, products, and infrastructure.
2. **Perform comprehensive quantum risk assessment** and identify systems prone to potential quantum attacks, highlighting risks to sensitive data.
3. **Classify all artefacts** by type, lifetime, and business criticality using structured frameworks such as **Mosca's algorithm (X + Y > Z)**.
4. **Recommend suitable alternatives** (PQC / Hybrid algorithms) for applications based on risk profile, latency, cost, etc.

### 1.3 Expected Deliverables
- Comprehensive **CBOM (Cryptographic Bill of Materials)** analytics tool.
- Scanning of **source code repositories, binaries, libraries, and container images**.
- Report of all cryptographic assets including **versions / modes in standardised formats** (CycloneDX).
- **Interactive GUI platform** to visualise the scan, risks, and results.

### 1.4 How we map to the PS
| PS requirement | ECDAT delivers | Reference doc |
|---|---|---|
| Catalogue artefacts (algo, keys, certs, protocols, libs) | Tree-sitter AST + regex + entropy hybrid, 500+ API KB, TLS/cipher probing, container layer scan | `ECDAT-Web/doc/ECDAT_ARCHITECTURE_V3.md` |
| Quantum risk assessment | Mosca + QARS (0–100) + GRI-2025 Monte-Carlo Q-Day (P5/P50/P95) + HNDL score + GNN transitive risk | `ECDAT-Web/doc/SIH26-26164_Cybersecurity_Research_Doc.md` §2–4 |
| Classify by type / lifetime / criticality | CryptoClassLLM 25-class + lifetime/sensitivity/criticality scorer + compliance tier | `ECDAT-Web/doc/ECDAT_AI_ML_MODELS.md` |
| Recommend PQC / hybrid alternatives | NIST FIPS 203/204/205 rules (ML-KEM-768, ML-DSA-65, SLH-DSA) + hybrid X25519+ML-KEM + effort/cost matrix | `ECDAT-Web/doc/ECDAT_IMPLEMENTATION_V3.md` |
| CBOM analytics tool | CycloneDX 1.6/1.7 CBOM + SBOM fusion, `GET /scans/{id}/cbom` | `ECDAT-Web/doc/ECDAT_COMPLETE_ARCHITECTURE_DIAGRAM.md` |
| Scan repos, binaries, libraries, containers | `POST /scan/source`, `/scan/binary`, `/scan/entropy`, container + dependency scan | `ECDAT-Web/doc/GATEWAY_API_REFERENCE.md` |
| Standardised report (versions/modes) | Findings with algo + version + mode + CWE + confidence + recommendation, SARIF + PDF export | `ECDAT-Web/doc/ALL_APIS_EXECUTION_REPORT.md` |
| Interactive GUI | Web workbench (`frontend/`) + IDE panels + SOC console | `ECDAT-IDE/ecdat-ide-extension/README.md` |
| **Beyond PS (our additions)** | Auto-remediation with in-editor Accept/Reject, CERT-In v2.0 / DPDP / NIST compliance, NVD+CISA-KEV vuln intel, TrapDoor supply-chain check, executable Shor/Grover proof on simulator + real IBM QPU, migration cost (CostNet P50) | `ECDAT-IDE/QIROVA-FINAL.md`, `ECDAT-IDE/PRESENTATION.md` |

---

## 2. Solution abstract

**ECDAT finds classical cryptography in your code, proves a quantum computer can break it, prices the fix, and migrates you to post-quantum replacements — with evidence.**

Pipeline: **detect → prove → price → migrate → prove again.**

1. **Detect** — 29-model staged audit (AST-CryptoNet, BinCryptoCNN, EntropyGuard, taxonomy LLM, misuse/CWE, knowledge graph, vuln intel).
2. **Prove** — real Qiskit Shor/Grover campaigns in simulator ($0) and on 156-qubit IBM Heron QPUs (`ibm_fez`, `ibm_marrakesh`, Job IDs `dafhlo51ierc738ncop0`, `dafi7qtnj4cs73agdfm0`), plus inline circuit diagrams.
3. **Price** — QARS tier + Monte-Carlo Q-Day distribution + CostNet P50 migration estimate + HNDL exposure window.
4. **Migrate** — NIST-approved replacements + hybrid modes via rule+template engine and LLM rewrite, reviewed in-editor (Accept/Reject/Accept All) or as API diff.
5. **Evidence** — CycloneDX CBOM, compliance gap report (CERT-In / DPDP / NIST / CNSA 2.0), audit trail.

---

## 3. Repository structure — ECDAT-Web vs ECDAT-IDE

```
ECDAT/  (this submission root)
├── README.md          <- this file (submission entry point)
├── .gitignore         <- single exclusion list (secrets, handoffs, weights, live tests)
├── ECDAT-Web/         <- enterprise web platform
│   ├── gateway/       # FastAPI gateway + routers (scan, classify, risk, quantum, knowledge, llm, remediate)
│   ├── src/ecdat/     # core package
│   ├── models/        # model_07_ecdat_lora, model_11_gemini, model_21_crypto_api, model_23_trapdoor
│   ├── doc/           # 12 research + architecture + API docs (see §10)
│   ├── deployment/    # cloud guides (evaluators: see README inside; creds excluded per .gitignore)
│   ├── docker/, k8s/, scripts/, tests/
│   ├── requirements.txt, pyproject.toml, docker-compose.yml, README.md
└── ECDAT-IDE/         <- developer IDE (QIROVA IDE)
    ├── ecdat-ide-extension/  # VS Code / VSCodium extension (TypeScript, 26+ commands)
    ├── backend/       # full 29-model gateway (gateway/ + src/ + all_models/model_01..29 + quantum_redteam/)
    ├── docs/          # integration plan + QPU proof
    ├── README.md, PRESENTATION.md (5-min demo), QIROVA-FINAL.md (full reference)
```

### 3.1 What is different and why both are used

| Dimension | **ECDAT-Web** | **ECDAT-IDE (QIROVA IDE)** |
|---|---|---|
| **Who** | SOC team, auditor, SIH judge in a browser | Developer fixing code in VS Code / VSCodium |
| **Interface** | REST API + web workbench: upload repo → staged progress → findings / telemetry / compliance / migration views → CBOM + PDF export | QIROVA Copilot chat (`scan`, `migrate`, `red-team`, `qred`, `q-day`, `cbom`, `score`, `knowledge`) + inline red/green diffs with Accept/Reject CodeLens + ghost fixes + 4 side panels + status-bar Q-Day & PQC score |
| **Backend** | Lean production gateway, 4 checked-in models, dockerised services (CPU/GPU/stateful/batch), `docker-compose.yml`, k8s manifests | Full 29-model runtime (`all_models/model_01..29`) + `quantum_redteam/` 3-phase engine, child-process isolated audits, 8-min deadline with partial results |
| **Why it exists** | Central, scalable, team-wide scans; CI integration; judge demo without installing an IDE; cloud deploy | Fix where code is written; one-click QuickFix (MD5→blake2b, SHA-1→SHA-256, RC4→ChaCha20, DES→AES-256, ECB→GCM, RSA→ML-KEM-768); immediate quantum proof + cost |
| **Demo in 2 min** | `POST /api/v1/pipeline/audit` → show Q-Day P5–P95 table + CostNet P50 + CBOM | Open vulnerable file → `scan` → `migrate` → Accept All → `cbom` |

Both speak the same API. IDE default gateway `http://127.0.0.1:8000`, overridable via `ecdat.gateway.url`.

---

## 4. Key features (evaluator-visible)

- **Multi-source discovery:** source AST, binaries (ELF/PE), entropy/secret scan (700+ detectors), container layers, TLS endpoints (400+ cipher suites, JA3).
- **Quantum risk:** Mosca, QARS 0–100 with tier/action, Monte-Carlo Q-Day with CI bands, HNDL score (V×S×R×E), temporal forecast, GNN transitive risk.
- **AI classification:** CryptoClassLLM (25-class, 99.80%), MisuseDetector (XGBoost, 99.10%), robustness attack-test, LoRA remediator, Gemini/DeepSeek/StarCoder/CodeLlama reasoning with simulation fallback.
- **Knowledge & threat:** CDKG graph, RAG + hybrid retriever, SourceTrust, TKG, VulnIntel (18k CVE + CISA KEV), TrapDoor IOCs, Crypto-API KB (780 APIs, 6 langs).
- **Remediation:** rule+template engine (no hallucinated APIs) + LLM rewrite; IDE review cards; `POST /remediate`.
- **Compliance:** CERT-In v2.0 §8, DPDP Act 2023, NIST IR 8547 / FIPS 203-205, CNSA 2.0, RBI/SEBI overlays; gap report with score.
- **Red team:** Qiskit Shor (RSA/ECC) + Grover (AES/SHA) + PQC resistance + timeline; sim free, hardware via estimate→confirm→capped job; inline SVG circuits.
- **Evidence:** CycloneDX CBOM, SARIF, PDF report, hash-chained audit trail, scan history.

---

## 5. Architecture & tech stack

```
[ VS Code extension ] ─┐
[ Web workbench     ] ─┼─► FastAPI gateway :8000 ─► Class-A CPU (discovery/risk) ─► Class-B GPU (LLMs)
[ CI / scripts      ] ─┘                              ├► Class-C stateful (KG/RAG/Chroma) ─► Neo4j / FAISS
                                                      ├► Class-D batch (GNN/forecast/redteam) ─► CronJob
                                                      └► Class-E ML (LoRA / Gemini router)
                                                      + quantum_redteam (Qiskit Aer + IBM Quantum job mode)
```

Stack: Python 3.11 FastAPI + Uvicorn, Tree-sitter, Qiskit Aer + IBM Quantum, PennyLane VQC, XGBoost + GraphSAGE/GAT, Neo4j + FAISS + ChromaDB, Docker + Kubernetes, TypeScript VS Code API + Webview, CycloneDX CBOM. Full map: `ECDAT-Web/doc/ECDAT_ARCHITECTURE_V3.md`, `ECDAT_COMPLETE_ARCHITECTURE_DIAGRAM.md`, `ECDAT-IDE/PRESENTATION.md` §3.

---

## 6. AI/ML models (29 wired, `/models/status`)

| ID | Name | Task | Metric (see benchmarks doc) |
|---|---|---|---|
| 01–03 | AST-CryptoNet, BinCryptoCNN, EntropyGuard | Find crypto + secrets | High precision + confidence scoring |
| 04 | CryptoClassLLM (Qwen2.5-Coder-3B+LoRA) | 25-class classifier | 99.80% |
| 05 | CryptoRobust | Adversarial test | FGSM/PGD/C&W/GAMMA |
| 06 | MisuseDetector (XGBoost+RL) | CWE misuse (7 types) | 99.10% |
| 07 | ECDAT LoRA remediator | Generate PQC fix | Validated templates |
| 08–11 | DeepSeek-Coder, StarCoder2, CodeLlama, Gemini router | Code reasoning | Simulation fallback, 5-key rotation |
| 12–18 | CDKG, RAG, Hybrid retriever, Chroma, Embeddings, SourceTrust, TKG | Knowledge & provenance | 95–98% coverage/precision |
| 19–24 | GNN risk, Quantum-cost DB, Crypto-API KB, VulnIntel, Trapdoor, Compliance KB | Risk intel | 92% AUC / 18k CVE / 1247 rules |
| 25–28 | QARS, Monte-Carlo Q-Day, Temporal forecast, CostNet | Scores, timelines, prices | 0.0% over-deadline loss (calibrated) |
| 29 | AI Red Team (+ quantum_redteam engine) | Stress-test + VQC + PPO | 99.42% static / 89.0% RL defense |

Details: `ECDAT-Web/doc/ECDAT_AI_ML_MODELS.md`, `ALL_MODELS_BENCHMARK_AND_ACCURACY_TABLES.md`, `models/README.md`.

### Quantum hardware validation
- Targets: `ibm_fez`, `ibm_marrakesh` (IBM Heron, 156 physical qubits, superconducting transmon).
- Jobs: `dafhlo51ierc738ncop0`, `dafi7qtnj4cs73agdfm0` (see `ECDAT-IDE/docs/qpu-first-run-proof.json`).
- Result: Shor RSA-15 → 3×5 in simulator (0.6 s, $0) and on live QPU (job URL + counts).
- Costing: Gidney & Ekerå 2021 / Gidney 2025 / Roetteler 2017 grounded DB — e.g. RSA-2048 ≈ 6,189 logical qubits / ~8 h; ECC P-256 easier (2.6× fewer qubits). Full tables: `ECDAT-Web/doc/SIH26-26164_Cybersecurity_Research_Doc.md` §2.

---

## 7. Comparison with existing products

| Capability | **ECDAT (ours)** | IBM Quantum Safe / Guardium | Thales CipherTrust Discovery | DigiCert / InfoSec Global / QuSecure | Open-source (cryptosense, PQC scanners, regex tools) |
|---|---|---|---|---|---|
| Source + binary + container + TLS discovery | ✅ all four, one CBOM | Partial (mainly inventory) | ✅ discovery, weak PQC depth | Partial / point tools | ❌ single-source only |
| Quantum risk (Mosca + Q-Day distribution + HNDL quantified) | ✅ continuous score + P5–P95 + shelf-life | ✅ inventory + roadmap, no HNDL per-asset | ❌ no Q-Day sim | ❌ binary safe/unsafe | ❌ none |
| Executable Shor/Grover proof (sim + real 156q QPU) | ✅ Qiskit + IBM job mode + circuits | ❌ advisory only | ❌ | ❌ | ❌ |
| Auto-remediation in-editor with review | ✅ Accept/Reject + ghost + PR-ready diff | ❌ | ❌ | ❌ | ❌ manual |
| Indian compliance (CERT-In v2.0, DPDP, DST roadmap) | ✅ gap report + score | ❌ US/EU centric | ❌ | ❌ | ❌ |
| Threat intel (NVD + CISA KEV + TrapDoor supply-chain) | ✅ per-finding CVE + KEV flag | Partial | Partial | ❌ | ❌ |
| Migration cost (CostNet P50) + prioritised scheduler (DQN) | ✅ priced roadmap | ❌ | ❌ | ❌ | ❌ |
| IDE + Web + API in one submission | ✅ | ❌ enterprise only | ❌ | ❌ / SaaS only | ❌ CLI only |
| Cost / access for NTRO eval | ✅ self-hosted, open eval | Commercial licence | Commercial licence | Commercial licence | Free but shallow |

Typical SIH team says *"RSA is vulnerable."* ECDAT says *"RSA-2048 needs ~6,189 logical qubits / ~8 h (Gidney & Ekerå 2021); at GRI-2025 midline Q-Day your 10-yr-shelf-life asset has 71% exposure if migration starts 2030 vs 45% if started 2026 — migrate to ML-KEM-768 hybrid now, est. ₹X / Y days."* (See `ECDAT-Web/doc/ECDAT_RESEARCH_PLAN.md` — "How this beats every other team".)

---

## 8. How to run (for evaluators)

### Option A — Web platform (recommended, no IDE needed)
```powershell
cd ECDAT-Web
python -m venv .venv; .\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
copy .env.example .env   # add NVIDIA / GEMINI / IBM keys (any missing service falls back to heuristics)
python -m uvicorn gateway.main:app --host 127.0.0.1 --port 8000
```
- Health: `GET http://127.0.0.1:8000/api/v1/health`
- Status: `GET http://127.0.0.1:8000/api/v1/models/status`
- Full audit: `POST http://127.0.0.1:8000/api/v1/pipeline/audit` (see `doc/GATEWAY_API_REFERENCE.md`, `ALL_APIS_EXECUTION_REPORT.md`)
- Docker: `docker compose up --build`

### Option B — IDE (developer fix flow)
```powershell
cd ECDAT-IDE\backend
python -m venv .venv; .\.venv\Scripts\Activate.ps1
pip install -r requirements-lite.txt
copy .env.example .env
python -m uvicorn gateway.main:app --host 127.0.0.1 --port 8000

cd ..\ecdat-ide-extension
npm install; npm run build; npm test
npm run package   # install resulting .vsix via VS Code / VSCodium
```
In VS Code set `ecdat.gateway.url` → `http://127.0.0.1:8000`, then Copilot: `scan` → `migrate` → `red-team` → `q-day` → `cbom`. 5-min script: `ECDAT-IDE/PRESENTATION.md` §4.

### 5-minute judge demo
1. `scan` a sample vulnerable repo → 29-row evidence table + severity split (60 s–8 min, partials with banner on deadline).
2. `red-team` → Shor 15 = 3×5 table + PQC verdicts + timeline.
3. `q-day` → P5–P95 table + QARS tier + HNDL window.
4. `migrate` → Accept All → re-scan score rises.
5. `cbom` → CycloneDX export + compliance score.

---

## 9. Documents to read (in order)

| # | Document | What it proves |
|---|---|---|
| 1 | `ECDAT-IDE/PRESENTATION.md` | 1-page pitch + architecture + demo tour |
| 2 | `ECDAT-IDE/QIROVA-FINAL.md` | Complete reference: extension + backend + APIs + verification |
| 3 | `ECDAT-Web/doc/SIH26-26164_Cybersecurity_Research_Doc.md` | PS analysis + attack-cost DB + Q-Day + HNDL + compliance |
| 4 | `ECDAT-Web/doc/ECDAT_ARCHITECTURE_V3.md` + `ECDAT_COMPLETE_ARCHITECTURE_DIAGRAM.md` | Enterprise design |
| 5 | `ECDAT-Web/doc/ECDAT_IMPLEMENTATION_V3.md` | Build log / implementation evidence |
| 6 | `ECDAT-Web/doc/ECDAT_AI_ML_MODELS.md` + `ALL_MODELS_BENCHMARK_AND_ACCURACY_TABLES.md` | Model specs + metrics |
| 7 | `ECDAT-Web/doc/GATEWAY_API_REFERENCE.md` + `ALL_APIS_EXECUTION_REPORT.md` | Every route + live execution proof |
| 8 | `ECDAT-Web/doc/QUANTUM_RESEARCH_ECDAT_SIH26164.md`, `AI-Research-Document-PS26164.md` | Quantum + AI depth |
| 9 | `ECDAT-Web/doc/GCP_HOSTING_GUIDE.md`, `deployment/README.md` | Hosting (creds excluded) |
| 10 | `ECDAT-IDE/ecdat-ide-extension/README.md`, `ECDAT-IDE/docs/INTEGRATION-PLAN.md` | Extension install + wiring plan |

---

## 10. Tech stack (summary)

Python 3.11 · FastAPI · Uvicorn · Tree-sitter · Qiskit Aer · IBM Quantum · PennyLane · XGBoost · GraphSAGE/GAT · Neo4j · FAISS · ChromaDB · Docker · Kubernetes · TypeScript (VS Code API) · CycloneDX CBOM.

---

## 11. Team

**KT@UnseenGeeks** — SIH 2026, PS 26164 (NTRO).

---

## 12. Submission checklist

| # | Item | Status | Location / note |
|---|---|---|---|
| 1 | Problem statement quoted + mapped to solution | ✅ | §1 above + `doc/SIH26-26164_Cybersecurity_Research_Doc.md` |
| 2 | Web platform runnable (gateway + models + docker) | ✅ | `ECDAT-Web/` — `requirements.txt`, `docker-compose.yml`, `gateway/` |
| 3 | IDE runnable (extension + backend) | ✅ | `ECDAT-IDE/ecdat-ide-extension/` (`npm run build/test/package`) + `ECDAT-IDE/backend/` |
| 4 | CBOM in standard format | ✅ | CycloneDX 1.6/1.7 via `GET /scans/{id}/cbom` |
| 5 | Source + binary + library + container scan | ✅ | `POST /scan/source|binary|entropy`, container + dep scan — see `GATEWAY_API_REFERENCE.md` |
| 6 | Quantum risk (Mosca + Q-Day + HNDL) | ✅ | QARS + Monte-Carlo + HNDL scorer |
| 7 | PQC recommendations (NIST FIPS 203/204/205 + hybrid) | ✅ | Remediation engine + migration matrix |
| 8 | Interactive GUI | ✅ | Web workbench + IDE panels/console |
| 9 | Real-QPU evidence | ✅ | Job IDs + `docs/qpu-first-run-proof.json` |
| 10 | Benchmarks + API execution reports | ✅ | `ALL_MODELS_BENCHMARK_AND_ACCURACY_TABLES.md`, `ALL_APIS_EXECUTION_REPORT.md` |
| 11 | No secrets committed | ✅ | Root `.gitignore` excludes `.env`, `secrets.yaml`, handoffs; evaluators use `.env.example` |
| 12 | Internal-only files excluded | ✅ | Handoffs, live-key tests, heavy weights, local runners ignored (see `.gitignore`) |
| 13 | Demo script for judges | ✅ | §8 above + `ECDAT-IDE/PRESENTATION.md` §4 |
| 14 | Comparison vs existing products | ✅ | §7 above |
| 15 | Team name declared | ✅ | KT@UnseenGeeks |

*Evaluators: start at §8 Option A, then read docs in §9 order. Total cold start ~10 min first boot (model loads), then audits run 60 s–8 min depending on repo size and LLM availability.*
