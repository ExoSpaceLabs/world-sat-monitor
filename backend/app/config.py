from __future__ import annotations

from dataclasses import dataclass
import os


def _as_bool(name: str, default: bool) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


@dataclass(frozen=True)
class Settings:
    database_url: str = os.getenv(
        "DATABASE_URL",
        "postgresql://worldsat:worldsat@db:5432/worldsat",
    )
    mock_seed_enabled: bool = _as_bool("MOCK_SEED_ENABLED", True)
    mock_history_hours: int = int(os.getenv("MOCK_HISTORY_HOURS", "3"))
    mock_prediction_hours: int = int(os.getenv("MOCK_PREDICTION_HOURS", "48"))
    mock_step_seconds: int = int(os.getenv("MOCK_STEP_SECONDS", "10"))


settings = Settings()
