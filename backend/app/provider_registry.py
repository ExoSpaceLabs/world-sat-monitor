from __future__ import annotations

from functools import lru_cache

from .config import settings
from .orbital_provider import (
    CelesTrakProvider,
    MockOrbitalDataProvider,
    OrbitalDataProvider,
    ProviderError,
)
from .provider_policy import normalize_provider_name
from .space_track import SpaceTrackProvider


@lru_cache(maxsize=1)
def _shared_spacetrack_provider() -> SpaceTrackProvider:
    # One authenticated session, cache and request budget per orbital-provider process.
    return SpaceTrackProvider(
        settings.spacetrack_identity,
        settings.spacetrack_password,
        base_url=settings.spacetrack_base_url,
        timeout_seconds=settings.spacetrack_timeout_seconds,
        batch_size=settings.spacetrack_batch_size,
        refresh_seconds=settings.spacetrack_refresh_seconds,
    )


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
        {
            "name": "spacetrack",
            "enabled": settings.spacetrack_enabled,
            "kind": "external",
            "supports_single_fetch": True,
            "supports_group_fetch": False,
            "supports_catalog": False,
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
    if provider == "spacetrack":
        if not settings.spacetrack_enabled:
            raise ProviderError("Space-Track provider is disabled")
        return _shared_spacetrack_provider()
    raise ProviderError(f"unsupported orbital provider: {provider}")
