"""Unit tests for the NVIDIA NIM client (mocked HTTP, no network)."""
import io
import json
import sys
import urllib.error

import pytest

from src.ecdat.core import nvidia_client as nv


@pytest.fixture(autouse=True)
def _no_cffi(monkeypatch):
    # Force the urllib transport so tests never touch the network.
    monkeypatch.setitem(sys.modules, "curl_cffi", None)


class _Resp:
    def __init__(self, status=200, body=None):
        self.status = status
        self._body = body if body is not None else {"choices": [{"message": {"content": '{"a": 1}'}}]}

    def read(self):
        return json.dumps(self._body).encode("utf-8")

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


def _patch(monkeypatch, handler):
    monkeypatch.setattr(nv.urllib.request, "urlopen", handler)


def test_no_keys_returns_none(monkeypatch):
    monkeypatch.delenv("NVIDIA_API_KEY", raising=False)
    assert nv.request_json({"model": "m"}) is None
    assert nv.nvidia_key_count() == 0
    assert nv.chat_json("s", "u") is None


def test_success_returns_body_and_counts_keys(monkeypatch):
    monkeypatch.setenv("NVIDIA_API_KEY", "k1, k2")
    _patch(monkeypatch, lambda req, timeout=None: _Resp(200))
    body = nv.request_json({"model": "m"}, timeout=5)
    assert body["choices"][0]["message"]["content"] == '{"a": 1}'
    assert nv.nvidia_key_count() == 2


def test_rotates_past_rate_limited_key(monkeypatch):
    monkeypatch.setenv("NVIDIA_API_KEY", "bad, good")
    calls = []

    def handler(req, timeout=None):
        calls.append(req.headers.get("Authorization"))
        if len(calls) == 1:
            raise urllib.error.HTTPError(req.full_url, 429, "slow", {}, io.BytesIO(b""))
        return _Resp(200)

    _patch(monkeypatch, handler)
    body = nv.request_json({"model": "m"})
    assert body is not None
    assert calls == ["Bearer bad", "Bearer good"]


def test_non_retryable_http_error_returns_none(monkeypatch):
    monkeypatch.setenv("NVIDIA_API_KEY", "k1")

    def handler(req, timeout=None):
        raise urllib.error.HTTPError(req.full_url, 500, "boom", {}, io.BytesIO(b""))

    _patch(monkeypatch, handler)
    assert nv.request_json({"model": "m"}) is None


def test_connection_error_returns_none(monkeypatch):
    monkeypatch.setenv("NVIDIA_API_KEY", "k1")
    _patch(monkeypatch, lambda req, timeout=None: (_ for _ in ()).throw(ConnectionError("down")))
    assert nv.request_json({"model": "m"}) is None


def test_chat_json_parses_and_strips_fences(monkeypatch):
    monkeypatch.setenv("NVIDIA_API_KEY", "k1")
    fenced = _Resp(200, {"choices": [{"message": {"content": '```json\n{"a": 2}\n```'}}]})
    _patch(monkeypatch, lambda req, timeout=None: fenced)
    assert nv.chat_json("sys", "usr") == {"a": 2}


def test_chat_json_list_content_joined(monkeypatch):
    monkeypatch.setenv("NVIDIA_API_KEY", "k1")
    listed = _Resp(200, {"choices": [{"message": {"content": [{"text": '{"b": '}, {"text": '3}'}]}}]})
    _patch(monkeypatch, lambda req, timeout=None: listed)
    assert nv.chat_json("sys", "usr") == {"b": 3}


def test_chat_json_non_dict_or_garbage_returns_none(monkeypatch):
    monkeypatch.setenv("NVIDIA_API_KEY", "k1")
    _patch(monkeypatch, lambda req, timeout=None: _Resp(200, {"choices": [{"message": {"content": "[1,2]"}}]}))
    assert nv.chat_json("sys", "usr") is None
    _patch(monkeypatch, lambda req, timeout=None: _Resp(200, {"choices": [{"message": {"content": "nope"}}]}))
    assert nv.chat_json("sys", "usr") is None


class _CffiResp:
    def __init__(self, status_code=200, body=None):
        self.status_code = status_code
        self._body = body if body is not None else {"ok": True}

    def json(self):
        if isinstance(self._body, Exception):
            raise self._body
        return self._body

    def close(self):
        pass


def _with_cffi(monkeypatch, handler):
    import types
    calls = []

    def fake_post(url, **kw):
        calls.append((url, kw))
        return handler(url, kw)

    fake_requests = types.SimpleNamespace(post=fake_post)
    fake_mod = types.SimpleNamespace(requests=fake_requests)
    monkeypatch.delitem(sys.modules, "curl_cffi", raising=False)
    monkeypatch.setitem(sys.modules, "curl_cffi", fake_mod)
    return calls


def test_cffi_transport_success_and_rotation(monkeypatch):
    monkeypatch.setenv("NVIDIA_API_KEY", "bad, good")
    seen = []

    def handler(url, kw):
        auth = kw["headers"]["Authorization"]
        seen.append(auth)
        if len(seen) == 1:
            return _CffiResp(429, {})
        return _CffiResp(200, {"choices": [{"message": {"content": '{"a": 9}'}}]})

    _with_cffi(monkeypatch, handler)
    body = nv.request_json({"model": "m"})
    assert body["choices"][0]["message"]["content"] == '{"a": 9}'
    assert seen == ["Bearer bad", "Bearer good"]


def test_cffi_transport_failure_modes(monkeypatch):
    monkeypatch.setenv("NVIDIA_API_KEY", "k1")
    _with_cffi(monkeypatch, lambda url, kw: _CffiResp(500, {}))
    assert nv.request_json({"model": "m"}) is None

    def boom(url, kw):
        raise ConnectionError("down")

    _with_cffi(monkeypatch, boom)
    assert nv.request_json({"model": "m"}) is None
    _with_cffi(monkeypatch, lambda url, kw: _CffiResp(200, "not-json"))
    assert nv.chat_json("sys", "usr") is None
