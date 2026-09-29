"""Visual quantum-circuit SVG rendering for the red-team engine.

Contract (IDE side depends on this):
- Every phase-1 result dict AND every hardware-estimate item dict gains:
    - ``circuit_svg``: full inline ``<svg ...>...</svg>`` string or None
    - ``circuit_omitted``: string reason (e.g. "too-large") or None
- Only render when 0 < num_qubits <= max_qubits (default 16).
- Analytical results (dicts, no circuit) -> (None, None) handled by callers.

``circuit_svg()`` never raises: returns None on any exception or when
the qubit count is out of range.
"""

from __future__ import annotations

import io
import re
from typing import Optional


def circuit_svg(circuit, max_qubits: int = 16) -> Optional[str]:
    """Render a Qiskit circuit to an inline SVG string.

    Returns the SVG string (starting with ``<svg``) or None when the
    circuit is too large, invalid, or rendering fails. Never raises.
    """
    try:
        n = getattr(circuit, "num_qubits", None)
        if n is None:
            return None
        try:
            n = int(n)
        except Exception:
            return None
        if not (0 < n <= max_qubits):
            return None

        import matplotlib

        matplotlib.use("Agg")
        import matplotlib.pyplot as plt

        from qiskit.visualization import circuit_drawer

        # fold=25 keeps wide circuits small (drawer-supported pagination).
        try:
            fig = circuit_drawer(circuit, output="mpl", fold=25)
        except TypeError:
            # Older drawer without fold kwarg.
            fig = circuit_drawer(circuit, output="mpl")

        try:
            buf = io.BytesIO()
            fig.savefig(buf, format="svg", bbox_inches="tight")
            raw = buf.getvalue().decode("utf-8", errors="replace")
        finally:
            try:
                plt.close(fig)
            except Exception:
                pass

        start = raw.find("<svg")
        if start < 0:
            return None
        svg = raw[start:]
        # Strip fixed width/height so the SVG scales, keep viewBox.
        svg = re.sub(r'\swidth="[^"]*"', "", svg, count=1)
        svg = re.sub(r'\sheight="[^"]*"', "", svg, count=1)
        # Ensure responsive scaling.
        if "max-width" not in svg:
            svg = svg.replace("<svg", '<svg style="max-width:100%;height:auto;"', 1)
        if not svg.lstrip().startswith("<svg"):
            return None
        return svg
    except Exception:
        return None
