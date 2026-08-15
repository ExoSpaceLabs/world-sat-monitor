# WorldSat Monitor service architecture

## Current vertical slice

The repository is split into independently deployable services:

- `frontend`: the existing 3D mission UI. It renders state but does not own orbit propagation.
- `backend`: FastAPI query service. It resolves current position, interpolates between stored samples, returns track data, and exposes prediction-quality metrics.
- `db`: PostgreSQL catalogue and propagated-state store.
- `gateway`: nginx front door. `/` is routed to the frontend and `/api/` to the backend, so the browser can use same-origin APIs.

The backend seeds one dynamic mock satellite (`WORLDSAT-01`, NORAD `99001`) when the database is empty or the previous mock run has expired. Mock samples use a 10-second cadence and cover a short history plus an arbitrary future prediction window.

## Planned services

### TLE fetcher

Responsibilities:

1. Load the list of managed satellites from `satellites`.
2. Fetch newer TLEs from the configured provider.
3. Insert immutable rows into `tle_sets`.
4. Enqueue one `propagation_jobs` row for each newly accepted TLE.

The fetcher should not propagate or serve HTTP position queries. Keeping ingestion separate prevents provider failures from taking down the user-facing API.

### Orbit propagator

Responsibilities:

1. Claim pending jobs from `propagation_jobs` using PostgreSQL row locking (`FOR UPDATE SKIP LOCKED`).
2. Propagate the source TLE at the configured cadence, initially 10 seconds.
3. Store one `propagation_runs` record and its `position_samples`.
4. Mark the job completed or failed.

A 14-day run at 10-second cadence is 120,960 samples per satellite. That is reasonable for PostgreSQL, but API responses should always be decimated before being sent to the browser.

### Prediction-quality evaluator

This can initially live in the propagator process rather than becoming another container.

When a newer reference TLE arrives, the evaluator propagates that newer TLE over timestamps covered by older runs and compares ECEF position vectors at equal timestamps. Results are grouped by forecast horizon day and written to `prediction_error_daily`.

A later TLE is not ground truth. The UI should label this as prediction disagreement/error estimate. If precise GNSS or operator ephemerides become available, `reference_kind` can identify them as the higher-quality truth source.

Recommended daily buckets for a 14-day forecast are days 1 through 14, with at least mean, RMS, p95, maximum error, and sample count. Keeping distributions rather than a single number avoids giving users a suspiciously tidy confidence curve produced by orbital mechanics, which is rarely that polite.

## Position interpolation

Raw propagated samples are stored in ECEF Cartesian coordinates plus cached geodetic coordinates for display. Current-position queries find the two 10-second samples bracketing the requested UTC timestamp and linearly interpolate in ECEF, then convert the interpolated vector to latitude/longitude/altitude.

This deliberately avoids directly interpolating longitude, which fails at the ±180° meridian. For a 10-second step the ECEF linear approximation is adequate for display. If higher precision becomes necessary, store velocity and switch to cubic Hermite interpolation without changing the public API.

## API surface

- `GET /api/v1/health`
- `GET /api/v1/satellites`
- `GET /api/v1/satellites/{norad_id}/position?at=<UTC timestamp>`
- `GET /api/v1/satellites/{norad_id}/track?start=<UTC>&end=<UTC>&resolution_seconds=60`
- `GET /api/v1/satellites/{norad_id}/prediction-error`

The backend owns authoritative timestamps. If `at` is omitted from the position endpoint, it uses current UTC.

## Data ownership

`tle_sets` is append-only source data. `propagation_runs` identifies a deterministic propagation product from a specific TLE or a mock generator. `position_samples` contains the dense state series. `prediction_error_daily` contains historical quality statistics. The frontend should not write any of these tables.
