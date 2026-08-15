# WorldSat Monitor

[![CI](https://github.com/ExoSpaceLabs/world-sat-monitor/actions/workflows/ci.yml/badge.svg)](https://github.com/ExoSpaceLabs/world-sat-monitor/actions/workflows/ci.yml)

WorldSat Monitor is a service-oriented satellite mission display built around an interactive 3D Earth. The browser is deliberately a rendering client; catalogue storage, propagated state, interpolation, persistent configuration, and eventually TLE ingestion live outside the UI.

## Repository layout

```text
frontend/       3D web UI and API client
backend/        FastAPI position/query/settings service
database/       PostgreSQL bootstrap schema
gateway/        Same-origin nginx gateway
config/         Documented settings JSON example
docs/           Architecture and system-flow diagrams
compose.yaml    Local multi-service deployment
```

## Current backend/frontend slice

The current vertical slice provides:

- PostgreSQL satellite, TLE, propagation-run, position-sample, job, and prediction-error tables
- one dynamic backend-generated mock satellite (`WORLDSAT-01`, NORAD `99001`)
- 10-second mock ECEF samples covering 48 hours of history and 15 days of future state
- current/arbitrary UTC position lookup with ECEF interpolation
- configurable history/prediction track queries with API-side decimation
- solid historical, dashed prediction, and independently controlled direction-vector rendering
- global `GROUND` / `ORBIT` track placement
- MapLibre globe-aware elevated WebGL overlay rendering without screen-space altitude approximation
- 14 daily mock prediction-disagreement buckets for future UI plotting
- persistent map settings plus global orbit-display settings in a mounted JSON file
- automatic migration of older settings files to the current schema
- same-origin routing through nginx

The mock generator is temporary. Its purpose is to stabilize the API, database, rendering, and settings flows before adding a TLE provider and a real SGP4 propagation worker.

## Services

| Service | Responsibility |
| --- | --- |
| `gateway` | Exposes the application on port 3000 and routes `/api/` to the backend. |
| `frontend` | Renders Earth, interpolated satellite state, history/prediction tracks, and controls. |
| `backend` | Queries stored state, interpolates position, serves API responses, and persists settings. |
| `db` | Stores managed satellites, immutable TLEs, propagation products, jobs, and quality metrics. |
| `settings_data` | Docker volume containing `/data/settings.json`. |

Planned next services are a TLE fetcher and SGP4 orbit propagator. PostgreSQL already contains a `propagation_jobs` queue so a newly accepted TLE can enqueue work without making the user-facing backend perform propagation.

See [`docs/architecture.md`](docs/architecture.md) for the complete service/data architecture and [`docs/orbit-display.md`](docs/orbit-display.md) for the globe-track rendering pipeline.

## Run

```bash
docker compose up --build
```

Open `http://localhost:3000`.

The API is available through the same origin:

```bash
curl http://localhost:3000/api/v1/health
curl http://localhost:3000/api/v1/settings
curl http://localhost:3000/api/v1/satellites
curl http://localhost:3000/api/v1/satellites/99001/position
curl "http://localhost:3000/api/v1/satellites/99001/track?resolution_seconds=60"
curl http://localhost:3000/api/v1/satellites/99001/prediction-error
```

## Orbit display

Orbit-display policy is global across tracked satellites. The Orbit Settings panel controls:

- history length
- future prediction length
- requested path sample step
- path refresh period
- interpolated-position request period
- orbit-path visibility
- direction-vector visibility
- `GROUND` versus `ORBIT` track placement

`GROUND` forces path elevation to zero and displays the satellite nadir track on Earth. `ORBIT` uses the propagated altitude for each sample.

History, prediction, and direction geometry is drawn by a MapLibre custom WebGL overlay. Backend samples are densified only for display, split at the dateline, and remain geographic until MapLibre performs the final projection. Each render vertex carries altitude in both coordinate systems needed by MapLibre: physical metres for the globe shader and conformal Mercator z for the Mercator shader.

## Persistent settings

The backend creates `/data/settings.json` on first startup and stores it in the Compose `settings_data` volume. The frontend loads that document through `GET /api/v1/settings`. UI changes are validated by the backend and atomically persisted through `PUT /api/v1/settings`.

The schema is documented in [`config/settings.example.json`](config/settings.example.json).

Inspect the live file:

```bash
docker compose exec backend cat /data/settings.json
```

Reset the complete document to defaults:

```bash
curl -X POST http://localhost:3000/api/v1/settings/reset
```

The Map Settings and Orbit Settings panels reset only their own section and persist the resulting full document.

Satellite selection is runtime UI state and is deliberately not stored in the global settings file. Version-1 and version-2 settings documents are migrated automatically to schema version 3 while preserving applicable map/path/update values.

## Development

Frontend:

```bash
cd frontend
npm ci
npm run lint
npm test
```

Backend:

```bash
PYTHONPATH=backend python -m unittest discover -s backend/tests -v
```

The normal integration path is Docker Compose so the backend, PostgreSQL schema, mock seed, frontend, and settings volume stay aligned.

## Prediction quality

Prediction quality is stored per forecast-horizon day. The intended production evaluator compares an older propagation with a later reference ephemeris/TLE at matching timestamps and records mean, RMS, p95, maximum disagreement, and sample count.

A later TLE is still an estimate, not physical ground truth. The UI should therefore present this as a prediction disagreement/error estimate. If precise GNSS or operator ephemerides are added later, the same model can identify them as a higher-quality reference source.
