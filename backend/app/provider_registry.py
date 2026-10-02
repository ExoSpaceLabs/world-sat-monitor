from __future__ import annotations

from .config import settings
from .orbital_provider import (
    CelesTrakProvider,
    MockOrbitalDataProvider,
    OrbitalDataProvider,
    ProviderError,
)
from .provider_policy import normalize_provider_name


def registered_provider_names() -> tuple[str, ...]:
    return ("mock", "celestrak")


def build_orbital_provider(name: str) -> OrbitalDataProvider:
    provider = normalize_provider_name(name)
    if provider == "mock":
        return MockOrbitalDataProvider()
    if provider == "celestrak":
        if not settings.celestrak_enabled:
            raise ProviderError("CelesTrak provider is disabled")
        return CelesTrakProvider(
            settings.celestrak_base_url,
            timeout_seconds=settings.celestrak_timeout_seconds,
            request_attempts=settings.celestrak_request_attempts,
            retry_delay_seconds=settings.celestrak_retry_delay_seconds,
        )
    raise ProviderError(f"unsupported orbital provider: {provider}")
