"""Frozen backend entry: serves the QIROVA gateway without venv/python/pip.

Working directory must be the backend/ install dir (.env, all_models/,
data/ resolve relative to it; ECDAT_ALL_MODELS_DIR may override).
"""
import os
import sys

if getattr(sys, "frozen", False):
    # PyInstaller onefile/onedir temp root is already on sys.path;
    # make sure bundled packages win over any stray site-packages.
    pass

import uvicorn  # noqa: E402

from gateway.main import app  # noqa: E402


def main():
    # use_colors=False: windowed (noconsole) exe launched without stdio
    # has sys.stdout=None; uvicorn's colour probe would crash logging setup.
    uvicorn.run(app, host="127.0.0.1", port=8000, log_level="info", use_colors=False)


if __name__ == "__main__":
    main()
