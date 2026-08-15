# WorldSat Monitor

[![CI](https://github.com/ExoSpaceLabs/world-sat-monitor/actions/workflows/ci.yml/badge.svg)](https://github.com/ExoSpaceLabs/world-sat-monitor/actions/workflows/ci.yml)

WorldSat Monitor is a service-oriented satellite mission display built around an interactive 3D Earth. The browser is deliberately a rendering client; catalogue storage, propagated state, interpolation, and eventually TLE ingestion live outside the UI.

## Repository layout

```text
frontend/       Existing 3D web UI
backend/        FastAPI position/query service
database/       PostgreSQL bootstrap schema
gateway/        Same-origin nginx gateway
docs/           Architecture notes
compose.yaml    Local multi-service deployment
```

The previous repository-root application has been moved intact under `frontend/` so frontend tooling and future backend services no longer share a directory by historical accident.

## Current backend slice

The first backend vertical slice provides:

- PostgreSQL satellite, TLE, propagation-run, position-sample, job, and prediction-error tables
- one dynamic mock satellite (`WORLDSAT-01`, NORAD `99001`)
- mock propagated samples at a 10-second cadence
- current/arbitrary UTC position lookup
- ECEF interpolation between bracketing samples
- past/future ground-track queries with API-side decimation
- 14 daily mock prediction-disagreement buckets for future UI plotting
- same-origin routing through nginx

The mock generator is intentionally temporary. Its purpose is to stabilize the API and data flow before adding TLE-provider behavior and an actual SGP4/Orekit propagation service.

## Services

| Service | Responsibility |
| --- | --- |
| `gateway` | Exposes the application on port 3000 and routes `/api/` to the backend. |
| `frontend` | Renders the Earth, satellite state, controls, and future track/error overlays. |
| `backend` | Queries stored state, interpolates current position, and serves API responses. |
| `db` | Stores managed satellites, immutable TLEs, propagation products, jobs, and quality metrics. |

Planned next services are a TLE fetcher and orbit propagator. The database already contains a `propagation_jobs` queue so a new TLE can enqueue work without making the user-facing backend responsible for propagation.

See [`docs/architecture.md`](docs/architecture.md) for the service boundaries and prediction-quality model.

## Run

```bash
docker compose up --build
```

Open `http://localhost:3000`.

The API is available through the same origin:

```bash
curl http://localhost:3000/api/v1/health
curl http://localhost:3000/api/v1/satellites
curl http://localhost:3000/api/v1/satellites/99001/position
curl "http://localhost:3000/api/v1/satellites/99001/track?resolution_seconds=60"
curl http://localhost:3000/api/v1/satellites/99001/prediction-error
```

The backend accepts timezone-aware ISO 8601 timestamps. If `at` is omitted from the position endpoint, backend current UTC is used.

## Frontend development

Requirements are Node.js `>=22.13.0` and npm.

```bash
cd frontend
npm ci
npm run dev
```

Quality gates:

```bash
npm run lint
npm test
```

The frontend page entry point is `frontend/app/page.tsx`; rendering components and their styles remain under `frontend/app/components`, with shared rendering contracts under `frontend/app/domain`.

## Backend development

The backend targets Python 3.13. Orbit math tests do not require a running database:

```bash
PYTHONPATH=backend python -m unittest discover -s backend/tests -v
```

The normal development path is Docker Compose so the backend and PostgreSQL schema stay aligned.

## Prediction quality

Prediction quality is stored per forecast-horizon day. The intended production evaluator compares an older propagation with a later reference ephemeris/TLE at matching timestamps and records mean, RMS, p95, maximum disagreement, and sample count.

A later TLE is still an estimate, not physical ground truth. The UI should therefore present this as a prediction disagreement/error estimate. If precise GNSS or operator ephemerides are added later, the same model can identify them as a higher-quality reference source.
