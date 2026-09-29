"""
ErrorMitigation — Error mitigation strategies for hardware mode.

Auto-selects strategy based on circuit depth:
  Depth < 50   → TREX only (low overhead)
  Depth 50-200 → TREX + ZNE (~3x overhead)
  Depth > 200  → TREX + ZNE + DD (full mitigation)

Techniques:
  TREX  — Measurement error mitigation (Twirled Readout EXtraction)
  ZNE   — Zero-Noise Extrapolation (+29% accuracy, ~3x shots)
  DD    — Dynamical Decoupling (reduces idle qubit errors)
  PEC   — Probabilistic Error Cancellation (exact, high overhead)

Reference: arXiv:2406.14759 (error mitigation benchmarks)
"""

from typing import Dict, Any


class ErrorMitigation:
    """Error mitigation strategies for hardware mode."""

    def select_strategy(self, circuit) -> str:
        """Auto-select mitigation strategy based on circuit depth."""
        depth = circuit.depth()

        if depth < 50:
            return "trex"           # Light: fix measurement only
        elif depth < 200:
            return "zne_trex"       # Medium: ZNE + measurement
        else:
            return "dd_zne_trex"    # Heavy: all techniques

    def apply(self, estimator, circuit):
        """Apply auto-selected mitigation to an estimator."""
        strategy = self.select_strategy(circuit)

        if "trex" in strategy:
            self.apply_trex(estimator)
        if "zne" in strategy:
            self.apply_zne(estimator)
        if "dd" in strategy:
            self.apply_dd(estimator)

        return strategy

    def apply_trex(self, estimator):
        """Measurement error mitigation. Low overhead."""
        try:
            estimator.options.resilience.measure_mitigation = True
        except AttributeError:
            pass

    def apply_zne(self, estimator):
        """Zero-noise extrapolation. ~3x overhead, +29% accuracy."""
        try:
            estimator.options.resilience.zne_mitigation = True
            estimator.options.resilience.zne.noise_factors = (1, 3, 5)
            estimator.options.resilience.zne.extrapolator = "exponential"
        except AttributeError:
            pass

    def apply_dd(self, estimator):
        """Dynamical decoupling. Good for sparse circuits."""
        try:
            estimator.options.dynamical_decoupling.enable = True
            estimator.options.dynamical_decoupling.sequence_type = "XX"
        except AttributeError:
            pass

    def apply_twirling(self, estimator):
        """Pauli twirling. Converts noise to Pauli channels."""
        try:
            estimator.options.twirling.enable_gates = True
            estimator.options.twirling.num_randomizations = 32
        except AttributeError:
            pass

    def get_strategy_info(self, circuit) -> Dict[str, Any]:
        """Get mitigation strategy details for a circuit."""
        strategy = self.select_strategy(circuit)
        depth = circuit.depth()

        techniques = []
        overhead = 1.0

        if "trex" in strategy:
            techniques.append({
                "name": "TREX",
                "description": "Measurement error mitigation",
                "overhead": "Low (~1.1x)",
            })
            overhead *= 1.1

        if "zne" in strategy:
            techniques.append({
                "name": "ZNE",
                "description": "Zero-Noise Extrapolation (3 noise levels)",
                "overhead": "Medium (~3x shots)",
                "accuracy_improvement": "+29%",
            })
            overhead *= 3.0

        if "dd" in strategy:
            techniques.append({
                "name": "DD",
                "description": "Dynamical Decoupling (XX sequence)",
                "overhead": "Minimal (~1.05x)",
            })
            overhead *= 1.05

        return {
            "strategy": strategy,
            "circuit_depth": depth,
            "techniques": techniques,
            "total_overhead": f"~{overhead:.1f}x",
            "recommendation": (
                "Light mitigation (measurement only)"
                if strategy == "trex"
                else "Medium mitigation (ZNE + measurement)"
                if strategy == "zne_trex"
                else "Full mitigation (all techniques)"
            ),
        }
