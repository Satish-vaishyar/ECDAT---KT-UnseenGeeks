"""ECDAT API Gateway — unified entrypoint for all dockerised models."""
__version__ = "3.0.0"

import os as _os
import socket as _socket

_orig_setsockopt = _socket.socket.setsockopt


def _guarded_setsockopt(self, level, optname, value):
    # Windows allows two processes to share one port when SO_REUSEADDR is set
    # (uvicorn sets it). Refusing it keeps exactly one server on :8000: any
    # stray re-execution fails fast with EADDRINUSE instead of silently
    # splitting traffic with the healthy instance.
    if optname == _socket.SO_REUSEADDR:
        return None
    return _orig_setsockopt(self, level, optname, value)


_socket.socket.setsockopt = _guarded_setsockopt


def _ensure_single_server():
    # Audit child workers import gateway.client for helper calls; they must
    # not be mistaken for duplicate servers (run_audit_child sets this).
    if _os.environ.get("QIROVA_ALLOW_SUBPROCESS") == "1":
        return
    # Something in this environment (security sandboxing?) occasionally
    # re-executes our exact command line as a child of the server itself.
    # A named kernel mutex makes the duplicate exit during import — before it
    # can bind :8000 or load models. The mutex auto-releases if the owner
    # dies, so restarts are unaffected. Import-time only; TestClient and
    # library use never bind, so they are unaffected.
    try:
        import ctypes
        _kern = ctypes.windll.kernel32
        handle = _kern.CreateMutexW(None, True, "Global\\QIROVA-Gateway-Server")
        already = _kern.GetLastError() == 183  # ERROR_ALREADY_EXISTS
        if already:
            raise SystemExit(0)
    except SystemExit:
        raise
    except Exception:
        pass


_ensure_single_server()
