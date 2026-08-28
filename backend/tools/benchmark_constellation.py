from __future__ import annotations

import argparse
from datetime import datetime, timedelta, timezone
import json
from pathlib import Path
import statistics
import time
from uuid import uuid4

from psycopg.types.json import Jsonb

from app.db import connect
from app.repository import (
    get_current_positions_for_selection,
    get_group_current_positions,
    get_track_points,
)
from app.retention import prune_obsolete_position_samples
from app.sampling_policy import PropagationSamplingPolicy


REPO_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_SIZES = (100, 1000, 5000)
DEFAULT_GROUP_P95_TARGET_MS = {100: 100.0, 1000: 250.0, 5000: 800.0}
DEFAULT_SELECTION_P95_TARGET_MS = 1000.0
DEFAULT_TRACK_P95_TARGET_MS = 200.0


def initialize_schema() -> None:
    schema = (REPO_ROOT / "database/init/001_schema.sql").read_text(encoding="utf-8")
    with connect() as connection:
        for statement in schema.split(";"):
            if statement.strip():
                connection.execute(statement)
        connection.commit()


def percentile(values: list[float], fraction: float) -> float:
    ordered = sorted(values)
    index = min(len(ordered) - 1, max(0, round((len(ordered) - 1) * fraction)))
    return ordered[index]


def measure(callable_, repeats: int = 9) -> dict[str, float]:
    callable_()
    callable_()
    values: list[float] = []
    for _ in range(repeats):
        started = time.perf_counter()
        callable_()
        values.append((time.perf_counter() - started) * 1000.0)
    return {
        "median_ms": round(statistics.median(values), 3),
        "p95_ms": round(percentile(values, 0.95), 3),
        "max_ms": round(max(values), 3),
    }


def seed_fixture(connection, max_size: int, sizes: tuple[int, ...]):
    token = f"benchmark-{uuid4().hex}"
    now = datetime.now(timezone.utc).replace(microsecond=0)

    rows = connection.execute(
        """
        INSERT INTO satellites (name, active, object_type, provider_preference, metadata)
        SELECT
            'BENCH-' || %s || '-' || series::text,
            TRUE,
            'payload',
            'benchmark',
            jsonb_build_object('benchmark_token', %s)
        FROM generate_series(1, %s) AS series
        RETURNING id
        """,
        (token, token, max_size),
    ).fetchall()
    satellite_ids = [int(row["id"]) for row in rows]
    first_satellite_id = satellite_ids[0]

    connection.execute(
        """
        WITH ranked AS (
            SELECT id, ROW_NUMBER() OVER (ORDER BY id) AS sequence
            FROM satellites
            WHERE metadata->>'benchmark_token' = %s
        )
        INSERT INTO satellite_identifiers (satellite_id, namespace, value)
        SELECT id, 'NORAD_CAT_ID', (700000000 + sequence)::text
        FROM ranked
        """,
        (token,),
    )

    group_ids: dict[int, int] = {}
    for size in sizes:
        group_row = connection.execute(
            """
            INSERT INTO satellite_groups (name, group_type, source, source_key, metadata)
            VALUES (%s, 'constellation', 'benchmark', %s, %s)
            RETURNING id
            """,
            (
                f"BENCH-{size}",
                f"{token}-{size}",
                Jsonb({"benchmark_token": token, "size": size}),
            ),
        ).fetchone()
        group_id = int(group_row["id"])
        group_ids[size] = group_id
        connection.execute(
            """
            INSERT INTO satellite_group_members (group_id, satellite_id)
            SELECT %s, id
            FROM satellites
            WHERE metadata->>'benchmark_token' = %s
            ORDER BY id
            LIMIT %s
            """,
            (group_id, token, size),
        )

    current_run_id = str(uuid4())
    policy = PropagationSamplingPolicy(60)
    connection.execute(
        """
        INSERT INTO propagation_runs (
            id, satellite_id, generated_at, start_time, end_time,
            step_seconds, sampling_policy, status, is_mock
        )
        VALUES (%s, %s, %s, %s, %s, 60, %s, 'completed', FALSE)
        """,
        (
            current_run_id,
            first_satellite_id,
            now,
            now - timedelta(hours=48),
            now + timedelta(days=14),
            Jsonb(policy.payload()),
        ),
    )

    connection.execute(
        """
        WITH ranked AS (
            SELECT id, ROW_NUMBER() OVER (ORDER BY id) AS sequence
            FROM satellites
            WHERE metadata->>'benchmark_token' = %s
        )
        INSERT INTO satellite_current_state (
            satellite_id, state_time,
            x_ecef_km, y_ecef_km, z_ecef_km,
            lat_deg, lon_deg, altitude_km,
            source_run_id, source_element_set_id
        )
        SELECT
            id,
            %s,
            6800.0,
            sequence::double precision,
            (sequence % 50)::double precision,
            ((sequence % 160) - 80)::double precision,
            (((sequence * 7) % 360) - 180)::double precision,
            550.0 + (sequence % 30)::double precision,
            %s,
            NULL
        FROM ranked
        """,
        (token, now, current_run_id),
    )

    track_start = now - timedelta(minutes=90)
    track_end = now + timedelta(hours=6)
    connection.execute(
        """
        INSERT INTO position_samples (
            run_id, satellite_id, sample_time,
            x_ecef_km, y_ecef_km, z_ecef_km,
            lat_deg, lon_deg, altitude_km
        )
        SELECT
            %s,
            %s,
            sample_time,
            6800.0,
            EXTRACT(EPOCH FROM sample_time)::double precision / 1000000.0,
            10.0,
            20.0,
            MOD(EXTRACT(EPOCH FROM sample_time)::numeric / 60, 360)::double precision - 180.0,
            550.0
        FROM generate_series(%s, %s, INTERVAL '60 seconds') AS sample_time
        """,
        (current_run_id, first_satellite_id, track_start, track_end),
    )

    old_run_id = str(uuid4())
    old_generated = now - timedelta(hours=72)
    connection.execute(
        """
        INSERT INTO propagation_runs (
            id, satellite_id, generated_at, start_time, end_time,
            step_seconds, sampling_policy, status, is_mock
        )
        VALUES (%s, %s, %s, %s, %s, 60, %s, 'completed', FALSE)
        """,
        (
            old_run_id,
            first_satellite_id,
            old_generated,
            old_generated - timedelta(hours=1),
            old_generated + timedelta(hours=1),
            Jsonb(policy.payload()),
        ),
    )
    connection.execute(
        """
        INSERT INTO position_samples (
            run_id, satellite_id, sample_time,
            x_ecef_km, y_ecef_km, z_ecef_km,
            lat_deg, lon_deg, altitude_km
        )
        SELECT %s, %s, sample_time, 1, 2, 3, 4, 5, 550
        FROM generate_series(%s, %s, INTERVAL '60 seconds') AS sample_time
        """,
        (
            old_run_id,
            first_satellite_id,
            old_generated - timedelta(minutes=10),
            old_generated + timedelta(minutes=10),
        ),
    )

    return {
        "token": token,
        "now": now,
        "satellite_ids": satellite_ids,
        "group_ids": group_ids,
        "current_run_id": current_run_id,
        "old_run_id": old_run_id,
        "track_start": track_start,
        "track_end": track_end,
        "policy": policy,
    }


def explain_group_current_state(connection, group_id: int) -> str:
    row = connection.execute(
        """
        EXPLAIN (FORMAT JSON)
        SELECT s.id, scs.state_time, scs.lat_deg, scs.lon_deg, scs.altitude_km
        FROM satellite_group_members gm
        JOIN satellites s ON s.id = gm.satellite_id
        JOIN satellite_current_state scs ON scs.satellite_id = s.id
        WHERE gm.group_id = %s AND s.active
        ORDER BY s.id
        LIMIT 10000
        """,
        (group_id,),
    ).fetchone()
    return json.dumps(row["QUERY PLAN"], separators=(",", ":"))


def run_benchmark(sizes: tuple[int, ...], enforce: bool) -> dict[str, object]:
    initialize_schema()
    max_size = max(sizes)
    with connect() as connection:
        fixture = seed_fixture(connection, max_size, sizes)
        connection.execute("ANALYZE satellites")
        connection.execute("ANALYZE satellite_group_members")
        connection.execute("ANALYZE satellite_current_state")
        connection.execute("ANALYZE position_samples")

        group_results: dict[str, object] = {}
        for size in sizes:
            group_id = fixture["group_ids"][size]
            timing = measure(
                lambda group_id=group_id, size=size: get_group_current_positions(
                    connection,
                    group_id,
                    active_only=True,
                    limit=size,
                )
            )
            rows = get_group_current_positions(connection, group_id, limit=size)
            if len(rows) != size:
                raise RuntimeError(f"expected {size} group positions, received {len(rows)}")
            plan = explain_group_current_state(connection, group_id)
            if "position_samples" in plan:
                raise RuntimeError("current-state query plan touched position_samples")
            group_results[str(size)] = {
                **timing,
                "rows": len(rows),
                "target_p95_ms": DEFAULT_GROUP_P95_TARGET_MS.get(size, 1000.0),
            }

        selected_ids = fixture["satellite_ids"][:max_size]
        selection_timing = measure(
            lambda: get_current_positions_for_selection(
                connection,
                satellite_ids=selected_ids,
                active_only=True,
                limit=max_size,
            )
        )
        selection_rows = get_current_positions_for_selection(
            connection,
            satellite_ids=selected_ids,
            active_only=True,
            limit=max_size,
        )
        if len(selection_rows) != max_size:
            raise RuntimeError(
                f"expected {max_size} selection positions, received {len(selection_rows)}"
            )

        track_timing = measure(
            lambda: get_track_points(
                connection,
                fixture["current_run_id"],
                fixture["track_start"],
                fixture["track_end"],
                60,
                60,
                5000,
            )
        )
        track_rows, track_resolution = get_track_points(
            connection,
            fixture["current_run_id"],
            fixture["track_start"],
            fixture["track_end"],
            60,
            60,
            5000,
        )

        old_before = connection.execute(
            "SELECT COUNT(*)::int AS count FROM position_samples WHERE run_id = %s",
            (fixture["old_run_id"],),
        ).fetchone()["count"]
        prune_obsolete_position_samples(
            connection,
            retention_hours=24,
            batch_size=1000,
            now=fixture["now"],
        )
        old_after = connection.execute(
            "SELECT COUNT(*)::int AS count FROM position_samples WHERE run_id = %s",
            (fixture["old_run_id"],),
        ).fetchone()["count"]
        current_after = connection.execute(
            "SELECT COUNT(*)::int AS count FROM position_samples WHERE run_id = %s",
            (fixture["current_run_id"],),
        ).fetchone()["count"]
        if old_before <= 0 or old_after != 0 or current_after <= 0:
            raise RuntimeError("retention benchmark did not prune only the superseded run")

        policy: PropagationSamplingPolicy = fixture["policy"]
        policy_start = fixture["now"] - timedelta(hours=48)
        policy_end = fixture["now"] + timedelta(days=14)
        tiered_samples = policy.sample_count(policy_start, policy_end, fixture["now"])
        uniform_samples = int((policy_end - policy_start).total_seconds() // 60) + 1

        result: dict[str, object] = {
            "sizes": list(sizes),
            "group_current_state": group_results,
            "arbitrary_selection": {
                **selection_timing,
                "rows": len(selection_rows),
                "target_p95_ms": DEFAULT_SELECTION_P95_TARGET_MS,
            },
            "selected_track": {
                **track_timing,
                "rows": len(track_rows),
                "effective_resolution_seconds": track_resolution,
                "target_p95_ms": DEFAULT_TRACK_P95_TARGET_MS,
            },
            "storage_policy": {
                "uniform_samples_per_run": uniform_samples,
                "tiered_samples_per_run": tiered_samples,
                "reduction_percent": round(100.0 * (1.0 - tiered_samples / uniform_samples), 2),
                "tiered_rows_at_1000_satellites": tiered_samples * 1000,
                "tiered_rows_at_5000_satellites": tiered_samples * 5000,
                "policy": policy.payload(),
            },
            "retention": {
                "superseded_samples_before": old_before,
                "superseded_samples_after": old_after,
                "protected_current_samples_after": current_after,
            },
        }

        if enforce:
            for size in sizes:
                observed = float(group_results[str(size)]["p95_ms"])
                target = DEFAULT_GROUP_P95_TARGET_MS.get(size, 1000.0)
                if observed > target:
                    raise RuntimeError(
                        f"group current-state p95 for {size} satellites was {observed:.1f} ms; target {target:.1f} ms"
                    )
            if float(selection_timing["p95_ms"]) > DEFAULT_SELECTION_P95_TARGET_MS:
                raise RuntimeError("arbitrary current-state batch query exceeded p95 target")
            if float(track_timing["p95_ms"]) > DEFAULT_TRACK_P95_TARGET_MS:
                raise RuntimeError("selected track query exceeded p95 target")

        connection.rollback()
        return result


def main() -> None:
    parser = argparse.ArgumentParser(description="Benchmark constellation-sized WorldSat workloads")
    parser.add_argument(
        "--sizes",
        nargs="+",
        type=int,
        default=list(DEFAULT_SIZES),
        help="group sizes to benchmark",
    )
    parser.add_argument(
        "--enforce",
        action="store_true",
        help="fail when conservative CI p95 targets are exceeded",
    )
    args = parser.parse_args()
    sizes = tuple(sorted(set(args.sizes)))
    if not sizes or sizes[0] <= 0 or sizes[-1] > 10000:
        raise SystemExit("benchmark sizes must be between 1 and 10000")
    result = run_benchmark(sizes, args.enforce)
    print(json.dumps(result, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
