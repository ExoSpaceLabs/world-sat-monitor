from __future__ import annotations

from datetime import datetime
from typing import Any


def list_satellites(connection) -> list[dict[str, Any]]:
    rows = connection.execute(
        """
        SELECT id, norad_id, name, active, created_at
        FROM satellites
        WHERE active = TRUE
        ORDER BY name, norad_id
        """
    ).fetchall()
    return list(rows)


def get_satellite(connection, norad_id: int) -> dict[str, Any] | None:
    return connection.execute(
        """
        SELECT id, norad_id, name, active, created_at
        FROM satellites
        WHERE norad_id = %s AND active = TRUE
        """,
        (norad_id,),
    ).fetchone()


def get_run_covering(
    connection,
    satellite_id: int,
    start: datetime,
    end: datetime,
) -> dict[str, Any] | None:
    return connection.execute(
        """
        SELECT id, satellite_id, source_tle_id, generated_at, start_time, end_time,
               step_seconds, status, is_mock
        FROM propagation_runs
        WHERE satellite_id = %s
          AND status = 'completed'
          AND start_time <= %s
          AND end_time >= %s
        ORDER BY generated_at DESC
        LIMIT 1
        """,
        (satellite_id, start, end),
    ).fetchone()


def get_position_bracket(
    connection,
    run_id: str,
    at: datetime,
) -> tuple[dict[str, Any] | None, dict[str, Any] | None]:
    before = connection.execute(
        """
        SELECT sample_time, x_ecef_km, y_ecef_km, z_ecef_km,
               lat_deg, lon_deg, altitude_km
        FROM position_samples
        WHERE run_id = %s AND sample_time <= %s
        ORDER BY sample_time DESC
        LIMIT 1
        """,
        (run_id, at),
    ).fetchone()
    after = connection.execute(
        """
        SELECT sample_time, x_ecef_km, y_ecef_km, z_ecef_km,
               lat_deg, lon_deg, altitude_km
        FROM position_samples
        WHERE run_id = %s AND sample_time >= %s
        ORDER BY sample_time ASC
        LIMIT 1
        """,
        (run_id, at),
    ).fetchone()
    return before, after


def get_track_points(
    connection,
    run_id: str,
    start: datetime,
    end: datetime,
    raw_step_seconds: int,
    resolution_seconds: int,
    max_points: int,
) -> list[dict[str, Any]]:
    stride = max(1, round(resolution_seconds / raw_step_seconds))
    rows = connection.execute(
        """
        WITH ranked AS (
            SELECT sample_time, lat_deg, lon_deg, altitude_km,
                   ROW_NUMBER() OVER (ORDER BY sample_time) - 1 AS sample_index
            FROM position_samples
            WHERE run_id = %s
              AND sample_time BETWEEN %s AND %s
        )
        SELECT sample_time, lat_deg, lon_deg, altitude_km
        FROM ranked
        WHERE MOD(sample_index, %s) = 0
        ORDER BY sample_time
        LIMIT %s
        """,
        (run_id, start, end, stride, max_points),
    ).fetchall()
    return list(rows)


def get_prediction_errors(connection, run_id: str) -> list[dict[str, Any]]:
    rows = connection.execute(
        """
        SELECT horizon_day, mean_error_km, rms_error_km, p95_error_km,
               max_error_km, sample_count, evaluated_at, reference_kind
        FROM prediction_error_daily
        WHERE evaluated_run_id = %s
        ORDER BY horizon_day
        """,
        (run_id,),
    ).fetchall()
    return list(rows)
