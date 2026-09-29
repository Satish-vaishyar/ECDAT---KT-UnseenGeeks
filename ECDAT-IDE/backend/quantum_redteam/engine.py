"""
QuantumRedTeamEngine — Main orchestrator for quantum red team attacks.

Dispatches to correct execution mode (simulation vs hardware),
orchestrates all 3 attack phases, aggregates results, and generates reports.
"""

import os
import time
from typing import Optional, List, Dict, Any

from quantum_redteam.config import (
    MODE_SIMULATION, MODE_HARDWARE, MODE_AUTO,
    PHASE1_PRE_MIGRATION, PHASE2_POST_MIGRATION, PHASE3_TIMELINE, PHASE_ALL,
    MAX_HARDWARE_QUBITS, DEFAULT_SHOTS,
    DEFAULT_PHASE1_TARGETS, DEFAULT_PHASE2_TARGETS, DEFAULT_PHASE3_TARGETS,
)


class QuantumRedTeamEngine:
    """
    Main entry point for quantum red team attacks.

    Responsibilities:
    - Mode selection (simulation vs hardware)
    - Phase orchestration (1, 2, 3)
    - Result aggregation
    - Report generation
    """

    def __init__(self, mode: str = MODE_SIMULATION, shots: int = DEFAULT_SHOTS,
                 noise: str = "real"):
        self.mode = mode
        self.shots = shots
        self.noise = noise
        self._sim = None   # Lazy-loaded
        self._hw = None    # Lazy-loaded
        self._cost_guard = None
        self.results: List[Dict[str, Any]] = []
        self._start_time = time.time()

    @property
    def sim(self):
        """Lazy-init simulation mode (FREE)."""
        if self._sim is None:
            from quantum_redteam.modes.simulation import SimulationMode
            self._sim = SimulationMode(noise_source=self.noise)
        return self._sim

    @property
    def hw(self):
        """Lazy-init hardware mode (only when actually needed)."""
        if self._hw is None:
            token = os.getenv("IBM_QUANTUM_TOKEN")
            if not token:
                raise RuntimeError(
                    "IBM_QUANTUM_TOKEN not set in .env — "
                    "required for hardware mode. "
                    "Get a free token at https://quantum.ibm.com/account"
                )
            from quantum_redteam.modes.hardware import HardwareMode
            self._hw = HardwareMode(token)
        return self._hw

    @property
    def cost_guard(self):
        """Lazy-init cost guard."""
        if self._cost_guard is None:
            from quantum_redteam.cost.cost_guard import CostGuard
            self._cost_guard = CostGuard()
        return self._cost_guard

    # ── Phase 1: Pre-Migration Attacks ────────────────
    def run_phase1(self, targets: Optional[List[str]] = None) -> List[Dict]:
        """
        Attack classical crypto (RSA, ECC, AES, SHA).
        Uses Shor's for asymmetric, Grover's for symmetric.
        """
        from quantum_redteam.attacks.shor import ShorAttack
        from quantum_redteam.attacks.grover import GroverAttack

        target_list = targets or DEFAULT_PHASE1_TARGETS
        phase_results = []

        for target in target_list:
            try:
                if target.startswith("RSA") or target.startswith("ECC"):
                    attack = ShorAttack()
                else:
                    attack = GroverAttack()
                result = self._execute(attack, target, phase=1)
                result["phase"] = 1
                self.results.append(result)
                phase_results.append(result)
            except Exception as e:
                err_result = {
                    "phase": 1,
                    "algorithm": target,
                    "error": str(e),
                    "broken": False,
                    "cost_usd": 0.0,
                    "mode": self.mode,
                }
                self.results.append(err_result)
                phase_results.append(err_result)

        return phase_results

    # ── Phase 2: PQC Resistance ───────────────────────
    def run_phase2(self, targets: Optional[List[str]] = None) -> List[Dict]:
        """
        Test PQC algorithms against quantum attacks.
        Always simulation-only (no circuits to run on hardware).
        """
        from quantum_redteam.attacks.pqc_test import PQCResistanceTest

        target_list = targets or DEFAULT_PHASE2_TARGETS
        tester = PQCResistanceTest()
        phase_results = []

        for target in target_list:
            try:
                result = tester.test(target, self.sim)
                result["phase"] = 2
                self.results.append(result)
                phase_results.append(result)
            except Exception as e:
                err_result = {
                    "phase": 2,
                    "algorithm": target,
                    "error": str(e),
                    "verdict": "error",
                    "cost_usd": 0.0,
                }
                self.results.append(err_result)
                phase_results.append(err_result)

        return phase_results

    # ── Phase 3: Timeline ─────────────────────────────
    def run_phase3(self) -> List[Dict]:
        """
        Predict when each algorithm becomes breakable.
        ALWAYS FREE (pure math, no quantum execution).
        """
        from quantum_redteam.timeline.predictor import TimelinePredictor

        predictor = TimelinePredictor()
        predictions = predictor.predict_all()

        for p in predictions:
            p["phase"] = 3
            self.results.append(p)

        return predictions

    # ── Run All Phases ────────────────────────────────
    def run_all(self, phase1_targets=None, phase2_targets=None) -> Dict:
        """Run all 3 phases and return aggregated results."""
        p1 = self.run_phase1(targets=phase1_targets)
        p2 = self.run_phase2(targets=phase2_targets)
        p3 = self.run_phase3()

        elapsed = time.time() - self._start_time
        total_cost = sum(r.get("cost_usd", 0) for r in self.results)

        return {
            "phase1": p1,
            "phase2": p2,
            "phase3": p3,
            "summary": {
                "total_attacks": len(self.results),
                "broken_count": sum(1 for r in self.results if r.get("broken")),
                "resistant_count": sum(1 for r in self.results
                                       if r.get("verdict") == "resistant"),
                "total_cost_usd": round(total_cost, 2),
                "execution_mode": self.mode,
                "elapsed_seconds": round(elapsed, 2),
            },
        }

    # ── Attack Execution Router ───────────────────────
    def _execute(self, attack, target: str, phase: int) -> Dict:
        """
        Route attack to correct execution mode.
        Decision logic: mode setting + circuit qubit count.
        """
        circuit_info = attack.build(target)

        # If build returns a dict with analytical results (large targets),
        # return directly without circuit execution
        if isinstance(circuit_info, dict) and circuit_info.get("analytical"):
            return circuit_info

        circuit = circuit_info
        n_qubits = circuit.num_qubits

        if self.mode == MODE_SIMULATION:
            # FREE path — always simulation
            return attack.execute(sim=self.sim, target=target,
                                  circuit=circuit, shots=self.shots)

        elif self.mode == MODE_HARDWARE:
            if n_qubits > MAX_HARDWARE_QUBITS:
                # Too many qubits for hardware — fall back to FREE sim
                result = attack.execute(sim=self.sim, target=target,
                                        circuit=circuit, shots=self.shots)
                result["fallback"] = (
                    f"{target}: {n_qubits}q > {MAX_HARDWARE_QUBITS}q max. "
                    f"Using FREE simulation."
                )
                return result

            # Estimate cost before spending money
            estimate = self.cost_guard.estimate(circuit, self.shots)
            self.cost_guard.check_limits(estimate["cost_usd"])

            if not self.cost_guard.confirm(estimate):
                return {
                    "algorithm": target,
                    "cancelled": True,
                    "cost_usd": 0,
                    "mode": "hardware",
                    "reason": "User declined cost confirmation",
                }

            result = attack.execute(hw=self.hw, target=target,
                                    circuit=circuit, shots=self.shots)
            actual_cost = result.get("cost_usd", 0)
            self.cost_guard.record_actual(actual_cost)
            return result

        else:  # auto mode
            # FREE by default — use simulation
            return attack.execute(sim=self.sim, target=target,
                                  circuit=circuit, shots=self.shots)

    # ── Report ────────────────────────────────────────
    def generate_report(self, output_dir: str = "reports") -> str:
        """Generate unified attack report."""
        from quantum_redteam.reports.generator import ReportGenerator
        reporter = ReportGenerator()
        return reporter.generate(self.results, self.mode, output_dir=output_dir)

    # ── Serialization (for API responses) ─────────────
    def to_dict(self) -> Dict:
        """Serialize all results for JSON API response."""
        elapsed = time.time() - self._start_time
        total_cost = sum(r.get("cost_usd", 0) for r in self.results)

        return {
            "results": self.results,
            "summary": {
                "total_attacks": len(self.results),
                "broken_count": sum(1 for r in self.results if r.get("broken")),
                "resistant_count": sum(1 for r in self.results
                                       if r.get("verdict") == "resistant"),
                "total_cost_usd": round(total_cost, 2),
                "execution_mode": self.mode,
                "elapsed_seconds": round(elapsed, 2),
            },
        }
