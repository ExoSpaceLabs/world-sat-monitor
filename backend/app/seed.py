from __future__ import annotations

from datetime import datetime, timedelta, timezone
from uuid import uuid4

from .config import settings
from .db import connect
from .orbit import ecef_to_geodetic_spherical, mock_ecef_state

MOCK_NORAD_ID = "99001"
MOCK_NAME = "WORLDSAT-01"
MOCK_HISTORY_SLACK_HOURS = 24
MOCK_PREDICTION_SLACK_HOURS = 24


def _floor_time(value: datetime, step_seconds: int) -> datetime:
    timestamp = int(value.timestamp())
    return datetime.fromtimestamp(
        timestamp - (timestamp % step_seconds),
        tz=timezone.utc,
    )


def _ensure_mock_satellite(connection) -> int:
    satellite = connection.execute(
        """
        SELECT s.id
        FROM satellites s
        JOIN satellite_identifiers si ON si.satellite_id = s.id
        WHERE si.namespace = 'NORAD_CAT_ID' AND si.value = %s
        LIMIT 1
        """,
        (MOCK_NORAD_ID,),
    ).fetchone()
    if satellite is not None:
        connection.execute(
            "UPDATE satellites SET name = %s, updated_at = NOW() WHERE id = %s",
            (MOCK_NAME, satellite["id"]),
        )
        return int(satellite["id"])

    satellite = connection.execute(
        """
        INSERT INTO satellites (name, active, object_type, metadata)
        VALUES (%s, TRUE, 'payload', '{"mock": true}'::jsonb)
        RETURNING id
        """,
        (MOCK_NAME,),
    ).fetchone()
    satellite_id = int(satellite["id"])
    connection.execute(
        """
        INSERT INTO satellite_identifiers (satellite_id, namespace, value)
        VALUES (%s, 'NORAD_CAT_ID', %s)
        """,
        (satellite_id, MOCK_NORAD_ID),
    )
    return satellite_id


def ensure_mock_data() -> None:
    if not settings.mock_seed_enabled:
        return

    now = datetime.now(timezone.utc)
    step = settings.mock_step_seconds
    start = _floor_time(
        now - timedelta(hours=settings.mock_history_hours),
        step,
    )
    end = _floor_time(
        now + timedelta(hours=settings.mock_prediction_hours),
        step,
    )
    required_start = now - timedelta(
        hours=max(0, settings.mock_history_hours - MOCK_HISTORY_SLACK_HOURS),
    )
    required_end = now + timedelta(
        hours=max(0, settings.mock_prediction_hours - MOCK_PREDICTION_SLACK_HOURS),
    )

    with connect() as connection:
        satellite_id = _ensure_mock_satellite(connection)

        existing = connection.execute(
            """
            SELECT id
            FROM propagation_runs
            WHERE satellite_id = %s
              AND is_mock = TRUE
              AND status = 'completed'
              AND start_time <= %s
              AND end_time >= %s
            ORDER BY generated_at DESC
            LIMIT 1
            """,
            (satellite_id, required_start, required_end),
        ).fetchone()
        if existing:
            connection.commit()
            return

        run_id = str(uuid4())
        connection.execute(
            """
            INSERT INTO propagation_runs (
                id, satellite_id, generated_at, start_time, end_time,
                step_seconds, status, is_mock
            )
            VALUES (%s, %s, %s, %s, %s, %s, 'completed', TRUE)
            """,
            (run_id, satellite_id, now, start, end, step),
        )

        epoch = _floor_time(now, step)
        cursor = start
        with connection.cursor() as db_cursor:
            with db_cursor.copy(
                """
                COPY position_samples (
                    run_id, satellite_id, sample_time,
                    x_ecef_km, y_ecef_km, z_ecef_km,
                    lat_deg, lon_deg, altitude_km
                ) FROM STDIN
                """
            ) as copy:
                while cursor <= end:
                    ecef = mock_ecef_state(cursor, epoch)
                    geodetic = ecef_to_geodetic_spherical(ecef)
                    copy.write_row(
                        (
                            run_id,
                            satellite_id,
                            cursor,
                            ecef.x_ecef_km,
                            ecef.y_ecef_km,
                            ecef.z_ecef_km,
                            geodetic.lat_deg,
                            geodetic.lon_deg,
                            geodetic.altitude_km,
                        )
                    )
                    cursor += timedelta(seconds=step)

        error_rows = []
        for horizon_day in range(1, 15):
            mean_error = 0.8 + 0.55 * (horizon_day**1.45)
            error_rows.append(
                (
                    satellite_id,
                    run_id,
                    horizon_day,
                    mean_error,
                    mean_error * 1.25,
                    mean_error * 2.0,
                    mean_error * 3.0,
                    100,
                    "mock",
                )
            )

        with connection.cursor() as db_cursor:
            db_cursor.executemany(
                """
                INSERT INTO prediction_error_daily (
                    satellite_id, evaluated_run_id, horizon_day,
                    mean_error_km, rms_error_km, p95_error_km,
                    max_error_km, sample_count, reference_kind
                )
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (evaluated_run_id, horizon_day) DO NOTHING
                """,
                error_rows,
            )

        connection.commit()
