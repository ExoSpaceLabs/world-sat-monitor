from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

from psycopg.types.json import Jsonb

from .orbital_provider import NormalizedElementSet


def get_latest_element_set(connection, satellite_id: int, source: str | None = None):
    source_clause = "" if source is None else "AND source = %s"
    params: tuple[Any, ...] = (satellite_id,) if source is None else (satellite_id, source)
    return connection.execute(
        f"""
        SELECT *
        FROM orbital_element_sets
        WHERE satellite_id = %s {source_clause}
        ORDER BY fetched_at DESC, id DESC
        LIMIT 1
        """,
        params,
    ).fetchone()


def get_provider_fetch_state(connection, satellite_id: int, provider: str):
    return connection.execute(
        """
        SELECT *
        FROM provider_fetch_state
        WHERE satellite_id = %s AND provider = %s
        """,
        (satellite_id, provider),
    ).fetchone()


def insert_element_set(
    connection,
    satellite_id: int,
    element_set: NormalizedElementSet,
) -> tuple[int, bool]:
    fingerprint = element_set.fingerprint()
    row = connection.execute(
        """
        INSERT INTO orbital_element_sets (
            satellite_id, epoch, source, source_format, mean_element_theory,
            mean_motion, eccentricity, inclination_deg, ra_of_asc_node_deg,
            arg_of_pericenter_deg, mean_anomaly_deg, bstar, mean_motion_dot,
            mean_motion_ddot, element_set_no, rev_at_epoch, fingerprint, raw_payload
        )
        VALUES (
            %s, %s, %s, %s, %s,
            %s, %s, %s, %s,
            %s, %s, %s, %s,
            %s, %s, %s, %s, %s
        )
        ON CONFLICT (satellite_id, source, fingerprint)
            WHERE fingerprint IS NOT NULL
        DO NOTHING
        RETURNING id
        """,
        (
            satellite_id,
            element_set.epoch,
            element_set.source,
            element_set.source_format,
            element_set.mean_element_theory,
            element_set.mean_motion,
            element_set.eccentricity,
            element_set.inclination_deg,
            element_set.ra_of_asc_node_deg,
            element_set.arg_of_pericenter_deg,
            element_set.mean_anomaly_deg,
            element_set.bstar,
            element_set.mean_motion_dot,
            element_set.mean_motion_ddot,
            element_set.element_set_no,
            element_set.rev_at_epoch,
            fingerprint,
            Jsonb(element_set.raw_payload),
        ),
    ).fetchone()
    if row is not None:
        return int(row["id"]), True

    existing = connection.execute(
        """
        SELECT id
        FROM orbital_element_sets
        WHERE satellite_id = %s AND source = %s AND fingerprint = %s
        """,
        (satellite_id, element_set.source, fingerprint),
    ).fetchone()
    if existing is None:
        raise RuntimeError("element-set deduplication lookup failed")
    return int(existing["id"]), False


def record_provider_fetch(
    connection,
    satellite_id: int,
    provider: str,
    *,
    success: bool,
    element_set_id: int | None = None,
    error: str | None = None,
) -> None:
    connection.execute(
        """
        INSERT INTO provider_fetch_state (
            satellite_id, provider, last_attempt_at, last_success_at,
            last_error, latest_element_set_id
        )
        VALUES (%s, %s, NOW(), CASE WHEN %s THEN NOW() ELSE NULL END, %s, %s)
        ON CONFLICT (satellite_id, provider)
        DO UPDATE SET
            last_attempt_at = EXCLUDED.last_attempt_at,
            last_success_at = CASE
                WHEN %s THEN EXCLUDED.last_attempt_at
                ELSE provider_fetch_state.last_success_at
            END,
            last_error = EXCLUDED.last_error,
            latest_element_set_id = COALESCE(
                EXCLUDED.latest_element_set_id,
                provider_fetch_state.latest_element_set_id
            )
        """,
        (
            satellite_id,
            provider,
            success,
            error,
            element_set_id,
            success,
        ),
    )


def ensure_propagation_job(
    connection,
    *,
    satellite_id: int,
    element_set_id: int,
    history_hours: int,
    horizon_days: int,
    step_seconds: int,
    now: datetime | None = None,
) -> tuple[int | None, bool]:
    now = (now or datetime.now(timezone.utc)).astimezone(timezone.utc)
    existing_work = connection.execute(
        """
        SELECT id
        FROM propagation_jobs
        WHERE element_set_id = %s AND status IN ('pending', 'running')
        ORDER BY requested_at DESC
        LIMIT 1
        """,
        (element_set_id,),
    ).fetchone()
    if existing_work is not None:
        return int(existing_work["id"]), False

    minimum_future = now + timedelta(days=min(1, horizon_days))
    completed = connection.execute(
        """
        SELECT id
        FROM propagation_runs
        WHERE satellite_id = %s
          AND source_element_set_id = %s
          AND status = 'completed'
          AND start_time <= %s
          AND end_time >= %s
        ORDER BY generated_at DESC
        LIMIT 1
        """,
        (satellite_id, element_set_id, now, minimum_future),
    ).fetchone()
    if completed is not None:
        return None, False

    row = connection.execute(
        """
        INSERT INTO propagation_jobs (
            satellite_id, element_set_id, history_hours, horizon_days,
            step_seconds, status
        )
        VALUES (%s, %s, %s, %s, %s, 'pending')
        RETURNING id
        """,
        (satellite_id, element_set_id, history_hours, horizon_days, step_seconds),
    ).fetchone()
    return int(row["id"]), True


def cancel_inactive_pending_jobs(connection) -> int:
    cursor = connection.execute(
        """
        UPDATE propagation_jobs pj
        SET status = 'cancelled',
            finished_at = NOW(),
            error = 'satellite deactivated before propagation'
        FROM satellites s
        WHERE pj.satellite_id = s.id
          AND s.active = FALSE
          AND pj.status = 'pending'
        """
    )
    return cursor.rowcount


def claim_next_propagation_job(connection):
    return connection.execute(
        """
        WITH next_job AS (
            SELECT pj.id
            FROM propagation_jobs pj
            JOIN satellites s ON s.id = pj.satellite_id
            WHERE pj.status = 'pending' AND s.active = TRUE
            ORDER BY pj.requested_at, pj.id
            FOR UPDATE OF pj SKIP LOCKED
            LIMIT 1
        )
        UPDATE propagation_jobs pj
        SET status = 'running',
            started_at = NOW(),
            finished_at = NULL,
            error = NULL
        FROM next_job
        WHERE pj.id = next_job.id
        RETURNING pj.*
        """
    ).fetchone()


def load_element_set(connection, element_set_id: int):
    return connection.execute(
        "SELECT * FROM orbital_element_sets WHERE id = %s",
        (element_set_id,),
    ).fetchone()


def is_satellite_active(connection, satellite_id: int, *, lock: bool = False) -> bool:
    suffix = " FOR SHARE" if lock else ""
    row = connection.execute(
        f"SELECT active FROM satellites WHERE id = %s{suffix}",
        (satellite_id,),
    ).fetchone()
    return bool(row and row["active"])


def finish_job(connection, job_id: int, status: str, error: str | None = None) -> None:
    connection.execute(
        """
        UPDATE propagation_jobs
        SET status = %s, finished_at = NOW(), error = %s
        WHERE id = %s
        """,
        (status, error, job_id),
    )
