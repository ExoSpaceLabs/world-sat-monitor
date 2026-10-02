from __future__ import annotations

from .config import settings
from .orbital_provider import (
    CelesTrakProvider,
    MockOrbitalDataProvider,
    OrbitalDataProvider,
    ProviderError,
)
from .provider_policy import normalize_provider_name


def provider_descriptors() -> tuple[dict[str, object], ...]:
    return (
        {
            "name": "mock",
            "enabled": True,
            "kind": "synthetic",
            "supports_single_fetch": True,
            "supports_group_fetch": False,
            "supports_catalog": False,
        },
        {
            "name": "celestrak",
            "enabled": settings.celestrak_enabled,
            "kind": "external",
            "supports_single_fetch": True,
            "supports_group_fetch": True,
            "supports_catalog": True,
        },
    )


def registered_provider_names() -> tuple[str, ...]:
    return tuple(str(descriptor["name"]) for descriptor in provider_descriptors())


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
