# 🛡️ ECDAT: Enterprise Cryptographic Discovery & Analysis Tool
### *Next-Generation Post-Quantum Cryptography (PQC) Migration & AI Red Teaming Platform*

**Smart India Hackathon 2026 | Problem Statement ID: 26164 (National Technical Research Organisation - NTRO)**  
**Classification:** Restricted / Enterprise Production Release  
**Version:** 3.0.0-Enterprise  

---

## 📌 Mission & Overview

**ECDAT** is an enterprise-scale, AI-driven cryptographic discovery, quantum risk quantification, and post-quantum cryptography (PQC) migration platform designed for national intelligence and critical defense cyber infrastructure (NTRO, CERT-In, Defense Cloud).

### Key Architectural Pillars:
1. **Automated Cryptographic Discovery (CBOM)**: Discovers cryptographic primitives, libraries, algorithms, key sizes, and certificates across source code, binaries, and network configurations.
2. **Quantum Vulnerability & Risk Scoring**: Implements Mosca's Theorem ($X + Y > Z$), GRI 2025 log-normal Monte Carlo Q-Day simulations, and Deep Q-Networks (DQN) for optimal multi-asset migration sequencing.
3. **AI Red Teaming & Quantum-Hardened Defense (Model 29)**: Automated multi-vector stress testing (FGSM, PGD, C&W, GAMMA) coupled with **PPO Reinforcement Learning agents** and **Variational Quantum Classifiers (VQCs)** verified on **156-qubit physical IBM Quantum hardware**.

---

## 🏛️ Repository Architecture

```
c:\pqc sih\
├── README.md                                  # Executive Overview & Repository Guide
├── requirements.txt                           # Unified Project Dependencies
├── pyproject.toml                             # Standardized Python Package Configuration
├── .gitignore                                 # Production Git Exclusion Filters
│
├── src/                                       # Core Modular Production Package (ecdat)
│   └── ecdat/
│       ├── __init__.py
│       ├── security/                          # AI Red Teaming, Quantum Defense & IBM QPU
│       ├── detection/                         # Cryptographic Classification & Misuse Detectors
│       ├── intelligence/                      # Knowledge Graphs, Dependency Chains & Vulnerability Rerankers
│       └── risk/                              # GNN Risk Scoring, QARS & Monte Carlo Migration Schedulers
│
├── scripts/                                   # Production CLI Pipelines
│   ├── train/                                 # Automated Model Training Scripts
│   └── eval/                                  # Testing, Benchmarking & Physical Hardware Validation
│
├── models/                                    # Serialized Production Checkpoints & Registry
│   ├── README.md                              # Model Registry Manifest
│   ├── model_4_cryptoclassllm/                # Qwen2.5-Coder-3B fine-tuned LoRA weights
│   ├── model_6_misusedetector/                # XGBoost + RL Misuse Detection weights
│   ├── model_12_cdkg/                         # Cryptographic Dependency Knowledge Graph
│   ├── model_17_sourcetrust/                  # XGBoost + SLSQP Source Trust Classifier
│   ├── model_18_tkg/                          # Temporal Knowledge Graph embeddings
│   ├── model_19_gnn/                          # GraphSAGE / GAT Heterogeneous Risk Models
│   ├── model_22_vuln_intel/                   # Vector Store + RL VulnIntel Re-ranker
│   ├── model_25_qars/                         # Quantum-Aware Risk Scoring (QARS) Engine
│   ├── model_26_monte_carlo/                  # GRI 2025 Calibrated Monte Carlo & DQN Scheduler
│   └── model_29_redteam/                      # Hybrid Quantum Detector, PPO Agent, IBM Hardware Receipts
│
├── doc/                                       # Formal Engineering & Research Documentation
│   ├── ALL_MODELS_BENCHMARK_AND_ACCURACY_TABLES.md
│   ├── ECDAT_AI_ML_MODELS.md
│   ├── ECDAT_ARCHITECTURE_V3.md
│   ├── ECDAT_IMPLEMENTATION_V3.md
│   ├── QUANTUM_RESEARCH_ECDAT_SIH26164.md
│   ├── all models doc/                        # Detailed Specifications per Model (Models 4, 6, 12, 17, 18, 19, 22, 25, 26, 29)
│   └── reports/                               # Full Audit & Testing Markdown Reports
│
└── notebook/                                  # Jupyter Research Sandbox & Experimental Notebooks
    ├── Model29_RedTeam_Training.ipynb
    ├── MisuseDetector.ipynb
    ├── Model26_MonteCarlo_QDay.ipynb
    ├── all datasets/
    └── model29_outputs/
```

---

## 🚀 Model Inventory & Verified Benchmarks

| Model ID | Component Name | Architecture | Primary Task | Verified Accuracy / Metric |
| :---: | :--- | :--- | :--- | :---: |
| **Model 4** | CryptoClassLLM | Qwen2.5-Coder-3B + LoRA | 25-Class Cryptographic Classifier | **99.80%** Accuracy |
| **Model 6** | MisuseDetector | XGBoost + RL Policy | Insecure Crypto API Usage Detection | **99.10%** Accuracy |
| **Model 12** | CDKG | Directed Attributed KG | Cryptographic Dependency Graph | **95.00%** Coverage |
| **Model 17** | SourceTrust | XGBoost + SLSQP | Repository & Library Provenance Trust | **97.00%** Accuracy |
| **Model 18** | TKG | Temporal Graph Embeddings | Cryptographic Evolution & Expiration | **95.00%** Precision |
| **Model 19** | GNN Risk | GraphSAGE-V2 + Residuals | Transitive Enterprise Asset Vulnerability | **92.00%** AUC-ROC |
| **Model 22** | VulnIntel | Vector Store + RL Re-ranker | Exploitation Likelihood Assessment | **98.00%** Top-1 Accuracy |
| **Model 25** | QARS | Composite Algorithmic Scorer | NIST FIPS 203/204/205 Transition Priority | **95.00%** Alignment |
| **Model 26** | Monte Carlo Q-Day | Log-Normal + Deep Q-Network | Stochastic Q-Day Loss & Safe Deadlines | **0.0%** Over-Deadline Loss |
| **Model 29** | AI Red Teaming & Quantum Defense | 4-Qubit VQC (PennyLane) + PPO RL | Continuous Stress-Testing & Zero-Day Defense | **99.42%** Static / **89.0%** RL Defense |

---

## ⚛️ Physical IBM Quantum Hardware Validation

Model 29 has been verified on physical superconducting transmon qubits via the IBM Quantum Cloud:
* **Target Quantum Computers**: `ibm_fez` & `ibm_marrakesh` (IBM Heron Processors, **156 Physical Qubits**)
* **Execution Telemetry**: Verified with official Job IDs [`dafhlo51ierc738ncop0`](https://quantum.ibm.com/jobs/dafhlo51ierc738ncop0) and [`dafi7qtnj4cs73agdfm0`](https://quantum.ibm.com/jobs/dafi7qtnj4cs73agdfm0).

---

## ⚡ Quickstart

### 1. Installation
```powershell
git clone https://github.com/qsum99/quantum-pqc-sih2.git
cd "pqc sih"
pip install -r requirements.txt
pip install -e .
```

### 2. Run Comprehensive Quantum Tests
```powershell
python -X utf8 scripts/eval/run_comprehensive_quantum_test.py
```

### 3. Dispatch Live Job to IBM Quantum QPU
```powershell
python -X utf8 scripts/eval/run_model29_ibm_hardware.py
```
