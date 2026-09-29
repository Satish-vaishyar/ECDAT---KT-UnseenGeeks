import pytest
from pathlib import Path

from src.ecdat.core.all_models_runtime import (
    model01_classify,
    model02_binary,
    model05_robust,
    model13_rag,
    model24_compliance,
    model27_forecast,
)


def test_model01_uses_loader_contract():
    probability, label = model01_classify([1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0])
    assert 0.0 <= probability <= 1.0
    assert label in {"DEFINITIVE", "HIGH", "MEDIUM", "LOW", "NOISE"}


def test_model02_binary_result_includes_quality_warning():
    result = model02_binary(b"MZ" + bytes(2048))
    assert result["input_quality"] == "extractor_backed"
    assert "mixed real plus regenerated-placeholder" in result["weights_caveat"]
    assert result["input_normalization"] == "train_mean_std"


def test_model02_surfaces_extractor_classifier_conflict():
    raw = Path("data/demo_test_suite/vulnerable_crypto_app.exe").read_bytes()
    result = model02_binary(raw)
    assert result["crypto_hits"] > 0
    assert result["prediction_conflict"] is True
    assert result["decision_quality"] == "review_required"
    assert 0.0 <= result["probability"] <= 1.0


def test_model05_rejects_wrong_feature_width():
    with pytest.raises(ValueError, match="1562"):
        model05_robust([0.0] * 10)


def test_model13_returns_ranked_documents():
    documents = model13_rag("RSA quantum migration", top_k=2)
    assert documents
    assert all("content" in document and "retrieval_score" in document for document in documents)


def test_model24_rejects_wrong_vector_width():
    with pytest.raises(ValueError, match="43"):
        model24_compliance([0.0] * 42)


def test_model27_uses_canonical_feature_window():
    result = model27_forecast([50.0] * 90, "RSA-2048")
    assert result["input_quality"] == "canonical_feature_window"
    assert result["horizon_days"] == 30
    assert len(result["qars_forecast"]) == 30
