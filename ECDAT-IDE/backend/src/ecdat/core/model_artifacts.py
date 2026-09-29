"""Runtime discovery for optional model artifacts.

Weights are evidence of availability only; a model is live only after its
compatible loader successfully runs inference.
"""
import os
from pathlib import Path
from typing import Any


PROJECT_ROOT = Path(__file__).resolve().parents[3]


def get_all_models_root() -> Path:
    configured = os.getenv("ECDAT_ALL_MODELS_DIR")
    if configured:
        return Path(configured).expanduser().resolve()
    return PROJECT_ROOT / "all_models"


def get_artifact_dir(model_number: int) -> Path:
    return get_all_models_root() / f"model_{model_number:02d}"


def inspect_artifacts() -> dict[str, Any]:
    root = get_all_models_root()
    inventory: dict[str, Any] = {
        "root": str(root),
        "root_exists": root.is_dir(),
        "models": {},
    }
    if not root.is_dir():
        return inventory

    for directory in sorted(path for path in root.iterdir() if path.is_dir()):
        files = sorted(path.name for path in directory.iterdir() if path.is_file())
        inventory["models"][directory.name] = {
            "artifact_dir": str(directory),
            "artifact_count": len(files),
            "files": files,
        }
    return inventory
