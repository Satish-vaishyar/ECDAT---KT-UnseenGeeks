# ECDAT — Research Plan (3 Specialists)
## SIH26164 | Smart India Hackathon 2026

---

## Research Team

| Researcher | Domain | Mission |
|---|---|---|
| **Researcher 1** | Quantum Computing | Deep threat modeling nobody else can do |
| **Researcher 2** | AI/ML | Smart detection + accurate remediation |
| **Researcher 3** | Cybersecurity | Real-world threats + Indian compliance |

---

## Researcher 1: Quantum Computing → Breakthrough in Threat Modeling

### Current State (What Others Do)
- Basic Mosca formula: `X + Y > Z` → vulnerable/not vulnerable
- Static Q-day assumption: "quantum computers arrive in 2035"
- Binary output: safe or not safe

### Mission
**Turn a binary yes/no into a continuous, quantified risk model nobody else has.**

---

### Track 1: Algorithm-Specific Quantum Attack Costing

**Question:** *Exactly how many logical qubits and what circuit depth does each attack require?*

**Research:**
- Shor's algorithm costs per algorithm (RSA, ECC, DSA, DH)
- Grover's algorithm impact on symmetric crypto
- Hybrid attack models (classical + quantum combined)
- Recent papers: Gidney & Ekerå 2021, NIST IR 8413

**Deliverable:** Quantum Attack Cost Database (JSON/SQLite):

```json
{
  "algorithm": "RSA-2048",
  "attack": "Shor",
  "logical_qubits": 4096,
  "circuit_depth": 1.2e8,
  "t_count": 2.5e9,
  "wall_time_estimate": "8 hours on 1000 logical qubits",
  "classical_equivalent_ops": "2^112",
  "quantum_speedup": "2^40",
  "references": ["Gidney & Ekerå 2021", "NIST IR 8413"]
}
```

**Why breakthrough:** Nobody in SIH will have this. Other teams say "RSA is vulnerable." You say "RSA-2048 requires 4096 logical qubits and 2.5 billion T-gates — at current error correction rates, that's approximately 8 hours on a 1000-logical-qubit machine, which we estimate arriving between 2033-2038."

---

### Track 2: Q-Day Probability Distribution (Not a Single Date)

**Question:** *When will quantum computers break RSA-2048? (Not a date — a probability distribution)*

**Research:**
- Expert elicitation surveys (Mosca, Gidney, Google Quantum AI)
- Current quantum hardware progress (IBM roadmap, Google milestones, Chinese experiments)
- Error correction progress (surface codes, logical qubits)
- How to model arrival as probability distribution (log-normal, Weibull)

**Deliverable:** Q-Day Monte Carlo Simulator:

```
Input:
  - pessimistic_qday: 2030 (5th percentile)
  - midline_qday: 2035 (50th percentile)
  - optimistic_qday: 2040 (95th percentile)
  - shelf_life: 10 years
  - migration_time: 6 years

Output:
  - P(exposure) = 71% under midline
  - P(exposure) = 45% if migration starts 2026
  - P(exposure) = 89% if migration starts 2030
  - Expected confidentiality loss = 3.2 years
  - Latest safe migration start: 2027
```

**Why breakthrough:** Static dates are misleading. Probability distributions show uncertainty — which is more honest and more useful for decision-makers.

---

### Track 3: Harvest-Now-Decrypt-Later (HNDL) Risk Scoring

**Question:** *Which data is most at risk from HNDL attacks?*

**Research:**
- How HNDL works: intercept today → store → decrypt when quantum available
- Data shelf life by type: government (50+ years), medical (30 years), financial (7 years), personal (5 years)
- HNDL scoring formula: `HNDL = V × S × R × E`
- Network traffic classification methods

**Deliverable:** HNDL Risk Score per crypto asset:

```
HNDL Score: 87/100 (CRITICAL)

Breakdown:
- Vulnerability: 100 (RSA-2048, fully broken by Shor)
- Sensitivity: 90 (government classified data, 50yr shelf life)
- Risk: 80 (intercepted in transit, stored in adversary cache)
- Exposure: 85 (external-facing TLS endpoint, internet-accessible)

Time window at risk: 2026-2035 (9 years)
Recommendation: Migrate to ML-KEM-768 hybrid IMMEDIATELY
```

**Why breakthrough:** Nobody scores HNDL risk quantitatively. Shows judges you understand the real-world threat, not just the math.

---

### Track 4: Post-Quantum Cryptography Migration Complexity

**Question:** *How hard is it to replace RSA with ML-KEM in practice?*

**Research:**
- NIST FIPS 203/204/205 (ML-KEM, ML-DSA, SLH-DSA)
- Hybrid schemes: X25519 + ML-KEM-768
- Library support: liboqs, BouncyCastle, OpenSSL 3.5+, Go 1.22+
- Migration effort per algorithm
- Side-channel vulnerabilities in PQC implementations

**Deliverable:** PQC Migration Complexity Matrix:

| Algorithm | Replacement | Library | Effort | Side-Channel Risk | Compatibility |
|---|---|---|---|---|---|
| RSA-2048 | ML-KEM-768 | liboqs | HIGH | Low | OpenSSL 3.5+ |
| ECDSA P-256 | ML-DSA-65 | BouncyCastle | HIGH | Medium | Java 21+ |
| SHA-1 | SHA-256 | Built-in | LOW | None | All versions |
| 3DES | AES-256-GCM | Built-in | LOW | None | All versions |

**Why breakthrough:** Migration effort varies wildly. Knowing the effort prevents underestimating the task.

---

## Researcher 2: AI/ML → Breakthrough in Smart Detection & Remediation

### Current State (What Others Do)
- Regex patterns to find crypto keywords
- Simple string matching
- Manual replacement suggestions

### Mission
**Make detection smarter and remediation more accurate than any tool on the market.**

---

### Track 1: Context-Aware Crypto Detection (Not Just Regex)

**Question:** *How to detect crypto in code without false positives?*

**Research:**
- AST-based semantic analysis vs regex (precision comparison)
- How to distinguish crypto usage from crypto comments/docs
- Taint analysis: tracing data flow from key generation to usage
- Known crypto API mappings per library:
  - Python: `cryptography`, `pycryptodome`, `hashlib`, `PyJWT`
  - Java: `javax.crypto`, `BouncyCastle`, `JCA`
  - JavaScript: `crypto`, `WebCrypto`, `crypto-js`
  - Go: `crypto/*`, `golang.org/x/crypto`
  - C: OpenSSL `EVP_*`, `SSL_*`, `RSA_*`
  - Rust: `ring`, `rustls`, `aes-gcm`

**Deliverable:** Crypto API Knowledge Base (500+ entries):

```json
{
  "library": "cryptography",
  "language": "python",
  "api_call": "rsa.generate_private_key",
  "algorithm": "RSA",
  "risk": "quantum_vulnerable",
  "replacement": "oqs.KeyEncapsulation",
  "false_positive_pattern": "# comment mentioning RSA",
  "confidence_boost": 0.15
}
```

**Why breakthrough:** Regex catches "RSA" in comments too. Semantic detection knows it's an actual key generation call.

---

### Track 2: Intelligent False Positive Reduction

**Question:** *How to reduce false positives without missing real crypto?*

**Research:**
- Shannon entropy analysis for secret detection
- Context windows: crypto in test files vs production code
- Confidence scoring: multiple signals → combined score
- Known false positive patterns

**Deliverable:** Confidence Scoring System:

```
Signal                    | Score
-------------------------|------
Tree-sitter AST match    | +0.4
Regex pattern match      | +0.2
Import statement found   | +0.15
Key size parameter       | +0.1
In production code path  | +0.1
In test/doc file         | -0.3
Comment-only context     | -0.5
-------------------------|------
TOTAL CONFIDENCE         | 0.85 (HIGH)
```

**Why breakthrough:** High confidence = fewer false positives = judges trust your tool more.

---

### Track 3: Smart Remediation (Rule-Based + Template Hybrid)

**Question:** *How to generate correct PQC replacement code that actually works?*

**Research:**
- Why pure LLM generation is dangerous (hallucination, wrong APIs, subtle bugs)
- Why pure rules are too rigid (can't handle all code patterns)
- Hybrid approach: rules map the algorithm, templates generate the code
- Jinja2 templates per language with verified API contexts
- How to handle semantic shifts (key agreement → key encapsulation)

**Deliverable:** Transformation Rules Engine:

```python
TRANSFORMATION_RULES = {
    "RSA": {
        "key_exchange": {
            "template": "pqc_key_exchange.j2",
            "classical_api": "rsa.generate_private_key",
            "pqc_api": "oqs.KeyEncapsulation",
            "semantic_shift": "key_agreement_to_kem",
            "hybrid_mode": "X25519 + ML-KEM-768",
            "validated": True
        },
        "digital_signature": {
            "template": "pqc_signature.j2",
            "classical_api": "rsa.generate_private_key",
            "pqc_api": "oqs.Signature",
            "semantic_shift": "none",
            "hybrid_mode": "ECDSA + ML-DSA-65",
            "validated": True
        }
    }
}
```

**Why breakthrough:** Rules + templates = correct code every time. LLM = sometimes correct, sometimes wrong. Judges will test your tool — it must work.

---

### Track 4: Anomaly Detection in Crypto Usage Patterns

**Question:** *Can we detect suspicious crypto usage that might indicate a vulnerability?*

**Research:**
- Known crypto misuse patterns:
  - Static IVs (should be random)
  - ECB mode (should be CBC/GCM)
  - Weak PRNG (should be CSPRNG)
  - Hardcoded keys (should be env vars/vaults)
  - Custom crypto (should use established libraries)
- How to detect these automatically
- OWASP Cryptographic Failures category mapping

**Deliverable:** Crypto Misuse Detector:

```
FINDING: Static IV detected in AES-CBC usage
FILE: src/encrypt.py:15
SEVERITY: HIGH
DESCRIPTION: IV is hardcoded as bytes constant, should be randomly generated
OWASP: A02:2021 - Cryptographic Failures
RECOMMENDATION: Use os.urandom(16) for IV generation
```

**Why breakthrough:** Most tools find algorithms. Yours finds misuse — which is often more dangerous than the algorithm choice.

---

## Researcher 3: Cybersecurity → Breakthrough in Threat Intelligence & Compliance

### Current State (What Others Do)
- Basic crypto scanning
- No compliance mapping
- No real-world threat context

### Mission
**Connect scanning results to real-world threats, regulations, and actionable intelligence.**

---

### Track 1: Vulnerability Database Integration

**Question:** *Which known CVEs affect the discovered crypto?*

**Research:**
- NIST NVD API 2.0 — query by CPE/keyword, filter by CVSS
- CISA KEV Catalog — actively exploited vulnerabilities
- OSV API — open-source vulnerability database
- Crypto-specific CWEs:
  - CWE-327: Broken Crypto Algorithm
  - CWE-330: Insufficient RNG
  - CWE-321: Hardcoded Key
  - CWE-326: Excessive Key Size
- Recent crypto CVEs (TrapDoor campaign May 2026, OpenSSL CVEs)

**Deliverable:** Vulnerability Correlation Engine:

```
FOUND: OpenSSL 3.0.0 in container image
CVE-2023-5678: CVSS 7.5 (HIGH)
CISA KEV: YES (actively exploited)
IMPACT: TLS 1.3 key exchange group negotiation flaw
RECOMMENDATION: Upgrade to OpenSSL 3.0.13+
```

**Why breakthrough:** Scanning finds crypto. Vulnerability correlation finds danger. Judges see real-world threat context, not just algorithm names.

---

### Track 2: Indian Regulatory Compliance Mapping

**Question:** *Does this crypto usage comply with Indian regulations?*

**Research:**
- **CERT-In Technical Guidelines v2.0** — Section 8 defines CBOM minimum elements
- **DPDP Act 2023** — crypto requirements for personal data protection
- **DST PQC Roadmap** — three migration milestones:
  - Foundations (2027-2028)
  - High-Priority Migration (2028-2030)
  - Full PQC Adoption (2029-2033)
- **RBI/SEBI** — financial sector crypto guidelines
- **NIST IR 8547** — Category 1 (acceptable), 2 (deprecated 2030), 3 (disallowed 2035)

**Deliverable:** Compliance Gap Report:

```
COMPLIANCE SCORE: 45/100 (NON-COMPLIANT)

CERT-In v2.0 Section 8:
  ✅ Algorithm inventory present
  ✅ Key lengths documented
  ❌ Certificate details missing
  ❌ Crypto-agility assessment missing
  Score: 50%

DPDP Act 2023:
  ❌ No quantum-safe encryption for personal data
  ❌ No key rotation policy documented
  Score: 25%

DST PQC Roadmap:
  ❌ RSA-2048 should be migrated by 2028 (Category 2)
  ⚠️ SHA-1 should be migrated by 2030 (Category 2)
  Score: 40%

RECOMMENDATION: Priority migration of RSA-2048 to ML-KEM-768
to meet CERT-In requirements by FY 2027-28
```

**Why breakthrough:** No SIH tool maps crypto to Indian regulations. This alone makes your tool enterprise-ready and government-adoptable.

---

### Track 3: Supply Chain Crypto Risk Analysis

**Question:** *Which third-party libraries have crypto vulnerabilities?*

**Research:**
- Dependency vulnerability scanning (npm, PyPI, Cargo, Go modules, Maven)
- TrapDoor campaign (May 2026): 34 malicious packages targeting crypto developers
- Lockfile integrity enforcement
- Package behavioral analysis (postinstall hooks, build.rs abuse)
- SBOM standards (CycloneDX, SPDX) — how to fuse with CBOM

**Deliverable:** Supply Chain Risk Scanner:

```
DEPENDENCY: requests==2.28.0
  → Transitively depends: urllib3==1.26.12
  → CVE-2023-45803: CVSS 5.3 (MEDIUM)
  → Status: FIXED in urllib3>=2.0.7
  → Action: pip install urllib3>=2.0.7

DEPENDENCY: cryptography==41.0.0
  → CVE-2023-49083: CVSS 5.9 (MEDIUM)
  → Status: FIXED in cryptography>=41.0.6
  → Action: pip install cryptography>=41.0.6

MALICIOUS PACKAGE CHECK: ✅ No TrapDoor IOCs detected
```

**Why breakthrough:** Supply chain attacks are the #1 real-world threat. Connecting crypto scanning to dependency vulnerabilities is practical and impactful.

---

### Track 4: Attack Surface Mapping & HNDL Exposure

**Question:** *Which crypto is externally facing vs internal? Which is most at risk from harvest-now-decrypt-later?*

**Research:**
- External vs internal asset classification
- HNDL attack model: intercept TLS → store → decrypt later
- Data sensitivity classification (government, financial, medical, personal)
- Network traffic analysis methods
- Shodan/Censys API for external asset enumeration

**Deliverable:** Attack Surface Report:

```
ATTACK SURFACE SUMMARY:

External-facing TLS endpoints: 12
  → RSA-2048: 8 endpoints (HNDL RISK: CRITICAL)
  → ECDSA P-256: 4 endpoints (HNDL RISK: HIGH)

Internal-only crypto: 45 instances
  → AES-256-GCM: 30 instances (HNDL RISK: LOW)
  → RSA-2048: 15 instances (HNDL RISK: MEDIUM)

HNDL RISK SCORE: 78/100 (HIGH)
  → Estimated intercepted traffic in adversary cache: ~2.3 GB
  → Data shelf life: 10 years (government classified)
  → Migration urgency: IMMEDIATE
```

**Why breakthrough:** HNDL is the #1 quantum threat discussed by NIST, NSA, and CERT-In. Quantifying it per asset is novel.

---

## How the 3 Researchers Collaborate

```
QUANTUM RESEARCHER          AI/ML RESEARCHER          CYBERSECURITY RESEARCHER
       │                          │                          │
       │                          │                          │
  Quantum Attack           Smart Detection             Vulnerability DB
  Cost Database            + False Positive            + Compliance Mapping
       │                          │                          │
       │                          │                          │
  Q-Day Monte Carlo        Confidence Scoring          Supply Chain Risk
  Simulator                System                      Analysis
       │                          │                          │
       │                          │                          │
  HNDL Risk                Anomaly Detection           Attack Surface
  Scoring                  in Crypto Usage             Mapping
       │                          │                          │
       │                          │                          │
  PQC Migration            Smart Remediation           CERT-In / DPDP
  Complexity Matrix        Rules Engine                Compliance Report
       │                          │                          │
       └──────────────┬───────────┘                          │
                      │                                      │
                      ▼                                      │
              UNIFIED ECDAT PLATFORM ◀───────────────────────┘
                      │
                      ▼
              QUANTUM-POWERED CRYPTO
              RISK ASSESSMENT WITH
              SMART REMEDIATION AND
              REGULATORY COMPLIANCE
```

---

## Research Output Summary

| Researcher | Outputs | Breakthroughs |
|---|---|---|
| **Quantum** | Attack cost DB, Q-Day simulator, HNDL scoring, PQC migration matrix | Continuous risk scoring, probability distributions, not binary |
| **AI/ML** | Crypto API KB, false positive scoring, transformation rules, misuse detection | Semantic detection, confidence scoring, compile-verified remediation |
| **Cybersecurity** | Vuln correlation, compliance mapping, supply chain scanning, attack surface | CERT-In/DPDP compliance, HNDL quantification, real-world threat context |

---

## Research Timeline

| Week | Quantum | AI/ML | Cybersecurity |
|---|---|---|---|
| **Week 1** | Attack cost database (50+ algorithms) | Crypto API knowledge base (500+ entries) | NVD + CISA KEV integration |
| **Week 2** | Q-Day Monte Carlo simulator | Confidence scoring system | CERT-In / DPDP compliance mapper |
| **Week 3** | HNDL risk scoring | Transformation rules engine | Supply chain risk scanner |
| **Week 4** | PQC migration complexity matrix | Anomaly detection in crypto usage | Attack surface mapping |

---

## How This Beats Every Other Team

| Dimension | Typical Team | Your Team |
|---|---|---|
| **Quantum** | "RSA is vulnerable" | "RSA-2048 requires 4096 logical qubits, 2.5B T-gates, arrives 2033-2038 with 71% probability" |
| **Detection** | Regex finds "RSA" | Semantic AST finds actual key generation calls with 85% confidence |
| **Remediation** | "Replace with Kyber" | Auto-generates validated diff, compiles, creates PR |
| **Compliance** | None | CERT-In + DPDP + NIST gap report |
| **Threat intel** | None | CISA KEV + CVE correlation per dependency |
| **HNDL** | None | Quantified risk per asset with shelf-life scoring |

---

## Remember

> **3 researchers doing deep work** while other teams are surface-level.
> The judges will see depth they've never seen before.

> **"Working ugly prototype > beautiful slides"**
> — Every SIH winner ever

> **"Demo >>>> anything you write on slides"**
> — SIH evaluator feedback
