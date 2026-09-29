"""
Quantum Red Team Attack Tool
=============================
Standalone quantum red team package for ECDAT.
Validates PQC migration lifecycle via 3-phase quantum attack simulation.

Phase 1: Pre-Migration  — Attack classical crypto (Shor/Grover)
Phase 2: Post-Migration — Test PQC algorithms for resistance
Phase 3: Timeline       — Predict when algorithms break

Two execution modes:
  - Simulation (FREE)  — Qiskit Aer local simulator
  - Hardware   ($96/m) — IBM Quantum QPU (opt-in, cost-guarded)
"""

__version__ = "1.0.0"
__all__ = [
    "QuantumRedTeamEngine",
    "SimulationMode",
    "HardwareMode",
    "ShorAttack",
    "GroverAttack",
    "QAOAAttack",
    "PQCResistanceTest",
    "CostGuard",
    "TimelinePredictor",
    "ReportGenerator",
]

from quantum_redteam.config import (
    MODE_SIMULATION, MODE_HARDWARE, MODE_AUTO,
    PHASE1_PRE_MIGRATION, PHASE2_POST_MIGRATION, PHASE3_TIMELINE, PHASE_ALL,
)
