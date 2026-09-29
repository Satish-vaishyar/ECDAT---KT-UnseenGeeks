"""LLM routes — Class B GPU dockerised models 08 / 09 / 10 / 11.

POST /api/v1/llm/generate -> {deepseek_coder|starcoder2|codellama|gemini_flash|ecdat_lora}
proxied to class-b-gpu /v1/chat/completions (OpenAI-compatible).
Model 11 Gemini serves via Google AI Studio (GEMINI_API_KEY; free tier).
"""
import time
from fastapi import APIRouter, HTTPException

from .. import client as C
from ..config import config
from ..schemas import GatewayResponse, LLMGenerateRequest

router = APIRouter(prefix="/api/v1/llm", tags=["llm"])

MODEL_IDS = {"deepseek_coder": "08", "starcoder2": "09",
             "codellama": "10", "gemini_flash": "11", "ecdat_lora": "07"}


@router.post("/generate", response_model=GatewayResponse)
async def generate(req: LLMGenerateRequest):
    t0 = time.perf_counter()
    if req.model not in MODEL_IDS:
        raise HTTPException(status_code=422,
                            detail=f"model must be one of {sorted(MODEL_IDS)}")
    msgs = []
    if req.system:
        msgs.append({"role": "system", "content": req.system})
    msgs.append({"role": "user", "content": req.prompt})
    hit = await C.downstream_infer(req.model, {"model": req.model, "messages": msgs,
                                               "temperature": req.temperature,
                                               "max_tokens": req.max_tokens})
    if hit:
        body = hit["body"]
        text = ""
        try:
            text = body["choices"][0]["message"]["content"]
        except Exception:
            text = str(body)[:2000]
        return GatewayResponse(model=req.model, model_id=MODEL_IDS[req.model],
                               docker_service=f"class-b-gpu ({hit['_service']})",
                               findings=[], total_findings=0, quantum_risk="NONE",
                               confidence=0.9, latency_ms=C.now_ms(t0),
                               metadata={"text": text, "usage": body.get("usage", {}),
                                         "spec": "ECDAT_AI_ML_MODELS §8-11 (Ollama/vLLM)"})
    if not config.STANDALONE_FALLBACK:
        raise HTTPException(status_code=503, detail="LLM service unavailable")
    return GatewayResponse(
        model=req.model, model_id=MODEL_IDS[req.model],
        docker_service="class-b-gpu (standalone-fallback: downstream unreachable)",
        findings=[], total_findings=0, quantum_risk="NONE", confidence=0.4,
        latency_ms=C.now_ms(t0),
        metadata={"text": f"[fallback] class-b-gpu unreachable at {config.CLASS_B_URL}. "
                          f"Prompt received ({len(req.prompt)} chars); start the GPU stack "
                          "or set CLASS_B_URL.",
                  "spec": "ECDAT_AI_ML_MODELS §8-11"})
