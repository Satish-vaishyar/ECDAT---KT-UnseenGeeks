"""
ECDAT Class E Adapter - Transformer ML Models (CPU/GPU).
Models: 04 cryptoclassllm (Qwen2.5-Coder-3B + LoRA), 07 ecdat_lora (Qwen2.5-Coder-7B + LoRA)
Open Inference Protocol. Lazy-loads; 503s cleanly when weights/HF base absent.
"""
import os
import time
from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

PRELOAD = os.getenv("MODEL_E_PRELOAD", "false").lower() == "true"

MODELS: dict[str, Any] = {}
MODEL_LOADED: dict[str, bool] = {}


def load_04(model_dir: str):
    from model_04_cryptoclassllm.inference import CryptoClassLLM
    m = CryptoClassLLM(model_dir)
    MODELS["cryptoclassllm"] = m
    MODEL_LOADED["cryptoclassllm"] = True


def _model_07_dir(base: str) -> str:
    """Resolve Model 7 dir: explicit path, /srv image layout, or local repo."""
    import pathlib
    cands = [base, "/srv/models/model_07_ecdat_lora",
             str(pathlib.Path(__file__).resolve().parent / "model_07_ecdat_lora")]
    for c in cands:
        if c and pathlib.Path(c).exists():
            return c
    return base


def load_07(model_dir: str):
    """Model 7 via ECDATLoRAClient (PEFT -> Ollama -> simulation).

    Client construction is lightweight (no torch/HF imports); the heavy
    PEFT path only triggers on explicit MODEL7_BACKEND=peft. Default auto
    serves via Ollama when present, else the offline simulation engine —
    so the adapter is healthy with zero GPU and zero downloads.
    """
    import sys
    from pathlib import Path as _P
    resolved = _model_07_dir(model_dir)
    if resolved not in sys.path:
        sys.path.insert(0, resolved)
    try:
        from client import ECDATLoRAClient
    except ImportError:
        from model_07_ecdat_lora.client import ECDATLoRAClient
    m = ECDATLoRAClient(model_dir=resolved,
                        backend=os.getenv("MODEL7_BACKEND", "auto"))
    MODELS["ecdat_lora"] = m
    MODEL_LOADED["ecdat_lora"] = True


@asynccontextmanager
async def lifespan(app: FastAPI):
    if PRELOAD:
        for name, path, fn in (
            ("cryptoclassllm", "/srv/models/model_04_cryptoclassllm", load_04),
            ("ecdat_lora", "/srv/models/model_07_ecdat_lora", load_07),
        ):
            try:
                fn(path)
            except Exception as e:
                MODEL_LOADED[name] = False
                print(f"[class-e] preload {name} failed: {e}")
    else:
        MODEL_LOADED.update({"cryptoclassllm": False, "ecdat_lora": False})
    yield
    MODELS.clear()


app = FastAPI(title="ECDAT Class E - Transformer ML Models", lifespan=lifespan)


class InferRequest(BaseModel):
    model: str
    version: str = "v1"
    input: dict[str, Any]


class ChatRequest(BaseModel):
    model: str
    messages: list
    temperature: float = 0.3
    max_tokens: int = 512


def _ensure(name: str):
    if MODELS.get(name) is not None:
        return
    try:
        if name == "cryptoclassllm":
            load_04("/srv/models/model_04_cryptoclassllm")
        elif name == "ecdat_lora":
            load_07("/srv/models/model_07_ecdat_lora")
        else:
            raise HTTPException(status_code=404, detail=f"Model {name} not found")
    except HTTPException:
        raise
    except Exception as e:
        MODEL_LOADED[name] = False
        raise HTTPException(status_code=503,
                            detail=f"Model {name} unavailable (weights/HF base missing?): {e!s}")


@app.get("/healthz")
async def healthz():
    return {"status": "healthy", "service": "ecdat-class-e"}


@app.get("/readyz")
async def readyz():
    loaded = sum(1 for v in MODEL_LOADED.values() if v)
    return {"status": "ready" if loaded > 0 else "loading",
            "models_loaded": loaded, "models_total": len(MODEL_LOADED)}


@app.post("/v2/models/{model_name}/infer")
async def infer(model_name: str, request: InferRequest):
    start = time.perf_counter()
    _ensure(model_name)
    try:
        if model_name == "cryptoclassllm":
            out = MODELS["cryptoclassllm"].predict(
                request.input.get("code", request.input.get("source_code", "")),
                request.input.get("language", "python"))
            conf = float(out.get("level_3_quantum_confidence",
                                 out.get("level_1_family_confidence", 0.85)))
        elif model_name == "ecdat_lora":
            client = MODELS["ecdat_lora"]
            code = request.input.get("code", request.input.get("source_code", ""))
            if request.input.get("source_path"):
                out = {"text": client.continue_codebase_file(
                    request.input["source_path"],
                    language=request.input.get("language", "python"),
                    max_new_tokens=request.input.get("max_tokens", 128))}
                conf = 0.85
            elif code:
                out = client.analyze_crypto_code(
                    code, language=request.input.get("language", "python"))
                conf = float(out.get("confidence", 0.85))
            else:  # free prompt -> analyse as crypto text
                out = client.analyze_crypto_code(
                    request.input.get("prompt", ""),
                    language=request.input.get("language", "python"))
                conf = float(out.get("confidence", 0.85))
        else:
            raise HTTPException(status_code=404, detail=f"Model {model_name} not found")
        return {"model": model_name, "version": "v1", "output": out,
                "confidence": conf,
                "latency_ms": round((time.perf_counter() - start) * 1000, 2)}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Inference failed: {e!s}")


@app.post("/v1/chat/completions")
async def chat(req: ChatRequest):
    """Chat endpoint (used by gateway for Model 07)."""
    if req.model not in ("ecdat_lora", "cryptoclassllm"):
        raise HTTPException(status_code=404, detail=f"Model {req.model} not found")
    _ensure(req.model)
    prompt = "\n".join(m.get("content", "") for m in req.messages
                       if m.get("role") == "user") or "Continue."
    if req.model == "ecdat_lora":
        res = MODELS["ecdat_lora"].analyze_crypto_code(prompt[:4000])
        cwe = res.get("cwe_misuse", {})
        text = (
            f"Model 7 (EC DAT LoRA, backend={res.get('backend_used')}) | "
            f"family={res.get('level_1_family')} algo={res.get('level_2_algorithm')} "
            f"risk={res.get('level_3_quantum_risk')} conf={res.get('confidence')} | "
            f"CWE={cwe.get('cwe_id')} | "
            f"PQC={res.get('pqc_remediation', {}).get('recommended_replacement')} | "
            f"{res.get('reasoning', '')}"
        )
    else:
        text = str(MODELS["cryptoclassllm"].predict(prompt[:2000]))
    return {"id": f"chatcmpl-{int(time.time())}", "model": req.model,
            "choices": [{"index": 0, "message": {"role": "assistant", "content": text},
                         "finish_reason": "stop"}],
            "usage": {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0}}
