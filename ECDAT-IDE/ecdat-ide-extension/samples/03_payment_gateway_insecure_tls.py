"""
Demo Vector 3: Payment Gateway Webhook Client (Python)
Vulnerability: Disabled TLS/SSL Certificate Verification (CWE-295)
Expected Output:
  - Security Alert: CWE-295 (Improper Certificate Validation)
  - Impact: Enables Man-in-the-Middle (MitM) traffic interception
  - Remediation: Enforce strict certificate verification (verify=True or custom CA bundle)
"""
import requests
import json

class PaymentGatewayClient:
    def __init__(self, endpoint: str):
        self.endpoint = endpoint

    def dispatch_transaction_webhook(self, transaction_id: str, amount: float):
        payload = {
            "tx_id": transaction_id,
            "amount": amount,
            "currency": "INR",
            "status": "SETTLED"
        }
        headers = {"Content-Type": "application/json", "X-Gateway-Auth": "secret_key_881"}

        # CWE-295: Disabled TLS certificate validation allows attacker eavesdropping
        response = requests.post(
            f"{self.endpoint}/v1/notify",
            data=json.dumps(payload),
            headers=headers,
            verify=False,
            timeout=10.0
        )
        return response.status_code
