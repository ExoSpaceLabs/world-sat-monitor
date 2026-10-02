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
    next_retry_at: datetime | None = None,
    attempted_at: datetime | None = None,
) -> None:
    attempted_at = (attempted_at or datetime.now(timezone.utc)).astimezone(timezone.utc)
    last_success_at = attempted_at if success else None
    last_error = None if success else error
    failure_count = 0 if success else 1
    retry_at = None if success else next_retry_at
    last_error_at = None if success else attempted_at

    connection.execute(
        """
        INSERT INTO provider_fetch_state (
            satellite_id, provider, last_attempt_at, last_success_at,
            last_error, latest_element_set_id, consecutive_failures,
            next_retry_at, last_error_at
        )
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
        ON CONFLICT (satellite_id, provider)
        DO UPDATE SET
            last_attempt_at = EXCLUDED.last_attempt_at,
            last_success_at = COALESCE(
                EXCLUDED.last_success_at,
                provider_fetch_state.last_success_at
            ),
            last_error = EXCLUDED.last_error,
            latest_element_set_id = COALESCE(
                EXCLUDED.latest_element_set_id,
                provider_fetch_state.latest_element_set_id
            ),
            consecutive_failures = CASE
                WHEN EXCLUDED.last_success_at IS NOT NULL THEN 0
                ELSE provider_fetch_state.consecutive_failures + 1
            END,
            next_retry_at = EXCLUDED.next_retry_at,
            last_error_at = CASE
                WHEN EXCLUDED.last_success_at IS NOT NULL
                    THEN provider_fetch_state.last_error_at
                ELSE EXCLUDED.last_error_at
            END
        """,
        (
            satellite_id,
            provider,
            attempted_at,
            last_success_at,
            last_error,
            element_set_id,
            failure_count,
            retry_at,
            last_error_at,
        ),
    )


def get_orbital_source_status(connection, satellite_id: int) -> dict[str, Any] | None:
    satellite = connection.execute(
        """
        SELECT id, name, active, provider_preference, metadata
        FROM satellites
        WHERE id = %s
        """,
        (satellite_id,),
    ).fetchone()
    if satellite is None:
        return None

    metadata = dict(satellite.get("metadata") or {})
    preferred_provider = str(satellite.get("provider_preference") or "").strip().lower()
    if not preferred_provider:
        preferred_provider = "mock" if metadata.get("mock") is True else "celestrak"

    latest = get_latest_element_set(connection, satellite_id, source=preferred_provider)
    if latest is None:
        latest = get_latest_element_set(connection, satellite_id)
    provider_name = str(latest["source"]) if latest is not None else preferred_provider
    provider_state = get_provider_fetch_state(connection, satellite_id, provider_name)

    run = None
    if latest is not None:
        run = connection.execute(
            """
            SELECT id, generated_at, start_time, end_time, status, is_mock
            FROM propagation_runs
            WHERE satellite_id = %s
              AND source_element_set_id = %s
              AND status = 'completed'
            ORDER BY generated_at DESC
            LIMIT 1
            """,
            (satellite_id, int(latest["id"])),
        ).fetchone()

    current_state = connection.execute(
        """
        SELECT state_time, updated_at, source_run_id, source_element_set_id
        FROM satellite_current_state
        WHERE satellite_id = %s
        """,
        (satellite_id,),
    ).fetchone()

    return {
        "satellite": satellite,
        "provider": provider_name,
        "element_set": latest,
        "provider_state": provider_state,
        "propagation_run": run,
        "current_state": current_state,
    }


def get_group_orbital_source_summary(
    connection,
    group_id: int,
    *,
    now: datetime | None = None,
    refresh_seconds: int,
    attention_limit: int = 10,
) -> dict[str, Any]:
    current = (now or datetime.now(timezone.utc)).astimezone(timezone.utc)
    refresh = max(1, int(refresh_seconds))
    fresh_limit = refresh * 2
    aging_limit = max(refresh * 6, 24 * 3600)
    attention_limit = max(1, min(50, int(attention_limit)))

    row = connection.execute(
        """
        WITH members AS (
            SELECT
                s.id AS satellite_id,
                s.name,
                s.active,
                COALESCE(
                    NULLIF(LOWER(BTRIM(s.provider_preference)), ''),
                    CASE WHEN s.metadata->>'mock' = 'true' THEN 'mock' ELSE 'celestrak' END
                ) AS preferred_provider
            FROM satellite_group_members gm
            JOIN satellites s ON s.id = gm.satellite_id
            WHERE gm.group_id = %s
        ),
        resolved AS (
            SELECT
                m.*,
                latest.id AS element_set_id,
                latest.source AS element_source,
                latest.epoch AS element_epoch,
                latest.fetched_at AS element_fetched_at,
                COALESCE(latest.source, m.preferred_provider) AS provider_name
            FROM members m
            LEFT JOIN LATERAL (
                SELECT oes.id, oes.source, oes.epoch, oes.fetched_at
                FROM orbital_element_sets oes
                WHERE oes.satellite_id = m.satellite_id
                ORDER BY
                    CASE WHEN oes.source = m.preferred_provider THEN 0 ELSE 1 END,
                    oes.epoch DESC,
                    oes.id DESC
                LIMIT 1
            ) latest ON TRUE
        ),
        classified AS (
            SELECT
                r.*,
                pfs.last_attempt_at,
                pfs.last_success_at,
                pfs.last_error_at,
                pfs.last_error,
                pfs.consecutive_failures,
                pfs.next_retry_at,
                scs.satellite_id AS current_state_satellite_id,
                scs.source_element_set_id AS current_source_element_set_id,
                CASE
                    WHEN r.element_epoch IS NULL THEN NULL
                    ELSE GREATEST(
                        0,
                        EXTRACT(EPOCH FROM (%s::timestamptz - r.element_epoch))::bigint
                    )
                END AS age_seconds
            FROM resolved r
            LEFT JOIN provider_fetch_state pfs
              ON pfs.satellite_id = r.satellite_id
             AND pfs.provider = r.provider_name
            LEFT JOIN satellite_current_state scs
              ON scs.satellite_id = r.satellite_id
        ),
        status_rows AS (
            SELECT
                c.*,
                CASE
                    WHEN c.age_seconds IS NULL THEN 'unknown'
                    WHEN c.age_seconds <= %s THEN 'fresh'
                    WHEN c.age_seconds <= %s THEN 'aging'
                    ELSE 'stale'
                END AS freshness,
                CASE
                    WHEN c.next_retry_at IS NOT NULL
                     AND c.next_retry_at > %s::timestamptz THEN 'backoff'
                    WHEN COALESCE(c.consecutive_failures, 0) > 0
                      OR c.last_error IS NOT NULL THEN 'degraded'
                    WHEN c.last_success_at IS NOT NULL THEN 'healthy'
                    ELSE 'unknown'
                END AS provider_health
            FROM classified c
        ),
        attention_ranked AS (
            SELECT
                sr.*,
                CASE
                    WHEN sr.provider_health = 'backoff' THEN 5
                    WHEN sr.provider_health = 'degraded' THEN 4
                    WHEN sr.freshness = 'stale' THEN 3
                    WHEN sr.freshness = 'unknown' THEN 2
                    WHEN sr.freshness = 'aging' THEN 1
                    ELSE 0
                END AS severity
            FROM status_rows sr
        )
        SELECT
            COUNT(*)::int AS member_count,
            COUNT(*) FILTER (WHERE active)::int AS active_member_count,
            COUNT(element_set_id)::int AS element_set_members,
            COUNT(current_state_satellite_id)::int AS current_state_members,
            COUNT(*) FILTER (
                WHERE element_set_id IS NOT NULL
                  AND current_source_element_set_id = element_set_id
            )::int AS current_on_latest_elements,
            COUNT(*) FILTER (WHERE freshness = 'fresh')::int AS freshness_fresh,
            COUNT(*) FILTER (WHERE freshness = 'aging')::int AS freshness_aging,
            COUNT(*) FILTER (WHERE freshness = 'stale')::int AS freshness_stale,
            COUNT(*) FILTER (WHERE freshness = 'unknown')::int AS freshness_unknown,
            COUNT(*) FILTER (WHERE provider_health = 'healthy')::int AS health_healthy,
            COUNT(*) FILTER (WHERE provider_health = 'degraded')::int AS health_degraded,
            COUNT(*) FILTER (WHERE provider_health = 'backoff')::int AS health_backoff,
            COUNT(*) FILTER (WHERE provider_health = 'unknown')::int AS health_unknown,
            MIN(element_epoch) AS oldest_element_epoch,
            MAX(element_epoch) AS newest_element_epoch,
            MIN(last_success_at) AS oldest_provider_success_at,
            MAX(last_success_at) AS newest_provider_success_at,
            COALESCE(
                (
                    SELECT jsonb_object_agg(provider_name, provider_count ORDER BY provider_name)
                    FROM (
                        SELECT provider_name, COUNT(*)::int AS provider_count
                        FROM status_rows
                        GROUP BY provider_name
                    ) provider_counts
                ),
                '{}'::jsonb
            ) AS providers,
            (
                SELECT COUNT(*)::int
                FROM attention_ranked
                WHERE severity > 0
            ) AS attention_total,
            COALESCE(
                (
                    SELECT jsonb_agg(
                        jsonb_build_object(
                            'satellite_id', satellite_id,
                            'name', name,
                            'active', active,
                            'provider', provider_name,
                            'provider_health', provider_health,
                            'freshness', freshness,
                            'age_seconds', age_seconds,
                            'element_epoch', element_epoch,
                            'last_error', last_error
                        )
                        ORDER BY severity DESC, age_seconds DESC NULLS LAST, satellite_id
                    )
                    FROM (
                        SELECT *
                        FROM attention_ranked
                        WHERE severity > 0
                        ORDER BY severity DESC, age_seconds DESC NULLS LAST, satellite_id
                        LIMIT %s
                    ) attention_rows
                ),
                '[]'::jsonb
            ) AS attention
        FROM status_rows
        """,
        (group_id, current, fresh_limit, aging_limit, current, attention_limit),
    ).fetchone()

    if row is None:
        raise RuntimeError("group orbital-source summary query returned no row")
    return dict(row)


def ensure_propagation_job(
    connection,
    *,
    satellite_id: int,
    element_set_id: int,
    history_hours: int,
    horizon_days: int,
    step_seconds: int,
    horizon_hours: int | None = None,
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

    if horizon_hours is not None:
        requested_future = timedelta(hours=horizon_hours)
        # Avoid regenerating a whole constellation every provider cycle just because
        # the rolling display window advanced a few seconds. Refresh once roughly
        # 20 percent of the requested horizon has been consumed.
        minimum_future = now + requested_future * 0.8
    else:
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
            horizon_hours, step_seconds, status
        )
        VALUES (%s, %s, %s, %s, %s, %s, 'pending')
        RETURNING id
        """,
        (satellite_id, element_set_id, history_hours, horizon_days, horizon_hours, step_seconds),
    ).fetchone()
    return int(row["id"]), True


def cancel_inactive_pending_jobs(connection) -> int:
    cursor = connection.execute(
        """
        UPDATE propagation_jobs pj
        SET status = 'cancelled',
            finished_at = NOW(),
            error = 'satellite no longer monitored or requested for display'
        FROM satellites s
        WHERE pj.satellite_id = s.id
          AND s.active = FALSE
          AND pj.status = 'pending'
          AND NOT EXISTS (
              SELECT 1
              FROM satellite_group_members gm
              JOIN satellite_groups g ON g.id = gm.group_id
              WHERE gm.satellite_id = s.id
                AND g.display_requested_until > NOW()
          )
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
            WHERE pj.status = 'pending'
              AND (
                  s.active = TRUE
                  OR EXISTS (
                      SELECT 1
                      FROM satellite_group_members gm
                      JOIN satellite_groups g ON g.id = gm.group_id
                      WHERE gm.satellite_id = s.id
                        AND g.display_requested_until > NOW()
                  )
              )
            ORDER BY
                CASE WHEN EXISTS (
                    SELECT 1
                    FROM satellite_group_members gm
                    JOIN satellite_groups g ON g.id = gm.group_id
                    WHERE gm.satellite_id = s.id
                      AND g.display_requested_until > NOW()
                ) THEN 0 ELSE 1 END,
                pj.requested_at,
                pj.id
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


def is_satellite_propagation_requested(
    connection,
    satellite_id: int,
    *,
    lock: bool = False,
) -> bool:
    suffix = " FOR SHARE OF s" if lock else ""
    row = connection.execute(
        f"""
        SELECT (
            s.active
            OR EXISTS (
                SELECT 1
                FROM satellite_group_members gm
                JOIN satellite_groups g ON g.id = gm.group_id
                WHERE gm.satellite_id = s.id
                  AND g.display_requested_until > NOW()
            )
        ) AS requested
        FROM satellites s
        WHERE s.id = %s{suffix}
        """,
        (satellite_id,),
    ).fetchone()
    return bool(row and row["requested"])


def finish_job(connection, job_id: int, status: str, error: str | None = None) -> None:
    connection.execute(
        """
        UPDATE propagation_jobs
        SET status = %s, finished_at = NOW(), error = %s
        WHERE id = %s
        """,
        (status, error, job_id),
    )
