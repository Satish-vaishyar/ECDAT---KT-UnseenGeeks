# ECDAT Gateway — FastAPI unified entrypoint for Class A/B/C/D
FROM python:3.12-slim

WORKDIR /srv
RUN apt-get update && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*
COPY docker/gateway/requirements.txt /srv/requirements.txt
RUN pip install --no-cache-dir -r requirements.txt
COPY gateway/ /srv/gateway/
ENV PYTHONUNBUFFERED=1 PYTHONPATH=/srv PORT=8000 \
    CLASS_A_URL=http://ecdat-class-a:8080 \
    CLASS_B_URL=http://ecdat-llm:8080 \
    CLASS_C_URL=http://ecdat-stateful:8080 \
    CLASS_E_URL=http://ecdat-class-e:8080 \
    STANDALONE_FALLBACK=true
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:${PORT}/healthz || exit 1
EXPOSE ${PORT}
CMD ["uvicorn", "gateway.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "2"]
