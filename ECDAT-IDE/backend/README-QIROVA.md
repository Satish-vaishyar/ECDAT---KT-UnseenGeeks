# QIROVA Backend (FastAPI gateway) — developer bundle

This `backend/` folder is a trimmed copy of the full gateway repo. It contains everything needed to run the API the IDE talks to in LIVE mode. What was deliberately left out (and why) is listed below.

## What's included

| Path | Purpose |
|---|---|
| `gateway/` | FastAPI app (`main.py`, `routers/`, `config.py`, `schemas.py`, `client.py`, …). Entry: `python -X utf8 -m gateway.main` or `uvicorn gateway.main:app` |
| `src/` | `src.ecdat.core.*` runtime imported by the routers (classify, knowledge, llm, pipeline, …) |
| `models/` | Lightweight adapters (`adapter_*.py`) + `README.md` |
| `data/demo_test_suite/` | The 7-file demo corpus the IDE detector tests were validated against |
| `frontend/` | Bundle served by the gateway itself (`main.py` mounts it) |
| `tests/` | Backend tests |
| `doc/` | AI-model spec docs referenced by the gateway |
| `scripts/` | `eval_binary_artifact.py`, cloud setup scripts |
| `requirements.txt`, `pyproject.toml` | Python dependencies |
| `run_backend.ps1` / `run_backend.bat` | One-command launchers (uvicorn on `127.0.0.1:8000`) |
| `run_full_audit.py` | 29-model turnkey audit runner |
| `.env.example` | Copy to `.env` and fill in — **never commit a real `.env`** |

## What's included — full backend

- **`all_models/` (~528 MB)** — the complete model-artifact zoo (weights, loaders, KBs). Loaded **lazily** (`src/ecdat/core/all_models_runtime.py`: "an unavailable optional dependency must not prevent the API from starting"), so the server boots fast; artifact-backed routes engage on first use.
- **`data/`** — full datasets including `demo_test_suite/` (the 7-file corpus the IDE detector tests were validated against).
- `docker/`, `k8s/`, `deployment/`, `.github/`, `demo_bubble12/`, compose files — deploy assets included for completeness.

## What's excluded (and why)

- **`.git/` (~407 MB history)** — version control only; not needed to run anything.
- **`__pycache__/`** — regenerated automatically.
- **`.env`** — contains real API keys in the source checkout; **never ship it**. Copy `.env.example` → `.env` and fill in only the keys you need (Models 08–11 / cloud routes). The gateway runs without it.
- **Session notes** (`session-*.md`) — internal working notes, not part of the app.

## Known client/server contract drift (pre-existing, handled gracefully)

The IDE's `GatewayClient` probes `GET /api/v1/health` (2.5 s timeout — cold starts can exceed it) and `GET /api/v1/risk/score` (no such route in this backend version). Both degrade to `null` by design, and the IDE falls back to MOCK data (status bar badge, risk tree, Q-Day table). Verified live: `health`, `risk/monte-carlo`, and `migration/cost` return real payloads from this exact bundle. If you add routes, mirror them in `../src/gatewayClient.ts` and extend `../test/integration.test.js`.

## Run it

```powershell
cd backend
python -m venv .venv; .\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
Copy-Item .env.example .env   # fill in keys only if you need Models 08-11 / cloud routes
.\run_backend.ps1             # → http://127.0.0.1:8000, Swagger at /docs
```

Health check the IDE uses: `GET /api/v1/health`. In the IDE set `ecdat.gateway.url` to `http://localhost:8000` (default) — the status bar flips from MOCK to LIVE.

## Minimal endpoints the IDE exercises

`health` · `risk/score` · `risk/monte-carlo` · `classify` · `knowledge/vuln` · `pipeline/audit` · `pipeline/compat` · `quantum/qars` · `quantum/hndl` · `migration/cost/:alg` · `compliance/cert-in` · `remediation/roadmap` · `system/resources` — all under `/api/v1/`. The extension's integration tests (`..\test\integration.test.js`) spin a stub implementing these; see `AI-BACKEND-INTEGRATION.md` for adding an `/api/v1/ai/chat` route.
