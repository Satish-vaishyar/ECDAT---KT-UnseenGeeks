# 🤖 ECDAT Production Models Master Registry

This directory stores the trained model weights, configuration artifacts, and standalone inference scripts for all **production AI/ML models** of the **Enterprise Cryptographic Discovery & Analysis Tool (ECDAT)** (Smart India Hackathon 2026 | NTRO PS-26164).

---

## 📁 Master Model Directory Index (Sequential Numerical Order)

| # | Directory | Official Model Name | Primary Architecture | Core Capabilities | Key Artifacts |
| :-: | :--- | :--- | :--- | :--- | :---: |
| **01** | [`model_01_ast_cryptonet/`](./model_01_ast_cryptonet/) | **Model 1: AST-CryptoNet** | Tree-sitter + 12-Signal Scorer + Platt Scaling + RL | • 6-Language Source Code AST Parsing<br>• Calibrated Confidence Scoring<br>• RL-Guided False Positive Reduction | `model1_ast_cryptonet_fixed.onnx`<br>`model1_rl_policy.pt` |
| **02** | [`model_02_bincryptocnn/`](./model_02_bincryptocnn/) | **Model 2: BinCryptoCNN** | 1D CNN + Actor-Critic RL Policy + Hybrid Quantum VQC | • 15-Class Compiled Binary Scanner<br>• Quantum Hilbert Space Disambiguation<br>• IBM Heron Physical QPU Execution | `best_bincryptocnn.pt`<br>`best_rl_bindecide.pt`<br>`best_hq_bincrypto.pt`<br>`ibm_quantum_hardware_receipt.json` |
| **03** | [`model_03_entropyguard/`](./model_03_entropyguard/) | **Model 3: EntropyGuard** | Shannon / Chi-Square + Sliding Window + ONNX + RL | • High-Entropy Key & Ciphertext Detection<br>• Packed/Encrypted Binary Section Analysis<br>• Sub-millisecond Execution | `model3_inference.py`<br>`export_onnx.py` |
| **04** | [`model_04_cryptoclassllm/`](./model_04_cryptoclassllm/) | **Model 4: CryptoClassLLM** | `Qwen2.5-Coder-3B` + LoRA (SFT & DPO RL) | • 3-Level Fast Tabular Head<br>• DPO Chain-of-Thought Verifier<br>• Shor/Grover Threat Mapping | `lora_weights/`<br>`dpo_rl_policy/` |
| **05** | [`model_05_cryptorobust/`](./model_05_cryptorobust/) | **Model 5: CryptoRobust** | Obfuscation-Resilient AST Classifier + Docker API | • Adversarial Code Identifier Renaming Defense<br>• Control Flow Flattening Invariance | `app/`<br>`models/`<br>`Dockerfile` |
| **06** | [`model_06_misusedetector/`](./model_06_misusedetector/) | **Model 6: MisuseDetector** | XGBoost + PyTorch RL Policy Network (34 Features) | • 7-Type CWE Misuse Classifier<br>• Zero False-Alarm Verifier<br>• Post-Quantum Remediation Engine | `model_6_xgboost.json`<br>`rl_policy_network.pth` |
| **07** | [`model_07_ecdat_lora/`](./model_07_ecdat_lora/) | **Model 7: ECDAT LoRA** | `Qwen2.5-Coder-7B` + QLoRA (SFT & DPO RL) + IBM Qiskit VQC | • ECDAT Codebase Continuation & Reconstruction<br>• DPO Chain-of-Thought Crypto Analysis<br>• Quantum VQC Embedding Enrichment<br>• 3-Tier Client (PEFT → Ollama → simulation), served by class-e-ml | `client.py`<br>`inference.py`<br>`inference_rl.py`<br>`final_model/` |
| **08** | [`model_08_deepseek_coder/`](./model_08_deepseek_coder/) | **Model 8: DeepSeek-Coder-V2** | 15.7B MoE Transformer (2.8B active) + MLA (128K Context) | • High-Tier Code Reasoning for Multi-Agent<br>• Complex Polyglot AST Disambiguation<br>• Shor/Grover Threat & PQC Remediation | `inference.py`<br>`client.py`<br>`prompts.py` |
| **09** | [`model_09_starcoder2/`](./model_09_starcoder2/) | **Model 9: StarCoder2-15B** | 15.2B Dense Transformer + GQA (16K Context) | • Cryptographic Code Explanation Agent<br>• Executive Audit Trail Document Generator<br>• CERT-In & DPDP Act Compliance Reporting | `inference.py`<br>`client.py`<br>`prompts.py` |
| **10** | [`model_10_codellama/`](./model_10_codellama/) | **Model 10: CodeLlama-7B** | 6.7B Dense Transformer (LLaMA 2 fork) + 16K Context | • Legacy Code Pattern Recognition<br>• Deprecated Cryptographic API Detection<br>• Backward-Compatible Modernization | `inference.py`<br>`client.py`<br>`prompts.py` |
| **11** | [`model_11_gemini/`](./model_11_gemini/) | **Model 11: Gemini Flash** | 1M Context Cloud Router + 5% Sovereign Budget Guard (free tier) | • High-Complexity Cryptographic Routing<br>• Automated NVD Threat Ingestion Pipeline<br>• Sovereign <= 5% Quota Circuit Breaker | `inference.py`<br>`budget_guard.py`<br>`setup_cloud.py` |
| **12** | [`model_12_cdkg/`](./model_12_cdkg/) | **Model 12: CDKG** | Knowledge Graph (25,849 nodes, 45,200 edges) + RL | • PQC Migration Dependency Traversal<br>• Indian DPDP / CERT-In Compliance Paths<br>• RL-Navigated Graph Reasoning | `CDKG/graph/`<br>`rl_policy.py` |


| **13** | [`model_13_rag_kb/`](./model_13_rag_kb/) | **Model 13: RAG KB** | Hybrid Dense/Sparse Retrieval + PPO RL Policy | • Semantic Cryptographic Standard Retrieval<br>• Multi-Document Context Assembly<br>• Policy-Optimized Top-K Reranking | `ppo_train.py`<br>`final_optimized_pipeline.py` |
| **14** | [`model_14_hybrid_retriever/`](./model_14_hybrid_retriever/) | **Model 14: Hybrid Retriever** | BM25 Sparse + FAISS Dense + Reciprocal Rank Fusion | • Multi-Stage Cryptographic Standards Search<br>• Sub-20ms Sparse/Dense Hybrid Fusion<br>• Cross-Encoder Precision Re-ranking | `inference.py`<br>`retriever.py`<br>`fusion.py` |
| **15** | [`model_15_chroma_vectordb/`](./model_15_chroma_vectordb/) | **Model 15: ChromaDB Vector Store** | Embedded ChromaDB + all-MiniLM-L6-v2 (384-dim) | • Persistent On-Disk Vector Storage<br>• Sub-5ms HNSW Cosine Similarity Search<br>• Sovereign Air-Gap Resilient Fallback | `inference.py`<br>`vector_db.py`<br>`embedding_provider.py` |
| **17** | [`model_17_sourcetrust/`](./model_17_sourcetrust/) | **Model 17: SourceTrust** | Constrained SLSQP + XGBoost Authority Classifier | • Multi-Signal Source Trust Scoring<br>• Authority Tier 1-5 Verification<br>• Cryptographic Claim Validation | `sourcetrust_pipeline.pkl`<br>`weights.json` |
| **18** | [`model_18_tkg/`](./model_18_tkg/) | **Model 18: TKG** | Temporal Knowledge Graph + Deep Q-Network Policy | • Temporal Algorithm State Queries<br>• Deprecation Curve Forecasting<br>• RL Phased Migration Scheduling | `tkg_graph.jsonl`<br>`best_dqn_scheduler.pt` |
| **19** | [`model_19_gnn/`](./model_19_gnn/) | **Model 19: GNN Risk** | Graph Neural Network + RL Cascade Risk Mitigator | • Quantum Hilbert Space Node Calibration<br>• Enterprise Vulnerability Propagation<br>• Autonomous Graph Cascade Defense | `gnn_risk_engine.pt`<br>`best_rl_mitigator.pt` |
| **20** | [`model_20_quantum_cost/`](./model_20_quantum_cost/) | **Model 20: Quantum Cost DB** | Analytical Shor/Grover Attack Complexity Engine | • Physical Qubit & Gate Count Estimation<br>• Surface Code Error Budget Modeling<br>• NIST Security Strength Verification | `quantum_cost.py`<br>`data/quantum_formulas.json` |
| **21** | [`model_21_crypto_api/`](./model_21_crypto_api/) | **Model 21: Crypto API KB** | Multi-Language Cryptographic Provider Knowledge Base | • OpenSSL, BouncyCastle, WebCrypto API Signatures<br>• Parameter Extraction Grammar<br>• Safe vs Unsafe API Mapping | `data/`<br>`ARCHITECTURE.md` |
| **22** | [`model_22_vuln_intel/`](./model_22_vuln_intel/) | **Model 22: VulnIntel** | ChromaDB Vector Store + ListNet RL Threat Reranker | • 18,000 CVE Multi-Source Ingestion<br>• CISA KEV Zero-Day Prioritization<br>• 100% NDCG@5 RL Triage | `vuln_store.sqlite`<br>`best_rl_reranker.pt` |
| **23** | [`model_23_trapdoor/`](./model_23_trapdoor/) | **Model 23: Trapdoor IOC DB** | SQLite + Pattern/Hash Lookup + Docker API | • 6-Family Backdoor IOC Detection (Dual_EC, Debian weak keys, static nonces)<br>• Sub-ms Hash Fingerprint Matching<br>• Served via Class A (`trapdoor`) | `trapdoor_db.py`<br>`data/trapdoor_iocs.json` |
| **24** | [`model_24_compliance_kb/`](./model_24_compliance_kb/) | **Model 24: Compliance KB** | Rule & Knowledge Engine for Cybersecurity Directives | • CERT-In 2022/2024 Guidelines Mapping<br>• DPDP Act 2023 Cryptographic Mandates<br>• NIST IR 8547 Transition Verification | `scripts/`<br>`DATA_READINESS_REPORT.md` |
| **25** | [`model_25_qars/`](./model_25_qars/) | **Model 25: QARS** | 6-Component Weighted Risk Scoring + RL-QARS Policy | • Quantum Algorithmic Risk Score (0-100)<br>• Mosca 3-Component Alternative Scoring<br>• Dynamic Context-Aware Risk Tuning | `best_rl_qars_policy.pt`<br>`rules.json` |
| **26** | [`model_26_monte_carlo/`](./model_26_monte_carlo/) | **Model 26: Monte Carlo Q-Day**| Log-Normal Simulation (100k sims) + DQN Agent | • Probabilistic Q-Day Distribution ($P_5/P_{50}/P_{95}$)<br>• Mosca Exposure Inequality $P(Z < X+Y)$<br>• Autonomous Migration Budget Optimization | `best_dqn_policy.pt`<br>`simulation.py` |
| **27** | [`model_27_temporal_risk/`](./model_27_temporal_risk/)| **Model 27: Temporal Risk** | Multi-Horizon Deprecation Forecasting Engine | • Classical-to-Quantum Timeline Projection<br>• Algorithm Phase-Out Risk Modeling | `checkpoints_v2/`<br>`train_model27_v2.py` |
| **29** | [`model_29_redteam/`](./model_29_redteam/) | **Model 29: AI Red Teaming** | XGBoost + 4-Qubit VQC + PPO Adversarial Agent | • Adversarial Cryptographic Injection Defense<br>• Physical IBM Quantum Hardware Validation (`ibm_marrakesh` / `ibm_fez`) | `hybrid_quantum_detector.pth`<br>`ibm_quantum_hardware_receipt.json` |

---

## 🚀 Quick Start / Local Inference

### 1. Model 01 (AST-CryptoNet) — Source Code Scanner
```powershell
& "C:\Users\Someshwar Kumbar\anaconda3\python.exe" "models/model_01_ast_cryptonet/rl_evaluate.py"
```

### 2. Model 02 (BinCryptoCNN + RL + Quantum) — Binary Scanner
```powershell
& "C:\Users\Someshwar Kumbar\anaconda3\python.exe" "models/model_02_bincryptocnn/scripts/eval_model2_head_to_head.py"
```

### 3. Model 03 (EntropyGuard) — Shannon & Chi-Square Analysis
```powershell
& "C:\Users\Someshwar Kumbar\anaconda3\python.exe" "models/model_03_entropyguard/model3_inference.py"
```

### 4. Model 04 (CryptoClassLLM) — 3-Level Classification & DPO RL
```powershell
& "C:\Users\Someshwar Kumbar\anaconda3\python.exe" "models/model_04_cryptoclassllm/inference.py"
```

### 5. Model 06 (MisuseDetector) — CWE Classifier & Zero False-Alarm
```powershell
& "C:\Users\Someshwar Kumbar\anaconda3\python.exe" "models/model_06_misusedetector/inference.py"
```

### 6. Model 07 (ECDAT LoRA) — Codebase Continuation & Quantum VQC
```powershell
& "C:\Users\Someshwar Kumbar\anaconda3\python.exe" "models/model_07_ecdat_lora/tests/test_model7_real_world.py"
```

### 7. Model 08 (DeepSeek-Coder-V2) — High-Tier Code Reasoning & PQC Remediation
```powershell
& "C:\Users\Someshwar Kumbar\anaconda3\python.exe" "models/model_08_deepseek_coder/tests/test_model8_real_world.py"
```

### 7. Model 09 (StarCoder2-15B) — Code Explanation & Compliance Documentation
```powershell
& "C:\Users\Someshwar Kumbar\anaconda3\python.exe" "models/model_09_starcoder2/tests/test_model9_real_world.py"
```

### 8. Model 10 (CodeLlama-7B) — Legacy Modernization & API Deprecation
```powershell
& "C:\Users\Someshwar Kumbar\anaconda3\python.exe" "models/model_10_codellama/tests/test_model10_real_world.py"
```

### 9. Model 11 (Gemini Flash) — Cloud Fallback Router & NVD Ingestion
```powershell
$env:GEMINI_API_KEY = "<ai-studio-key>"
python models/model_11_gemini/setup_cloud.py
pytest models/model_11_gemini/tests/test_model11_gemini.py -v
```

### 10. Model 12 (CDKG) — Domain Knowledge Graph Reasoning
```powershell
& "C:\Users\Someshwar Kumbar\anaconda3\python.exe" "models/model_12_cdkg/tests/test_real_world.py"
```

### 11. Model 14 (Hybrid Retriever) — Sparse & Dense Rank Fusion
```powershell
& "C:\Users\Someshwar Kumbar\anaconda3\python.exe" "models/model_14_hybrid_retriever/tests/test_model14_real_world.py"
```

### 12. Model 15 (ChromaDB Vector Store) — Persistent Semantic Search
```powershell
& "C:\Users\Someshwar Kumbar\anaconda3\python.exe" "models/model_15_chroma_vectordb/tests/test_model15_real_world.py"
```

### 13. Model 17 (SourceTrust) — Intelligence Feed Scoring
```powershell
& "C:\Users\Someshwar Kumbar\anaconda3\python.exe" "models/model_17_sourcetrust/tests/test_real_world.py"
```

### 14. Model 18 (TKG) — Temporal Knowledge Graph & RL Migration Scheduler
```powershell
& "C:\Users\Someshwar Kumbar\anaconda3\python.exe" "models/model_18_tkg/tests/test_real_world.py"
```

### 15. Model 19 (GNN Risk) — Graph Cascade Risk Defense
```powershell
& "C:\Users\Someshwar Kumbar\anaconda3\python.exe" "models/model_19_gnn/tests/test_real_world_benchmark.py"
```

### 16. Model 22 (VulnIntel) — 18,000 CVE Semantic Search & RL Reranker
```powershell
& "C:\Users\Someshwar Kumbar\anaconda3\python.exe" "models/model_22_vuln_intel/tests/test_real_world.py"
```

### 17. Model 25 (QARS) — Quantum Algorithmic Risk Scoring
```powershell
& "C:\Users\Someshwar Kumbar\anaconda3\python.exe" "models/model_25_qars/tests/test_real_world_benchmark.py"
```

### 18. Model 26 (Monte Carlo Q-Day) — Probabilistic Q-Day Simulation
```powershell
& "C:\Users\Someshwar Kumbar\anaconda3\python.exe" "models/model_26_monte_carlo/tests/test_real_world.py"
```

### 19. Model 29 (AI Red Teaming) — Adversarial Defense & Physical QPU Verification
```powershell
& "C:\Users\Someshwar Kumbar\anaconda3\python.exe" "scripts/eval/run_comprehensive_quantum_test.py"
```


---

## 🔗 Backward Compatibility Notes
- To prevent breaking existing external scripts and workflows:
  - Root directory junctions (`Model 1/`, `Model 2/`, `Model 3/`, etc.) map transparently to their canonical locations in `models/`.
  - All models in `models/` are strictly zero-padded two-digit folders (`model_01` through `model_29`) with no duplicates.

