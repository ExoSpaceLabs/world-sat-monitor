from __future__ import annotations

import re
from typing import Any, Iterable, Mapping


DEFAULT_PROVIDER = "celestrak"
MAX_PROVIDER_PRIORITY = 8
_PROVIDER_NAME = re.compile(r"^[a-z0-9][a-z0-9._-]{0,127}$")


def normalize_provider_name(value: str) -> str:
    normalized = value.strip().lower()
    if not normalized:
        raise ValueError("provider name cannot be empty")
    if not _PROVIDER_NAME.fullmatch(normalized):
        raise ValueError(f"invalid provider name: {value!r}")
    return normalized


def normalize_provider_priority(values: Iterable[str]) -> tuple[str, ...]:
    result: list[str] = []
    seen: set[str] = set()
    for value in values:
        provider = normalize_provider_name(str(value))
        if provider in seen:
            continue
        seen.add(provider)
        result.append(provider)
        if len(result) > MAX_PROVIDER_PRIORITY:
            raise ValueError(
                f"provider priority cannot contain more than {MAX_PROVIDER_PRIORITY} providers"
            )
    if not result:
        raise ValueError("provider priority cannot be empty")
    return tuple(result)


def provider_priority_for(satellite: Mapping[str, Any]) -> tuple[str, ...]:
    metadata = dict(satellite.get("metadata") or {})
    if metadata.get("mock") is True:
        return ("mock",)

    raw_priority = satellite.get("provider_priority")
    if raw_priority:
        return normalize_provider_priority(raw_priority)

    legacy = str(satellite.get("provider_preference") or "").strip()
    if legacy:
        return (normalize_provider_name(legacy),)

    return (DEFAULT_PROVIDER,)


def primary_provider_for(satellite: Mapping[str, Any]) -> str:
    return provider_priority_for(satellite)[0]
