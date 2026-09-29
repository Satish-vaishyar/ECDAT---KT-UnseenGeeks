# QIROVA IDE — Project Overview
### Quantum Intelligence for Resilient Operations · Vulnerability & Assurance

> Companion context for demos and presentations. Code: `https://github.com/snnxndnsjdnsn/ECDAT-IDE` (private).

---

## 1. The one-line pitch

**QIROVA IDE finds classical cryptography in your code, proves a quantum computer can break it, prices the fix, and migrates you to post-quantum replacements — inside the editor, on real or simulated quantum hardware.**

---

## 2. Why this exists

- RSA/ECDSA/ECDH fall to **Shor's algorithm**; AES/SHA fall (quadratically) to **Grover's**.
- "Harvest now, decrypt later" means vulnerable code written **today** is already exposed.
- NIST has finalized PQC replacements (ML-KEM-768, ML-DSA-65), but migration is manual, scary, and unpriced.
- QIROVA closes the loop: **detect → prove (quantum execution) → price → migrate → export evidence (CBOM).**

---

## 3. Architecture (two halves)

```
┌───────────────────────────── QIROVA IDE (VSCodium/VS Code) ─────────────────────────────┐
│  QIROVA Copilot (sidebar chat)   │  Editor: inline ghost fixes, red/green diff lenses   │
│  Panels: Risk · Compliance · Threat · Findings · Console                                 │
└──────────────────────────────────────────────┬──────────────────────────────────────────┘
                                               │  HTTP 127.0.0.1:8000 (IPv4-pinned client)
┌──────────────────────────────────────────────▼──────────────────────────────────────────┐
│  FastAPI gateway — 29 wired models + services (all-models runtime, thread-safe keys)    │
│  ├─ Static/discovery: 01 AST-CryptoNet · 02 BinCryptoCNN · 03 EntropyGuard              │
│  ├─ Adversarial: 04 taxonomy LLM · 05 robustness · 06 misuse (CWE) · 07 LoRA remediator │
│  ├─ Reasoning LLMs 08–11: NVIDIA NIM (gpt-oss-20b, 5-key rotation) → simulation fallback│
│  ├─ Knowledge 12–18: CDKG graph · RAG · trust · temporal/TKG · source-trust             │
│  ├─ Risk/cost 19–28: GNN · quantum-cost DB · API-KB · vuln-intel · trapdoor ·           │
│  │   compliance/cert-in · QARS(25) · Q-Day Monte Carlo(26) · temporal forecast(27) ·    │
│  │   CostNet(28, calibrated P50 estimates)                                              │
│  ├─ Validation: 29 red-team validator · 30 quantum-redteam engine (below)               │
│  └─ quantum_redteam/ — 3-phase campaign engine (Shor/Grover → PQC tests → timelines)    │
│       ├─ SIMULATION (free, Qiskit Aer): phases 1–3, attack evidence, cost $0            │
│       └─ HARDWARE (IBM Heron 156q, $96/min): cost estimate → explicit confirm → job URL │
└─────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 4. Feature tour (what to demo, in order)

| # | Command (Copilot) | What the audience sees | Backend proof |
|---|-------------------|------------------------|---------------|
| 1 | `scan` | 5-stage live plan → per-model evidence table → severity split → CostNet P50 → scan ID; partial results with banner if the 8-min deadline hits | `POST /pipeline/audit` (child-process isolated, 29-model telemetry) |
| 2 | `migrate` | PQC snippets + **Accept/Reject/Accept All** cards in chat **and** red/green inline diffs with CodeLenses in the editor + ghost-tab completions | Local snippets + live NVIDIA rewrite |
| 3 | `red-team` | Quantum campaign table: Shor factored RSA-15 (3×5), Grover recovered keys, PQC verdicts, break-year timeline | `POST /redteam/run` (real Qiskit simulation) |
| 4 | `qred` | **Real-QPU estimate** (~$49/target) → palette command confirms spend → job runs on `ibm_marrakesh`, factored 15 live for $388.95 wall-metered | `POST /redteam/hardware/*` (IBM job mode) |
| 5 | `q-day` | P5–P95 break-year table, CI bands, QARS tier, HNDL exposure, 30-day forecast | Models 25/26/27 |
| 6 | `cbom` | **CycloneDX 1.7** CBOM with `cryptoProperties` (family/primitive/mode/levels) | `GET /scans/{id}/cbom` |
| 7 | `score`, `knowledge` | PQC readiness + CVE/RAG answers | Models 01/25, 12–15 |

---

## 5. The 29 models (all wired — verified live via `/models/status`)

| ID(s) | Model | Job |
|-------|-------|-----|
| 01–03 | AST-CryptoNet, BinCryptoCNN, EntropyGuard | Find crypto + secrets in code |
| 04–07 | Taxonomy LLM, Robustness, Misuse/CWE, LoRA remediator | Classify, attack-test, fix |
| 08–11 | DeepSeek-coder, StarCoder2, CodeLlama, Gemini-router | Code reasoning (NVIDIA → simulation) |
| 12–18 | CDKG, RAG, retriever, Chroma, embeddings, SourceTrust, TKG | Knowledge & provenance |
| 19–24 | GNN risk, quantum-cost, API-KB, vuln-intel, trapdoor, compliance | Risk intel |
| 25–28 | QARS, Q-Day Monte Carlo, temporal forecast, CostNet | Risk scores, timelines, **prices** |
| 29 | Red-team validator | Adversarial self-check |
| 30 | quantum_redteam engine | Executable Shor/Grover/PQC/timeline campaigns |

---

## 6. Engineering highlights (for technical questions)

- **Crash-proof audits**: audits run in an isolated child process (native ML segfaults can't kill the gateway); single-flight semaphore (429 when busy); 8-min deadline with partial results.
- **Provider rotation**: 5 NVIDIA keys round-robin with per-key timeouts + fast-fail audit deadline (ContextVar) — no more infinite hangs.
- **IPv4-pinned client**, 25s bounded workspace crawl, elapsed ticker, silent-fallback warnings.
- **Money-safe QPU**: estimate → explicit confirm → capped run; session mode replaced with job mode (open-plan compatible); honest wall-clock cost floor after a $388.95 lesson.
- **Tests**: 248 extension unit/integration + 25-check jsdom webview E2E + backend pytest; everything above verified against the live backend, not just mocks.

## 7. Live numbers to quote

- Full 29-model audit: **~60s–8 min** (NVIDIA healthy → ~1 min; degraded → partial at 8 min, never infinite)
- Simulated Shor RSA-15: **factored 3×5 in 0.6s, $0**
- Real QPU Shor RSA-15 (`ibm_marrakesh`): **factored 3×5, $388.95 wall-metered**
- CBOM: CycloneDX **1.7**, validates offline
- Repo: extension + backend + `.env` + docs, LFS for large weights

## 8. Roadmap (honest next steps)

- Visual circuit diagrams inline in Copilot (circuits already exist server-side — render job)
- Q-Day live chart + migration PR automation
- Persistent server-side spend ledger for QPU caps across calls
- Model weight refresh (3 adapters excluded from git by GitHub's 100MB limit)
