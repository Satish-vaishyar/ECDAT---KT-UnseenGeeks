"""
IBM Quantum Physical Hardware Integration Module
Transpiles and dispatches Model 29 quantum circuits to physical superconducting QPUs (e.g. 156-qubit IBM Heron).
"""

import json
from qiskit import QuantumCircuit
from qiskit_ibm_runtime import QiskitRuntimeService, SamplerV2 as Sampler
from qiskit.transpiler.preset_passmanagers import generate_preset_pass_manager

class IBMQuantumHardwareExecutor:
    """Manages physical QPU connection, circuit transpilation, and job submission."""
    def __init__(self, channel='ibm_cloud'):
        self.service = QiskitRuntimeService(channel=channel)

    def get_least_busy_qpu(self):
        """Finds the operational physical quantum computer with the shortest queue."""
        backends = self.service.backends(operational=True, simulator=False)
        return min(backends, key=lambda b: b.status().pending_jobs)

    def build_detection_circuit(self, angles, weights):
        """Constructs a 4-qubit parameterized variational detection circuit."""
        qc = QuantumCircuit(4)
        # AngleEmbedding
        for q in range(4):
            qc.rx(float(angles[q]), q)
        # CNOT entangling ladder
        for q in range(3):
            qc.cx(q, q + 1)
        qc.cx(3, 0)
        # Variational rotation layer
        for q in range(4):
            qc.ry(float(weights[0, q, 0]), q)
            qc.rz(float(weights[0, q, 1]), q)
        # Second entangling ladder
        for q in range(3):
            qc.cx(q, q + 1)
        qc.cx(3, 0)
        qc.measure_all()
        return qc

    def dispatch_job(self, circuits, backend=None, shots=1024):
        """Transpiles and submits circuits to the selected physical backend."""
        target_backend = backend or self.get_least_busy_qpu()
        pm = generate_preset_pass_manager(backend=target_backend, optimization_level=1)
        isa_circuits = pm.run(circuits)
        
        sampler = Sampler(mode=target_backend)
        job = sampler.run(isa_circuits, shots=shots)
        return {
            "job_id": job.job_id(),
            "backend": target_backend.name,
            "qubits": target_backend.num_qubits,
            "status": str(job.status()),
            "url": f"https://quantum.ibm.com/jobs/{job.job_id()}",
            "job_handle": job
        }
