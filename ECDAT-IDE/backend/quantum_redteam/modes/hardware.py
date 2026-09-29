"""
HardwareMode — Real IBM Quantum hardware execution.

PAY-AS-YOU-GO: $96/minute.
Only for circuits ≤ 156 qubits (IBM Heron r3).
Always requires cost confirmation before execution.
"""

import os
import time
from typing import Dict, Any, Optional

from quantum_redteam.config import QPU_COST_PER_MINUTE, MAX_HARDWARE_QUBITS


class HardwareMode:
    """
    Real IBM Quantum hardware execution.
    PAY-AS-YOU-GO: $96/minute.
    """

    def __init__(self, token: str):
        self.token = token
        self._service = None
        self._backend = None

    @property
    def service(self):
        """Lazy-init IBM Quantum Runtime Service."""
        if self._service is None:
            from qiskit_ibm_runtime import QiskitRuntimeService
            self._service = QiskitRuntimeService(
                channel='ibm_quantum_platform', token=self.token)
        return self._service

    def execute(self, circuit, shots: int = 4096,
                backend_name: Optional[str] = None) -> Dict[str, Any]:
        """
        Execute on real QPU. Cost: ~$96/min.

        Returns counts, job ID, actual cost, and execution time.
        """
        from qiskit_ibm_runtime import SamplerV2 as Sampler
        from qiskit.transpiler import generate_preset_pass_manager

        # 1. Select backend
        if backend_name:
            backend = self.service.backend(backend_name)
        else:
            backend = self.service.least_busy(
                operational=True, simulator=False)

        # 2. Validate qubit count
        if circuit.num_qubits > backend.num_qubits:
            raise ValueError(
                f"Circuit needs {circuit.num_qubits} qubits, "
                f"but {backend.name} only has {backend.num_qubits}."
            )

        # 3. Transpile with heavy optimization
        pm = generate_preset_pass_manager(
            backend=backend,
            optimization_level=3,
            approximation_degree=0.99,
        )
        isa_circuit = pm.run(circuit)

        # 4. Execute in job mode (no Session: open-plan accounts cannot open
        # sessions; job mode submits directly and bills the same $96/min).
        start = time.time()
        sampler = Sampler(mode=backend)
        job = sampler.run([isa_circuit], shots=shots)
        result = job.result()
        elapsed = time.time() - start

        # 5. Calculate actual cost
        cost = (elapsed / 60) * QPU_COST_PER_MINUTE

        return {
            "mode": "hardware",
            "cost_usd": round(cost, 2),
            "backend": backend.name,
            "backend_qubits": backend.num_qubits,
            "job_id": job.job_id(),
            "execution_seconds": round(elapsed, 2),
            "counts": self._extract_counts(result),
            "transpiled_depth": isa_circuit.depth(),
            "transpiled_gates": isa_circuit.size(),
            "url": f"https://quantum.ibm.com/jobs/{job.job_id()}"
        }

    # ── FREE operations (no QPU time consumed) ────────

    def get_error_report(self, backend_name: str = "ibm_fez") -> Dict:
        """Get calibration data. FREE (metadata only)."""
        backend = self.service.backend(backend_name)
        try:
            props = backend.properties()
            n = backend.num_qubits
            return {
                "backend": backend_name,
                "num_qubits": n,
                "t1": [props.t1(q) for q in range(n)],
                "t2": [props.t2(q) for q in range(n)],
                "readout_errors": [
                    props.readout_error(q) for q in range(n)
                ],
            }
        except Exception as e:
            return {
                "backend": backend_name,
                "num_qubits": backend.num_qubits,
                "error": str(e),
            }

    def discover_backends(self) -> list:
        """List operational backends. FREE."""
        backends = self.service.backends(
            operational=True, simulator=False)
        results = []
        for b in backends:
            try:
                results.append({
                    "name": b.name,
                    "qubits": b.num_qubits,
                    "queue_depth": b.status().pending_jobs,
                })
            except Exception:
                results.append({"name": b.name, "qubits": b.num_qubits})
        return results

    def estimate_cost(self, circuit, shots: int = 4096) -> Dict:
        """Estimate cost BEFORE submitting. FREE (no QPU time)."""
        depth = circuit.depth()
        # Rough estimate: each gate layer takes ~1µs, plus overhead.
        # Floor at 3.0 min: observed IBM-side overhead alone is ~4 min wall
        # time for tiny circuits; metering is wall-clock, not QPU seconds.
        seconds = depth * shots * 1e-6 + 1.0
        minutes = max(seconds / 60 + 0.5, 3.0)  # + session overhead
        return {
            "estimated_minutes": round(minutes, 1),
            "estimated_cost_usd": round(minutes * QPU_COST_PER_MINUTE, 2)
        }

    @staticmethod
    def _extract_counts(result) -> Dict[str, int]:
        """Extract measurement counts from SamplerV2 result."""
        try:
            # SamplerV2 result format
            pub_result = result[0]
            counts = {}
            if hasattr(pub_result, 'data'):
                for key, val in pub_result.data.items():
                    if hasattr(val, 'get_counts'):
                        counts = dict(val.get_counts())
                        break
            return counts if counts else {"result": "see_job_url"}
        except Exception:
            return {"result": "see_job_url"}
