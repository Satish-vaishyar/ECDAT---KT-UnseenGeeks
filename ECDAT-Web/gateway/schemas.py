"""Pydantic schemas for every gateway route (one route per dockerised model)."""
from typing import Any, Optional
from pydantic import BaseModel, Field


class Finding(BaseModel):
    id: str
    algorithm: str
    category: Optional[str] = None
    status: Optional[str] = None
    cwe_id: Optional[str] = None
    line_number: Optional[int] = None
    code_snippet: Optional[str] = None
    quantum_risk: str = "NONE"
    confidence: float = 0.85
    recommendation: Optional[str] = None


class GatewayResponse(BaseModel):
    model: str
    model_id: Optional[str] = None
    docker_service: str = "standalone-fallback"
    findings: list[Finding] = Field(default_factory=list)
    total_findings: int = 0
    quantum_risk: str = "NONE"
    confidence: float = 0.85
    latency_ms: float = 0.0
    metadata: dict[str, Any] = Field(default_factory=dict)


# ---- Scan (Class A: 01/02/03) ----
class SourceScanRequest(BaseModel):
    code: Optional[str] = None
    file_path: Optional[str] = None
    language: str = "python"
    scan_depth: str = "standard"


class BinaryScanRequest(BaseModel):
    binary_data: str  # base64
    file_path: str = "upload.bin"


class EntropyRequest(BaseModel):
    code: Optional[str] = None
    data: Optional[str] = None
    context: Optional[str] = None


# ---- Classify (Class A: 06) ----
class ClassifyRequest(BaseModel):
    code: str
    language: str = "python"


# ---- Risk (Class A: 25/26 + Class D: 27/19 served via gateway) ----
class RiskScoreRequest(BaseModel):
    algorithm: str
    key_size: Optional[int] = None
    context: dict[str, Any] = Field(default_factory=dict)


class RiskForecastRequest(BaseModel):
    algorithm: str
    horizon_days: int = 30
    history: Optional[list[float]] = None


class MonteCarloRequest(BaseModel):
    iterations: int = 10000
    target_year: Optional[int] = None
    seed: Optional[int] = None


# ---- Knowledge (Class C: 12/13/14/15/16 + Class A: 17/18/22/24) ----
class KnowledgeQueryRequest(BaseModel):
    query: str
    top_k: int = 10


class RagSearchRequest(BaseModel):
    query: str
    top_k: int = 10


class TrustScoreRequest(BaseModel):
    source: str
    claim: Optional[str] = None


class TemporalStateRequest(BaseModel):
    algorithm: str
    date: Optional[str] = None


class VulnSearchRequest(BaseModel):
    query: str
    top_k: int = 10


class ComplianceCheckRequest(BaseModel):
    finding: Optional[str] = None
    algorithm: Optional[str] = None
    region: str = "IN"


# ---- LLM (Class B: 08/09/10/11) ----
class LLMGenerateRequest(BaseModel):
    prompt: str
    model: str = "deepseek_coder"
    temperature: float = 0.2
    max_tokens: int = 1024
    system: Optional[str] = None


# ---- Quantum (Class A: 20) ----
class QuantumCostRequest(BaseModel):
    algorithm: str
    key_size: Optional[int] = None


class MoscaRequest(BaseModel):
    shelf_life_years: float = 10.0
    migration_years: float = 5.0
    qday_years: float = 12.0


# ---- Remediate (rule engine grounded in Model 06 + NIST FIPS 203/204) ----
class RemediateRequest(BaseModel):
    finding_id: str = "ECDAT-2026-R001"
    vulnerable_code: str
    language: str = "python"
    target_algorithm: str = "ML-KEM-768"


# ---- Robust / batch-served (Class D: 05/19/29) ----
class RobustDetectRequest(BaseModel):
    code: Optional[str] = None
    features: Optional[list[float]] = None
    defense: str = "ensemble"


class GNNRiskRequest(BaseModel):
    algorithm_id: str
    neighbors: Optional[list[str]] = None


class RedTeamRequest(BaseModel):
    model_id: str
    attack: str = "FGSM"
    samples: int = 100


# ---- System (Class A: 28) ----
class CalibrateRequest(BaseModel):
    raw_score: float
    model_id: str = "ast_cryptonet"


# ---- Knowledge (Class C: 21) / Security (Class A: 23) ----
class CryptoAPIRequest(BaseModel):
    api_name: str
    language: str = "python"


class TrapdoorRequest(BaseModel):
    code_snippet: Optional[str] = None
    algorithm: Optional[str] = None
    fingerprint: Optional[str] = None
