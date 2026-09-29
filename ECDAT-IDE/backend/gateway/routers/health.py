"""Health probes + aggregated health (Class A/B/C reachability)."""
import asyncio
import httpx
from fastapi import APIRouter

from ..config import config

router = APIRouter(tags=["health"])

SERVICES = (
    ("class-a-cpu", config.CLASS_A_URL),
    ("class-b-gpu", config.CLASS_B_URL),
    ("class-c-stateful", config.CLASS_C_URL),
    ("class-e-ml", config.CLASS_E_URL),
)


async def _check(name, url):
    # Liveness first: sub-second downstream probe. Docker on LAN answers in
    # milliseconds; absent services fail fast instead of stalling IDE pings.
    try:
        async with httpx.AsyncClient(timeout=0.5) as c:
            r = await c.get(f"{url.rstrip('/')}/healthz")
            return name, {"url": url, "status": r.status_code}
    except Exception as e:
        return name, {"url": url, "status": "unreachable",
                      "fallback": "standalone-heuristics", "error": str(e)[:120]}


@router.get("/healthz")
async def healthz():
    return {"status": "healthy", "service": "ecdat-gateway"}


@router.get("/readyz")
async def readyz():
    return {"status": "ready", "service": "ecdat-gateway"}


@router.get("/api/v1/health")
async def health():
    out: dict = {"gateway": "healthy", "services": {}}
    for name, info in await asyncio.gather(*[_check(n, u) for n, u in SERVICES]):
        out["services"][name] = info
    return out
