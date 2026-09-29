"""
ECDAT Model 11: Gemini Cloud Router
High-Level Production Inference Interface
SIH 2026 Problem Statement ID: 26164 (NTRO)
"""
import sys
from typing import Dict, Any, Optional

from .client import GeminiClient


class CloudRouterGemini:
    """
    Production interface for Model 11 (Gemini Cloud Router & NVD Ingestion).
    Features:
      - Cloud overflow routing for complex, nested cryptographic code
      - Automated NVD CVE threat intelligence ingestion for ecdat/ingestion/nvd_crawler.py
      - Active token budget tracking enforcing <= 5% daily request quota
    """

    def __init__(
        self,
        api_key: Optional[str] = None,
        model: Optional[str] = None,
        ollama_url: str = "http://localhost:11434",
        backend: str = "auto",
    ):
        self.client = GeminiClient(
            api_key=api_key,
            model=model,
            ollama_url=ollama_url,
            backend=backend,
        )

    def route_and_analyze(self, code: str, language: str = "python",
                          complexity: int = 5, record_to_budget: bool = True) -> Dict[str, Any]:
        return self.client.route_and_analyze(
            code, language=language, complexity=complexity, record_to_budget=record_to_budget)

    def parse_nvd_advisory(self, raw_cve_text: str, record_to_budget: bool = True) -> Dict[str, Any]:
        """Ingest and structure raw CVE advisories into Cryptographic Threat Intel."""
        return self.client.parse_nvd_advisory(raw_cve_text, record_to_budget=record_to_budget)

    def get_budget_metrics(self) -> Dict[str, Any]:
        return self.client.budget_guard.get_metrics_summary()

    def record_local_event(self, count: int = 1, persist: bool = True):
        self.client.budget_guard.record_local_request(count, persist=persist)

    def reset_budget(self):
        self.client.budget_guard.reset()


def get_model(backend: str = "auto") -> CloudRouterGemini:
    """Convenience factory function."""
    return CloudRouterGemini(backend=backend)


if __name__ == "__main__":
    if sys.stdout.encoding != "utf-8":
        try:
            sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        except Exception:
            pass

    router = CloudRouterGemini()
    print(f"[*] Active Backend: {router.client.get_active_backend()}")

    sample_code = """
    from cryptography.hazmat.primitives.asymmetric import ec
    key = ec.generate_private_key(ec.SECP256R1())
    """
    res = router.route_and_analyze(sample_code)
    print(f"Algorithm: {res['level_2_algorithm']} | Quantum Risk: {res['level_3_quantum_risk']}")
    print(f"Budget Metrics: {router.get_budget_metrics()}")
