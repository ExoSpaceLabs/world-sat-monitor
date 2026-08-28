# WorldSat Monitor

[![CI](https://github.com/ExoSpaceLabs/world-sat-monitor/actions/workflows/ci.yml/badge.svg)](https://github.com/ExoSpaceLabs/world-sat-monitor/actions/workflows/ci.yml)

WorldSat Monitor is a service-oriented satellite mission display built around an interactive 3D Earth. The browser is deliberately a rendering client: satellite catalog state, orbital-source data, propagation products, interpolation, and persistent configuration live outside the UI.

Development work is performed on `develop`; `main` remains the stable branch and receives features after the development CI and integration path are stable.

## Repository layout

```text
frontend/       3D web UI, satellite management, API client
backend/        FastAPI query/management/settings service
database/       PostgreSQL bootstrap schema
gateway/        Same-origin nginx gateway
config/         Documented settings JSON example
docs/           Architecture and rendering documentation
compose.yaml    Local multi-service deployment
```

## Current vertical slice

The current application provides:

- PostgreSQL satellite metadata with separate external identifiers such as NORAD and COSPAR
- active/inactive satellite monitoring lifecycle without deleting inactive catalog entries
- generalized `orbital_element_sets` storage based on OMM/GP semantics rather than mandatory two-line TLE text
- one dynamic backend-generated mock satellite (`WORLDSAT-01`, NORAD `99001`)
- 10-second mock ECEF samples covering 48 hours of history and 15 days of future state
- current/arbitrary UTC position lookup with ECEF interpolation
- configurable history/prediction track queries with API-side decimation
- solid historical, dashed prediction, and independently controlled direction-vector rendering
- global `GROUND` / `ORBIT` track placement
- MapLibre globe-aware elevated WebGL rendering and Earth occlusion
- persistent map/orbit settings
- satellite management UI for adding local catalog entries and enabling/disabling monitoring
- in-place migration from the pre-#12 TLE-centric database schema
- CI for frontend, backend, legacy-schema migration, and full Docker Compose integration

The mock generator remains temporary. It stabilizes the API/database/rendering/lifecycle flows while the dedicated orbital-provider and propagation services are implemented.

## Service boundaries

| Service | Responsibility |
| --- | --- |
| `gateway` | Exposes the application on port 3000 and routes `/api/` to the backend. |
| `frontend` | Renders Earth/orbits and manages user interaction and satellite lifecycle controls. |
| `backend` | Queries stored orbital state, interpolates positions, exposes satellite CRUD/lifecycle APIs, and persists application settings. |
| `db` | Stores satellites, identifiers, orbital element sets, propagation jobs/products, and quality metrics. |

Planned independent services are `orbital-provider`, `propagator`, and `quality-worker`. The backend request process must not become the fetch scheduler or propagator.

## Orbital data model

A satellite is an internal entity and is not identified by a NORAD number in the primary key. External catalog identities live in `satellite_identifiers`:

```text
satellites
    |
    +-- satellite_identifiers
    |      NORAD_CAT_ID
    |      COSPAR
    |      future provider namespaces
    |
    +-- orbital_element_sets
           source
           source_format
           mean_element_theory
           OMM/GP mean-element fields
           raw_payload
```

Classic TLE/Alpha-5 can still be ingested later, but it is an input representation rather than the canonical database model. A legacy TLE row is migrated into an orbital element set with `source_format=TLE` and its original lines preserved in `raw_payload`.

Propagation runs, jobs, and prediction-quality references now point to generalized orbital element sets.

## Satellite lifecycle

`active` means WorldSat Monitor should maintain orbital source data and propagation for that satellite once the provider/worker services are available.

```text
inactive
  metadata + identifiers retained
  no scheduled provider/propagation work

active
  metadata + identifiers retained
  provider refresh required
  propagation required when fresh elements arrive
```

Deactivation is non-destructive. Historical element sets and propagation products remain available. Runtime map selection is separate from monitoring state.

## API

Start the stack:

```bash
docker compose up --build
```

Open `http://localhost:3000`.

Useful endpoints:

```bash
curl http://localhost:3000/api/v1/health
curl http://localhost:3000/api/v1/settings
curl http://localhost:3000/api/v1/satellites
curl "http://localhost:3000/api/v1/satellites?active=true"
curl http://localhost:3000/api/v1/satellites/99001/position
curl "http://localhost:3000/api/v1/satellites/99001/track?resolution_seconds=60"
```

Create an inactive catalog entry:

```bash
curl -X POST http://localhost:3000/api/v1/satellites \
  -H 'Content-Type: application/json' \
  -d '{
    "name": "EXAMPLE-SAT",
    "active": false,
    "identifiers": [
      {"namespace": "NORAD_CAT_ID", "value": "100001"},
      {"namespace": "COSPAR", "value": "2026-001A"}
    ]
  }'
```

Lifecycle operations use the internal satellite ID returned by the API:

```text
POST   /api/v1/satellites/{id}/activate
POST   /api/v1/satellites/{id}/deactivate
PATCH  /api/v1/satellites/{id}
DELETE /api/v1/satellites/{id}
```

Active satellites must be deactivated before deletion.

## Development and CI

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

CI runs on pushes to both `main` and `develop` and on pull requests. It covers:

1. frontend lint/build/tests/artifact validation;
2. backend compile/unit tests;
3. an actual PostgreSQL migration from the legacy TLE schema;
4. full Docker Compose startup, schema assertions, satellite CRUD/activation/deactivation, position/track queries, and persistent settings.

## Next services

The next production data path is:

```text
active satellites
      -> orbital-provider
      -> normalized orbital_element_sets
      -> propagation_jobs
      -> propagator / SGP4 initially
      -> propagation_runs + position_samples
      -> backend
      -> frontend
```

See [`docs/architecture.md`](docs/architecture.md) for service ownership and data flow, and [`docs/orbit-display.md`](docs/orbit-display.md) for the globe-track rendering pipeline.
