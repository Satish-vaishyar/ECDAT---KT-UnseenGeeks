# ECDAT Deployment Guide (AWS & Kubernetes)

This directory contains the Docker, Kubernetes, and CI/CD configuration for deploying ECDAT models to Amazon Web Services (AWS).

## Directory Structure

```
├── docker/                    # Dockerfiles
│   ├── class-a-cpu/          # CPU microservices (EKS / App Runner)
│   ├── class-b-gpu/          # GPU LLM models (EKS + vLLM)
│   ├── class-c-stateful/     # Stateful models (EKS StatefulSets + EBS)
│   └── class-d-batch/       # Batch jobs (EKS CronJobs)
│
├── k8s/                      # Kubernetes manifests (Kustomize)
│   ├── base/                 # Base resources (Namespaces, Class A, Class B ISVC, Class C Stateful, Class D CronJobs, Ingress)
│   ├── overlays/             # Overlays (prod, dev)
│   └── secrets.example.yaml  # Secrets configuration template
│
├── .github/workflows/         # GitHub Actions CI/CD
│   └── ci-cd.yml             # Main CI/CD pipeline (AWS OIDC + ECR + EKS)
│
├── scripts/                   # Setup scripts
│   ├── setup_aws.sh          # AWS infrastructure setup (ECR, S3, EKS, IAM OIDC)
│   └── setup_gcp.sh          # Legacy GCP infrastructure setup
│
├── models/
│   ├── adapter_class_a.py     # FastAPI adapter for Class A
│   ├── adapter_class_b.py     # FastAPI adapter for Class B
│   ├── adapter_class_c.py     # FastAPI adapter for Class C
│   └── batch_job.py          # Batch job entry point
│
├── .dockerignore              # Excludes training artifacts
├── Makefile                   # Deployment commands (AWS targets)
├── AWS_SETUP_AND_HANDOFF.md   # AWS setup & DevOps handoff contract (Primary)
├── GCP_SETUP_AND_HANDOFF.md   # GCP setup reference (Legacy)
└── README.md                  # This file
```

> [!TIP]
> For the complete AWS infrastructure setup checklist, required parameters, and Cloud Engineer instructions, read [AWS_SETUP_AND_HANDOFF.md](file:///c:/pqc%20sih/deployment/AWS_SETUP_AND_HANDOFF.md).

## Quick Start

### 1. Set up AWS (one-time by Cloud Engineer)

```bash
export AWS_REGION=ap-south-1
export EKS_CLUSTER_NAME=ecdat-serve
./scripts/setup_aws.sh
```

### 2. Authenticate to Amazon ECR

```bash
make ecr-login AWS_ACCOUNT_ID=123456789012 AWS_REGION=ap-south-1
```

### 3. Build & Push Images to ECR

```bash
make push-images AWS_ACCOUNT_ID=123456789012 AWS_REGION=ap-south-1
```

### 4. Deploy All Models to Amazon EKS

```bash
make deploy-k8s
```

### 5. Run Smoke Tests

```bash
make smoke-test
```

## Model Classes

| Class | Models | AWS Deployment | Description |
|---|---|---|---|
| **A** | 01, 02, 03, 06, 17, 18, 20, 22, 24, 25, 26, 28 | Amazon EKS Deployment / App Runner | CPU-only, fast inference, autoscaled |
| **B** | 08, 09, 10, 11 | Amazon EKS + GPU Node (`g5.2xlarge`) | vLLM GPU inference serving |
| **C** | 12, 13, 14, 15, 16 | Amazon EKS StatefulSets + EBS `gp3` | Persistent storage (Neo4j, ChromaDB) |
| **D** | 05, 19, 27, 29 | Amazon EKS CronJobs | Periodic batch inference |

## GitHub Actions CI/CD Pipeline

The pipeline runs automatically on push to `main` / `master`:

1. **Lint & Config Validation**: Ruff code linting, `docker compose config` validation, and `kubectl kustomize` validation.
2. **Unit Tests**: Automated pytest execution for production model adapters.
3. **Build & Push Docker Images**: Multi-stage builds pushed to private Amazon ECR repositories via keyless IAM OIDC federation.
4. **Deploy to Amazon EKS**: Kustomize manifests applied to production EKS cluster.
5. **Smoke Tests**: Verifies that Kubernetes pods and Ingress reach `Ready` status.

## Environment Variables

| Variable | Description | Required |
|---|---|---|
| `AWS_ACCOUNT_ID` | 12-digit AWS Account ID | Yes |
| `AWS_REGION` | AWS Region (default: `ap-south-1`) | Yes |
| `AWS_ROLE_TO_ASSUME` | IAM Role ARN for GitHub Actions OIDC | Yes (in GitHub Secrets) |
| `EKS_CLUSTER_NAME` | Name of EKS cluster (default: `ecdat-serve`) | Yes |

## API Endpoints

All models expose Open Inference Protocol compatible endpoints:

- `GET /healthz` - Health check (always 200)
- `GET /readyz` - Ready check (200 when weights loaded)
- `POST /v2/models/{name}/infer` - Run inference

Class B (LLM) also exposes:
- `POST /v1/chat/completions` - OpenAI-compatible chat completion endpoint
