# ECDAT-IDE (QIROVA IDE)

Post-quantum cryptography migration IDE: a VS Code/VSCodium extension backed by a
29-model Python gateway (AST discovery, misuse detection, LLM classification,
knowledge/RAG, quantum risk, migration-cost estimation, CBOM export).

> **Note on secrets:** `backend/.env` in this repo contains live API keys so the
> team can run immediately. It is a **private** repo — do not make it public and
> rotate the keys if a collaborator leaves (keys then live on in git history).

## Layout

- `ecdat-ide-extension/` — the IDE extension (TypeScript + Copilot webview).
- `backend/` — FastAPI gateway + all 29 models (`gateway/`, `src/`, `all_models/`).
- `docs/INTEGRATION-PLAN.md` — model wiring/integration plan.

## Extension dev setup

```cmd
cd ecdat-ide-extension
npm install
npm run build        :: typecheck + compile to out/
npm test             :: unit + integration tests (mocked)
npm run package      :: builds qirova-ide-*.vsix (needs vsce)
```

Press `F5` in VS Code, or install the `.vsix` into VSCodium as a builtin under
`resources/app/extensions/qirova-ide` (copy `out/` + `package.json`).

## Backend dev setup

```cmd
cd backend
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements-lite.txt
copy .env.example .env   :: or use the committed .env (keys included)
python -m uvicorn gateway.main:app --host 127.0.0.1 --port 8000
```

- Health: `GET http://127.0.0.1:8000/api/v1/health`
- Models: `GET http://127.0.0.1:8000/api/v1/models/status` (expect 29 wired)
- Full audit: `POST http://127.0.0.1:8000/api/v1/pipeline/audit`

## Large model weights

Three adapter files exceed GitHub's 100MB/file limit and are **excluded**
(see `.gitignore`): model_04 + model_07 LoRA adapters and the model_13 HF
snapshot. Copy them from a running install into the same relative paths, or
those models fall back to heuristics. Everything else needed to run ships here.

## Copilot usage (in the IDE)

`migrate` (PQC snippets + Accept/Reject/Accept All review) · `score` ·
`red-team` · `q-day` · `cbom` · `scan` (29-model staged audit) · `knowledge` ·
plain-language AI chat via the gateway.
