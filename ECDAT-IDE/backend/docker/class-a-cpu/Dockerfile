# ECDAT Class A - CPU Models (Cloud Run)
# Models: 01, 02, 03, 06, 17, 18, 20, 22, 23, 24, 25, 26, 28
FROM python:3.12-slim

WORKDIR /srv

# Install system dependencies (libgomp1 is required for XGBoost/ONNX/Torch OpenMP)
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    libgomp1 \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements and install
COPY docker/class-a-cpu/requirements.txt /srv/requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

# Copy adapter module and models
COPY models/ /srv/models/
COPY all_models/ /srv/all_models/

# Set environment variables
ENV PYTHONUNBUFFERED=1
ENV PYTHONPATH=/srv:/srv/models
ENV ECDAT_ALL_MODELS_DIR=/srv/all_models
ENV PORT=8080

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:${PORT}/healthz || exit 1

EXPOSE ${PORT}

# Run with uvicorn (1 worker for Cloud Run compatibility)
CMD ["uvicorn", "models.adapter_class_a:app", "--host", "0.0.0.0", "--port", "8080", "--workers", "1"]
