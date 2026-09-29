"""Model inventory — which of the 29 all_models are wired, present, and loaded.

GET /api/v1/models/status -> per-model {wired, weights_present, lazy_loaded, route, mode}
"""
from pathlib import Path

from fastapi import APIRouter

from src.ecdat.core import all_models_runtime as R

router = APIRouter(prefix="/api/v1/models", tags=["models"])

# number -> (name, route, mode). mode: artifact | api-router | formula | gated | simulation-default
CATALOG = {
    1: ("ast_cryptonet", "POST /api/v1/scan/source", "artifact"),
    2: ("bincryptocnn", "POST /api/v1/scan/binary", "artifact"),
    3: ("entropyguard", "POST /api/v1/scan/entropy", "artifact"),
    4: ("cryptoclassllm", "POST /api/v1/classify", "gated"),
    5: ("cryptorobust", "POST /api/v1/robust/detect", "artifact"),
    6: ("misusedetector", "POST /api/v1/classify/misuse", "artifact"),
    7: ("ecdat_lora", "POST /api/v1/llm/generate", "simulation-default"),
    8: ("deepseek_coder", "POST /api/v1/llm/generate", "api-router"),
    9: ("starcoder2", "POST /api/v1/llm/generate", "api-router"),
    10: ("codellama", "POST /api/v1/llm/generate", "api-router"),
    11: ("gemini_flash", "POST /api/v1/llm/generate", "api-router"),
    12: ("cdkg", "POST /api/v1/knowledge/query", "artifact"),
    13: ("rag_kb", "POST /api/v1/rag/search", "artifact"),
    14: ("hybrid_retriever", "POST /api/v1/knowledge/hybrid", "artifact"),
    15: ("chromadb", "POST /api/v1/knowledge/vector", "artifact"),
    16: ("embedding_pipeline", "POST /api/v1/knowledge/embed", "artifact"),
    17: ("source_trust", "POST /api/v1/knowledge/trust", "artifact"),
    18: ("tkg", "POST /api/v1/knowledge/temporal", "artifact"),
    19: ("gnn_risk", "POST /api/v1/risk/gnn", "artifact"),
    20: ("quantum_cost", "POST /api/v1/quantum/cost", "artifact"),
    21: ("crypto_api", "POST /api/v1/knowledge/crypto-api", "artifact"),
    22: ("vuln_intel", "POST /api/v1/knowledge/vuln", "artifact"),
    23: ("trapdoor", "POST /api/v1/security/trapdoor", "artifact"),
    24: ("compliance_kb", "POST /api/v1/knowledge/compliance", "artifact"),
    25: ("qars", "POST /api/v1/risk/score", "artifact"),
    26: ("monte_carlo", "POST /api/v1/risk/monte-carlo", "formula"),
    27: ("temporal_risk", "POST /api/v1/risk/forecast", "artifact"),
    28: ("costnet", "POST /api/v1/migration/cost", "artifact"),
    29: ("redteam", "POST /api/v1/security/redteam", "artifact"),
}

_SKIP = {"loader.py", "MODEL.md", "__init__.py"}


@router.get("/status")
async def models_status():
    models = []
    loaded = {key[0] for key in R._INSTANCES}
    for number in range(1, 30):
        name, route, mode = CATALOG[number]
        weights_present = False
        try:
            artifact_dir: Path = R.get_artifact_dir(number)
            weights_present = artifact_dir.is_dir() and any(
                p.is_file() and p.name not in _SKIP and p.suffix != ".py"
                for p in artifact_dir.iterdir()
            )
        except Exception:
            weights_present = False
        models.append({
            "id": f"{number:02d}",
            "name": name,
            "wired": True,
            "route": route,
            "mode": mode,
            "loader_present": R.model_available(number),
            "weights_present": weights_present,
            "lazy_loaded": number in loaded,
        })
    return {"count": len(models), "wired": sum(1 for m in models if m["wired"]),
            "models": models}
