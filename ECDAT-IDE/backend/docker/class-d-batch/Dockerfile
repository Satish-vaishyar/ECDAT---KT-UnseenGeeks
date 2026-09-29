# ECDAT Class D - Batch Jobs (Cloud Run Jobs)
# Models: 05, 19, 27, 29
FROM python:3.12-slim

WORKDIR /srv

RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    libgomp1 \
    && rm -rf /var/lib/apt/lists/*

COPY docker/class-d-batch/requirements.txt /srv/requirements.txt
# CPU-only torch (~200MB vs ~2.5GB CUDA bundle) — avoids PyPI read timeouts;
# GPU nodes can override with the CUDA variant at deploy time.
RUN pip install --no-cache-dir torch --index-url https://download.pytorch.org/whl/cpu
RUN pip install --no-cache-dir -r requirements.txt

COPY models/ /srv/models/

ENV PYTHONUNBUFFERED=1
ENV PYTHONPATH=/srv:/srv/models

# Entry point is the batch job script
CMD ["python", "-m", "models.batch_job"]
