import requests
import json

# New format: finding + ast_context
payload = {
    "finding": {
        "algorithm": "AES-CBC",
        "category": "SYMMETRIC",
        "code_snippet": "iv = b'0000000000000000'\ncipher = AES.new(key, AES.MODE_CBC, iv=iv)",
        "line_number": 2,
        "library": "pycryptodome",
        "key_size": 256
    },
    "ast_context": {
        "file_path": "auth/encryption.py",
        "language": "python",
        "function_name": "encrypt_password",
        "line_offset": 0,
        "imports": ["Crypto.Cipher.AES"]
    }
}

r = requests.post("http://127.0.0.1:8000/api/v1/classify/misuse", json=payload, timeout=30)
print("Status:", r.status_code)
print("Response:")
print(json.dumps(r.json(), indent=2))