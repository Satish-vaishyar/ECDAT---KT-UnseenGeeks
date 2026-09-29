# ECDAT Deployment Makefile (AWS ECR & EKS)
# Usage: make <target>

.PHONY: help setup-aws ecr-login build push push-images sync-weights-s3 deploy-k8s deploy-gpu deploy-stateful deploy-batch deploy-all k8s-dry-run smoke-test clean local-up local-down local-logs

AWS_ACCOUNT_ID ?= $(shell aws sts get-caller-identity --query "Account" --output text 2>/dev/null || echo "123456789012")
AWS_REGION ?= ap-south-1
EKS_CLUSTER ?= ecdat-serve
ECR_REGISTRY := $(AWS_ACCOUNT_ID).dkr.ecr.$(AWS_REGION).amazonaws.com
S3_WEIGHTS_BUCKET := s3://$(AWS_ACCOUNT_ID)-ecdat-weights

# Default target
help:
	@echo "ECDAT AWS Deployment Makefile"
	@echo "============================="
	@echo ""
	@echo "Setup:"
	@echo "  make setup-aws          - Provision AWS infrastructure (ECR, S3, EKS, IAM OIDC)"
	@echo ""
	@echo "Local Development:"
	@echo "  make local-up           - Start local multi-container stack"
	@echo "  make local-down         - Stop local containers"
	@echo "  make local-logs         - Tail local container logs"
	@echo ""
	@echo "Build & Push (AWS ECR):"
	@echo "  make ecr-login          - Authenticate Docker CLI to Amazon ECR"
	@echo "  make build              - Build all Docker images tagged for ECR"
	@echo "  make push               - Push images to Amazon ECR"
	@echo "  make push-images        - Build and push all images"
	@echo "  make sync-weights-s3    - Upload model weights & checkpoints to S3"
	@echo ""
	@echo "Deploy (Amazon EKS):"
	@echo "  make k8s-dry-run        - Preview Kustomize production manifests"
	@echo "  make deploy-k8s         - Deploy all workloads via Kustomize to EKS"
	@echo "  make deploy-gpu         - Deploy Class B (GPU LLM) models"
	@echo "  make deploy-stateful    - Deploy Class C (Stateful) models"
	@echo "  make deploy-batch       - Deploy Class D (Batch) CronJobs"
	@echo "  make deploy-all         - Deploy all EKS workloads"
	@echo ""
	@echo "Test & Verification:"
	@echo "  make smoke-test         - Run health & status checks on EKS pods"
	@echo ""
	@echo "Clean:"
	@echo "  make clean              - Delete Kubernetes deployments"

# Infrastructure Setup
setup-aws:
	./scripts/setup_aws.sh

# Local Development
local-up:
	docker compose up -d

local-down:
	docker compose down

local-logs:
	docker compose logs -f

# Amazon ECR Authentication
ecr-login:
	aws ecr get-login-password --region $(AWS_REGION) | docker login --username AWS --password-stdin $(ECR_REGISTRY)

# Gateway Commands
run-gateway:
	python -m uvicorn gateway.main:app --host 0.0.0.0 --port 8000 --reload

test-gateway:
	pytest tests/test_gateway.py -v

docker-build-gateway:
	docker build -f docker/gateway/Dockerfile -t ecdat-gateway:latest .

# Build Docker images for ECR
build:
	@for class in class-a-cpu class-b-gpu class-c-stateful class-d-batch class-e-ml gateway; do \
		docker build -f docker/$$class/Dockerfile -t $(ECR_REGISTRY)/ecdat-models/$$class:latest . ; \
		echo "Built $$class"; \
	done

# Push images to Amazon ECR
push: ecr-login
	@for class in class-a-cpu class-b-gpu class-c-stateful class-d-batch class-e-ml gateway; do \
		docker push $(ECR_REGISTRY)/ecdat-models/$$class:latest; \
		echo "Pushed $$class"; \
	done

# Build and push
push-images: build push

# Sync heavy weights to S3
sync-weights-s3:
	@echo "Syncing model checkpoints to $(S3_WEIGHTS_BUCKET)..."
	-aws s3 sync models/model_02_bincryptocnn/checkpoints/ $(S3_WEIGHTS_BUCKET)/bincryptocnn/
	-aws s3 cp models/model_01_ast_cryptonet/ $(S3_WEIGHTS_BUCKET)/ast_cryptonet/ --recursive --exclude "*" --include "*.onnx"
	-aws s3 sync models/model_27_temporal_risk/data/processed/ $(S3_WEIGHTS_BUCKET)/temporal-risk/input/
	@echo "Model weights synced to S3."

# Kubernetes Manifests
k8s-dry-run:
	kubectl kustomize k8s/overlays/prod

# Deploy all workloads to EKS
deploy-k8s:
	kubectl apply -k k8s/overlays/prod
	@echo "Applied all Kubernetes production workloads to EKS"

# Deploy Class B GPU models
deploy-gpu:
	kubectl apply -k k8s/overlays/prod
	kubectl wait --for=condition=Ready pods -l app=ecdat-llm-gateway -n ecdat-llm --timeout=300s || true
	@echo "Deployed GPU models to EKS"

# Deploy Class C Stateful models
deploy-stateful:
	kubectl apply -k k8s/overlays/prod
	kubectl wait --for=condition=Ready pods -l app=ecdat-cdkg -n ecdat --timeout=300s || true
	kubectl wait --for=condition=Ready pods -l app=ecdat-chroma -n ecdat --timeout=300s || true
	@echo "Deployed Stateful models to EKS"

# Deploy Class D Batch jobs
deploy-batch:
	kubectl apply -k k8s/overlays/prod
	@echo "Deployed batch CronJobs to EKS"

# Deploy everything
deploy-all: deploy-k8s

# Smoke test
smoke-test:
	@echo "Verifying EKS pod status..."
	kubectl get pods -n ecdat
	kubectl get pods -n ecdat-llm
	kubectl get ingress -n ecdat

# Clean up deployments
clean:
	@echo "Cleaning up EKS deployments..."
	-kubectl delete -k k8s/overlays/prod 2>/dev/null || true
	@echo "Clean complete"
