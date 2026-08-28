CREATE TABLE satellites (
    id BIGSERIAL PRIMARY KEY,
    norad_id INTEGER NOT NULL UNIQUE,
    name TEXT NOT NULL,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE tle_sets (
    id BIGSERIAL PRIMARY KEY,
    satellite_id BIGINT NOT NULL REFERENCES satellites(id) ON DELETE CASCADE,
    epoch TIMESTAMPTZ NOT NULL,
    line1 TEXT NOT NULL,
    line2 TEXT NOT NULL,
    source TEXT NOT NULL,
    fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (satellite_id, epoch, line1, line2)
);

CREATE TABLE propagation_runs (
    id UUID PRIMARY KEY,
    satellite_id BIGINT NOT NULL REFERENCES satellites(id) ON DELETE CASCADE,
    source_tle_id BIGINT REFERENCES tle_sets(id) ON DELETE SET NULL,
    generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    start_time TIMESTAMPTZ NOT NULL,
    end_time TIMESTAMPTZ NOT NULL,
    step_seconds INTEGER NOT NULL CHECK (step_seconds > 0),
    status TEXT NOT NULL CHECK (status IN ('pending', 'running', 'completed', 'failed')),
    is_mock BOOLEAN NOT NULL DEFAULT FALSE,
    CHECK (end_time > start_time)
);

CREATE TABLE position_samples (
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

CREATE TABLE propagation_jobs (
    id BIGSERIAL PRIMARY KEY,
    satellite_id BIGINT NOT NULL REFERENCES satellites(id) ON DELETE CASCADE,
    tle_id BIGINT NOT NULL REFERENCES tle_sets(id) ON DELETE CASCADE,
    requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    horizon_days INTEGER NOT NULL DEFAULT 14 CHECK (horizon_days > 0),
    step_seconds INTEGER NOT NULL DEFAULT 10 CHECK (step_seconds > 0),
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'completed', 'failed')),
    started_at TIMESTAMPTZ,
    finished_at TIMESTAMPTZ,
    error TEXT
);

CREATE TABLE prediction_error_daily (
    id BIGSERIAL PRIMARY KEY,
    satellite_id BIGINT NOT NULL REFERENCES satellites(id) ON DELETE CASCADE,
    evaluated_run_id UUID NOT NULL REFERENCES propagation_runs(id) ON DELETE CASCADE,
    reference_tle_id BIGINT REFERENCES tle_sets(id) ON DELETE SET NULL,
    horizon_day SMALLINT NOT NULL CHECK (horizon_day BETWEEN 1 AND 30),
    mean_error_km DOUBLE PRECISION NOT NULL CHECK (mean_error_km >= 0),
    rms_error_km DOUBLE PRECISION NOT NULL CHECK (rms_error_km >= 0),
    p95_error_km DOUBLE PRECISION NOT NULL CHECK (p95_error_km >= 0),
    max_error_km DOUBLE PRECISION NOT NULL CHECK (max_error_km >= 0),
    sample_count INTEGER NOT NULL CHECK (sample_count >= 0),
    evaluated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    reference_kind TEXT NOT NULL DEFAULT 'tle',
    UNIQUE (evaluated_run_id, horizon_day)
);

INSERT INTO satellites (norad_id, name, active) VALUES (99001, 'LEGACY-SAT', TRUE);
INSERT INTO tle_sets (satellite_id, epoch, line1, line2, source)
VALUES (1, '2026-08-28T00:00:00Z', '1 LEGACY', '2 LEGACY', 'fixture');
INSERT INTO propagation_runs (id, satellite_id, source_tle_id, start_time, end_time, step_seconds, status)
VALUES ('00000000-0000-0000-0000-000000000001', 1, 1, '2026-08-28T00:00:00Z', '2026-08-29T00:00:00Z', 60, 'completed');
INSERT INTO propagation_jobs (satellite_id, tle_id) VALUES (1, 1);
INSERT INTO prediction_error_daily (
    satellite_id, evaluated_run_id, reference_tle_id, horizon_day,
    mean_error_km, rms_error_km, p95_error_km, max_error_km, sample_count
) VALUES (1, '00000000-0000-0000-0000-000000000001', 1, 1, 1, 1, 1, 1, 1);
