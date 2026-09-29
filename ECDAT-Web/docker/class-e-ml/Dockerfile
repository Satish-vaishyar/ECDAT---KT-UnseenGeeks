# ECDAT Class E - Transformer ML Models (CPU/GPU)
# Models: 04 cryptoclassllm (Qwen2.5-Coder-3B + LoRA), 07 ecdat_lora (Qwen2.5-Coder-7B + LoRA)
# NOTE: base weights download from HuggingFace on first load (~6GB + ~15GB).
# Set HF_HOME to a persistent volume in production. MODEL_E_PRELOAD=true to load at boot.
FROM python:3.12-slim

WORKDIR /srv
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl libgomp1 git \
    && rm -rf /var/lib/apt/lists/*
COPY docker/class-e-ml/requirements.txt /srv/requirements.txt
# CPU-only torch (~200MB vs ~2.5GB CUDA bundle) — avoids PyPI read timeouts;
# GPU nodes can override with the CUDA variant at deploy time.
RUN pip install --no-cache-dir torch --index-url https://download.pytorch.org/whl/cpu
RUN pip install --no-cache-dir -r requirements.txt
COPY models/ /srv/models/
ENV PYTHONUNBUFFERED=1 PYTHONPATH=/srv:/srv/models PORT=8080 \
    HF_HOME=/srv/hf-cache MODEL_E_PRELOAD=false MODEL_E_4BIT=true \
    USE_TF=0 USE_TORCH=1 KMP_DUPLICATE_LIB_OK=TRUE
HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
    CMD curl -f http://localhost:${PORT}/healthz || exit 1
EXPOSE ${PORT}
CMD ["uvicorn", "models.adapter_class_e:app", "--host", "0.0.0.0", "--port", "8080", "--workers", "1"]
