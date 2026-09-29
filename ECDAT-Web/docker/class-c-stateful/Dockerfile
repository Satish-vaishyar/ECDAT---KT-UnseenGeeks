# ECDAT Class C - Stateful Models (GKE StatefulSets)
# Models: 12, 13, 14, 15, 16, 21
FROM python:3.12-slim

WORKDIR /srv

RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    libgomp1 \
    && rm -rf /var/lib/apt/lists/*

COPY docker/class-c-stateful/requirements.txt /srv/requirements.txt
# CPU-only torch (~200MB vs ~2.5GB CUDA bundle) — avoids PyPI read timeouts;
# GPU nodes can override with the CUDA variant at deploy time.
RUN pip install --no-cache-dir torch --index-url https://download.pytorch.org/whl/cpu
RUN pip install --no-cache-dir -r requirements.txt

COPY models/ /srv/models/

ENV PYTHONUNBUFFERED=1
ENV PYTHONPATH=/srv:/srv/models
ENV PORT=8080

HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
    CMD curl -f http://localhost:${PORT}/healthz || exit 1

EXPOSE ${PORT}

CMD ["uvicorn", "models.adapter_class_c:app", "--host", "0.0.0.0", "--port", "8080", "--workers", "1"]
