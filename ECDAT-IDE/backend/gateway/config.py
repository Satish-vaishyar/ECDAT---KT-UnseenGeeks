"""Gateway configuration — env driven, standalone-friendly."""
import os
from pathlib import Path


def _load_local_env() -> None:
    """Load the ignored project .env for direct local starts.

    Container deployments receive the same values from docker-compose. This
    small stdlib loader keeps `python -m uvicorn ...` consistent without
    adding a runtime dependency or overriding already-exported variables.
    """
    env_file = Path(__file__).resolve().parents[1] / ".env"
    if not env_file.is_file():
        return
    try:
        for raw_line in env_file.read_text(encoding="utf-8").splitlines():
            line = raw_line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            key, value = key.strip(), value.strip()
            if key and key not in os.environ:
                os.environ[key] = value.strip("'\"")
    except OSError:
        # Environment loading is optional; normal deployment variables remain
        # authoritative if the local file cannot be read.
        return


_load_local_env()


class Config:
    HOST: str = os.getenv("GATEWAY_HOST", "0.0.0.0")
    PORT: int = int(os.getenv("GATEWAY_PORT", "8000"))

    # Downstream dockerised services (Class A/B/C). Empty/unreachable -> heuristic fallback.
    CLASS_A_URL: str = os.getenv("CLASS_A_URL", "http://localhost:8080")
    CLASS_B_URL: str = os.getenv("CLASS_B_URL", "http://localhost:8082")
    CLASS_C_URL: str = os.getenv("CLASS_C_URL", "http://localhost:8081")
    CLASS_E_URL: str = os.getenv("CLASS_E_URL", "http://localhost:8083")

    STANDALONE_FALLBACK: bool = os.getenv("STANDALONE_FALLBACK", "true").lower() == "true"
    DOWNSTREAM_TIMEOUT_S: float = float(os.getenv("DOWNSTREAM_TIMEOUT_S", "15"))

    # Security / limits
    API_KEYS: set[str] = set(
        k.strip() for k in os.getenv("GATEWAY_API_KEYS", "").split(",") if k.strip()
    )
    ENABLE_RATE_LIMIT: bool = os.getenv("ENABLE_RATE_LIMIT", "true").lower() == "true"
    RATE_LIMIT_PER_MINUTE: int = int(os.getenv("RATE_LIMIT_PER_MINUTE", "120"))

    # CORS
    CORS_ORIGINS: list[str] = [
        o.strip() for o in os.getenv("CORS_ORIGINS", "*").split(",")
    ]

    # Laptop Low-VRAM Resource Profile (Intel Core 5 210H, 16GB RAM, RTX 3050 4GB VRAM)
    HARDWARE_PROFILE: str = os.getenv("ECDAT_HARDWARE_PROFILE", "laptop_3050_4gb")
    VRAM_BUDGET_GB: float = float(os.getenv("ECDAT_VRAM_BUDGET_GB", "3.2"))
    MAX_CONCURRENT_GPU_MODELS: int = 1
    FORCE_SEQUENTIAL_EXECUTION: bool = True
    PREFER_CPU_FOR_LIGHTWEIGHT: bool = True
    MIN_VRAM_HEADROOM_MB: float = 400.0


config = Config()
