"""
Demo Vector 1: Vulnerable Enterprise Asymmetric Key Exchange (Python)
Vulnerability: Shor-vulnerable RSA-2048 & Weak Key Generation (CWE-326)
Expected Output:
  - Algorithm: RSA-2048 (ASYMMETRIC)
  - Quantum Threat: CRITICAL (Broken by Shor's period finding in O(log^3 N))
  - NIST PQC Remediation: ML-KEM-768 (Kyber) or ML-DSA-65 (Dilithium)
"""
import os
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.hazmat.primitives import serialization

class GatewayKeyManager:
    def __init__(self, key_size: int = 2048):
        self.key_size = key_size

    def generate_server_keypair(self):
        # Shor-vulnerable asymmetric RSA keypair
        private_key = rsa.generate_private_key(
            public_exponent=65537,
            key_size=self.key_size
        )
        return private_key

    def export_pem(self, private_key):
        return private_key.private_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PrivateFormat.PKCS8,
            encryption_algorithm=serialization.NoEncryption()
        )
