"""Quantum red-team attack campaigns (standalone simulation package).

POST /api/v1/redteam/run      -> 3-phase Shor/Grover/PQC-resistance/timeline campaign
GET  /api/v1/redteam/timeline -> Phase-3 break-year predictions (pure math, instant)

Simulation mode only: hardware execution needs an IBM token and an interactive
cost confirmation, neither of which an API call can provide.
"""
import asyncio
import time
from typing import List, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from .. import client as C
from ..schemas import GatewayResponse

router = APIRouter(prefix="/api/v1/redteam", tags=["redteam"])


class RedTeamRunRequest(BaseModel):
    phase: int = Field(default=0, description="0=all, 1=pre-migration, 2=PQC resistance, 3=timeline")
    targets_1: Optional[List[str]] = Field(default=None, description="Phase-1 targets (default set, max 12)")
    targets_2: Optional[List[str]] = Field(default=None, description="Phase-2 targets (default set, max 12)")
    shots: int = Field(default=1024, ge=64, le=8192)


def _campaign(phase: int, targets_1: Optional[List[str]], targets_2: Optional[List[str]], shots: int) -> dict:
    from quantum_redteam.engine import QuantumRedTeamEngine
    eng = QuantumRedTeamEngine(mode="simulation", shots=shots)
    if phase == 1:
        eng.run_phase1(targets=targets_1)
        out = eng.to_dict()
        try:
            _enrich_phase1_results(out.get("results", []))
        except Exception:
            pass
        return out
    if phase == 2:
        eng.run_phase2(targets=targets_2)
        return eng.to_dict()
    if phase == 3:
        eng.run_phase3()
        return eng.to_dict()
    out = eng.run_all(phase1_targets=targets_1, phase2_targets=targets_2)
    try:
        _enrich_phase1_results(out.get("phase1", []))
    except Exception:
        pass
    return out


def _risk_of(out: dict) -> str:
    try:
        broken = int(out.get("summary", {}).get("broken_count", 0))
    except Exception:
        broken = 0
    return "HIGH" if broken > 0 else "NONE"


# ---------------------------------------------------------------------------
# Circuit-SVG enrichment (visual quantum-circuit output for the IDE).
# Contract: every phase-1 result dict AND every hardware-estimate item dict
# gains `circuit_svg` (inline <svg...> string or null) and `circuit_omitted`
# (string reason or null). Analytical results -> null/null. Circuits with
# 0 < num_qubits <= 16 render; else svg=null + omitted="too-large".
# One bad circuit must never fail the request (per-target try/except).
# ---------------------------------------------------------------------------

def _svg_pair_for_circuit(circuit_info) -> tuple:
    """Return (circuit_svg, circuit_omitted) for an already-built circuit."""
    try:
        if isinstance(circuit_info, dict):
            return None, None
        try:
            n = int(getattr(circuit_info, "num_qubits", 0))
        except Exception:
            return None, "render-failed"
        if not (0 < n <= 16):
            return None, "too-large"
        try:
            from quantum_redteam.viz import circuit_svg as _render
        except Exception:
            return None, "render-failed"
        try:
            svg = _render(circuit_info)
        except Exception:
            return None, "render-failed"
        if isinstance(svg, str) and svg.lstrip().startswith("<svg"):
            return svg, None
        return None, "render-failed"
    except Exception:
        return None, "render-failed"


def _svg_pair_for_target(target: str) -> tuple:
    """Rebuild the circuit for target and render it. Never raises."""
    try:
        from quantum_redteam.attacks.shor import ShorAttack
        from quantum_redteam.attacks.grover import GroverAttack
        attack = ShorAttack() if (target.startswith("RSA") or target.startswith("ECC")) else GroverAttack()
        try:
            circuit_info = attack.build(target)
        except Exception:
            return None, "render-failed"
        return _svg_pair_for_circuit(circuit_info)
    except Exception:
        return None, "render-failed"


def _enrich_phase1_results(results) -> None:
    """Attach circuit_svg/circuit_omitted to each phase-1 result dict in place."""
    try:
        for r in list(results or []):
            try:
                if not isinstance(r, dict):
                    continue
                if r.get("analytical"):
                    r.setdefault("circuit_svg", None)
                    r["circuit_svg"] = None
                    r.setdefault("circuit_omitted", None)
                    r["circuit_omitted"] = None
                    continue
                target = r.get("algorithm") or r.get("target")
                if not target:
                    r["circuit_svg"] = None
                    r["circuit_omitted"] = None
                    continue
                svg, omitted = _svg_pair_for_target(str(target))
                r["circuit_svg"] = svg
                r["circuit_omitted"] = omitted
            except Exception:
                try:
                    r["circuit_svg"] = None
                    r["circuit_omitted"] = "render-failed"
                except Exception:
                    pass
    except Exception:
        pass


@router.post("/run", response_model=GatewayResponse)
async def run_campaign(req: RedTeamRunRequest):
    t0 = time.perf_counter()
    if req.phase not in (0, 1, 2, 3):
        raise HTTPException(status_code=422, detail="phase must be 0, 1, 2 or 3")
    t1 = (req.targets_1 or [])[:12] or None
    t2 = (req.targets_2 or [])[:12] or None
    try:
        out = await asyncio.to_thread(_campaign, req.phase, t1, t2, req.shots)
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"redteam campaign failed: {exc}")
    return GatewayResponse(
        model="quantum_redteam", model_id="qrt",
        docker_service="quantum_redteam (simulation)",
        findings=[], total_findings=0,
        quantum_risk=_risk_of(out), confidence=0.9,
        latency_ms=C.now_ms(t0),
        metadata={"campaign": out, "artifact_backed": True,
                  "spec": "POST /api/v1/redteam/run (quantum_redteam 1.0.0)"})


@router.get("/timeline", response_model=GatewayResponse)
async def timeline():
    t0 = time.perf_counter()
    try:
        out = await asyncio.to_thread(_campaign, 3, None, None, 256)
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"redteam timeline failed: {exc}")
    preds = out.get("results", [])
    return GatewayResponse(
        model="quantum_redteam", model_id="qrt",
        docker_service="quantum_redteam (simulation)",
        findings=[], total_findings=0,
        quantum_risk="NONE", confidence=0.9,
        latency_ms=C.now_ms(t0),
        metadata={"predictions": preds, "summary": out.get("summary", {}),
                  "artifact_backed": True,
                  "spec": "GET /api/v1/redteam/timeline (quantum_redteam 1.0.0)"})

# ---------------------------------------------------------------------------
# Real-QPU red team (IBM Quantum hardware, pay-as-you-go).
# Simulation stays the default: hardware NEVER runs without an explicit
# confirm=true plus a cost cap check, because it spends real money ($96/min).
# ---------------------------------------------------------------------------

HW_DEFAULT_TARGETS = ["RSA-15", "AES-4"]


class HardwareEstimateRequest(BaseModel):
    targets: Optional[List[str]] = None
    shots: int = Field(default=1024, ge=64, le=8192)


class HardwareRunRequest(HardwareEstimateRequest):
    confirm: bool = False
    max_cost_usd: Optional[float] = None
    backend_name: Optional[str] = None


def _hw_token() -> str:
    import os
    return (os.environ.get("IBM_QUANTUM_TOKEN") or "").strip()


def _build_targets(targets, shots):
    from quantum_redteam.attacks.shor import ShorAttack
    from quantum_redteam.attacks.grover import GroverAttack
    from quantum_redteam.config import MAX_HARDWARE_QUBITS
    from quantum_redteam.cost.cost_guard import CostGuard
    wanted = list(targets or HW_DEFAULT_TARGETS)[:6]
    guard = CostGuard()
    items = []
    for target in wanted:
        try:
            attack = ShorAttack() if (target.startswith("RSA") or target.startswith("ECC")) else GroverAttack()
            circuit_info = attack.build(target)
        except Exception:
            items.append({"target": target, "analytical": False, "result": None,
                          "qubits": None, "fits_hardware": False, "estimate": None,
                          "circuit_svg": None, "circuit_omitted": "render-failed"})
            continue
        if isinstance(circuit_info, dict) and circuit_info.get("analytical"):
            items.append({"target": target, "analytical": True, "result": circuit_info,
                          "qubits": None, "fits_hardware": False, "estimate": None,
                          "circuit_svg": None, "circuit_omitted": None})
            continue
        est = guard.estimate(circuit_info, shots)
        fits = circuit_info.num_qubits <= MAX_HARDWARE_QUBITS
        try:
            svg, omitted = _svg_pair_for_circuit(circuit_info)
        except Exception:
            svg, omitted = None, "render-failed"
        items.append({"target": target, "analytical": False,
                      "qubits": circuit_info.num_qubits,
                      "depth": circuit_info.depth(),
                      "fits_hardware": fits, "estimate": est,
                      "circuit_svg": svg, "circuit_omitted": omitted})
    return items, guard


@router.get("/hardware/status", response_model=GatewayResponse)
async def hardware_status():
    t0 = time.perf_counter()
    from quantum_redteam.config import QPU_COST_PER_MINUTE, MAX_COST_PER_JOB, MAX_COST_PER_SESSION
    token = _hw_token()
    backends: list = []
    note = "IBM_QUANTUM_TOKEN not set: hardware runs disabled, simulation available."
    if token:
        try:
            from quantum_redteam.modes.hardware import HardwareMode
            hw = await asyncio.to_thread(HardwareMode, token)
            backends = await asyncio.to_thread(hw.discover_backends)
            note = "Token configured."
        except Exception as exc:
            note = f"Token set but backend discovery failed: {exc}"
    return GatewayResponse(
        model="quantum_redteam", model_id="qrt-hw",
        docker_service="quantum_redteam (hardware-gate)",
        findings=[], total_findings=0, quantum_risk="NONE", confidence=0.9,
        latency_ms=C.now_ms(t0),
        metadata={"token_configured": bool(token), "backends": backends,
                  "rate_per_minute_usd": QPU_COST_PER_MINUTE,
                  "max_job_usd": MAX_COST_PER_JOB,
                  "max_session_usd": MAX_COST_PER_SESSION, "note": note,
                  "spec": "GET /api/v1/redteam/hardware/status"})


@router.post("/hardware/estimate", response_model=GatewayResponse)
async def hardware_estimate(req: HardwareEstimateRequest):
    t0 = time.perf_counter()
    try:
        items, _guard = await asyncio.to_thread(_build_targets, req.targets, req.shots)
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"estimate failed: {exc}")
    total = round(sum((i["estimate"] or {}).get("cost_usd", 0) for i in items if not i.get("analytical")), 2)
    runnable = [i for i in items if i.get("fits_hardware")]
    return GatewayResponse(
        model="quantum_redteam", model_id="qrt-hw",
        docker_service="quantum_redteam (hardware-gate)",
        findings=[], total_findings=0, quantum_risk="NONE", confidence=0.9,
        latency_ms=C.now_ms(t0),
        metadata={"items": items, "total_estimated_usd": total,
                  "runnable_count": len(runnable),
                  "warning": "Real money ($96/min). Re-run with confirm=true to spend.",
                  "spec": "POST /api/v1/redteam/hardware/estimate"})


def _hardware_run_block(targets, shots, backend_name, cap):
    from quantum_redteam.config import MAX_HARDWARE_QUBITS
    from quantum_redteam.cost.cost_guard import CostGuard, CostExceededError
    from quantum_redteam.modes.hardware import HardwareMode
    import os
    token = (os.environ.get("IBM_QUANTUM_TOKEN") or "").strip()
    if not token:
        raise RuntimeError("IBM_QUANTUM_TOKEN not set")
    hw = HardwareMode(token)
    guard = CostGuard()
    results = []
    for target in list(targets or HW_DEFAULT_TARGETS)[:6]:
        from quantum_redteam.attacks.shor import ShorAttack
        from quantum_redteam.attacks.grover import GroverAttack
        attack = ShorAttack() if (target.startswith("RSA") or target.startswith("ECC")) else GroverAttack()
        circuit_info = attack.build(target)
        if isinstance(circuit_info, dict) and circuit_info.get("analytical"):
            circuit_info["phase"] = 1
            results.append(circuit_info)
            continue
        if circuit_info.num_qubits > MAX_HARDWARE_QUBITS:
            results.append({"algorithm": target, "error": "too many qubits for hardware",
                            "num_qubits": circuit_info.num_qubits, "mode": "hardware"})
            continue
        est = guard.estimate(circuit_info, shots)
        limit = min(cap, guard.max_job) if cap else guard.max_job
        if est["cost_usd"] > limit:
            raise CostExceededError(f"{target}: estimated ${est['cost_usd']} exceeds cap ${limit}")
        guard.check_limits(est["cost_usd"])
        res = attack.execute(hw=hw, target=target, circuit=circuit_info, shots=shots)
        guard.record_actual(res.get("cost_usd", 0))
        res["phase"] = 1
        results.append(res)
    return results, guard.get_summary()


@router.post("/hardware/run", response_model=GatewayResponse)
async def hardware_run(req: HardwareRunRequest):
    t0 = time.perf_counter()
    if not _hw_token():
        raise HTTPException(status_code=503, detail="IBM_QUANTUM_TOKEN not set: hardware runs disabled.")
    if not req.confirm:
        est_items, _g = await asyncio.to_thread(_build_targets, req.targets, req.shots)
        total = round(sum((i["estimate"] or {}).get("cost_usd", 0) for i in est_items if not i.get("analytical")), 2)
        raise HTTPException(status_code=422, detail={
            "message": "Refusing to spend without confirm=true.",
            "estimate_usd": total, "items": est_items})
    try:
        results, summary = await asyncio.to_thread(
            _hardware_run_block, req.targets, req.shots, req.backend_name, req.max_cost_usd)
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc))
    except Exception as exc:
        name = type(exc).__name__
        if "CostExceeded" in name:
            raise HTTPException(status_code=422, detail=str(exc))
        raise HTTPException(status_code=503, detail=f"hardware run failed: {exc}")
    broken = sum(1 for r in results if r.get("broken"))
    try:
        _enrich_phase1_results(results)
    except Exception:
        pass
    return GatewayResponse(
        model="quantum_redteam", model_id="qrt-hw",
        docker_service="quantum_redteam (hardware)",
        findings=[], total_findings=0,
        quantum_risk="HIGH" if broken else "NONE", confidence=0.9,
        latency_ms=C.now_ms(t0),
        metadata={"results": results, "cost": summary, "artifact_backed": True,
                  "spec": "POST /api/v1/redteam/hardware/run (IBM QPU)"})
