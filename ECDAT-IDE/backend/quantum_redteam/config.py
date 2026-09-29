"""Central configuration for Quantum Red Team tool."""

import os
from pathlib import Path

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

# ── Package root ─────────────────────────────────────
PACKAGE_DIR = Path(__file__).resolve().parent
DATA_DIR = PACKAGE_DIR.parent / "data"

# ── Execution Modes ──────────────────────────────────
MODE_SIMULATION = "simulation"   # FREE
MODE_HARDWARE = "hardware"       # $96/min
MODE_AUTO = "auto"               # FREE by default

# ── Attack Phases ────────────────────────────────────
PHASE1_PRE_MIGRATION = 1         # RSA/ECC/AES attacks
PHASE2_POST_MIGRATION = 2        # PQC resistance tests
PHASE3_TIMELINE = 3              # Break year prediction
PHASE_ALL = 0                    # All phases

# ── Cost Controls (from .env) ────────────────────────
QPU_COST_PER_MINUTE = float(os.getenv("QPU_COST_PER_MINUTE", "96"))
MAX_COST_PER_JOB = float(os.getenv("MAX_COST_PER_JOB", "200"))
MAX_COST_PER_SESSION = float(os.getenv("MAX_COST_PER_SESSION", "500"))

# ── Simulation Settings ──────────────────────────────
PESSIMISM_MARGIN = 0.7           # Real HW ≈ sim × 0.7
DEFAULT_SHOTS = 4096
MAX_STATEVECTOR_QUBITS = 30      # Practical RAM limit
NOISE_SOURCE = os.getenv("DEFAULT_BACKEND", "ibm_fez")

# ── Hardware Limits ──────────────────────────────────
MAX_HARDWARE_QUBITS = 156        # IBM Heron r3

# ── IBM Roadmap (qubits per year) ────────────────────
IBM_ROADMAP = {
    2023: 127,      # Eagle
    2024: 133,      # Heron r1
    2025: 156,      # Heron r3
    2026: 156,      # Heron r3 (current)
    2027: 433,      # Condor (projected)
    2028: 1121,     # Flamingo (projected)
    2030: 10000,    # Projected
    2035: 100000,
    2040: 1000000,
}

# ── Default Attack Targets ───────────────────────────
DEFAULT_PHASE1_TARGETS = [
    "RSA-15", "RSA-21",         # Shor's (fit hardware)
    "AES-4", "AES-8",           # Grover's (fit hardware)
    "RSA-2048", "ECC-P256",     # Shor's (simulation only)
    "AES-128", "AES-256",       # Grover's (simulation only)
]

DEFAULT_PHASE2_TARGETS = [
    "ML-KEM-768", "ML-DSA-65",
    "Falcon-512", "SLH-DSA-256",
]

DEFAULT_PHASE3_TARGETS = [
    "RSA-2048", "ECC-P256", "AES-128",
    "AES-256", "SHA-256",
    "ML-KEM-768", "ML-DSA-65",
]

# ── Qubit Requirements (from Model 20 / research) ───
QUBIT_REQUIREMENTS = {
    # Shor-vulnerable (logical qubits)
    "RSA-15":    16,
    "RSA-21":    20,
    "RSA-35":    30,
    "RSA-512":   699,
    "RSA-1024":  1399,
    "RSA-2048":  1399,       # Gidney 2025 CFS: 0.68n logical
    "RSA-3072":  2099,
    "RSA-4096":  2799,
    "ECC-P256":  1193,       # Roetteler 2017
    "ECC-P384":  1795,
    "ECC-P521":  2449,
    # Grover targets (logical qubits)
    "AES-4":     10,
    "AES-8":     20,
    "AES-128":   2700,       # Grassl et al. 2016
    "AES-192":   3100,
    "AES-256":   3200,       # Impractical: 2^286 quantum ops
    "SHA-256":   2402,       # Amy et al. 2016
    # PQC: no known efficient quantum attack
    "ML-KEM-768":  None,
    "ML-KEM-1024": None,
    "ML-DSA-65":   None,
    "ML-DSA-87":   None,
    "Falcon-512":  None,
    "SLH-DSA-256": None,
    "HQC-128":     None,
    "FrodoKEM-640": None,
}

# ── Physical qubit multipliers ───────────────────────
PHYSICAL_QUBIT_MULTIPLIER = {
    "RSA-2048": 642,      # 897,864 physical / 1,399 logical
    "ECC-P256": 419,      # ~500,000 physical / 1,193 logical
    "DEFAULT":  1000,     # Conservative default
}
