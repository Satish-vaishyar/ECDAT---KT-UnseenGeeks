"""
ECDAT Model 11: Cloud Setup, Health Verification & Budget Inspection Script
Tests Gemini API connectivity, local Ollama fallback, and audits the <= 5% quota.
SIH 2026 Problem Statement ID: 26164 (NTRO)

  export GEMINI_API_KEY=...   # AI Studio key (free tier); paid billing optional
  python -m models.model_11_gemini.setup_cloud [--reset-budget]
"""
import os
import sys
import argparse
from pathlib import Path

if sys.stdout.encoding != "utf-8":
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

root_dir = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(root_dir))
sys.path.insert(0, str(root_dir / "models"))

from model_11_gemini.budget_guard import CloudBudgetGuard
from model_11_gemini.client import GeminiClient


def check_status(reset_budget: bool = False):
    print("=" * 80)
    print("ECDAT MODEL 11: GEMINI CLOUD ROUTER & BUDGET AUDIT")
    print("=" * 80)

    guard = CloudBudgetGuard()
    if reset_budget:
        guard.reset()
        print("[+] Budget metrics have been successfully reset.\n")

    client = GeminiClient()
    active_backend = client.get_active_backend()

    api_key = os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")
    masked = f"{api_key[:7]}...{api_key[-4:]}" if api_key and len(api_key) > 12 else ("SET" if api_key else "NOT SET")

    print(f"[*] Cloud Provider:      Google AI Studio Gemini ({client.model})")
    print(f"[*] API Key Status:      {masked}")
    print(f"[*] Active Backend:      {active_backend.upper()}")
    print("-" * 80)

    metrics = guard.get_metrics_summary()
    print("[*] Quota & Cost Audit Status:")
    print(f"  - Daily Cloud Fallback Limit: {metrics['max_daily_quota']}")
    print(f"  - Current Cloud Fallback:     {metrics['cloud_fallback_ratio']}")
    print(f"  - Quota Compliant:            {'YES' if metrics['is_quota_compliant'] else 'NO (OVER QUOTA)'}")
    print(f"  - Local Requests Recorded:    {metrics['local_requests']}")
    print(f"  - Cloud Requests Recorded:    {metrics['cloud_requests']}")
    print(f"  - Billing Tier:               {metrics['billing_tier']} (free=$0)")
    print(f"  - Input Tokens Consumed:      {metrics['total_input_tokens']}")
    print(f"  - Output Tokens Consumed:     {metrics['total_output_tokens']}")
    print(f"  - Total Cost Accrued (USD):   {metrics['estimated_cost_usd']}")
    print("=" * 80)


def main():
    parser = argparse.ArgumentParser(description="Model 11 Gemini Router & Budget Inspector")
    parser.add_argument("--reset-budget", action="store_true",
                        help="Reset token and request counters to zero")
    args = parser.parse_args()
    check_status(reset_budget=args.reset_budget)


if __name__ == "__main__":
    main()
