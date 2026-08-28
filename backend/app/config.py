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
    app_settings_path: str = os.getenv(
        "APP_SETTINGS_PATH",
        "/data/settings.json",
    )
    mock_seed_enabled: bool = _as_bool("MOCK_SEED_ENABLED", True)

    provider_poll_seconds: float = float(os.getenv("PROVIDER_POLL_SECONDS", "5"))
    provider_refresh_seconds: int = int(os.getenv("PROVIDER_REFRESH_SECONDS", "7200"))
    celestrak_enabled: bool = _as_bool("CELESTRAK_ENABLED", True)
    celestrak_base_url: str = os.getenv(
        "CELESTRAK_BASE_URL",
        "https://celestrak.org/NORAD/elements/gp.php",
    )
    celestrak_catalog_url: str = os.getenv(
        "CELESTRAK_CATALOG_URL",
        "https://celestrak.org/satcat/records.php",
    )
    celestrak_timeout_seconds: float = float(os.getenv("CELESTRAK_TIMEOUT_SECONDS", "15"))
    provider_health_port: int = int(os.getenv("PROVIDER_HEALTH_PORT", "8010"))

    propagator_poll_seconds: float = float(os.getenv("PROPAGATOR_POLL_SECONDS", "2"))
    propagator_health_port: int = int(os.getenv("PROPAGATOR_HEALTH_PORT", "8011"))
    propagation_history_hours: int = int(os.getenv("PROPAGATION_HISTORY_HOURS", "48"))
    propagation_horizon_days: int = int(os.getenv("PROPAGATION_HORIZON_DAYS", "14"))
    propagation_step_seconds: int = int(os.getenv("PROPAGATION_STEP_SECONDS", "60"))


settings = Settings()
