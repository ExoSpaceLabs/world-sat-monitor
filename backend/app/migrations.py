from __future__ import annotations

from .db import connect


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


def migrate_legacy_schema() -> bool:
    """Migrate the pre-#12 TLE schema in-place. Returns True when migration ran."""
    with connect() as connection:
        state = connection.execute(
            """
            SELECT
                to_regclass('public.tle_sets') IS NOT NULL AS has_legacy_tle,
                to_regclass('public.orbital_element_sets') IS NOT NULL AS has_element_sets
            """
        ).fetchone()
        if not state["has_legacy_tle"] or state["has_element_sets"]:
            return False
        connection.execute(LEGACY_TO_ELEMENT_SET_SQL)
        connection.commit()
        return True
