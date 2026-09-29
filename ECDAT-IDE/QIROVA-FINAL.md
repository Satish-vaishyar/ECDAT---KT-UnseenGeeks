# QIROVA IDE — Complete Project Documentation
### Quantum Intelligence for Resilient Operations · Vulnerability & Assurance

> Single reference for the whole system: IDE, extension, backend, features,
> verification. Code: `https://github.com/snnxndnsjdnsn/ECDAT-IDE` (private).

---

## 1. What this is

QIROVA IDE finds classical cryptography in source code, **proves** a quantum
computer can break it (on simulators *and* real IBM QPUs), prices the migration,
rewrites the code to post-quantum replacements with in-editor review, and
exports the evidence as a CycloneDX 1.7 CBOM — all inside VS Code / VSCodium.

Pipeline slogan: **detect → prove → price → migrate → prove again.**

---

## 2. Repository layout

```
ECDAT-IDE/
├── PRESENTATION.md                  # short demo companion
├── QIROVA-FINAL.md                  # ← this file
├── docs/INTEGRATION-PLAN.md         # 29-model wiring plan
├── docs/qpu-first-run-proof.json    # real-QPU Shor result (evidence)
├── ecdat-ide-extension/             # VS Code extension (TypeScript)
│   ├── src/                         # extension, copilot, remediator, providers,
│   │                                #   gatewayClient, scanner, console, statusBar…
│   ├── media/frontend/              # browser UI served at /app (scan workbench)
│   ├── test/                        # 250+ unit/integration + jsdom webview E2E
│   ├── samples/, themes/, walkthrough/
│   └── package.json                 # 26+ commands, views, configuration
└── backend/                         # FastAPI gateway + models (Python)
    ├── gateway/                     # routers: pipeline/scan/classify/risk/
    │                                #   knowledge/quantum/ai/migration/redteam…
    ├── src/ecdat/core/              # orchestrator, 29-model runtime, CBOM,
    │                                #   NVIDIA client, scan store, guard rails
    ├── all_models/model_01…29/      # one folder per model (code + weights)
    ├── quantum_redteam/             # 3-phase attack engine (sim + IBM QPU)
    ├── tests/                       # backend pytest suite
    └── .env                         # team keys (private repo only)
```

---

## 3. The extension (IDE side)

### 3.1 QIROVA Copilot (sidebar chat — the main interface)

| Input | What happens |
|-------|--------------|
| `scan` | Workspace sweep + **29-model staged audit**: live 5-stage plan, per-minute elapsed ticker, per-model evidence, severity split, CostNet P50, scan ID; partial results with banner if the 8-min deadline hits |
| `migrate` | PQC snippets + live NVIDIA rewrite + **review cards** (Accept/Reject/**Accept All**) + hunk jumps with ghost preview |
| `red-team` | Model verdicts + local review table + **live quantum campaign** (Shor/Grover results, PQC verdicts, break-year timeline) + **inline SVG circuit diagrams** (collapsible) |
| `qred` | **Real-QPU flow**: token/backends status, cost **estimate**, palette command confirms spend, Red-Team Review table, circuit diagrams |
| `q-day` | Full percentile card (P5–P95, CI bands, horizons), QARS tier/action, HNDL exposure, 30-day forecast |
| `score` | Per-file PQC readiness + live model verdicts |
| `cbom` | CycloneDX 1.7 export preview + save |
| `knowledge` | CDKG/RAG/CVE answers + compliance + trapdoor |
| plain words | AI chat via gateway (models 08–11) with active-file context |

### 3.2 In-editor review (middle window, Cursor-style)

- **Red/green diff decorations** + clickable **Accept / Reject CodeLenses** per hunk, **Accept All / Reject All** at file top — painted automatically after every `migrate`.
- **Inline ghost completions** (Tab/Esc) on vulnerable lines, always on.
- Commands: `QIROVA: Suggest Next Migration`, `QIROVA: Run Real-QPU Red Team (confirms spend)`, plus 20+ others (scan, CBOM export, Q-Day, trapdoor, entropy…).
- QuickFix lightbulb actions + snippet completions from the same fix engine.

### 3.3 Side panels & webview

- Panels: Risk, Compliance, Threat, Findings, Console — live rows from the gateway.
- Browser workbench (`/app`): file/folder upload audit, staged progress, findings/telemetry/compliance/migration views, report + CBOM PDF export, scan history.
- Webview renders on **VS Code theme variables** (adapts to any theme), black assistant cards, animations, single-column tables → lists, ragged tables get captions.

---

## 4. The backend (gateway + 29 models + services)

### 4.1 The 29 wired models (verified live at `/models/status`)

| ID | Model | Job |
|----|-------|-----|
| 01–03 | AST-CryptoNet, BinCryptoCNN, EntropyGuard | Find crypto/secrets |
| 04–07 | Taxonomy LLM, Robustness, Misuse/CWE, LoRA remediator | Classify, attack-test, fix |
| 08–11 | Coder, StarCoder2, CodeLlama, Gemini-router | Code reasoning (NVIDIA `gpt-oss-20b`, 5-key rotation → simulation) |
| 12–18 | CDKG, RAG, retriever, Chroma, embeddings, SourceTrust, TKG | Knowledge & provenance |
| 19–24 | GNN risk, quantum-cost, API-KB, vuln-intel, trapdoor, compliance | Risk intel |
| 25–28 | QARS, Q-Day Monte Carlo, temporal forecast, CostNet | Scores, timelines, **prices** |
| 29 | Red-team validator | Adversarial self-check |

### 4.2 quantum_redteam engine (the "30th" capability)

- **Phase 1** Shor (RSA/ECC) + Grover (AES/SHA) — real Qiskit circuits; **Phase 2** PQC resistance tests; **Phase 3** break-year timeline (pure math).
- **Simulation** (free, Qiskit Aer): full campaign <2s.
- **Hardware** (IBM Heron 156q, job mode): estimate → explicit confirm → capped run → job URL + counts. Proven: Shor RSA-15 → 3×5 on `ibm_marrakesh`.
- Every small circuit also served as **inline SVG** (`circuit_svg`) for the IDE diagrams.

### 4.3 Hardening (earned the hard way)

- Audits run in an **isolated child process** (native ML segfaults can't kill the gateway) + single-flight 429 + **8-min deadline with partial results**.
- NVIDIA: 5-key rotation, per-key timeouts, two-tier waits, audit-wide deadline fast-fail.
- Offline-first model loads; IPv4-pinned client; bounded workspace crawl; progress streaming into the sidebar.

---

## 5. Key API routes

- `POST /pipeline/audit` · `POST /pipeline/upload-audit` — full 29-model audit
- `GET /scans`, `/scans/{id}`, `/scans/{id}/cbom` (**CycloneDX 1.7**), `/report`
- `POST /redteam/run` · `GET /redteam/timeline` · `/redteam/hardware/{status,estimate,run}`
- `POST /ai/chat` (streaming) · `/scan/*` · `/classify/*` · `/risk/*` · `/quantum/*` · `/knowledge/*` · `/migration/*` · `/models/status` · `/system/*`

---

## 6. Setup (for developers)

```cmd
git clone https://github.com/snnxndnsjdnsn/ECDAT-IDE.git D:\ECDAT-IDE   :: D:, needs Git LFS
cd ECDAT-IDE\backend
python -m venv .venv & .venv\Scripts\activate & pip install -r requirements-lite.txt
:: .env already has team keys (private repo — never public, rotate on offboard)
python -m uvicorn gateway.main:app --host 127.0.0.1 --port 8000
:: wait ~10 min first boot; expect 29/29 at /models/status
cd ..\ecdat-ide-extension
npm install & npm run build & npm test & npm run package   :: then install the .vsix
```

---

## 7. Verification status (all against the LIVE backend)

- Extension: **250+ unit/integration** + **40-check jsdom webview E2E** green
- Backend pytest green (full suite needs live network; documented)
- Live: 29/29 wired · full audit 60s–8min with 29-row telemetry · Shor factored RSA-15 in sim (0.6s, $0) and on `ibm_marrakesh` ($388.95 wall-metered) · CBOM validates offline · 5/5 weight hashes byte-identical via git

## 8. Known limits & roadmap

- 3 large adapters excluded from git (GitHub 100MB cap) — copy from a running install
- Real-QPU floor ≈ $288 honest cost; $50 caps refuse by design; spend tracked per-call
- Roadmap: live Q-Day chart, migration PR automation, server-side spend ledger, weight refresh
