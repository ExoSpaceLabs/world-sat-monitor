from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

from .orbital_store import cancel_inactive_pending_jobs


DISPLAY_LEASE_SECONDS = 1800


def request_group_display(
    connection,
    group_id: int,
    *,
    prediction_hours: int,
    step_seconds: int,
    lease_seconds: int = DISPLAY_LEASE_SECONDS,
) -> dict[str, Any] | None:
    now = datetime.now(timezone.utc)
    row = connection.execute(
        """
        UPDATE satellite_groups
        SET display_requested_until = %s,
            display_prediction_hours = %s,
            display_step_seconds = %s,
            updated_at = NOW()
        WHERE id = %s
        RETURNING id, display_requested_until, display_prediction_hours, display_step_seconds
        """,
        (now + timedelta(seconds=lease_seconds), prediction_hours, step_seconds, group_id),
    ).fetchone()
    return row


def release_group_display(connection, group_id: int) -> bool:
    row = connection.execute(
        """
        UPDATE satellite_groups
        SET display_requested_until = NULL,
            updated_at = NOW()
        WHERE id = %s
        RETURNING id
        """,
        (group_id,),
    ).fetchone()
    if row is None:
        return False
    cancel_inactive_pending_jobs(connection)
    return True


def list_requested_groups(connection, now: datetime | None = None) -> list[dict[str, Any]]:
    at = (now or datetime.now(timezone.utc)).astimezone(timezone.utc)
    return list(
        connection.execute(
            """
            SELECT id, name, source, source_key,
                   display_requested_until, display_prediction_hours,
                   display_step_seconds, display_provider_refreshed_at,
                   display_provider_failures, display_provider_retry_at,
                   display_provider_last_error
            FROM satellite_groups
            WHERE display_requested_until IS NOT NULL
              AND display_requested_until > %s
            ORDER BY id
            """,
            (at,),
        ).fetchall()
    )


def mark_group_provider_refreshed(connection, group_id: int, at: datetime) -> None:
    connection.execute(
        """
        UPDATE satellite_groups
        SET display_provider_refreshed_at = %s,
            display_provider_failures = 0,
            display_provider_retry_at = NULL,
            display_provider_last_error = NULL
        WHERE id = %s
        """,
        (at, group_id),
    )


def mark_group_provider_failed(
    connection,
    group_id: int,
    *,
    error: str,
    retry_at: datetime,
) -> None:
    connection.execute(
        """
        UPDATE satellite_groups
        SET display_provider_failures = display_provider_failures + 1,
            display_provider_retry_at = %s,
            display_provider_last_error = %s
        WHERE id = %s
        """,
        (retry_at, error[:2000], group_id),
    )
