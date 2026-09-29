# ECDAT Class B - GPU LLM Models (GKE + KServe)
# Models: 08, 09, 10, 11
FROM vllm/vllm-openai:v0.7.0

WORKDIR /srv

# Install additional dependencies
RUN pip install --no-cache-dir \
    fastapi>=0.115.0 \
    uvicorn[standard]>=0.32.0 \
    httpx>=0.27.0

# Copy adapter module and models
COPY models/ /srv/models/

ENV PYTHONUNBUFFERED=1
ENV PYTHONPATH=/srv:/srv/models
ENV PORT=8080

# NOTE: vllm-openai base ships no curl — probe with stdlib python instead.
HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
    CMD python -c "import urllib.request,sys;sys.exit(0 if urllib.request.urlopen('http://localhost:8080/healthz',timeout=5).status==200 else 1)"

EXPOSE ${PORT}

# Run gateway adapter with uvicorn
CMD ["uvicorn", "models.adapter_class_b:app", "--host", "0.0.0.0", "--port", "8080"]
