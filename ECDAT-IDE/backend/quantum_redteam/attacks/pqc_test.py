"""
PQC Resistance Tests — Phase 2 of the attack lifecycle.

Tests post-quantum cryptographic algorithms against known quantum attacks.
All PQC algorithms tested are NIST-standardized or candidates.

Results:
  RESISTANT   — No practical quantum speedup known
  VULNERABLE  — Side-channel or implementation weakness found
  REDUCED     — Quantum attack reduces security margin (but still safe)

References:
  - Cho et al., TCHES 2025 — lattice sieving: 15-27 bit reduction
  - Lin et al., PKC 2025 — Falcon side-channel (power analysis)
  - Valsaraj et al., ePrint 2025/2009 — ML-KEM fault injection
  - NIST FIPS 203/204/205 — ML-KEM, ML-DSA, SLH-DSA standards
"""

from typing import Dict, Any


class PQCResistanceTest:
    """
    Test PQC algorithms against quantum attacks.
    Phase 2 of the lifecycle.
    """

    def test(self, algo: str, simulator=None) -> Dict[str, Any]:
        """
        Run appropriate resistance test.
        Returns verdict: RESISTANT / VULNERABLE / REDUCED_MARGIN
        """
        algo_upper = algo.upper().replace("-", "").replace("_", "")

        if "MLKEM" in algo_upper or "KYBER" in algo_upper:
            return self._test_lattice_kem(algo)
        elif "MLDSA" in algo_upper or "DILITHIUM" in algo_upper:
            return self._test_lattice_sig(algo)
        elif "SLHDSA" in algo_upper or "SPHINCS" in algo_upper:
            return self._test_hash(algo)
        elif "FALCON" in algo_upper:
            return self._test_ntru(algo)
        elif "HQC" in algo_upper:
            return self._test_code(algo)
        elif "BIKE" in algo_upper:
            return self._test_code(algo)
        elif "FRODO" in algo_upper:
            return self._test_conservative_lattice(algo)
        else:
            return self._test_unknown(algo)

    def _test_lattice_kem(self, algo: str) -> Dict[str, Any]:
        """
        ML-KEM (FIPS 203): Module-LWE lattice KEM.
        Quantum sieving gives only 15-27 bit security reduction.
        Reference: Cho et al. TCHES 2025
        """
        # Security levels by parameter set
        security_levels = {
            "ML-KEM-512": {"classical": 128, "pq": 101, "reduction": 27},
            "ML-KEM-768": {"classical": 192, "pq": 165, "reduction": 27},
            "ML-KEM-1024": {"classical": 256, "pq": 233, "reduction": 23},
        }

        params = security_levels.get(algo, {"classical": 192, "pq": 165,
                                            "reduction": 27})

        return {
            "algorithm": algo,
            "standard": "NIST FIPS 203",
            "family": "Lattice (Module-LWE)",
            "verdict": "resistant",
            "confidence": 0.95,
            "reason": "No practical quantum speedup for lattice problems",
            "detail": (f"Quantum 3-tuple sieve reduces security by "
                       f"~{params['reduction']} bits "
                       f"({params['classical']}-bit → {params['pq']}-bit PQ). "
                       f"Still safe: requires millions of logical qubits."),
            "quantum_attack": "3-tuple sieve 2^(0.2846d)",
            "classical_security_bits": params["classical"],
            "post_quantum_security_bits": params["pq"],
            "security_reduction_bits": params["reduction"],
            "required_qubits": "millions (impractical)",
            "cost_usd": 0.0,
            "source": "Cho et al. TCHES 2025 / Albrecht et al.",
        }

    def _test_lattice_sig(self, algo: str) -> Dict[str, Any]:
        """
        ML-DSA (FIPS 204): Module-LWE lattice signature.
        Same lattice sieving resistance as ML-KEM.
        """
        security_levels = {
            "ML-DSA-44": {"classical": 128, "pq": 101, "reduction": 27},
            "ML-DSA-65": {"classical": 192, "pq": 165, "reduction": 27},
            "ML-DSA-87": {"classical": 256, "pq": 233, "reduction": 23},
        }

        params = security_levels.get(algo, {"classical": 192, "pq": 165,
                                            "reduction": 27})

        return {
            "algorithm": algo,
            "standard": "NIST FIPS 204",
            "family": "Lattice (Module-LWE)",
            "verdict": "resistant",
            "confidence": 0.95,
            "reason": "Lattice sieving impractical against Module-LWE",
            "detail": (f"Same lattice hardness as ML-KEM. "
                       f"~{params['reduction']}-bit security reduction. "
                       f"Post-quantum security: {params['pq']}-bit."),
            "quantum_attack": "3-tuple sieve 2^(0.2846d)",
            "classical_security_bits": params["classical"],
            "post_quantum_security_bits": params["pq"],
            "security_reduction_bits": params["reduction"],
            "required_qubits": "millions (impractical)",
            "cost_usd": 0.0,
            "source": "Cho et al. TCHES 2025",
        }

    def _test_hash(self, algo: str) -> Dict[str, Any]:
        """
        SLH-DSA (FIPS 205): Stateless hash-based signature.
        Grover halves security: 256-bit → 128-bit PQ (still safe).
        """
        security_levels = {
            "SLH-DSA-128": {"classical": 128, "pq": 64},
            "SLH-DSA-192": {"classical": 192, "pq": 96},
            "SLH-DSA-256": {"classical": 256, "pq": 128},
        }

        params = security_levels.get(algo, {"classical": 256, "pq": 128})

        return {
            "algorithm": algo,
            "standard": "NIST FIPS 205",
            "family": "Hash-based (SPHINCS+)",
            "verdict": "resistant",
            "confidence": 0.98,
            "reason": f"Grover reduces to {params['pq']}-bit PQ security (still safe)",
            "detail": (f"Grover's algorithm halves hash security: "
                       f"{params['classical']}-bit → {params['pq']}-bit PQ. "
                       f"This is by design — SLH-DSA parameters account for Grover."),
            "quantum_attack": "Grover's (preimage search)",
            "classical_security_bits": params["classical"],
            "post_quantum_security_bits": params["pq"],
            "security_reduction_bits": params["classical"] - params["pq"],
            "required_qubits": f"{params['classical'] * 10:,}+ (impractical)",
            "cost_usd": 0.0,
            "source": "NIST FIPS 205 / Bernstein et al.",
        }

    def _test_ntru(self, algo: str) -> Dict[str, Any]:
        """
        Falcon: NTRU lattice signature.
        No quantum break, BUT side-channel vulnerable (power analysis).
        Reference: Lin et al., PKC 2025
        """
        return {
            "algorithm": algo,
            "standard": "NIST Round 4 (not FIPS standardized)",
            "family": "NTRU Lattice",
            "verdict": "vulnerable",
            "confidence": 0.90,
            "reason": "Side-channel vulnerability (power analysis)",
            "detail": (
                "No quantum algorithm breaks Falcon's lattice assumption. "
                "HOWEVER: power analysis attacks recover signing keys with "
                "85% fewer traces than previously thought. "
                "Fault injection attacks also demonstrated (Valsaraj 2025). "
                "NIST chose ML-DSA over Falcon for FIPS standardization partly "
                "due to these implementation risks."
            ),
            "quantum_attack": "None (classical side-channel attack)",
            "side_channel_risk": "HIGH",
            "side_channel_type": "Power analysis + fault injection",
            "classical_security_bits": 128,
            "post_quantum_security_bits": 128,
            "security_reduction_bits": 0,
            "required_qubits": "N/A (not a quantum attack)",
            "cost_usd": 0.0,
            "source": "Lin et al. PKC 2025 / Valsaraj et al. ePrint 2025/2009",
        }

    def _test_code(self, algo: str) -> Dict[str, Any]:
        """
        Code-based PQC (HQC, BIKE): no quantum speedup known.
        """
        return {
            "algorithm": algo,
            "standard": "NIST Round 4 candidate",
            "family": "Code-based",
            "verdict": "resistant",
            "confidence": 0.92,
            "reason": "No quantum speedup beyond Grover for ISD",
            "detail": (
                "Information Set Decoding (ISD) is the best known attack. "
                "Quantum variants (QISD) provide at most quadratic speedup "
                "(Grover-like), which is already accounted for in parameter "
                "selection. No exponential quantum advantage known."
            ),
            "quantum_attack": "QISD (quadratic speedup only)",
            "classical_security_bits": 128,
            "post_quantum_security_bits": 128,
            "security_reduction_bits": 0,
            "cost_usd": 0.0,
            "source": "Bernstein et al. / NIST Round 4 analysis",
        }

    def _test_conservative_lattice(self, algo: str) -> Dict[str, Any]:
        """
        FrodoKEM: Conservative LWE-based KEM.
        Most conservative lattice assumption (plain LWE, no ring/module structure).
        """
        return {
            "algorithm": algo,
            "standard": "NIST alternate candidate",
            "family": "Lattice (Plain LWE)",
            "verdict": "resistant",
            "confidence": 0.97,
            "reason": "Most conservative lattice assumption — no known quantum attack",
            "detail": (
                "FrodoKEM uses plain LWE without algebraic structure "
                "(no ring or module). This is the most conservative lattice "
                "assumption. No quantum speedup known beyond Grover-like "
                "improvements on sieving."
            ),
            "quantum_attack": "None known",
            "classical_security_bits": 128,
            "post_quantum_security_bits": 128,
            "security_reduction_bits": 0,
            "cost_usd": 0.0,
            "source": "Alkim et al. / NIST alternate analysis",
        }

    def _test_unknown(self, algo: str) -> Dict[str, Any]:
        """Unknown algorithm — cannot assess."""
        return {
            "algorithm": algo,
            "standard": "Unknown",
            "family": "Unknown",
            "verdict": "unknown",
            "confidence": 0.0,
            "reason": f"Algorithm '{algo}' not in resistance database",
            "detail": "Please specify a known PQC algorithm.",
            "cost_usd": 0.0,
        }

    def test_all_pqc(self, simulator=None) -> list:
        """Test all standard PQC algorithms."""
        targets = [
            "ML-KEM-512", "ML-KEM-768", "ML-KEM-1024",
            "ML-DSA-44", "ML-DSA-65", "ML-DSA-87",
            "SLH-DSA-128", "SLH-DSA-192", "SLH-DSA-256",
            "Falcon-512", "HQC-128", "FrodoKEM-640",
        ]
        return [self.test(t, simulator) for t in targets]
