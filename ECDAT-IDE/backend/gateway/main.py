"""ECDAT Production API Gateway — one route per dockerised model.

Spec: doc/ECDAT_AI_ML_MODELS.md (AI model spec) + models/README.md (models brief).
Serving map: docker/class-{a-cpu,b-gpu,c-stateful,d-batch}/Dockerfile + models/adapter_*.
"""
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pathlib import Path

from .config import config
from .middleware import GatewayMiddleware
from .routers import ai, classify, compat, health, knowledge, llm, migration, models, pipeline, quantum, redteam, remediate, risk, robust, scan, system

app = FastAPI(title="QIROVA API Gateway", version="3.0.0",
              description="Quantum Intelligence for Resilient Operations, Vulnerability & Assurance — unified gateway for the security model stack.")

_frontend_dir = Path(__file__).resolve().parents[1] / "frontend"
if _frontend_dir.is_dir():
    app.mount("/app", StaticFiles(directory=str(_frontend_dir), html=True), name="frontend")
app.add_middleware(GatewayMiddleware)
app.add_middleware(CORSMiddleware, allow_origins=config.CORS_ORIGINS,
                   allow_credentials=True, allow_methods=["*"], allow_headers=["*"])

app.include_router(health.router)
app.include_router(pipeline.router)
app.include_router(compat.router)
for r in (scan.router, classify.router, risk.router, knowledge.router, llm.router,
          ai.router, quantum.router, remediate.router, robust.router, system.router,
          migration.router, models.router, redteam.router):
    app.include_router(r)


@app.get("/")
async def root():
    return {
        "service": "ecdat-gateway", "version": "3.0.0",
        "spec_docs": ["doc/ECDAT_AI_ML_MODELS.md", "models/README.md",
                      "doc/GATEWAY_API_REFERENCE.md", "doc/GATEWAY_SPEC_COMPLIANCE_REPORT.md"],
        "routes": [
            {"route": "POST /api/v1/pipeline/audit", "model": "Sequential Multi-Model Audit (Auto-CBOM)", "docker": "sequential-orchestrator"},
            {"route": "GET /api/v1/scans", "model": "ScanStore Frontend History", "docker": "scan-store"},
            {"route": "GET /api/v1/scans/{id}", "model": "ScanStore Findings Drilldown", "docker": "scan-store"},
            {"route": "GET /api/v1/scans/{id}/cbom", "model": "CycloneDX 1.6 CBOM Export (ECMA-424) — We generate a CycloneDX-compatible CBOM (algorithms, certificates, keys + relationships)", "docker": "scan-store"},
            {"route": "POST /api/v1/scan", "model": "V3 Scan Lifecycle (Store + Findings + CBOM + Risk)", "docker": "class-a-cpu"},
            {"route": "GET /api/v1/system/resources", "model": "VRAM & System RAM Telemetry", "docker": "resource-manager"},
            {"route": "POST /api/v1/scan/source", "model": "01 AST-CryptoNet", "docker": "class-a-cpu"},
            {"route": "POST /api/v1/scan/binary", "model": "02 BinCryptoCNN", "docker": "class-a-cpu"},
            {"route": "POST /api/v1/scan/entropy", "model": "03 EntropyGuard", "docker": "class-a-cpu"},
            {"route": "POST /api/v1/classify", "model": "04 CryptoClassLLM (3-level)", "docker": "class-e-ml"},
            {"route": "POST /api/v1/classify/misuse", "model": "06 MisuseDetector", "docker": "class-a-cpu"},
            {"route": "POST /api/v1/llm/generate", "model": "08/09/10 (deepseek/starcoder2/codellama) + 11 gemini_flash + 07 ecdat_lora", "docker": "class-b-gpu/class-e-ml"},
            {"route": "POST /api/v1/ai/chat", "model": "07-11 conversational chat (JSON + SSE stream)", "docker": "gateway/artifact"},
            {"route": "POST /api/v1/knowledge/query", "model": "12 CDKG", "docker": "class-c-stateful"},
            {"route": "POST /api/v1/rag/search", "model": "13 RAG KB", "docker": "class-c-stateful"},
            {"route": "POST /api/v1/knowledge/hybrid", "model": "14 Hybrid Retriever", "docker": "class-c-stateful"},
            {"route": "POST /api/v1/knowledge/vector", "model": "15 ChromaDB (+16 pipeline)", "docker": "class-c-stateful"},
            {"route": "POST /api/v1/knowledge/embed", "model": "16 Embedding Pipeline", "docker": "class-c-stateful"},
            {"route": "GET /api/v1/models/status", "model": "29-model inventory (wired/weights/loaded)", "docker": "gateway"},
            {"route": "POST /api/v1/knowledge/trust", "model": "17 SourceTrust", "docker": "class-a-cpu"},
            {"route": "POST /api/v1/knowledge/temporal", "model": "18 TKG", "docker": "class-a-cpu"},
            {"route": "POST /api/v1/quantum/cost + GET /api/v1/quantum/attack-costs/{algo}", "model": "20 Quantum Cost DB", "docker": "class-a-cpu"},
            {"route": "GET /api/v1/quantum/attack-costs", "model": "20 Quantum Attack Cost List", "docker": "class-a-cpu"},
            {"route": "GET /api/v1/quantum/pqc-matrix", "model": "PQC Migration Complexity Matrix (12 entries)", "docker": "class-a-cpu"},
            {"route": "GET /api/v1/quantum/qscrs", "model": "Side-Channel Quantum Resistance DB (6 categories)", "docker": "class-a-cpu"},
            {"route": "POST /api/v1/knowledge/crypto-api", "model": "21 Crypto API KB (780 APIs)", "docker": "class-c-stateful"},
            {"route": "POST /api/v1/security/trapdoor", "model": "23 Trapdoor IOC DB", "docker": "class-a-cpu"},
            {"route": "POST /api/v1/knowledge/vuln", "model": "22 VulnIntel", "docker": "class-a-cpu"},
            {"route": "POST /api/v1/knowledge/compliance", "model": "24 Compliance KB", "docker": "class-a-cpu"},
            {"route": "POST /api/v1/compliance/cert-in + dpdp", "model": "24 CERT-In v2.0 & DPDP Act 2023 Audits", "docker": "class-a-cpu"},
            {"route": "POST /api/v1/risk/score + POST /api/v1/quantum/mosca", "model": "25 QARS", "docker": "class-a-cpu"},
            {"route": "POST /api/v1/quantum/qars + /hndl", "model": "25 Dedicated QARS & HNDL Risk Engine", "docker": "class-a-cpu"},
            {"route": "POST /api/v1/risk/monte-carlo", "model": "26 Monte Carlo Q-Day", "docker": "class-a-cpu"},
            {"route": "POST /api/v1/risk/forecast", "model": "27 Temporal Risk (batch-served)", "docker": "class-d-batch"},
            {"route": "POST /api/v1/migration/cost", "model": "28 ECDAT-CostNet Dual-Currency Migration Engine", "docker": "class-a-cpu"},
            {"route": "POST /api/v1/system/calibrate", "model": "29 Confidence Calibration", "docker": "class-a-cpu"},
            {"route": "POST /api/v1/robust/detect", "model": "05 CryptoRobust (batch-served)", "docker": "class-d-batch"},
            {"route": "POST /api/v1/risk/gnn", "model": "19 GNN Risk (batch-served)", "docker": "class-d-batch"},
            {"route": "POST /api/v1/security/redteam", "model": "30 AI Red Team (batch-served)", "docker": "class-d-batch"},
            {"route": "POST /api/v1/remediate", "model": "06 RemediationEngine + FIPS 203/204", "docker": "class-a-cpu"},
            {"route": "POST /api/v1/remediation/roadmap + rules", "model": "06 Remediation Rules & Phased Roadmap", "docker": "class-a-cpu"},
            {"route": "GET /api/v1/health/{component}", "model": "14 Component Health Probes (postgres, redis, ollama, minio)", "docker": "gateway"},
        ],
        "not_dockerised": [],
    }
