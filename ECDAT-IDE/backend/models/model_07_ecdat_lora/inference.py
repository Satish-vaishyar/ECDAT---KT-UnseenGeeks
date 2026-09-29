"""
Model 7: ECDAT LoRA — Standalone Local Inference Script
Fine-tuned Qwen2.5-Coder-7B-Instruct for ECDAT codebase continuation/reconstruction.

Usage:
    python inference.py
    python inference.py --model-dir /path/to/adapter
"""
import os
import sys
import json
import argparse
from pathlib import Path
from typing import Optional, Dict, Any

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

# Torch, transformers, peft are lazy-loaded inside __init__ to avoid startup latency


class ECDATLoRAInference:
    """Model 7: Fine-tuned Qwen2.5-Coder-7B for ECDAT codebase reconstruction."""

    BASE_MODEL_ID = "Qwen/Qwen2.5-Coder-7B-Instruct"
    SYSTEM_PROMPT = (
        "You are Qwen2.5-Coder, fine-tuned on the ECDAT codebase. "
        "Continue or reconstruct real ECDAT source files faithfully."
    )

    def __init__(self, model_dir: Optional[str] = None, use_4bit: bool = True):
        """Initialize the ECDAT LoRA model.

        Args:
            model_dir: Path to the LoRA adapter directory. Defaults to ./final_model.
            use_4bit: Whether to use 4-bit quantization (saves VRAM).
        """
        if model_dir is None:
            model_dir = Path(__file__).resolve().parent / "final_model"
        else:
            model_dir = Path(model_dir)

        if not model_dir.exists():
            print(f"[!] Adapter directory not found: {model_dir}")
            print("[!] Please train the model first using Model07_ECDAT_LoRA.ipynb")
            print("[!] Running in base-model-only mode")
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

        # Load LoRA adapter
        if model_dir is not None:
            print(f"[*] Loading LoRA adapter from {model_dir}...")
            self.model = PeftModel.from_pretrained(base_model, str(model_dir))
        else:
            self.model = base_model

        self.model.eval()
        if torch.cuda.is_available() and "device_map" not in load_kwargs:
            self.model = self.model.cuda()
            print(f"[+] Loaded Model 7 (ECDAT LoRA) on GPU: {torch.cuda.get_device_name(0)}")
        else:
            print("[+] Loaded Model 7 (ECDAT LoRA) on CPU")

    def generate(
        self,
        prompt: str,
        max_new_tokens: int = 512,
        temperature: float = 0.3,
        top_p: float = 0.9,
        system_prompt: Optional[str] = None,
    ) -> str:
        """Generate code continuation for an ECDAT source file.

        Args:
            prompt: The user prompt (e.g., "Continue the ECDAT python file at ...").
            max_new_tokens: Maximum tokens to generate.
            temperature: Sampling temperature (lower = more deterministic).
            top_p: Nucleus sampling probability.
            system_prompt: Override the default system prompt.

        Returns:
            Generated text string.
        """
        messages = [
            {"role": "system", "content": system_prompt or self.SYSTEM_PROMPT},
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
                max_new_tokens=max_new_tokens,
                temperature=temperature,
                do_sample=temperature > 0,
                top_p=top_p,
                pad_token_id=self.tokenizer.pad_token_id,
            )

        response = self.tokenizer.decode(
            outputs[0][inputs.input_ids.shape[1]:], skip_special_tokens=True
        ).strip()
        return response

    def continue_file(
        self, source_path: str, language: str = "python", **kwargs
    ) -> str:
        """Convenience method: generate a continuation for a specific ECDAT file.

        Args:
            source_path: Workspace-relative path (e.g., "ecdat/classification/classifier.py").
            language: Programming language of the file.
            **kwargs: Additional kwargs passed to generate().

        Returns:
            Generated continuation text.
        """
        prompt = (
            f"Continue the real ECDAT {language} source file at `{source_path}`. "
            f"Preserve the file's existing style, imports, and naming."
        )
        return self.generate(prompt, **kwargs)


class ECDATLoRACryptoReasoning:
    """
    High-level production interface for Model 7 (ECDAT LoRA / Qwen2.5-Coder-7B).
    Provides polyglot cryptographic discovery, Shor/Grover quantum threat analysis,
    CWE vulnerability identification, NIST PQC migration remediation, and
    faithful ECDAT codebase continuation.
    """

    def __init__(self, model_dir: Optional[str] = None, backend: str = "auto"):
        from .client import ECDATLoRAClient
        self.client = ECDATLoRAClient(model_dir=model_dir, backend=backend)

    def predict(self, code: str, language: str = "python") -> Dict[str, Any]:
        """Analyze code snippet and return structured 3-level taxonomy and quantum risk."""
        return self.client.analyze_crypto_code(code, language=language)

    def continue_file(self, source_path: str, language: str = "python", max_new_tokens: int = 128) -> str:
        """Reconstruct or continue an ECDAT source file faithfully."""
        return self.client.continue_codebase_file(source_path, language=language, max_new_tokens=max_new_tokens)

    def explain_vulnerability(self, code: str, cwe_id: str, language: str = "python") -> str:
        """Generate human-readable vulnerability assessment."""
        res = self.predict(code, language=language)
        cwe = res.get("cwe_misuse", {})
        threat = res.get("quantum_threat_mechanism", "N/A")
        remediation = res.get("pqc_remediation", {}).get("recommended_replacement", "N/A")
        return (
            f"=== ECDAT Model 7 (ECDAT LoRA) Vulnerability Assessment ===\n"
            f"Vulnerability / CWE: {cwe.get('cwe_id', cwe_id)}\n"
            f"Exploitable: {cwe.get('is_vulnerable', False)}\n"
            f"Description: {cwe.get('description', 'N/A')}\n"
            f"Quantum Threat Mechanism: {threat}\n"
            f"Recommended Post-Quantum Upgrade: {remediation}\n"
            f"Expert Reasoning: {res.get('reasoning', '')}\n"
        )

    def generate_pqc_remediation(self, code: str, target_pqc: str = "ML-KEM-768", language: str = "python") -> Dict[str, Any]:
        """Provide drop-in quantum-safe code remediation recommendations."""
        res = self.predict(code, language=language)
        return {
            "original_algo": res.get("level_2_algorithm"),
            "quantum_risk": res.get("level_3_quantum_risk"),
            "target_pqc": target_pqc,
            "nist_standard": res.get("pqc_remediation", {}).get("nist_standard"),
            "urgency": res.get("pqc_remediation", {}).get("urgency"),
            "replacement_strategy": res.get("pqc_remediation", {}).get("rationale")
        }


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Model 7: ECDAT LoRA Inference")
    parser.add_argument("--model-dir", type=str, default=None, help="Path to LoRA adapter")
    parser.add_argument("--no-4bit", action="store_true", help="Disable 4-bit quantization")
    args = parser.parse_args()

    model = ECDATLoRAInference(
        model_dir=args.model_dir,
        use_4bit=not args.no_4bit,
    )

    # Test cases
    test_cases = [
        ("ecdat/classification/classifier.py", "python"),
        ("ecdat/scanners/binary_scanner.py", "python"),
        ("ecdat/classification/knowledge_base/data/crypto_api_kb_all.csv", "csv"),
    ]

    print("\n" + "=" * 80)
    print("MODEL 7 (ECDAT LoRA) -- INFERENCE TEST")
    print("=" * 80)

    for source_path, lang in test_cases:
        print(f"\n--- Source: {source_path} ---")
        result = model.continue_file(source_path, language=lang, max_new_tokens=256)
        print(result[:400])
        print("=" * 80)
