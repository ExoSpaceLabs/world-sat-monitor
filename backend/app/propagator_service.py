from __future__ import annotations

from datetime import datetime, timedelta, timezone
import logging
import time
from uuid import uuid4

from psycopg.types.json import Jsonb

from .config import settings
from .db import connect, wait_for_database
from .migrations import migrate_schema
from .orbital_store import (
    claim_next_propagation_job,
    finish_job,
    is_satellite_propagation_requested,
    load_element_set,
)
from .propagation import SGP4PropagationEngine
from .retention import prune_obsolete_position_samples
from .sampling_policy import PropagationSamplingPolicy
from .worker_health import WorkerHealth, start_health_server

LOGGER = logging.getLogger("worldsat.propagator")


def _floor_time(value: datetime, step_seconds: int) -> datetime:
    timestamp = int(value.timestamp())
    return datetime.fromtimestamp(timestamp - (timestamp % step_seconds), tz=timezone.utc)


def _sampling_policy(base_step_seconds: int) -> PropagationSamplingPolicy:
    return PropagationSamplingPolicy(
        base_step_seconds=base_step_seconds,
        near_horizon_hours=settings.propagation_near_horizon_hours,
        mid_horizon_hours=settings.propagation_mid_horizon_hours,
        mid_step_seconds=settings.propagation_mid_step_seconds,
        far_step_seconds=settings.propagation_far_step_seconds,
    )


def _claim_job():
    with connect() as connection:
        job = claim_next_propagation_job(connection)
        connection.commit()
        return job


def _mark_failed(job_id: int, error: Exception | str) -> None:
    with connect() as connection:
        finish_job(connection, job_id, "failed", str(error)[:4000])
        connection.commit()


def _mark_cancelled(job_id: int, message: str) -> None:
    with connect() as connection:
        finish_job(connection, job_id, "cancelled", message[:4000])
        connection.commit()


def _prune_samples() -> int:
    with connect() as connection:
        deleted = prune_obsolete_position_samples(
            connection,
            settings.propagation_sample_retention_hours,
            settings.propagation_cleanup_batch_size,
        )
        connection.commit()
    return deleted


def run_propagation_once(now: datetime | None = None) -> bool:
    job = _claim_job()
    if job is None:
        return False
    job_id = int(job["id"])
    satellite_id = int(job["satellite_id"])
    try:
        with connect() as connection:
            element_set = load_element_set(connection, int(job["element_set_id"]))
            requested = is_satellite_propagation_requested(connection, satellite_id)
        if element_set is None:
            raise RuntimeError(f"element set {job['element_set_id']} no longer exists")
        if not requested:
            _mark_cancelled(job_id, "satellite no longer monitored or requested for display")
            return True

        generated_at = (now or datetime.now(timezone.utc)).astimezone(timezone.utc)
        step_seconds = int(job["step_seconds"])
        start = _floor_time(
            generated_at - timedelta(hours=int(job["history_hours"])),
            step_seconds,
        )
        if job.get("horizon_hours") is not None:
            end_delta = timedelta(hours=int(job["horizon_hours"]))
        else:
            end_delta = timedelta(days=int(job["horizon_days"]))
        end = _floor_time(generated_at + end_delta, step_seconds)
        sampling_policy = _sampling_policy(step_seconds)
        engine = SGP4PropagationEngine()
        prepared = engine.prepare(element_set)
        current = engine.propagate_prepared(prepared, generated_at)
        run_id = str(uuid4())
        sample_count = 0

        with connect() as connection:
            if not is_satellite_propagation_requested(connection, satellite_id, lock=True):
                finish_job(
                    connection,
                    job_id,
                    "cancelled",
                    "satellite no longer monitored or requested for display while propagation was running",
                )
                connection.commit()
                return True
            connection.execute(
                """
                INSERT INTO propagation_runs (
                    id, satellite_id, source_element_set_id, generated_at,
                    start_time, end_time, step_seconds, sampling_policy, status, is_mock
                )
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, 'running', %s)
                """,
                (
                    run_id,
                    satellite_id,
                    int(element_set["id"]),
                    generated_at,
                    start,
                    end,
                    step_seconds,
                    Jsonb(sampling_policy.payload()),
                    str(element_set["source"]).lower() == "mock",
                ),
            )
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
                    for cursor_time in sampling_policy.iter_sample_times(start, end, generated_at):
                        state = engine.propagate_prepared(prepared, cursor_time)
                        copy.write_row(
                            (
                                run_id,
                                satellite_id,
                                cursor_time,
                                state.ecef.x_ecef_km,
                                state.ecef.y_ecef_km,
                                state.ecef.z_ecef_km,
                                state.geodetic.lat_deg,
                                state.geodetic.lon_deg,
                                state.geodetic.altitude_km,
                            )
                        )
                        sample_count += 1
            connection.execute(
                """
                INSERT INTO satellite_current_state (
                    satellite_id, state_time, x_ecef_km, y_ecef_km, z_ecef_km,
                    lat_deg, lon_deg, altitude_km, source_run_id,
                    source_element_set_id, updated_at
                )
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, NOW())
                ON CONFLICT (satellite_id) DO UPDATE SET
                    state_time=EXCLUDED.state_time,
                    x_ecef_km=EXCLUDED.x_ecef_km,
                    y_ecef_km=EXCLUDED.y_ecef_km,
                    z_ecef_km=EXCLUDED.z_ecef_km,
                    lat_deg=EXCLUDED.lat_deg,
                    lon_deg=EXCLUDED.lon_deg,
                    altitude_km=EXCLUDED.altitude_km,
                    source_run_id=EXCLUDED.source_run_id,
                    source_element_set_id=EXCLUDED.source_element_set_id,
                    updated_at=NOW()
                """,
                (
                    satellite_id,
                    generated_at,
                    current.ecef.x_ecef_km,
                    current.ecef.y_ecef_km,
                    current.ecef.z_ecef_km,
                    current.geodetic.lat_deg,
                    current.geodetic.lon_deg,
                    current.geodetic.altitude_km,
                    run_id,
                    int(element_set["id"]),
                ),
            )
            connection.execute(
                "UPDATE propagation_runs SET status = 'completed' WHERE id = %s",
                (run_id,),
            )
            finish_job(connection, job_id, "completed")
            connection.commit()
        LOGGER.info(
            "completed propagation job=%s satellite=%s samples=%s horizon=%s policy=%s",
            job_id,
            satellite_id,
            sample_count,
            f"{job['horizon_hours']}h" if job.get("horizon_hours") is not None else f"{job['horizon_days']}d",
            sampling_policy.payload(),
        )
        return True
    except Exception as error:
        LOGGER.exception("propagation job %s failed", job_id)
        _mark_failed(job_id, error)
        return True


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    wait_for_database()
    migrate_schema()
    health = WorkerHealth("propagator")
    start_health_server(settings.propagator_health_port, health)
    LOGGER.info(
        "propagator started: poll=%ss history=%sh horizon=%sd base-step=%ss retention=%sh",
        settings.propagator_poll_seconds,
        settings.propagation_history_hours,
        settings.propagation_horizon_days,
        settings.propagation_step_seconds,
        settings.propagation_sample_retention_hours,
    )
    last_cleanup_at = 0.0
    while True:
        try:
            processed = run_propagation_once()
            now_monotonic = time.monotonic()
            if now_monotonic - last_cleanup_at >= max(1, settings.propagation_cleanup_interval_seconds):
                deleted = _prune_samples()
                last_cleanup_at = now_monotonic
                if deleted:
                    LOGGER.info("pruned %s superseded position samples", deleted)
            health.success()
            if not processed:
                time.sleep(max(0.2, settings.propagator_poll_seconds))
        except Exception as error:
            health.failure(error)
            LOGGER.exception("propagator loop failed")
            time.sleep(max(0.2, settings.propagator_poll_seconds))


if __name__ == "__main__":
    main()
