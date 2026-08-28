from __future__ import annotations

from .db import connect


MIGRATION_LOCK_ID = 94712014

LEGACY_TO_ELEMENT_SET_SQL = r"""
ALTER TABLE satellites
    ADD COLUMN IF NOT EXISTS object_type TEXT NOT NULL DEFAULT 'payload',
    ADD COLUMN IF NOT EXISTS provider_preference TEXT,
    ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE TABLE IF NOT EXISTS satellite_identifiers (
    id BIGSERIAL PRIMARY KEY,
    satellite_id BIGINT NOT NULL REFERENCES satellites(id) ON DELETE CASCADE,
    namespace TEXT NOT NULL,
    value TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (namespace, value),
    UNIQUE (satellite_id, namespace)
);

INSERT INTO satellite_identifiers (satellite_id, namespace, value)
SELECT id, 'NORAD_CAT_ID', norad_id::text
FROM satellites
ON CONFLICT (namespace, value) DO NOTHING;

CREATE TABLE orbital_element_sets (
    id BIGSERIAL PRIMARY KEY,
    satellite_id BIGINT NOT NULL REFERENCES satellites(id) ON DELETE CASCADE,
    epoch TIMESTAMPTZ NOT NULL,
    source TEXT NOT NULL,
    source_format TEXT NOT NULL,
    mean_element_theory TEXT NOT NULL DEFAULT 'SGP4',
    mean_motion DOUBLE PRECISION,
    eccentricity DOUBLE PRECISION,
    inclination_deg DOUBLE PRECISION,
    ra_of_asc_node_deg DOUBLE PRECISION,
    arg_of_pericenter_deg DOUBLE PRECISION,
    mean_anomaly_deg DOUBLE PRECISION,
    bstar DOUBLE PRECISION,
    mean_motion_dot DOUBLE PRECISION,
    mean_motion_ddot DOUBLE PRECISION,
    element_set_no INTEGER,
    rev_at_epoch INTEGER,
    fingerprint TEXT,
    raw_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO orbital_element_sets (
    id, satellite_id, epoch, source, source_format, mean_element_theory,
    raw_payload, fetched_at
)
SELECT id, satellite_id, epoch, source, 'TLE', 'SGP4',
       jsonb_build_object('line1', line1, 'line2', line2), fetched_at
FROM tle_sets;

SELECT setval(
    pg_get_serial_sequence('orbital_element_sets', 'id'),
    COALESCE((SELECT MAX(id) FROM orbital_element_sets), 1),
    EXISTS (SELECT 1 FROM orbital_element_sets)
);

ALTER TABLE propagation_runs ADD COLUMN source_element_set_id BIGINT;
UPDATE propagation_runs SET source_element_set_id = source_tle_id;
ALTER TABLE propagation_runs
    ADD CONSTRAINT propagation_runs_source_element_set_fk
    FOREIGN KEY (source_element_set_id) REFERENCES orbital_element_sets(id) ON DELETE SET NULL;

ALTER TABLE propagation_jobs ADD COLUMN element_set_id BIGINT;
UPDATE propagation_jobs SET element_set_id = tle_id;
ALTER TABLE propagation_jobs ALTER COLUMN element_set_id SET NOT NULL;
ALTER TABLE propagation_jobs
    ADD CONSTRAINT propagation_jobs_element_set_fk
    FOREIGN KEY (element_set_id) REFERENCES orbital_element_sets(id) ON DELETE CASCADE;

ALTER TABLE prediction_error_daily ADD COLUMN reference_element_set_id BIGINT;
UPDATE prediction_error_daily SET reference_element_set_id = reference_tle_id;
ALTER TABLE prediction_error_daily
    ADD CONSTRAINT prediction_error_reference_element_set_fk
    FOREIGN KEY (reference_element_set_id) REFERENCES orbital_element_sets(id) ON DELETE SET NULL;

ALTER TABLE propagation_runs DROP COLUMN source_tle_id;
ALTER TABLE propagation_jobs DROP COLUMN tle_id;
ALTER TABLE prediction_error_daily DROP COLUMN reference_tle_id;
DROP TABLE tle_sets;
ALTER TABLE satellites DROP COLUMN norad_id;

CREATE INDEX IF NOT EXISTS ix_satellites_active_name
    ON satellites (active, name);
CREATE INDEX IF NOT EXISTS ix_satellite_identifiers_satellite
    ON satellite_identifiers (satellite_id);
CREATE INDEX IF NOT EXISTS ix_orbital_element_sets_satellite_epoch
    ON orbital_element_sets (satellite_id, epoch DESC);
CREATE UNIQUE INDEX IF NOT EXISTS ux_orbital_element_sets_source_fingerprint
    ON orbital_element_sets (satellite_id, source, fingerprint)
    WHERE fingerprint IS NOT NULL;
"""

CURRENT_SCHEMA_SQL = r"""
ALTER TABLE propagation_jobs
    ADD COLUMN IF NOT EXISTS history_hours INTEGER NOT NULL DEFAULT 48
        CHECK (history_hours >= 0);

ALTER TABLE propagation_jobs
    ALTER COLUMN step_seconds SET DEFAULT 60;

ALTER TABLE propagation_jobs
    DROP CONSTRAINT IF EXISTS propagation_jobs_status_check;

ALTER TABLE propagation_jobs
    ADD CONSTRAINT propagation_jobs_status_check
    CHECK (status IN ('pending', 'running', 'completed', 'failed', 'cancelled'));

CREATE TABLE IF NOT EXISTS provider_fetch_state (
    satellite_id BIGINT NOT NULL REFERENCES satellites(id) ON DELETE CASCADE,
    provider TEXT NOT NULL,
    last_attempt_at TIMESTAMPTZ,
    last_success_at TIMESTAMPTZ,
    last_error TEXT,
    latest_element_set_id BIGINT REFERENCES orbital_element_sets(id) ON DELETE SET NULL,
    PRIMARY KEY (satellite_id, provider)
);

CREATE TABLE IF NOT EXISTS satellite_current_state (
    satellite_id BIGINT PRIMARY KEY REFERENCES satellites(id) ON DELETE CASCADE,
    state_time TIMESTAMPTZ NOT NULL,
    x_ecef_km DOUBLE PRECISION NOT NULL,
    y_ecef_km DOUBLE PRECISION NOT NULL,
    z_ecef_km DOUBLE PRECISION NOT NULL,
    lat_deg DOUBLE PRECISION NOT NULL,
    lon_deg DOUBLE PRECISION NOT NULL,
    altitude_km DOUBLE PRECISION NOT NULL,
    source_run_id UUID NOT NULL REFERENCES propagation_runs(id) ON DELETE CASCADE,
    source_element_set_id BIGINT REFERENCES orbital_element_sets(id) ON DELETE SET NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ix_satellite_current_state_time
    ON satellite_current_state (state_time);

WITH ranked_active_jobs AS (
    SELECT id,
           ROW_NUMBER() OVER (
               PARTITION BY element_set_id
               ORDER BY requested_at, id
           ) AS duplicate_rank
    FROM propagation_jobs
    WHERE status IN ('pending', 'running')
)
UPDATE propagation_jobs
SET status = 'cancelled',
    finished_at = NOW(),
    error = 'duplicate active job cancelled during schema migration'
WHERE id IN (
    SELECT id FROM ranked_active_jobs WHERE duplicate_rank > 1
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_propagation_jobs_active_element
    ON propagation_jobs (element_set_id)
    WHERE status IN ('pending', 'running');
"""


def migrate_schema() -> bool:
    """Apply legacy conversion and additive worker schema updates.

    Returns True only when the pre-#12 TLE schema was converted.
    """
    with connect() as connection:
        connection.execute("SELECT pg_advisory_xact_lock(%s)", (MIGRATION_LOCK_ID,))
        state = connection.execute(
            """
            SELECT
                to_regclass('public.tle_sets') IS NOT NULL AS has_legacy_tle,
                to_regclass('public.orbital_element_sets') IS NOT NULL AS has_element_sets
            """
        ).fetchone()
        migrated_legacy = bool(state["has_legacy_tle"] and not state["has_element_sets"])
        if migrated_legacy:
            connection.execute(LEGACY_TO_ELEMENT_SET_SQL)
        connection.execute(CURRENT_SCHEMA_SQL)
        connection.commit()
        return migrated_legacy


def migrate_legacy_schema() -> bool:
    """Backward-compatible migration entry point used by existing tests/tools."""
    return migrate_schema()
