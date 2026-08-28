CREATE TABLE IF NOT EXISTS satellites (
    id BIGSERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    active BOOLEAN NOT NULL DEFAULT FALSE,
    object_type TEXT NOT NULL DEFAULT 'payload',
    provider_preference TEXT,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ix_satellites_active_name
    ON satellites (active, name);

CREATE TABLE IF NOT EXISTS satellite_identifiers (
    id BIGSERIAL PRIMARY KEY,
    satellite_id BIGINT NOT NULL REFERENCES satellites(id) ON DELETE CASCADE,
    namespace TEXT NOT NULL,
    value TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (namespace, value),
    UNIQUE (satellite_id, namespace)
);

CREATE INDEX IF NOT EXISTS ix_satellite_identifiers_satellite
    ON satellite_identifiers (satellite_id);

CREATE TABLE IF NOT EXISTS orbital_element_sets (
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

CREATE INDEX IF NOT EXISTS ix_orbital_element_sets_satellite_epoch
    ON orbital_element_sets (satellite_id, epoch DESC);

CREATE UNIQUE INDEX IF NOT EXISTS ux_orbital_element_sets_source_fingerprint
    ON orbital_element_sets (satellite_id, source, fingerprint)
    WHERE fingerprint IS NOT NULL;

CREATE TABLE IF NOT EXISTS propagation_runs (
    id UUID PRIMARY KEY,
    satellite_id BIGINT NOT NULL REFERENCES satellites(id) ON DELETE CASCADE,
    source_element_set_id BIGINT REFERENCES orbital_element_sets(id) ON DELETE SET NULL,
    generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    start_time TIMESTAMPTZ NOT NULL,
    end_time TIMESTAMPTZ NOT NULL,
    step_seconds INTEGER NOT NULL CHECK (step_seconds > 0),
    status TEXT NOT NULL CHECK (status IN ('pending', 'running', 'completed', 'failed')),
    is_mock BOOLEAN NOT NULL DEFAULT FALSE,
    CHECK (end_time > start_time)
);

CREATE INDEX IF NOT EXISTS ix_propagation_runs_satellite_time
    ON propagation_runs (satellite_id, generated_at DESC, start_time, end_time);

CREATE TABLE IF NOT EXISTS position_samples (
    run_id UUID NOT NULL REFERENCES propagation_runs(id) ON DELETE CASCADE,
    satellite_id BIGINT NOT NULL REFERENCES satellites(id) ON DELETE CASCADE,
    sample_time TIMESTAMPTZ NOT NULL,
    x_ecef_km DOUBLE PRECISION NOT NULL,
    y_ecef_km DOUBLE PRECISION NOT NULL,
    z_ecef_km DOUBLE PRECISION NOT NULL,
    lat_deg DOUBLE PRECISION NOT NULL,
    lon_deg DOUBLE PRECISION NOT NULL,
    altitude_km DOUBLE PRECISION NOT NULL,
    PRIMARY KEY (run_id, sample_time)
);

CREATE INDEX IF NOT EXISTS ix_position_samples_satellite_time
    ON position_samples (satellite_id, sample_time);

CREATE TABLE IF NOT EXISTS propagation_jobs (
    id BIGSERIAL PRIMARY KEY,
    satellite_id BIGINT NOT NULL REFERENCES satellites(id) ON DELETE CASCADE,
    element_set_id BIGINT NOT NULL REFERENCES orbital_element_sets(id) ON DELETE CASCADE,
    requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    horizon_days INTEGER NOT NULL DEFAULT 14 CHECK (horizon_days > 0),
    step_seconds INTEGER NOT NULL DEFAULT 10 CHECK (step_seconds > 0),
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'running', 'completed', 'failed')),
    started_at TIMESTAMPTZ,
    finished_at TIMESTAMPTZ,
    error TEXT
);

CREATE INDEX IF NOT EXISTS ix_propagation_jobs_status_requested
    ON propagation_jobs (status, requested_at);

CREATE TABLE IF NOT EXISTS prediction_error_daily (
    id BIGSERIAL PRIMARY KEY,
    satellite_id BIGINT NOT NULL REFERENCES satellites(id) ON DELETE CASCADE,
    evaluated_run_id UUID NOT NULL REFERENCES propagation_runs(id) ON DELETE CASCADE,
    reference_element_set_id BIGINT REFERENCES orbital_element_sets(id) ON DELETE SET NULL,
    horizon_day SMALLINT NOT NULL CHECK (horizon_day BETWEEN 1 AND 30),
    mean_error_km DOUBLE PRECISION NOT NULL CHECK (mean_error_km >= 0),
    rms_error_km DOUBLE PRECISION NOT NULL CHECK (rms_error_km >= 0),
    p95_error_km DOUBLE PRECISION NOT NULL CHECK (p95_error_km >= 0),
    max_error_km DOUBLE PRECISION NOT NULL CHECK (max_error_km >= 0),
    sample_count INTEGER NOT NULL CHECK (sample_count >= 0),
    evaluated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    reference_kind TEXT NOT NULL DEFAULT 'orbital_element_set',
    UNIQUE (evaluated_run_id, horizon_day)
);

CREATE INDEX IF NOT EXISTS ix_prediction_error_satellite_horizon
    ON prediction_error_daily (satellite_id, horizon_day, evaluated_at DESC);
