"""API-key auth + sliding-window rate limit + latency/audit logging."""
import json
import time
from collections import defaultdict, deque

from fastapi import Request
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware

from .config import config

_hits: dict[str, deque] = defaultdict(deque)
EXEMPT = {"/", "/healthz", "/readyz", "/docs", "/openapi.json", "/api/v1/health"}


class GatewayMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        start = time.perf_counter()
        if request.url.path not in EXEMPT:
            if config.API_KEYS:
                key = request.headers.get("x-api-key") or request.headers.get(
                    "authorization", ""
                ).replace("Bearer ", "")
                if key not in config.API_KEYS:
                    return JSONResponse({"detail": "Invalid API key"}, status_code=401)
            if config.ENABLE_RATE_LIMIT:
                now = time.time()
                ip = request.client.host if request.client else "anon"
                window = _hits[ip]
                while window and now - window[0] > 60:
                    window.popleft()
                if len(window) >= config.RATE_LIMIT_PER_MINUTE:
                    return JSONResponse({"detail": "Rate limit exceeded"}, status_code=429)
                window.append(now)
        resp = await call_next(request)
        ms = (time.perf_counter() - start) * 1000
        resp.headers["X-Process-Time-Ms"] = f"{ms:.1f}"
        print(
            json.dumps(
                {"method": request.method, "path": request.url.path,
                 "status": resp.status_code, "latency_ms": round(ms, 1)}
            )
        )
        return resp
