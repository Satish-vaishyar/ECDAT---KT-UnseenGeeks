# ECDAT — GCP Hosting Guide (All Models, Step by Step + Verification)

**Scope:** deploy every ECDAT AI/ML model & system (`ECDAT_AI_ML_MODELS.md`, 34 entries) on Google Cloud:
one Docker image per model (adapter script + weights pattern), Kubernetes orchestration,
single main API (JSON in/out), easy maintenance, continuous monitoring + improvement.
**Default region:** `asia-south1` (Mumbai — SIH India team). Replace `PROJECT_ID` with your GCP project.
**Repo reality (2026-09-07):** no serving code exists yet; trained weights exist for Model 1/2/27;
9 model folders have artifacts. This guide therefore has two tracks:
**Track A** = deploy what's trained today; **Track B** = slot in each remaining model with the same template as it finishes training.

Conventions: commands run in Cloud Shell or any shell with `gcloud` + `docker`. After EVERY step there is a
**Verify** block — do not proceed until it passes.

---

## 0. Architecture map (what goes where)

One image per model is kept, but split by workload class. Weights are NEVER baked into images —
they live in GCS and are pulled at pod start (init container). Only the adapter + server runtime is in the image.

| Class | Members | Target | Why |
|---|---|---|---|
| **A. CPU microservices** | 1 AST-CryptoNet, 2 BinCryptoCNN, 3 EntropyGuard, 6 MisuseDetector, 17 Source Trust, 20 Quantum Cost DB, 21 Crypto API KB, 23 Trapdoor IOC, 24 Compliance KB, 25 QARS, 26 Monte Carlo, 28 Confidence Calibration | **Cloud Run** (scale-to-zero) | Small, bursty, CPU-only. Cheapest + zero cluster ops. |
| **B. GPU LLMs** | 7 Qwen2.5-7B, 8 DeepSeek-16B, 9 StarCoder2-15B, 10 CodeLlama-7B, 4 CryptoClassLLM (LoRA) | **GKE Autopilot + KServe, vLLM runtime** (Ollama dev-only) | Need GPUs, batching, throughput. vLLM >> raw Ollama in prod. |
| **C. Stateful data systems** | 12 CDKG (Neo4j), 18 TKG (Neo4j), 13 RAG KB, 14 Hybrid Retrieval, 15 ChromaDB, 16 Embedding Pipeline | **GKE StatefulSets + PDs** (or Vertex Matching Engine for vectors later) | Disks + stable identity. |
| **D. Batch/cron jobs** | 22 Vuln Intel pipeline, 29 Red Teaming, 32 MLOps retraining, 33 ecdat-bench, 34 Drift Monitor, 5 CryptoRobust eval | **Cloud Run Jobs + Cloud Scheduler** | Periodic, no 24/7 endpoint. |
| **E. Already-cloud** | 11 GPT-4o-mini (Azure OpenAI) | Keep; add GCP failover key only if needed | Don't re-host what's rented. |
| **F. Platform** | 30 Ollama Runtime (dev), 31 Model Serving (this guide replaces with KServe), 19 GNN Risk, 27 Temporal Predictor | 19/27 → Class A (Cloud Run, CPU); 30 → dev only | Small PyTorch CPU models fit Cloud Run. |

**Single main API:** one FastAPI gateway on Cloud Run (`POST /api/v1/...`, routes from spec Part 9:
`/scan/source`, `/scan/binary`, `/classify`, `/classify/misuse`, `/risk/score`, `/risk/forecast`,
`/knowledge/query`, `/rag/search`, `/llm/generate`). It validates the user query, fans out to model
services, and returns unified JSON. Auth + rate limiting live here, nowhere else.

---

## 1. Prerequisites

### 1.1 Project, billing, APIs
```bash
gcloud projects create PROJECT_ID --name=ecdat
gcloud beta billing projects link PROJECT_ID --billing-account=BILLING_ID
gcloud config set project PROJECT_ID
gcloud config set run/region asia-south1
gcloud services enable run.googleapis.com container.googleapis.com \
  artifactregistry.googleapis.com storage.googleapis.com aiplatform.googleapis.com \
  monitoring.googleapis.com logging.googleapis.com cloudscheduler.googleapis.com \
  cloudbuild.googleapis.com secretmanager.googleapis.com
```
**Verify:** `gcloud services list --enabled | grep -E "run|container|aiplatform"` shows all enabled;
`gcloud beta billing projects describe PROJECT_ID` shows `billingEnabled: true`.

### 1.2 IAM + service accounts (least privilege)
```bash
gcloud iam service-accounts create ecdat-serve --display-name="ECDAT serving"
gcloud iam service-accounts create ecdat-train --display-name="ECDAT training"
for SA in ecdat-serve ecdat-train; do
  gcloud projects add-iam-policy-binding PROJECT_ID \
    --member="serviceAccount:$SA@PROJECT_ID.iam.gserviceaccount.com" \
    --role="roles/storage.objectViewer"
done
```
Serving account gets objectViewer only (reads weights, never writes). Trainer gets objectCreator separately if needed.
**Verify:** `gcloud iam service-accounts list` shows both; `gcloud projects get-iam-policy PROJECT_ID` contains the bindings.

### 1.3 Local tools
`gcloud`, `docker`, `kubectl`, `hey` (load test). **Verify:** `gcloud --version; docker --version; kubectl version --client`.

---

## 2. Foundation: registries, buckets, secrets

```bash
# Docker images
gcloud artifacts repositories create ecdat-models \
  --repository-format=docker --location=asia-south1
# Weights (versioned, no public access) + request logs
gsutil mb -l asia-south1 gs://PROJECT_ID-ecdat-weights
gsutil mb -l asia-south1 gs://PROJECT_ID-ecdat-logs
gsutil versioning set on gs://PROJECT_ID-ecdat-weights
# Secrets (API keys, e.g. Azure OpenAI for model 11 fallback)
echo -n "KEY" | gcloud secrets create azure-openai-key --data-file=-
```
**Verify:** `gcloud artifacts repositories list`; `gsutil ls gs://PROJECT_ID-ecdat-weights`;
`gcloud secrets list`. Upload one test blob + `gsutil cp` it back and `sha256sum`-compare.

---

## 3. Packaging standard (applies to every model — build once, cookie-cut)

### 3.1 Adapter contract (your "script 1" slimmed down)
Each image exposes Open-Inference-Protocol-style JSON. Adapter does ONLY pre/post-processing;
the server runtime (MLServer/Triton/FastAPI+uvicorn for custom) handles HTTP, batching, metrics, health.

Request: `{"model": "bincryptocnn", "version": "v3-real", "input": {...}}`
Response: `{"model": ..., "version": ..., "output": {...}, "confidence": 0.0-1.0, "latency_ms": N}`.
Mandatory endpoints in every image: `GET /healthz` (200 < 1s, no model load), `GET /readyz` (200 only when
weights loaded), `POST /v2/models/<name>/infer`.

### 3.2 Reference Dockerfile (CPU, Class A — copy per model, change 3 lines)
```dockerfile
FROM python:3.12-slim
WORKDIR /srv
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt   # fastapi uvicorn torch --index-url cpu numpy pydantic prometheus-client
COPY adapter.py model_loader.py ./
ENV MODEL_NAME=bincryptocnn MODEL_VERSION=v3-real WEIGHTS_GCS=gs://PROJECT_ID-ecdat-weights/bincryptocnn/v3-real/best.pt PORT=8080
EXPOSE 8080
CMD ["uvicorn", "adapter:app", "--host", "0.0.0.0", "--port", "8080", "--workers", "1"]
```
GPU/LLM images use `vllm/vllm-openai` as base + a 20-line adapter sidecar instead of hand-rolled servers.

### 3.3 Build, push, test locally (example: Model 2)
```bash
docker build -t asia-south1-docker.pkg.dev/PROJECT_ID/ecdat-models/bincryptocnn:v3-real Model-2-image/
docker push asia-south1-docker.pkg.dev/PROJECT_ID/ecdat-models/bincryptocnn:v3-real
docker run -p 8080:8080 -e WEIGHTS_GCS=gs://PROJECT_ID-ecdat-weights/bincryptocnn/v3-real/best.pt \
  asia-south1-docker.pkg.dev/PROJECT_ID/ecdat-models/bincryptocnn:v3-real
curl -s localhost:8080/healthz; echo
curl -s localhost:8080/readyz; echo
curl -s -X POST localhost:8080/v2/models/bincryptocnn/infer \
  -H 'Content-Type: application/json' -d '{"model":"bincryptocnn","input":{"sha256":"test"}}'
```
**Verify:** `/healthz` 200 instantly; `/readyz` 200 after weights download; infer returns the JSON schema from §3.1
with `confidence` present; `docker logs` shows no traceback. Only then push.

### 3.4 Weights flow (same for every model, including your friend's)
```bash
# From the training machine (yours or friend's), name EXACTLY model/version/file:
gsutil cp "Model 2/checkpoints_training_data_real/best_bincryptocnn.pt" \
  gs://PROJECT_ID-ecdat-weights/bincryptocnn/v3-real/best.pt
gsutil cp Model-2-image/adapter.py gs://PROJECT_ID-ecdat-weights/bincryptocnn/v3-real/adapter.py
echo "v3-real $(date -u +%FT%TZ) sha256:$(sha256sum best.pt | cut -d' ' -f1)" >> registry.log
```
**Verify:** `gsutil ls -l gs://PROJECT_ID-ecdat-weights/bincryptocnn/v3-real/`; re-download and
`sha256sum`-match; registry.log entry exists. **Rollback = point the manifest at the previous version dir** (keep
at least 2 versions per model; versioning is also on at bucket level).

---

## 4. Deploy CPU models → Cloud Run (Class A + models 19/27)

Repeat per model (BinCryptoCNN shown; MisuseDetector/XGBoost, QARS, KBs identical except image + env):
```bash
gcloud run deploy bincryptocnn --image=asia-south1-docker.pkg.dev/PROJECT_ID/ecdat-models/bincryptocnn:v3-real \
  --region=asia-south1 --platform=managed --no-allow-unauthenticated \
  --service-account=ecdat-serve@PROJECT_ID.iam.gserviceaccount.com \
  --memory=2Gi --cpu=2 --min-instances=0 --max-instances=10 --concurrency=20 \
  --set-env-vars=MODEL_NAME=bincryptocnn,MODEL_VERSION=v3-real \
  --timeout=300
gcloud run services add-iam-policy-binding bincryptocnn --region=asia-south1 \
  --member="serviceAccount:ecdat-gateway@PROJECT_ID.iam.gserviceaccount.com" --role="roles/run.invoker"
```
**Verify per model:**
```bash
URL=$(gcloud run services describe bincryptocnn --region=asia-south1 --format='value(status.url)')
ID=$(gcloud auth print-identity-token)
curl -s -H "Authorization: Bearer $ID" $URL/healthz; echo
curl -s -H "Authorization: Bearer $ID" $URL/readyz; echo
time curl -s -H "Authorization: Bearer $ID" -H 'Content-Type: application/json' \
  -X POST $URL/v2/models/bincryptocnn/infer -d '{"model":"bincryptocnn","input":{"probe":true}}'
```
Pass = 200s, valid JSON schema, p50 inference < 500 ms (CPU). Cold start (min-instances=0) may take 10–60 s
on first hit after idle — acceptable, or set `--min-instances=1` for latency-critical models (costs more).

---

## 5. Deploy GPU LLMs → GKE Autopilot + KServe (Class B)

```bash
# 5.1 Cluster (Autopilot: Google manages nodes/upgrades; request a GPU-capable setup)
gcloud container clusters create-auto ecdat-serve --region=asia-south1
gcloud container clusters get-credentials ecdat-serve --region=asia-south1
# 5.2 KServe + Knative/Istio per current KServe install docs for your KServe version
kubectl apply -f https://github.com/kserve/kserve/releases/download/v0.14.0/kserve.yaml
# 5.3 GPU nodepool for the LLM namespace (example: L4 spot for cost; T4/g2 for cheap)
gcloud container node-pools create gpu-pool --cluster=ecdat-serve --region=asia-south1 \
  --machine-type=g2-standard-8 --accelerator=type=nvidia-l4,count=1 --spot \
  --node-labels=workload=llm --node-taints=nvidia.com/gpu=Present:NoSchedule
```
**Verify:** `kubectl get nodes -l workload=llm`; `kubectl get pods -n kserve-system`; `nvidia-smi` via a debug pod shows the L4.

### 5.4 LLM InferenceService (example: Qwen2.5-7B via vLLM; repeat for 8/9/10, LoRA adapter for model 4)
```yaml
apiVersion: serving.kserve.io/v1beta1
kind: InferenceService
metadata: {name: qwen25-7b, namespace: ecdat}
spec:
  predictor:
    containers:
    - name: vllm
      image: vllm/vllm-openai:v0.7.0
      args: ["--model", "Qwen/Qwen2.5-Coder-7B-Instruct", "--quantization", "awq",
             "--max-model-len", "16384", "--enforce-eager"]
      resources: {limits: {nvidia.com/gpu: 1}, requests: {memory: 24Gi}}
      env: [{name: HF_TOKEN, valueFrom: {secretKeyRef: {name: hf-token, key: token}}}]
    minReplicas: 0   # scale-to-zero when idle
    maxReplicas: 3
```
```bash
kubectl apply -f qwen-isvc.yaml
kubectl get inferenceservice qwen25-7b -n ecdat -w   # wait Ready=True
```
**Verify:** `kubectl get isvc -n ecdat` Ready; port-forward + OpenAI-compatible `/v1/chat/completions` test prompt
returns code; `kubectl top pods -n ecdat` GPU mem sane; scale-to-zero test: idle 10 min → 0 pods, next request
succeeds (cold start 40 s–4 min for 7B — document it; keep minReplicas=1 if your demo can't wait).

---

## 6. Stateful systems (Class C) + batch jobs (Class D)

- **Neo4j (12/18):** Helm `neo4j/neo4j` StatefulSet, 100–200 GB PD, daily `neo4j-admin backup` to GCS via CronJob.
  Verify: `cypher-shell "MATCH (n) RETURN count(n)"` ≈ 22,313 nodes; kill a pod → data intact.
- **Vector stores (13/14/15):** Chroma/FAISS as StatefulSet with PD (or migrate to Vertex Matching Engine later).
  Verify: recall@10 probe vs your `ecdat-bench` baseline.
- **SQLite KBs (21/23/24):** bake the .sqlite into the Class-A image (read-only, they change quarterly) — simplest
  correct answer; move to Cloud SQL only if write traffic appears.
- **Cron jobs (22/29/32/33/34):** one Cloud Run Job image each + Cloud Scheduler:
  `gcloud scheduler jobs create http vuln-crawl --schedule="0 */6 * * *" --uri=<job-url> ...`
  Verify: force-run each job, check outputs (e.g. drift CSV, bench report) land in GCS with fresh timestamps.

---

## 7. Main API gateway (your "main script", done once)

FastAPI service on Cloud Run (`ecdat-gateway`, authenticated, rate-limited) implementing spec Part 9 routes.
It never loads weights — it forwards to model URLs (env map) and merges JSON.
```bash
gcloud run deploy ecdat-gateway --image=.../ecdat-gateway:v1 --region=asia-south1 \
  --no-allow-unauthenticated --service-account=ecdat-gateway@... --memory=1Gi --min-instances=1
```
**Verify end-to-end (the single most important test):**
```bash
ID=$(gcloud auth print-identity-token); GW=<gateway-url>
curl -s -H "Authorization: Bearer $ID" -H 'Content-Type: application/json' \
  -X POST $GW/api/v1/scan/binary -d '{"sha256":"<real-test-sha>"}' | python3 -m json.tool
```
Pass = 200, schema `{findings, confidence, quantum_risk, model, version, latency_ms}`, p95 < 5 s warm.

---

## 8. Monitoring (continuous) — set up once, wakes you forever

1. **Ops (all services):** Cloud Monitoring dashboard: request count, p50/p95/p99 latency, 5xx rate, CPU/mem/GPU.
   Alert: 5xx > 1% for 5 min; p95 > SLO (1 s CPU models, 10 s LLM) for 10 min; GPU mem > 90%.
   Verify: send 200 rps for 2 min with `hey`, watch the dashboard move; force a 500 (bad input) and confirm the alert fires to your email.
2. **ML (drift/skew):** Vertex AI Model Monitoring on 2–3 key endpoints (or Evidently batch job writing to BigQuery),
   baselines = your training feature stats; thresholds = your Model-34 values (PSI > 0.2, KS p < 0.05).
   Verify: replay last week's traffic with one shifted feature → expect a drift alert within one monitoring window.
3. **Logs:** every gateway response logged (minus raw binaries) to BigQuery — this log IS your future training data.
   Verify: make 5 test calls → 5 rows in the table.

---

## 9. CI/CD + safe rollout (easy maintenance)

GitHub Actions per model repo/folder: `lint → build image → push :sha → ecdat-bench gate (Model 33 thresholds) → 
deploy canary (KServe trafficSplit 5% / Cloud Run tag) → auto-promote on SLOs → record version in registry.log`.
**Verify:** merge a no-op PR → pipeline greens, canary serves 5%, metrics clean, promotion recorded; then practice
**rollback drill**: `kubectl patch isvc …` (or Run revision rollback) to previous version in < 5 min, confirm traffic + metrics recover.

## 10. Continuous improvement loop (operations, weekly)
1. Scheduler runs drift job → Drift Report in GCS.
2. If PSI/KS breach or champion-vs-challenger gap: MLOps pipeline retrains (your Model 32 triggers: >1,000 new binaries etc.).
3. New weights → registry (new version dir, NO image rebuild) → bench gate → canary → promote or auto-rollback.
4. Monthly review: per-model scorecard (accuracy, latency, cost, drift events) → retire/merge weak models.
**Verify quarterly:** pick one model, walk v_current → retrain → canary → promote end-to-end on staging first.

## 11. Security + cost (don't skip)
- Private services (`--no-allow-unauthenticated`) + gateway-only invoker; secrets in Secret Manager (never env files);
  VPC Connector if models must reach private Neo4j. Verify: unauthenticated curl → 403; `gcloud secrets list` holds keys.
- Budgets: `gcloud billing budgets create` at 50/80/100% with email; GPU nodepool SPOT + scale-to-zero; Cloud Run min-instances=0 except gateway.
  Verify: billing dashboard shows budget alerts armed; idle weekend cost ≈ near-zero for Class A/D.

## 12. Master acceptance checklist (sign-off)
- [ ] Every Class A model: healthz/readyz/infer 200, schema-valid JSON, p95 warm < 1 s.
- [ ] Every LLM: chat completion sane on 5 probe prompts, scale-to-zero + wake verified.
- [ ] Gateway: all 9 spec routes return merged JSON, p95 < 5 s, auth enforced.
- [ ] Monitoring: dashboards live, 3 alerts tested firing, drift job ran once green.
- [ ] CI/CD: one full canary+promote cycle done; rollback drill < 5 min.
- [ ] Accuracy: `ecdat-bench` per-model gates pass on the DEPLOYED endpoints (not just localhost).
- [ ] Costs: 7-day burn within budget; idle-tier spend ≈ 0 for A/D.
- [ ] Docs: registry.log current; this guide's per-model table filled with live URLs/versions.

## 13. Troubleshooting (first aid)
| Symptom | Likely cause | Fix |
|---|---|---|
| `/readyz` never 200 | weights GCS path/permission wrong | check service-account storage Viewer + exact `WEIGHTS_GCS` |
| First request 60 s+, then fast | cold start (scale-to-zero) | expected; min-instances=1 if SLO forbids |
| 403 from model URL | gateway SA missing run.invoker | re-run the add-iam-policy-binding in §4 |
| KServe ISVC never Ready | GPU taint/quota (L4 quota!) | request GPU quota in asia-south1; check `kubectl describe isvc` events |
| Drift alerts constantly firing | baseline = wrong dataset | re-baseline on post-deploy traffic, keep training baseline for skew view |
| Canary 5% errors, stable 95% clean | bad weights | auto-rollback (revision/previous version dir), inspect bench diff |

*Track A today: deploy Model 2 (`checkpoints_training_data_real/best_bincryptocnn.pt`), Model 27 (`checkpoints*/best_model*.pt`),
Model 1 (`model1_rl_policy.pt`) via §3–§4 this week. Track B: each new trained model (yours + friend's) repeats §3.4 + its
class row in §0 — same contract, no new design needed.*
