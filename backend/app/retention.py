from __future__ import annotations

from datetime import datetime, timedelta, timezone


def prune_obsolete_position_samples(
    connection,
    retention_hours: int,
    batch_size: int,
    now: datetime | None = None,
) -> int:
    """Delete trajectory rows from superseded runs while retaining run metadata.

    The latest completed run and the current-state source run are protected for
    active satellites. Prediction-quality rows reference propagation_runs, not
    position_samples, so quality history remains intact after sample cleanup.
    Inactive satellites do not pin old trajectory samples indefinitely.
    """

    if retention_hours < 0:
        raise ValueError("retention_hours cannot be negative")
    if batch_size <= 0:
        raise ValueError("batch_size must be positive")

    cutoff = (now or datetime.now(timezone.utc)).astimezone(timezone.utc) - timedelta(
        hours=retention_hours
    )
    cursor = connection.execute(
        """
        WITH latest_active_runs AS (
            SELECT DISTINCT ON (pr.satellite_id) pr.id
            FROM propagation_runs pr
            JOIN satellites s ON s.id = pr.satellite_id AND s.active
            WHERE pr.status = 'completed'
            ORDER BY pr.satellite_id, pr.generated_at DESC, pr.id DESC
        ),
        protected_runs AS (
            SELECT id FROM latest_active_runs
            UNION
            SELECT scs.source_run_id
            FROM satellite_current_state scs
            JOIN satellites s ON s.id = scs.satellite_id AND s.active
        ),
        candidates AS (
            SELECT ps.ctid
            FROM position_samples ps
            JOIN propagation_runs pr ON pr.id = ps.run_id
            LEFT JOIN protected_runs protected ON protected.id = pr.id
            WHERE pr.status = 'completed'
              AND pr.generated_at < %s
              AND protected.id IS NULL
            ORDER BY pr.generated_at, ps.sample_time
            LIMIT %s
        )
        DELETE FROM position_samples ps
        USING candidates candidate
        WHERE ps.ctid = candidate.ctid
        """,
        (cutoff, batch_size),
    )
    return max(0, int(cursor.rowcount or 0))
