"""ECDAT Production API Gateway — one route per dockerised model.

Spec: doc/ECDAT_AI_ML_MODELS.md (AI model spec) + models/README.md (models brief).
Serving map: docker/class-{a-cpu,b-gpu,c-stateful,d-batch}/Dockerfile + models/adapter_*.
"""
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import config
from .middleware import GatewayMiddleware
from .routers import classify, health, knowledge, llm, quantum, remediate, risk, robust, scan, system

app = FastAPI(title="ECDAT API Gateway", version="3.0.0",
              description="Unified gateway for all dockerised ECDAT models (Class A/B/C/D).")
app.add_middleware(GatewayMiddleware)
app.add_middleware(CORSMiddleware, allow_origins=config.CORS_ORIGINS,
                   allow_credentials=True, allow_methods=["*"], allow_headers=["*"])

app.include_router(health.router)
for r in (scan.router, classify.router, risk.router, knowledge.router, llm.router,
          quantum.router, remediate.router, robust.router, system.router):
    app.include_router(r)


@app.get("/")
async def root():
    return {
        "service": "ecdat-gateway", "version": "3.0.0",
        "spec_docs": ["doc/ECDAT_AI_ML_MODELS.md", "models/README.md",
                      "doc/GATEWAY_API_REFERENCE.md"],
        "routes": [
            {"route": "POST /api/v1/scan/source", "model": "01 AST-CryptoNet", "docker": "class-a-cpu"},
            {"route": "POST /api/v1/scan/binary", "model": "02 BinCryptoCNN", "docker": "class-a-cpu"},
            {"route": "POST /api/v1/scan/entropy", "model": "03 EntropyGuard", "docker": "class-a-cpu"},
            {"route": "POST /api/v1/classify", "model": "04 CryptoClassLLM (3-level)", "docker": "class-e-ml"},
            {"route": "POST /api/v1/classify/misuse", "model": "06 MisuseDetector", "docker": "class-a-cpu"},
            {"route": "POST /api/v1/llm/generate", "model": "08/09/10 (deepseek/starcoder2/codellama) + 11 gemini_flash + 07 ecdat_lora", "docker": "class-b-gpu/class-e-ml"},
            {"route": "POST /api/v1/knowledge/query", "model": "12 CDKG", "docker": "class-c-stateful"},
            {"route": "POST /api/v1/rag/search", "model": "13 RAG KB", "docker": "class-c-stateful"},
            {"route": "POST /api/v1/knowledge/hybrid", "model": "14 Hybrid Retriever", "docker": "class-c-stateful"},
            {"route": "POST /api/v1/knowledge/vector", "model": "15 ChromaDB (+16 pipeline)", "docker": "class-c-stateful"},
            {"route": "POST /api/v1/knowledge/trust", "model": "17 SourceTrust", "docker": "class-a-cpu"},
            {"route": "POST /api/v1/knowledge/temporal", "model": "18 TKG", "docker": "class-a-cpu"},
            {"route": "POST /api/v1/quantum/cost + GET /api/v1/quantum/attack-costs/{algo}", "model": "20 Quantum Cost DB", "docker": "class-a-cpu"},
            {"route": "POST /api/v1/knowledge/crypto-api", "model": "21 Crypto API KB (780 APIs)", "docker": "class-c-stateful"},
            {"route": "POST /api/v1/security/trapdoor", "model": "23 Trapdoor IOC DB", "docker": "class-a-cpu"},
            {"route": "POST /api/v1/knowledge/vuln", "model": "22 VulnIntel", "docker": "class-a-cpu"},
            {"route": "POST /api/v1/knowledge/compliance", "model": "24 Compliance KB", "docker": "class-a-cpu"},
            {"route": "POST /api/v1/risk/score + POST /api/v1/quantum/mosca", "model": "25 QARS", "docker": "class-a-cpu"},
            {"route": "POST /api/v1/risk/monte-carlo", "model": "26 Monte Carlo Q-Day", "docker": "class-a-cpu"},
            {"route": "POST /api/v1/risk/forecast", "model": "27 Temporal Risk (batch-served)", "docker": "class-d-batch"},
            {"route": "POST /api/v1/system/calibrate", "model": "28 Confidence Calibration", "docker": "class-a-cpu"},
            {"route": "POST /api/v1/robust/detect", "model": "05 CryptoRobust (batch-served)", "docker": "class-d-batch"},
            {"route": "POST /api/v1/risk/gnn", "model": "19 GNN Risk (batch-served)", "docker": "class-d-batch"},
            {"route": "POST /api/v1/security/redteam", "model": "29 AI Red Team (batch-served)", "docker": "class-d-batch"},
            {"route": "POST /api/v1/remediate", "model": "06 RemediationEngine + FIPS 203/204", "docker": "class-a-cpu"},
        ],
        "not_dockerised": [],
    }
