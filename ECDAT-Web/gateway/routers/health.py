"""Health probes + aggregated health (Class A/B/C reachability)."""
import httpx
from fastapi import APIRouter

from ..config import config

router = APIRouter(tags=["health"])


@router.get("/healthz")
async def healthz():
    return {"status": "healthy", "service": "ecdat-gateway"}


@router.get("/readyz")
async def readyz():
    return {"status": "ready", "service": "ecdat-gateway"}


@router.get("/api/v1/health")
async def health():
    out: dict = {"gateway": "healthy", "services": {}}
    for name, url in (("class-a-cpu", config.CLASS_A_URL),
                      ("class-b-gpu", config.CLASS_B_URL),
                      ("class-c-stateful", config.CLASS_C_URL),
                      ("class-e-ml", config.CLASS_E_URL)):
        try:
            async with httpx.AsyncClient(timeout=3) as c:
                r = await c.get(f"{url.rstrip('/')}/healthz")
                out["services"][name] = {"url": url, "status": r.status_code}
        except Exception as e:
            out["services"][name] = {"url": url, "status": "unreachable",
                                     "fallback": "standalone-heuristics", "error": str(e)[:120]}
    return out
