"""Pytest bootstrap: deterministic offline test environment.

Disables the gateway sliding-window rate limiter — the full suite issues
hundreds of TestClient requests from one client IP and would otherwise
trip 429s depending on timing. Must be set before gateway.config imports.
"""
import os

os.environ["ENABLE_RATE_LIMIT"] = "false"
