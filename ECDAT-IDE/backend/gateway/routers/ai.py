"""AI chat route — IDE copilot conversational endpoint (models 07-11).

POST /api/v1/ai/chat -> {deepseek_coder|starcoder2|codellama|gemini_flash|ecdat_lora}
JSON or SSE stream. Non-stream responses reuse the crypto-reasoning harness;
stream:true yields token deltas (live backends) or JSON chunks (simulation).
"""
import asyncio
import json
import time
from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse

from .. import client as C
from ..config import config
from ..schemas import AIChatRequest, GatewayResponse
from .llm import MODEL_IDS
from src.ecdat.core.all_models_runtime import model_reason_stream, _model_backend

router = APIRouter(prefix="/api/v1/ai", tags=["ai"])

STREAM_MODELS = {**MODEL_IDS}


def _sse(payload: dict) -> str:
    return f"data: {json.dumps(payload, default=str)}\n\n"


async def _token_stream(number: int, messages: list[dict],
                        temperature: float, max_tokens: int):
    try:
        # Run the blocking generator in a thread; yield deltas as SSE.
        gen = await asyncio.to_thread(
            lambda: list(model_reason_stream(number, messages, temperature, max_tokens)))
        for delta in gen:
            if delta:
                yield _sse({"delta": delta})
    except Exception as exc:
        yield _sse({"error": str(exc)[:240]})
    yield "data: [DONE]\n\n"


@router.post("/chat")
async def chat(req: AIChatRequest):
    t0 = time.perf_counter()
    if req.model not in STREAM_MODELS:
        raise HTTPException(status_code=422,
                            detail=f"model must be one of {sorted(STREAM_MODELS)}")
    number = int(STREAM_MODELS[req.model])
    messages = [{"role": m.role, "content": m.content} for m in req.messages]
    if not messages:
        raise HTTPException(status_code=422, detail="provide at least one message")
    if req.stream:
        return StreamingResponse(
            _token_stream(number, messages, req.temperature, req.max_tokens),
            media_type="text/event-stream",
            headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})
    try:
        chunks = await asyncio.to_thread(
            lambda: list(model_reason_stream(number, messages,
                                             req.temperature, req.max_tokens)))
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"chat backend failed: {exc}")
    text = "".join(chunks)
    try:
        model_output = json.loads(text)
    except Exception:
        model_output = {"text": text}
    backend_used = (model_output.get("backend_used", None)
                    if isinstance(model_output, dict) else None)
    if not backend_used:
        # Streamed prose carries no tier label (only simulation yields tagged
        # JSON): resolve the configured tier; "auto" + prose means a live LLM.
        backend_used = _model_backend(number)
        if backend_used == "auto":
            backend_used = "live-llm"
    return GatewayResponse(
        model=req.model, model_id=STREAM_MODELS[req.model],
        docker_service=f"all_models/model_{STREAM_MODELS[req.model]} ({backend_used})",
        findings=[], total_findings=0, quantum_risk="NONE", confidence=0.8,
        latency_ms=C.now_ms(t0),
        metadata={"text": text, "model_output": model_output,
                  "backend": backend_used, "artifact_backed": True,
                  "spec": "POST /api/v1/ai/chat (models 07-11)"})
