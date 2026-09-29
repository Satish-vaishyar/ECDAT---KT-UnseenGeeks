"""
ECDAT Class B Adapter - GPU LLM Models
Models: 08, 09, 10 (via Ollama), 11 (via Google AI Studio Gemini)
Ollama host comes from OLLAMA_HOST env (default http://localhost:11434).
"""
import json
import os
import time

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

app = FastAPI(title="ECDAT Class B - GPU LLM Models")


class ChatRequest(BaseModel):
    model: str
    messages: list
    temperature: float = 0.7
    max_tokens: int = 2048


@app.get("/healthz")
async def healthz():
    return {"status": "healthy", "service": "ecdat-llm"}


@app.get("/readyz")
async def readyz():
    return {"status": "ready", "service": "ecdat-llm"}


@app.post("/v1/chat/completions")
async def chat_completions(request: ChatRequest):
    """
    OpenAI-compatible chat completions endpoint.
    Routes to appropriate LLM based on model name.
    """
    # Model 11 Gemini serves via Google AI Studio (no Ollama needed)
    if request.model == "gemini_flash":
        return await chat_gemini(request)

    # Map model names to Ollama models
    model_map = {
        "deepseek_coder": "deepseek-coder-v2:latest",
        "starcoder2": "starcoder2:15b",
        "codellama": "codellama:7b-instruct",
    }

    ollama_model = model_map.get(request.model, request.model)

    ollama_host = os.getenv("OLLAMA_HOST", "http://localhost:11434").rstrip("/")
    try:
        import httpx
        async with httpx.AsyncClient(timeout=120.0) as client:
            response = await client.post(
                f"{ollama_host}/api/chat",
                json={
                    "model": ollama_model,
                    "messages": request.messages,
                    "stream": False,
                    "options": {
                        "temperature": request.temperature,
                        "num_predict": request.max_tokens,
                    }
                }
            )
            response.raise_for_status()
            result = response.json()

            return {
                "id": f"chatcmpl-{int(time.time())}",
                "model": request.model,
                "choices": [{
                    "index": 0,
                    "message": {
                        "role": "assistant",
                        "content": result.get("message", {}).get("content", "")
                    },
                    "finish_reason": "stop"
                }],
                "usage": {
                    "prompt_tokens": result.get("prompt_eval_count", 0),
                    "completion_tokens": result.get("eval_count", 0),
                    "total_tokens": result.get("prompt_eval_count", 0) + result.get("eval_count", 0)
                }
            }
    except httpx.HTTPError as e:
        raise HTTPException(status_code=503, detail=f"LLM service unavailable: {e!s}")


async def chat_gemini(request: "ChatRequest"):
    """Model 11: Gemini Cloud Router (Google AI Studio free tier / paid)."""
    import os
    import sys
    from pathlib import Path as _P
    for c in (os.getenv("MODEL_11_DIR", ""),
              str(_P(__file__).resolve().parent / "model_11_gemini")):
        if c and c not in sys.path:
            sys.path.insert(0, c)
    try:
        from client import GeminiClient
    except ImportError:
        from model_11_gemini.client import GeminiClient
    prompt = "\n".join(m.get("content", "") for m in request.messages
                       if m.get("role") == "user") or "Continue."
    try:
        client = GeminiClient()
        res = client._call_gemini(prompt, "text",
                                  "\n".join(m.get("content", "") for m in request.messages
                                            if m.get("role") == "system")
                                  or "You are a cryptographic analyst. Reply concisely.")
        text = json.dumps(res) if res else ""
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"Gemini unavailable: {e!s}")
    if not text:
        raise HTTPException(status_code=503,
                            detail="Gemini unavailable (missing GEMINI_API_KEY or quota)")
    return {
        "id": f"chatcmpl-{int(time.time())}",
        "model": request.model,
        "choices": [{"index": 0,
                     "message": {"role": "assistant", "content": text},
                     "finish_reason": "stop"}],
        "usage": {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0},
    }


@app.post("/v2/models/{model_name}/infer")
async def infer(model_name: str, request: dict):
    """Open Inference Protocol compatible endpoint."""
    return {
        "model": model_name,
        "version": "v1",
        "output": {"status": "use /v1/chat/completions for LLM inference"},
        "confidence": 1.0,
        "latency_ms": 0
    }
