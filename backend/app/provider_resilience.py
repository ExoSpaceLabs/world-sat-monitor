from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Mapping


def retry_delay_seconds(
    consecutive_failures: int,
    *,
    base_seconds: int,
    max_seconds: int,
) -> int:
    base = max(1, int(base_seconds))
    maximum = max(base, int(max_seconds))
    failures = max(0, int(consecutive_failures))
    return min(maximum, base * (2 ** min(failures, 30)))


def retry_blocked(state: Mapping[str, Any] | None, now: datetime | None = None) -> bool:
    if not state:
        return False
    retry_at = state.get("next_retry_at")
    if retry_at is None:
        return False
    current = (now or datetime.now(timezone.utc)).astimezone(timezone.utc)
    if retry_at.tzinfo is None:
        retry_at = retry_at.replace(tzinfo=timezone.utc)
    return retry_at.astimezone(timezone.utc) > current


def provider_health(state: Mapping[str, Any] | None, now: datetime | None = None) -> str:
    if not state:
        return "unknown"
    if retry_blocked(state, now):
        return "backoff"
    if int(state.get("consecutive_failures") or 0) > 0 or state.get("last_error"):
        return "degraded"
    if state.get("last_success_at") is not None:
        return "healthy"
    return "unknown"


def source_freshness(
    epoch: datetime | None,
    now: datetime | None,
    refresh_seconds: int,
) -> tuple[int | None, str]:
    if epoch is None:
        return None, "unknown"
    current = (now or datetime.now(timezone.utc)).astimezone(timezone.utc)
    normalized_epoch = epoch
    if normalized_epoch.tzinfo is None:
        normalized_epoch = normalized_epoch.replace(tzinfo=timezone.utc)
    normalized_epoch = normalized_epoch.astimezone(timezone.utc)
    age_seconds = max(0, int((current - normalized_epoch).total_seconds()))
    refresh = max(1, int(refresh_seconds))
    if age_seconds <= refresh * 2:
        freshness = "fresh"
    elif age_seconds <= max(refresh * 6, 24 * 3600):
        freshness = "aging"
    else:
        freshness = "stale"
    return age_seconds, freshness
