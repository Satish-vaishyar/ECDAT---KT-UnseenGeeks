"""Gateway configuration — env driven, standalone-friendly."""
import os


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


config = Config()
