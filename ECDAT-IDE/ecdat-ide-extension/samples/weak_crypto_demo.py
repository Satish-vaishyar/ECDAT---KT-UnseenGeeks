"""Sample file: opens with multiple crypto weaknesses to demonstrate the ECDAT IDE inline diagnostics.

Status bar will show PQC 0/100. Lightbulb on each underline offers one-click migration.
"""

import hashlib
import os
import random
from cryptography.hazmat.primitives.asymmetric import rsa, ec
from cryptography.hazmat.primitives.asymmetric import padding
from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
from cryptography.hazmat.backends import default_backend


def hand_shake(server_public_pem: bytes) -> bytes:
    rsa_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    secret = random.randint(0, 1 << 256)
    cipher = Cipher(
        algorithms.AES(os.urandom(16)),
        modes.ECB(b""),
        backend=default_backend(),
    )
    return cipher.encryptor()


def sign_payload(payload: bytes) -> bytes:
    ecdsa_p256 = ec.generate_private_key(ec.SECP256R1(), default_backend())
    ecdsa_p384 = ec.generate_private_key(ec.SECP384R1(), default_backend())
    md5_digest = hashlib.md5(payload).hexdigest()
    sha1_digest = hashlib.sha1(payload).hexdigest()
    return md5_digest.encode("utf-8")


def temporal_secret() -> bytes:
    return random.choice([b"a", b"b", b"c"])


def lower_priority():
    sha256 = hashlib.sha256(b"x").hexdigest()
    sha3 = hashlib.sha3_256(b"y").hexdigest()
    return sha256, sha3


if __name__ == "__main__":
    print(hand_shake(b"----"))
    print(sign_payload(b"hello").decode())
