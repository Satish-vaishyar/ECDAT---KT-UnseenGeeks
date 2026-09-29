"""
Model 7: ECDAT LoRA — DPO Reinforcement Learning Aligned Inference Script
Runs the Qwen2.5-Coder-7B + DPO-aligned policy to provide:
1. Chain-of-thought cryptographic code reasoning & verification
2. Faithful ECDAT codebase reconstruction with RL-optimized quality
3. Strong preference for complete, stylistically consistent outputs
"""
import os
import sys
import json
import argparse
from pathlib import Path
from typing import Optional

if sys.stdout.encoding != 'utf-8':
    try:
        sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    except Exception:
        pass

os.environ['KMP_DUPLICATE_LIB_OK'] = 'TRUE'
os.environ['USE_TF'] = '0'
os.environ['USE_TORCH'] = '1'

# Fallback for Windows DLL application control policy on regex C extension
try:
    import regex
except ImportError:
    import re
    sys.modules['regex'] = re
    sys.modules['_regex'] = re
    sys.modules['regex._regex'] = re
    sys.modules['regex._regex_core'] = re
# Lazy loaded inside __init__


class ECDATLoRARLInference:
    """Model 7 DPO-aligned inference for ECDAT code analysis & reconstruction."""

    BASE_MODEL_ID = "Qwen/Qwen2.5-Coder-7B-Instruct"

    def __init__(self, model_dir: Optional[str] = None, use_4bit: bool = True):
        """Initialize the DPO-aligned ECDAT LoRA model.

        Args:
            model_dir: Path to DPO LoRA adapter. Defaults to ./final_rl_model.
            use_4bit: Whether to use 4-bit quantization.
        """
        if model_dir is None:
            model_dir = Path(__file__).resolve().parent / "final_rl_model"
        else:
            model_dir = Path(model_dir)

        if not model_dir.exists():
            # Fallback to SFT model
            sft_dir = Path(__file__).resolve().parent / "final_model"
            if sft_dir.exists():
                print(f"[!] DPO adapter not found, falling back to SFT: {sft_dir}")
                model_dir = sft_dir
            else:
                print(f"[!] No adapters found. Train Model 7 first.")
                model_dir = None

        import torch
        from transformers import AutoTokenizer, AutoModelForCausalLM, BitsAndBytesConfig
        from peft import PeftModel

        # Load tokenizer
        print(f"[*] Loading tokenizer: {self.BASE_MODEL_ID}")
        self.tokenizer = AutoTokenizer.from_pretrained(
            self.BASE_MODEL_ID, use_fast=True, trust_remote_code=True
        )
        if self.tokenizer.pad_token is None:
            self.tokenizer.pad_token = self.tokenizer.eos_token

        # Load base model
        device_dtype = torch.float16 if torch.cuda.is_available() else torch.float32
        load_kwargs = {
            "torch_dtype": device_dtype,
            "low_cpu_mem_usage": True,
            "trust_remote_code": True,
        }

        if use_4bit and torch.cuda.is_available():
            load_kwargs["quantization_config"] = BitsAndBytesConfig(
                load_in_4bit=True,
                bnb_4bit_quant_type="nf4",
                bnb_4bit_compute_dtype=device_dtype,
                bnb_4bit_use_double_quant=True,
            )
            load_kwargs["device_map"] = "auto"

        print(f"[*] Loading base model ({self.BASE_MODEL_ID})...")
        base_model = AutoModelForCausalLM.from_pretrained(
            self.BASE_MODEL_ID, **load_kwargs
        )

        # Load DPO adapter
        if model_dir is not None:
            print(f"[*] Loading DPO RL LoRA adapter from {model_dir}...")
            self.model = PeftModel.from_pretrained(base_model, str(model_dir))
        else:
            self.model = base_model

        self.model.eval()
        if torch.cuda.is_available() and "device_map" not in load_kwargs:
            self.model = self.model.cuda()
            print(f"[+] Loaded DPO-Aligned Model 7 on GPU: {torch.cuda.get_device_name(0)}")
        else:
            print("[+] Loaded DPO-Aligned Model 7 on CPU")

    def analyze(self, code_snippet: str, language: str = "python") -> str:
        """Analyze cryptographic operations in code using chain-of-thought reasoning.

        Args:
            code_snippet: Source code to analyze.
            language: Programming language of the code.

        Returns:
            Chain-of-thought analysis with cryptographic findings.
        """
        prompt = (
            f"Analyze the cryptographic operations in this ECDAT source code. "
            f"Provide a structured assessment including:\n"
            f"1. Cryptographic algorithms detected\n"
            f"2. Quantum vulnerability assessment\n"
            f"3. Recommended PQC replacements\n\n"
            f"```{language}\n{code_snippet.strip()}\n```"
        )

        messages = [
            {
                "role": "system",
                "content": (
                    "You are Qwen2.5-Coder, fine-tuned on the ECDAT codebase with DPO "
                    "reinforcement learning. Provide thorough, structured cryptographic "
                    "analysis with chain-of-thought reasoning."
                ),
            },
            {"role": "user", "content": prompt},
        ]

        input_text = self.tokenizer.apply_chat_template(
            messages, tokenize=False, add_generation_prompt=True
        )
        device = next(self.model.parameters()).device
        inputs = self.tokenizer(input_text, return_tensors="pt").to(device)

        with torch.no_grad():
            outputs = self.model.generate(
                **inputs,
                max_new_tokens=512,
                temperature=0.1,
                do_sample=False,
                pad_token_id=self.tokenizer.pad_token_id,
            )

        response = self.tokenizer.decode(
            outputs[0][inputs.input_ids.shape[1]:], skip_special_tokens=True
        ).strip()
        return response

    def reconstruct(
        self, source_path: str, language: str = "python", max_new_tokens: int = 1024
    ) -> str:
        """Reconstruct an ECDAT source file with DPO-quality output.

        Args:
            source_path: Workspace-relative path of the file.
            language: Programming language.
            max_new_tokens: Maximum generation length.

        Returns:
            Reconstructed source code.
        """
        messages = [
            {
                "role": "system",
                "content": (
                    "You are Qwen2.5-Coder, fine-tuned on the ECDAT codebase. "
                    "Continue or reconstruct real ECDAT source files faithfully."
                ),
            },
            {
                "role": "user",
                "content": (
                    f"Continue the real ECDAT {language} source file at `{source_path}`. "
                    f"Preserve the file's existing style, imports, and naming."
                ),
            },
        ]

        input_text = self.tokenizer.apply_chat_template(
            messages, tokenize=False, add_generation_prompt=True
        )
        device = next(self.model.parameters()).device
        inputs = self.tokenizer(input_text, return_tensors="pt").to(device)

        with torch.no_grad():
            outputs = self.model.generate(
                **inputs,
                max_new_tokens=max_new_tokens,
                temperature=0.3,
                do_sample=True,
                top_p=0.9,
                pad_token_id=self.tokenizer.pad_token_id,
            )

        response = self.tokenizer.decode(
            outputs[0][inputs.input_ids.shape[1]:], skip_special_tokens=True
        ).strip()
        return response


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Model 7: ECDAT LoRA DPO RL Inference")
    parser.add_argument("--model-dir", type=str, default=None, help="Path to DPO adapter")
    parser.add_argument("--no-4bit", action="store_true", help="Disable 4-bit quantization")
    args = parser.parse_args()

    agent = ECDATLoRARLInference(
        model_dir=args.model_dir,
        use_4bit=not args.no_4bit,
    )

    test_cases = [
        (
            "Production RSA 2048-bit Key Generation",
            "python",
            "from cryptography.hazmat.primitives.asymmetric import rsa\n"
            "def create_cert():\n"
            "    return rsa.generate_private_key(public_exponent=65537, key_size=2048)",
        ),
        (
            "AES-GCM AEAD Encryption",
            "python",
            "import secrets\n"
            "from cryptography.hazmat.primitives.ciphers.aead import AESGCM\n"
            "def encrypt_payload(data, key):\n"
            "    nonce = secrets.token_bytes(12)\n"
            "    return AESGCM(key).encrypt(nonce, data, None)",
        ),
        (
            "Non-Crypto Log (False Positive Test)",
            "python",
            "import logging\n"
            "logger = logging.getLogger('security')\n"
            "def log_auth(uid):\n"
            "    logger.warning(f'User {uid} failed RSA certificate handshake')",
        ),
    ]

    print("\n" + "=" * 90)
    print("MODEL 7 DPO RL-ALIGNED INFERENCE (CHAIN-OF-THOUGHT ANALYSIS)")
    print("=" * 90)

    for title, lang, code in test_cases:
        print(f"\nTEST CASE: {title}")
        print("-" * 60)
        output = agent.analyze(code, language=lang)
        print(output)
        print("=" * 90)
