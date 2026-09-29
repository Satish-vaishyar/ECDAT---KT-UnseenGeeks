"""Lazy runtime bridge for the model artifacts shipped in ``all_models``.

The gateway and sequential audit share this module so artifact-backed results
are reported consistently. Imports and weight loading are deliberately lazy:
an unavailable optional dependency must not prevent the API from starting.
"""
from __future__ import annotations

import importlib.util
import os
import tempfile
from pathlib import Path
from typing import Any

from .model_artifacts import get_artifact_dir

_MODULES: dict[int, Any] = {}
_INSTANCES: dict[tuple[int, str], Any] = {}


def _module(number: int) -> Any:
    if number not in _MODULES:
        path = get_artifact_dir(number) / "loader.py"
        if not path.is_file():
            raise FileNotFoundError(f"Model {number:02d} loader not found: {path}")
        spec = importlib.util.spec_from_file_location(f"ecdat_all_model_{number:02d}", path)
        if spec is None or spec.loader is None:
            raise ImportError(f"Cannot load model {number:02d} loader")
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        _MODULES[number] = module
    return _MODULES[number]


def _instance(number: int, key: str, factory):
    cache_key = (number, key)
    if cache_key not in _INSTANCES:
        _INSTANCES[cache_key] = factory(_module(number))
    return _INSTANCES[cache_key]


def model_available(number: int) -> bool:
    return (get_artifact_dir(number) / "loader.py").is_file()


def model01_classify(signals: list[float]) -> tuple[float, str]:
    loader = _instance(1, "cryptonet", lambda m: m.CryptoNet(get_artifact_dir(1), use_rl=False))
    return loader.classify(signals)


def model02_binary(raw: bytes) -> dict[str, Any]:
    """Run Model 02 on bytes using its own feature extractor."""
    module = _module(2)
    loader = _instance(2, "cnn", lambda m: m.BinCryptoCNNLoader(get_artifact_dir(2)))
    suffix = ".exe" if raw[:2] == b"MZ" else ".bin"
    fd, path = tempfile.mkstemp(suffix=suffix)
    try:
        with os.fdopen(fd, "wb") as f:
            f.write(raw)
        result = loader.predict_file(path)
        result["input_quality"] = "extractor_backed"
        result["weights_caveat"] = "real-ready checkpoint was trained on a mixed real plus regenerated-placeholder dataset; validate per-class real-binary performance before production decisions"
        result["input_normalization"] = "train_mean_std"
        result["prediction_conflict"] = bool(
            result.get("class") == "No_Crypto_Pattern"
            and (result.get("crypto_hits", 0) > 0 or result.get("detected_families"))
        )
        result["decision_quality"] = "review_required" if result["prediction_conflict"] else "model_only"
        return result
    finally:
        try:
            os.unlink(path)
        except OSError:
            pass


def model03_entropy(text: str, variable_name: str = "unknown", file_type: str = ".py") -> dict[str, Any]:
    loader = _instance(3, "entropy", lambda m: m.EntropyGuardV3(get_artifact_dir(3)))
    return loader.classify(text, variable_name, file_type)


def model05_robust(features: list[float], return_icnn: bool = False) -> dict[str, Any]:
    loader = _instance(5, "robust", lambda m: m.CryptoRobust(get_artifact_dir(5)))
    return loader.predict(features, return_icnn=return_icnn)


def model13_rag(query: str, top_k: int = 10, method: str = "hybrid") -> list[dict[str, Any]]:
    loader = _instance(13, "rag", lambda m: m.RAGPipeline(get_artifact_dir(13)))
    return loader.query(query, top_k=max(1, min(top_k, 50)), method=method)


def model20_quantum_cost(algorithm: str, key_size: int | None = None) -> Any:
    module = _module(20)
    return module.calculate_quantum_cost(algorithm, key_size or 2048, include_mosca=True)


def model21_crypto_api(api_name: str, language: str = "python") -> dict[str, Any]:
    loader = _instance(21, "api", lambda m: m.CryptoAPIKB(get_artifact_dir(21)))
    return loader.classify_api(api_name, language)


def model24_compliance(features: dict[str, Any] | list[float]) -> tuple[str, list[float]]:
    if isinstance(features, list) and len(features) != 43:
        raise ValueError(f"Model 24 requires exactly 43 features, got {len(features)}")
    loader = _instance(24, "compliance", lambda m: m.ComplianceClassifier(get_artifact_dir(24)))
    return loader.predict(features)


def model27_forecast(history: list[Any], algorithm: str = "unknown") -> dict[str, Any]:
    """Build the canonical 90x30 feature window and run Model 27.

    ``history`` accepts legacy numeric QARS values or records containing
    ``date``, ``qars``, and optional CVE fields. Numeric histories are assigned
    consecutive dates for backward compatibility, while all 30 derived
    features are still computed by the vendored canonical builder.
    """
    import datetime as dt
    import pandas as pd
    module = _module(27)
    window_path = get_artifact_dir(27) / "build_window.py"
    window_spec = importlib.util.spec_from_file_location("ecdat_all_model_27_window", window_path)
    if window_spec is None or window_spec.loader is None:
        raise ImportError(f"Cannot load Model 27 window builder: {window_path}")
    window_module = importlib.util.module_from_spec(window_spec)
    window_spec.loader.exec_module(window_module)
    loader = _instance(27, "temporal", lambda m: m.TemporalRisk(get_artifact_dir(27)))
    aliases = {"RSA": "RSA-2048", "ECDSA": "ECC-P256", "ECDH": "ECC-P256",
               "AES": "AES-256", "SHA1": "SHA-1"}
    algorithm = aliases.get(str(algorithm).upper(), algorithm)
    known = set(window_module.REF["algorithms"])
    if algorithm not in known:
        raise ValueError(f"unknown Model 27 algorithm {algorithm!r}; expected one of {sorted(known)}")
    if not history:
        raise ValueError("Model 27 requires at least 90 history points")
    if isinstance(history[0], dict):
        rows = list(history)
    else:
        rows = [{"date": dt.date.today() - dt.timedelta(days=len(history) - i - 1),
                 "qars": value} for i, value in enumerate(history)]
    frame = pd.DataFrame(rows)
    if "date" not in frame or "qars" not in frame:
        raise ValueError("Model 27 history records require date and qars")
    if len(frame) < 90:
        raise ValueError(f"Model 27 requires at least 90 history rows, got {len(frame)}")
    window = window_module.build_window(algorithm, frame)
    result = loader.predict_risk(window)
    result["algorithm"] = algorithm
    result["input_quality"] = "canonical_feature_window"
    return result


def model28_cost(**features: Any) -> dict[str, Any]:
    required = ("finding_id", "primitive_family", "key_size_bits", "target_pqc_primitive",
                "deployment_tier", "cwe_misuse_flags", "crypto_loc", "call_site_count")
    missing = [name for name in required if name not in features]
    if missing:
        raise ValueError(f"Model 28 missing required fields: {', '.join(missing)}")
    return _module(28).predict_mitigation_cost(**features)


# The remaining local models expose small, model-specific inference APIs.  Keep
# these adapters here so gateway routes do not import model folders directly.
def model06_misuse(code: str, language: str = "python") -> dict[str, Any]:
    return _module(6).predict(code, language)


def model04_classify(code: str, language: str = "python") -> dict[str, Any]:
    return _module(4).predict(code, language)


def _model_backend(number: int) -> str:
    override = os.environ.get(f"ECDAT_MODEL{number:02d}_BACKEND",
                              os.environ.get(f"MODEL{number}_BACKEND"))
    if override:
        return override
    if number in (8, 9, 10, 11) and os.environ.get("NVIDIA_API_KEY"):
        return "nvidia"
    if number == 8 and os.environ.get("FEATHERLESS_API_KEY"):
        return "featherless"
    if number in (8, 9, 10, 11) and os.environ.get("GROQ_API_KEY"):
        return "groq"
    # "auto": local Ollama if a matching model is installed, else API key,
    # else offline simulation. Same offline behaviour, zero-config live LLM.
    return os.environ.get(f"ECDAT_MODEL{number:02d}_BACKEND", "auto")


def model07_reason(code: str, language: str = "python") -> dict[str, Any]:
    return _module(7).predict(code, language, backend=_model_backend(7))


def model08_reason(code: str, language: str = "python") -> dict[str, Any]:
    return _module(8).predict(code, language, backend=_model_backend(8))


def model09_reason(code: str, language: str = "python") -> dict[str, Any]:
    return _module(9).predict(code, language, backend=_model_backend(9))


def model10_reason(code: str, language: str = "python") -> dict[str, Any]:
    return _module(10).predict(code, language, backend=_model_backend(10))


def model11_reason(code: str, language: str = "python", complexity: int = 5) -> dict[str, Any]:
    # Keep Model 11 consistent with Models 08-10: use Groq when configured,
    # while retaining the deterministic fallback when no provider key exists.
    backend = os.environ.get(
        "ECDAT_MODEL11_BACKEND",
        os.environ.get("MODEL11_BACKEND", _model_backend(11)),
    )
    return _module(11).predict(code, language, complexity=complexity, backend=backend)


def model_reason_stream(number: int, messages: list[dict[str, str]],
                        temperature: float = 0.0, max_tokens: int = 1024):
    """Yield assistant text for chat messages for models 07-11.

    Loaders with chat_stream (08-11) stream tokens when live; anything else
    yields its predict() output in chunks so callers see one interface.
    """
    module = _module(number)
    if number == 11:
        backend = os.environ.get(
            "ECDAT_MODEL11_BACKEND",
            os.environ.get("MODEL11_BACKEND", _model_backend(11)),
        )
    else:
        backend = _model_backend(number)
    fn = getattr(module, "chat_stream", None)
    if fn is not None:
        yield from fn(messages, temperature, max_tokens, backend=backend)
        return
    import json as _json
    prompt = "\n".join(str(m.get("content", "")) for m in messages)
    out = module.predict(prompt, "python", backend=backend)
    text = _json.dumps(out, default=str)
    for i in range(0, len(text), 120):
        yield text[i:i + 120]


def model12_migration(algorithm: str) -> Any:
    configured = os.environ.get("ECDAT_MODEL12_DATASET_DIR")
    bundled = get_artifact_dir(12) / "CDKG"
    dataset_dir = configured or (str(bundled) if bundled.is_dir() else None)
    return _module(12).predict(algorithm, dataset_dir=dataset_dir)


def model12_recommend(organization: dict[str, Any]) -> Any:
    configured = os.environ.get("ECDAT_MODEL12_DATASET_DIR")
    bundled = get_artifact_dir(12) / "CDKG"
    dataset_dir = configured or (str(bundled) if bundled.is_dir() else None)
    return _module(12).recommend(organization, dataset_dir=dataset_dir)


def model14_search(query: str, top_k: int = 10) -> Any:
    return _module(14).predict(query, top_k=top_k)


def model15_search(query: str, top_k: int = 10) -> Any:
    return _module(15).predict(query, n_results=top_k)


def model16_search(query: str, top_k: int = 10) -> Any:
    return _module(16).predict(query, top_k=top_k)


def model17_trust(source_name: str, publication_date: Any = None,
                  corroboration_count: int = 1, conflict_count: int = 0) -> dict[str, Any]:
    return _module(17).predict(source_name, publication_date=publication_date,
                                corroboration_count=corroboration_count,
                                conflict_count=conflict_count)


def model18_temporal(algorithm_id: str, as_of_date: str | None = None) -> Any:
    """Run Model 18 against the bundled temporal graph dataset."""
    configured = os.environ.get("ECDAT_MODEL18_DATASET_DIR")
    bundled = get_artifact_dir(18) / "TKG"
    dataset_dir = configured or (str(bundled) if bundled.is_dir() else None)
    if as_of_date:
        return _module(18).temporal_state(algorithm_id, as_of_date,
                                          dataset_dir=dataset_dir)
    return _module(18).predict(algorithm_id, dataset_dir=dataset_dir)


def model19_risk(algorithm_name: str) -> Any:
    return _module(19).predict(algorithm_name)


def model22_rerank(query: str, candidates: list[dict[str, Any]], top_k: int = 10) -> Any:
    return _module(22).rerank(query, candidates, top_k=top_k)


def model22_search(query: str, top_k: int = 10) -> Any:
    try:
        return _module(22).predict(query, top_k=top_k, use_rl=True)
    except (ImportError, ModuleNotFoundError):
        # torch-free installs: plain CVE search without the RL rerank pass.
        return _module(22).predict(query, top_k=top_k, use_rl=False)


def model23_trapdoor(code_snippet: str = "", algorithm: str = "",
                     fingerprint: str = "") -> dict[str, Any]:
    return _module(23).predict(code_snippet=code_snippet, algorithm=algorithm,
                                fingerprint=fingerprint)


def model25_qars(algorithm: str, context: Any = None) -> Any:
    return _module(25).predict(algorithm, context=context)


def model26_simulation(iterations: int = 10000, seed: int = 12345) -> dict[str, Any]:
    estimate = _module(26).predict(iterations=iterations, seed=seed)
    return estimate.to_dict() if hasattr(estimate, "to_dict") else estimate


def model29_redteam(features: list[float]) -> dict[str, Any]:
    return _module(29).predict(features)
