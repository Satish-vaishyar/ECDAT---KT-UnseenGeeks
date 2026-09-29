"""Migration Cost routes — Enterprise Mitigation Cost Estimator in USD ($) and INR (Rs.).

GET  /api/v1/migration/cost/{algo} -> Instant migration difficulty & financial cost breakdown
POST /api/v1/migration/cost        -> Scaled mitigation cost calculation by instances & environment
"""
import time
from fastapi import APIRouter

from .. import client as C
from ..schemas import GatewayResponse, MigrationCostRequest
from src.ecdat.core.all_models_runtime import model28_cost

router = APIRouter(prefix="/api/v1/migration", tags=["migration"])


def _costnet_estimate(algorithm: str, mc: dict, key_size: int,
                      instances: int, env: str):
    """Model 28 CostNet mitigation-cost estimate; (output, status, error).

    Request carries 8 fields; the remaining schema signals use request-derived
    values (key size, instance counts, env) plus documented neutral defaults.
    The estimate is supplementary metadata — the heuristic engine stays primary.
    """
    try:
        risk_score = {"CRITICAL": 0.95, "HIGH": 0.8, "MEDIUM": 0.5,
                      "LOW": 0.25}.get(mc.get("quantum_risk", "MEDIUM"), 0.5)
        instances = instances or 1
        prod = (env or "").lower() == "production"
        out = model28_cost(
            finding_id=f"MIG-{algorithm}",
            primitive_family=mc.get("family", "CRYPTOGRAPHIC_PRIMITIVE"),
            key_size_bits=key_size or 0,
            target_pqc_primitive=mc.get("recommended_pqc_replacement", "ML-KEM-768"),
            deployment_tier=env or "general",
            cwe_misuse_flags="",
            crypto_loc=1000 * instances,
            call_site_count=instances,
            quantum_threat_score=risk_score,
            dependency_fan_out=min(instances, 50),
            cyclomatic_complexity=8,
            hardcoded_key_count=0,
            test_coverage_ratio=0.5,
            pki_cert_chain_depth=3,
            third_party_api_count=2,
            data_shelf_life_years=7,
            cert_in_mandate_urgency=1,
            cnsa_2_deadline_years=9,
            mosca_ratio=1.2,
            cvss_score=7.0,
            is_deprecated=1 if mc.get("quantum_risk") in ("HIGH", "CRITICAL") else 0,
            hsm_dependency_flag=0,
            network_exposure_tier=2 if prod else 1,
            service_criticality=3,
            dpdp_act_penalty_tier=2,
        )
        out["feature_provenance"] = "request-derived + neutral defaults"
        return out, "ACTUAL", None
    except Exception as exc:
        return None, "HEURISTIC", str(exc)[:240]


@router.get("/cost/{algo}", response_model=GatewayResponse)
async def migration_cost_get(algo: str):
    """Calculate enterprise migration and mitigation costs in USD and INR for an unsafe algorithm."""
    t0 = time.perf_counter()
    mc = C.calculate_migration_cost(algo)
    costnet, costnet_status, costnet_error = _costnet_estimate(algo, mc, 0, 1, "general")
    return GatewayResponse(
        model="migration_cost_engine", model_id="20+25",
        docker_service="class-a-cpu (standalone-fallback)",
        findings=[{
            "id": "MIG-COST-001",
            "algorithm": algo,
            "category": mc.get("family", "CRYPTOGRAPHIC_PRIMITIVE"),
            "status": "MIGRATION_REQUIRED" if mc.get("quantum_risk") != "NONE" else "COMPLIANT",
            "cwe_id": "CWE-326" if "ASYM" in mc.get("family", "") else ("CWE-327" if mc.get("quantum_risk") in ("HIGH", "CRITICAL") else None),
            "line_number": None,
            "code_snippet": None,
            "quantum_risk": mc.get("quantum_risk", "MEDIUM"),
            "confidence": 0.95,
            "recommendation": f"Migrate to {mc.get('recommended_pqc_replacement')} ({mc.get('nist_standard')}). Est. Cost: {mc['costs']['inr']['formatted']} / {mc['costs']['usd']['formatted']}."
        }],
        total_findings=1,
        quantum_risk=mc.get("quantum_risk", "MEDIUM"),
        confidence=0.95,
        latency_ms=C.now_ms(t0),
        metadata={
            "algorithm": algo,
            "migration_cost": mc,
            "costnet_estimate": costnet, "costnet_status": costnet_status,
            "costnet_error": costnet_error, "costnet_model": "28",
            "spec": "ECDAT Migration & Mitigation Cost Engine (USD + INR)"
        }
    )


@router.post("/cost", response_model=GatewayResponse)
async def migration_cost_post(req: MigrationCostRequest):
    """Calculate enterprise migration and mitigation costs in USD and INR with environmental scaling."""
    t0 = time.perf_counter()
    mc = C.calculate_migration_cost(
        algorithm=req.algorithm,
        key_size=req.key_size,
        instances_count=req.instances_count,
        deployment_env=req.deployment_env
    )
    costnet, costnet_status, costnet_error = _costnet_estimate(
        req.algorithm, mc, req.key_size or 0,
        req.instances_count or 1, req.deployment_env or "general")
    return GatewayResponse(
        model="migration_cost_engine", model_id="20+25",
        docker_service="class-a-cpu (standalone-fallback)",
        findings=[{
            "id": "MIG-COST-001",
            "algorithm": req.algorithm,
            "category": mc.get("family", "CRYPTOGRAPHIC_PRIMITIVE"),
            "status": "MIGRATION_REQUIRED" if mc.get("quantum_risk") != "NONE" else "COMPLIANT",
            "cwe_id": "CWE-326" if "ASYM" in mc.get("family", "") else ("CWE-327" if mc.get("quantum_risk") in ("HIGH", "CRITICAL") else None),
            "line_number": None,
            "code_snippet": None,
            "quantum_risk": mc.get("quantum_risk", "MEDIUM"),
            "confidence": 0.95,
            "recommendation": f"Migrate to {mc.get('recommended_pqc_replacement')} ({mc.get('nist_standard')}). Est. Cost: {mc['costs']['inr']['formatted']} / {mc['costs']['usd']['formatted']}."
        }],
        total_findings=1,
        quantum_risk=mc.get("quantum_risk", "MEDIUM"),
        confidence=0.95,
        latency_ms=C.now_ms(t0),
        metadata={
            "algorithm": req.algorithm,
            "instances_count": req.instances_count,
            "deployment_env": req.deployment_env,
            "migration_cost": mc,
            "costnet_estimate": costnet, "costnet_status": costnet_status,
            "costnet_error": costnet_error, "costnet_model": "28",
            "spec": "ECDAT Migration & Mitigation Cost Engine (USD + INR)"
        }
    )
