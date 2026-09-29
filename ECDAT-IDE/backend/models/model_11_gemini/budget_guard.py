"""
ECDAT Model 11: Gemini Budget Guard & Quota Manager
Tracks token usage, estimated costs, and enforces the <= 5% daily cloud fallback threshold.
SIH 2026 Problem Statement ID: 26164 (NTRO)

Pricing (Gemini 3.6 Flash; replaced GPT-4o-mini $0.15/$0.60):
  FREE tier (AI Studio, no billing): $0.00 (rate-limited)
  Paid tier: $1.50 / 1M input, $7.50 / 1M output
Set MODEL11_BILLING=paid only when a billing account is attached; else cost accrues $0.
"""
import os
import json
import time
from typing import Dict, Any

COST_PER_1M_INPUT_TOKENS = 1.50
COST_PER_1M_OUTPUT_TOKENS = 7.50
MAX_FALLBACK_RATIO = 0.05  # 5% daily request threshold


class CloudBudgetGuard:
    """Manages API usage, costs, and enforces ECDAT's <= 5% cloud fallback constraint."""

    def __init__(self, state_file: str = "cloud_budget_state.json"):
        self.state_file = os.path.join(os.path.dirname(__file__), state_file)
        self.billing = os.getenv("MODEL11_BILLING", "free").lower()
        self.total_local_requests = 0
        self.total_cloud_requests = 0
        self.total_input_tokens = 0
        self.total_output_tokens = 0
        self.last_reset_time = time.time()
        self._load_state()

    def _load_state(self):
        if os.path.exists(self.state_file):
            try:
                with open(self.state_file, "r", encoding="utf-8") as f:
                    data = json.load(f)
                    self.total_local_requests = data.get("total_local_requests", 0)
                    self.total_cloud_requests = data.get("total_cloud_requests", 0)
                    self.total_input_tokens = data.get("total_input_tokens", 0)
                    self.total_output_tokens = data.get("total_output_tokens", 0)
                    self.last_reset_time = data.get("last_reset_time", time.time())
            except Exception:
                pass

    def _save_state(self):
        try:
            data = {
                "total_local_requests": self.total_local_requests,
                "total_cloud_requests": self.total_cloud_requests,
                "total_input_tokens": self.total_input_tokens,
                "total_output_tokens": self.total_output_tokens,
                "last_reset_time": self.last_reset_time,
                "estimated_cost_usd": self.get_estimated_cost_usd(),
                "fallback_ratio_percent": self.get_fallback_ratio() * 100,
            }
            with open(self.state_file, "w", encoding="utf-8") as f:
                json.dump(data, f, indent=2)
        except Exception:
            pass

    def reset(self):
        self.total_local_requests = 0
        self.total_cloud_requests = 0
        self.total_input_tokens = 0
        self.total_output_tokens = 0
        self.last_reset_time = time.time()
        self._save_state()

    def record_local_request(self, count: int = 1, persist: bool = True):
        self.total_local_requests += count
        if persist:
            self._save_state()

    def record_cloud_request(self, input_tokens: int, output_tokens: int, persist: bool = True):
        self.total_cloud_requests += 1
        self.total_input_tokens += input_tokens
        self.total_output_tokens += output_tokens
        if persist:
            self._save_state()

    def persist_state(self):
        self._save_state()

    def get_fallback_ratio(self) -> float:
        total = self.total_local_requests + self.total_cloud_requests
        if total == 0:
            return 0.0
        return self.total_cloud_requests / total

    def can_route_to_cloud(self) -> bool:
        total = self.total_local_requests + self.total_cloud_requests
        if total < 20:  # bootstrap allowance before enforcing ratio
            return True
        return self.get_fallback_ratio() <= MAX_FALLBACK_RATIO

    def get_estimated_cost_usd(self) -> float:
        if self.billing != "paid":
            return 0.0  # AI Studio free tier
        cost_in = (self.total_input_tokens / 1_000_000.0) * COST_PER_1M_INPUT_TOKENS
        cost_out = (self.total_output_tokens / 1_000_000.0) * COST_PER_1M_OUTPUT_TOKENS
        return round(cost_in + cost_out, 6)

    def get_metrics_summary(self) -> Dict[str, Any]:
        ratio = self.get_fallback_ratio()
        return {
            "total_requests": self.total_local_requests + self.total_cloud_requests,
            "local_requests": self.total_local_requests,
            "cloud_requests": self.total_cloud_requests,
            "cloud_fallback_ratio": f"{ratio * 100:.2f}%",
            "is_quota_compliant": ratio <= MAX_FALLBACK_RATIO
            or (self.total_local_requests + self.total_cloud_requests < 20),
            "total_input_tokens": self.total_input_tokens,
            "total_output_tokens": self.total_output_tokens,
            "estimated_cost_usd": f"${self.get_estimated_cost_usd():.6f}",
            "billing_tier": self.billing,
            "max_daily_quota": f"{MAX_FALLBACK_RATIO * 100:.0f}%",
        }
