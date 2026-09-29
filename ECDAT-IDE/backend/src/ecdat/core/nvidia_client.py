"""Small OpenAI-compatible NVIDIA NIM client used by the audit pipeline."""
from __future__ import annotations

import json
import os
import re
import threading
import time
from contextvars import ContextVar
import urllib.error
import urllib.request
from typing import Any

_rotation_lock = threading.Lock()
_rotation_index = 0


_audit_deadline: ContextVar = ContextVar("qirova_audit_deadline", default=None)


def set_audit_deadline(timestamp) -> None:
    """Bound every subsequent NVIDIA key attempt to an audit-wide deadline.
    Pass None to clear. Safe to call from any thread.
    """
    _audit_deadline.set(timestamp)


def _deadline_exceeded() -> bool:
    try:
        ts = _audit_deadline.get()
    except Exception:
        return False
    return ts is not None and time.perf_counter() > ts


def _keys() -> list[str]:
    return [key.strip() for key in os.environ.get("NVIDIA_API_KEY", "").split(",") if key.strip()]


def nvidia_key_count() -> int:
    """Return the number of configured keys without exposing their values."""
    return len(_keys())


def _post_curl_cffi(url: str, payload: dict[str, Any], key: str,
                    wait: float) -> tuple[int | None, Any]:
    """POST via curl-cffi Chrome impersonation (stdlib TLS gets throttled/
    blocked by some frontends). Returns (status, parsed-or-raw-body)."""
    from curl_cffi import requests as _cr
    resp = _cr.post(url, json=payload,
                    headers={"Authorization": f"Bearer {key}", "Accept": "application/json",
                             "Content-Type": "application/json",
                             "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) QIROVA-IDE/1.0.0"},
                    impersonate="chrome", timeout=wait)
    try:
        return resp.status_code, resp.json()
    except Exception:
        return resp.status_code, resp.text


def request_json(payload: dict[str, Any], *, timeout: float | None = None) -> dict[str, Any] | None:
    """POST to NIM and rotate keys on rate-limit/auth responses."""
    global _rotation_index
    keys = _keys()
    if not keys:
        return None
    try:
        from curl_cffi import requests as _has_cffi  # noqa: F401
        use_cffi = True
    except ImportError:
        use_cffi = False
    base = os.environ.get("NVIDIA_API_BASE", "https://integrate.api.nvidia.com/v1").rstrip("/")
    wait = timeout or float(os.environ.get("NVIDIA_API_TIMEOUT", "60"))
    rotate_wait = min(wait, float(os.environ.get("NVIDIA_ROTATE_TIMEOUT", "20")))
    with _rotation_lock:
        start = _rotation_index % len(keys)
        for offset in range(len(keys)):
            if _deadline_exceeded():
                return None
            index = (start + offset) % len(keys)
            wait_key = wait if offset == 0 else rotate_wait
            if use_cffi:
                try:
                    status, body = _post_curl_cffi(
                        f"{base}/chat/completions", payload, keys[index], wait_key)
                except Exception:
                    _rotation_index = (index + 1) % len(keys)
                    continue
                if status == 200 and isinstance(body, dict):
                    _rotation_index = index
                    return body
                if status in (401, 403, 429) or (isinstance(status, int) and status >= 500):
                    _rotation_index = (index + 1) % len(keys)
                    continue
                return None
            req = urllib.request.Request(
                f"{base}/chat/completions",
                data=json.dumps(payload).encode("utf-8"),
                headers={"Authorization": f"Bearer {keys[index]}", "Accept": "application/json", "Content-Type": "application/json"},
                method="POST",
            )
            try:
                with urllib.request.urlopen(req, timeout=wait_key) as response:
                    if response.status == 200:
                        _rotation_index = index
                        return json.loads(response.read().decode("utf-8"))
            except urllib.error.HTTPError as error:
                if error.code not in (401, 403, 429) and not (isinstance(error.code, int) and error.code >= 500):
                    return None
                _rotation_index = (index + 1) % len(keys)
                continue
            except Exception:
                _rotation_index = (index + 1) % len(keys)
                continue
        return None


def _single_key(value: str | None) -> str:
    """First key of a possibly comma-separated rotation list (single key safe)."""
    return (str(value or "").split(",")[0] or "").strip()


def _headers(key: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {key}", "Accept": "application/json",
            "Content-Type": "application/json",
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) QIROVA-IDE/1.0.0"}


def post_openai(api_base: str, api_key: str, payload: dict[str, Any],
                timeout: float = 120) -> dict[str, Any] | None:
    """POST one OpenAI-compatible call (any provider); parsed JSON or None.

    curl-cffi Chrome impersonation first (stdlib TLS is throttled/blocked by
    several frontends), plain urllib fallback. Uses the first key only —
    multi-key rotation lives in request_json().
    """
    key = _single_key(api_key)
    if not key:
        return None
    url = api_base.rstrip("/") + "/chat/completions"
    try:
        from curl_cffi import requests as _cr
        resp = _cr.post(url, json=payload, headers=_headers(key),
                        impersonate="chrome", timeout=timeout)
        if resp.status_code == 200:
            return resp.json()
        return None
    except ImportError:
        pass
    except Exception:
        return None
    try:
        req = urllib.request.Request(url, data=json.dumps(payload).encode("utf-8"),
                                     headers=_headers(key), method="POST")
        with urllib.request.urlopen(req, timeout=timeout) as response:
            if response.status == 200:
                return json.loads(response.read().decode("utf-8"))
    except Exception:
        return None
    return None


def _parse_sse_delta(raw):
    line = raw.strip() if isinstance(raw, bytes) else str(raw).strip()
    if isinstance(line, str):
        line = line.encode("utf-8")
    if not line or not line.startswith(b"data:"):
        return None
    data = line[5:].strip()
    if data == b"[DONE]":
        return False
    try:
        evt = json.loads(data.decode("utf-8"))
        d = (evt.get("choices") or [{}])[0].get("delta") or {}
        return (d.get("content") or d.get("reasoning")
                or d.get("reasoning_content") or "")
    except Exception:
        return None


def _stream_one(url: str, key: str, payload: dict[str, Any], wait: float):
    """Attempt one SSE stream with a single key. Yields deltas; resolves True
    when the stream ran (or finished empty), False when the key failed early
    so the caller can rotate to the next key."""
    try:
        from curl_cffi import requests as _cr
    except ImportError:
        _cr = None
    if _cr is not None:
        resp = None
        yielded = False
        try:
            resp = _cr.post(url, json=payload, headers=_headers(key),
                            impersonate="chrome", timeout=wait, stream=True)
            if resp.status_code != 200:
                return False
            for raw in resp.iter_lines():
                delta = _parse_sse_delta(raw)
                if delta is False:
                    break
                if delta:
                    yielded = True
                    yield delta
            return True
        except Exception:
            return yielded
        finally:
            try:
                if resp is not None:
                    resp.close()
            except Exception:
                pass
    try:
        req = urllib.request.Request(url, data=json.dumps(payload).encode("utf-8"),
                                     headers=_headers(key), method="POST")
        yielded = False
        with urllib.request.urlopen(req, timeout=wait) as resp:
            while True:
                line = resp.readline()
                if not line:
                    break
                delta = _parse_sse_delta(line)
                if delta is False:
                    break
                if delta:
                    yielded = True
                    yield delta
        return True
    except Exception:
        return False


def stream_openai(api_base: str, api_key: str, payload: dict[str, Any]):
    """Yield SSE text deltas from an OpenAI-compatible stream (any provider).

    Understands content + reasoning* delta fields (reasoning models).
    Rotates through every comma-separated key until one of them streams.
    """
    keys = [k.strip() for k in str(api_key or "").split(",") if k.strip()]
    if not keys:
        return
    wait = float(os.environ.get("NVIDIA_STREAM_TIMEOUT", "20"))
    url = api_base.rstrip("/") + "/chat/completions"
    for key in keys:
        if _deadline_exceeded():
            return
        if (yield from _stream_one(url, key, payload, wait)):
            return
def chat_json(system_prompt: str, user_prompt: str, *, timeout: float | None = None) -> dict[str, Any] | None:
    if not _keys():
        return None
    model = os.environ.get("NVIDIA_MODEL", "moonshotai/kimi-k3")
    payload = {
        "model": model,
        "messages": [{"role": "system", "content": system_prompt}, {"role": "user", "content": user_prompt}],
        "max_tokens": 16384,
        "seed": 0,
        "stream": False,
        "temperature": 1,
        "reasoning_effort": "max",
        "response_format": {"type": "json_object"},
    }
    try:
        body = request_json(payload, timeout=timeout)
        if not body:
            return None
        content = body["choices"][0]["message"]["content"]
        if isinstance(content, list):
            content = "".join(str(part.get("text", "")) for part in content if isinstance(part, dict))
        text = re.sub(r"^```(?:json)?\s*|\s*```$", "", str(content).strip(), flags=re.IGNORECASE)
        parsed = json.loads(text)
        return parsed if isinstance(parsed, dict) else None
    except Exception:
        return None
