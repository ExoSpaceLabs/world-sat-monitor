# WorldSat Monitor

[![CI](https://github.com/ExoSpaceLabs/world-sat-monitor/actions/workflows/ci.yml/badge.svg)](https://github.com/ExoSpaceLabs/world-sat-monitor/actions/workflows/ci.yml)

WorldSat Monitor is a service-oriented satellite mission display built around an interactive 3D Earth. The browser is deliberately a rendering client: satellite catalog state, orbital-source acquisition, propagation products, interpolation, and persistent configuration live outside the UI.

Development work is performed on `develop`; `main` remains the stable branch and receives features after the development CI and integration path are stable.

## Repository layout

```text
frontend/       3D web UI, satellite management, API client
backend/        Shared Python package for API/provider/propagator processes
database/       PostgreSQL bootstrap schema
gateway/        Same-origin nginx gateway
config/         Documented settings JSON example
docs/           Architecture and rendering documentation
compose.yaml    Local multi-service deployment
```

## Runtime services

| Service | Responsibility |
| --- | --- |
| `gateway` | Exposes the application on port 3000 and routes `/api/` to the backend. |
| `frontend` | Renders Earth/orbits and manages user interaction and satellite lifecycle controls. |
| `backend` | Queries stored orbital state, interpolates requested positions, exposes satellite CRUD/lifecycle APIs, and persists application settings. |
| `orbital-provider` | Refreshes active satellites, normalizes provider data, stores immutable orbital element sets, and creates propagation jobs. |
| `propagator` | Claims propagation jobs, runs SGP4, and stores runs, trajectory samples, and current state. |
| `db` | Stores satellites, identifiers, provider state, orbital elements, propagation jobs/products, and quality metrics. |

All three Python processes currently use the same backend image/package, but they are independent Compose services with separate entry points and ownership. The backend request process does not fetch provider data or propagate orbits.

## Current vertical slice

The application currently provides:

- PostgreSQL satellite metadata with separate external identifiers such as NORAD and COSPAR;
- active/inactive satellite monitoring lifecycle without deleting inactive catalog entries;
- generalized `orbital_element_sets` storage based on OMM/GP semantics rather than mandatory two-line TLE text;
- a dedicated `orbital-provider` service with CelesTrak GP/JSON ingestion and deterministic mock-provider support;
- immutable element-set fingerprinting and duplicate suppression;
- PostgreSQL-backed propagation jobs claimed with `FOR UPDATE ... SKIP LOCKED`;
- a dedicated `propagator` service using SGP4;
- `satellite_current_state` for fast current-state access as constellation support grows;
- propagated ECEF/geographic trajectory samples with source-element traceability;
- current/arbitrary UTC position lookup with ECEF interpolation;
- configurable history/prediction track queries with API-side decimation;
- solid historical, dashed prediction, and independently controlled direction-vector rendering;
- global `GROUND` / `ORBIT` track placement;
- MapLibre globe-aware elevated WebGL rendering and Earth occlusion;
- persistent map/orbit settings;
- satellite management UI for adding local catalog entries and enabling/disabling monitoring;
- in-place migration from the pre-#12 TLE-centric database schema;
- CI for frontend, backend/provider/propagator unit tests, legacy-schema migration, and full Docker Compose integration.

## Deterministic synthetic satellite

`WORLDSAT-01` remains intentionally available as a permanent integration fixture.

```text
WORLDSAT-01
NORAD_CAT_ID = 999999999  (WorldSat-reserved synthetic identifier)
provider = mock
        ↓
fixed OMM-compatible element set
        ↓
orbital_element_sets
        ↓
propagation_jobs
        ↓
SGP4 propagator
        ↓
propagation_runs + position_samples + satellite_current_state
        ↓
backend API
        ↓
frontend
```

The identifier is explicitly synthetic and is not claimed to be an official USSF/NORAD catalog assignment. The mock provider always returns the same valid orbital elements, allowing provider deduplication and the entire downstream system to be tested without network access.

Current `python-sgp4` releases constrain the internal `Satrec.satnum` metadata field to `0..339999`. When an OMM record carries a larger catalog identifier, WorldSat Monitor preserves the real identifier in the source payload/database and uses `0` only as the local SGP4 identity sentinel. Satellite number does not participate in SGP4 orbital dynamics.

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
           fingerprint
           raw_payload
```

Classic TLE/Alpha-5 remains a possible input representation, but it is not the canonical database model. A legacy TLE row is migrated into an orbital element set with `source_format=TLE` and its original lines retained in `raw_payload`.

## Monitoring lifecycle

`active` means WorldSat Monitor should maintain orbital source data and propagation for that satellite.

```text
inactive
  metadata + identifiers retained
  no scheduled provider acquisition
  no pending propagation work

active
  provider refresh enabled
  newest accepted element set persisted
  propagation job created when required
```

Deactivation is non-destructive. Historical element sets and propagation products remain available, while pending jobs are cancelled and workers will not claim new work for the inactive object. Runtime map selection remains separate from monitoring state.

## Provider flow

For each active satellite, `orbital-provider` selects the configured provider (`mock`, `celestrak`, and later additional providers), fetches only when due, normalizes the response into the OMM-compatible model, and fingerprints the orbital content.

```text
active satellite
      ↓
OrbitalDataProvider
      ↓
normalized element set
      ↓
deduplicate by satellite + source + fingerprint
      ↓
orbital_element_sets
      ↓
propagation_jobs
```

CelesTrak acquisition explicitly requests GP JSON. CI disables live CelesTrak access and uses saved fixtures plus the deterministic mock provider, so external service availability cannot make the build randomly red.

## Propagation flow

```text
propagation_jobs
      ↓
FOR UPDATE SKIP LOCKED
      ↓
SGP4PropagationEngine
      ↓
TEME state
      ↓
Earth rotation / ECEF
      ↓
position_samples
satellite_current_state
propagation_runs
```

The current engine abstraction is `PropagationEngine`; SGP4 is the first implementation rather than the architecture itself. This leaves room for OEM/state-vector interpolation or other propagation products later.

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
curl http://localhost:3000/api/v1/satellites/999999999/position
curl "http://localhost:3000/api/v1/satellites/999999999/track?resolution_seconds=60"
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

## Configuration

Important worker environment variables include:

```text
PROVIDER_POLL_SECONDS
PROVIDER_REFRESH_SECONDS
CELESTRAK_ENABLED
CELESTRAK_BASE_URL
CELESTRAK_TIMEOUT_SECONDS
PROPAGATOR_POLL_SECONDS
PROPAGATION_HISTORY_HOURS
PROPAGATION_HORIZON_DAYS
PROPAGATION_STEP_SECONDS
```

The default Compose stack enables CelesTrak. CI sets `CELESTRAK_ENABLED=false` and validates the same provider/propagator pipeline through `WORLDSAT-01`.

## Development and CI

Frontend:

```bash
cd frontend
npm ci
npm run lint
npm test
```

Backend and workers:

```bash
python -m pip install -r backend/requirements.txt
PYTHONPATH=backend python -m unittest discover -s backend/tests -v
```

CI runs on pushes to both `main` and `develop` and on pull requests. It covers:

1. frontend lint/build/tests/artifact validation;
2. backend/provider/propagator compile and unit tests;
3. deterministic provider normalization and SGP4 reference-vector validation;
4. an actual PostgreSQL migration from the legacy TLE schema;
5. full Docker Compose startup and worker health;
6. mock provider -> element-set -> job -> SGP4 -> DB -> backend position/track integration;
7. element-set deduplication and `satellite_current_state` creation;
8. satellite CRUD/activation/deactivation behavior and persistent settings.

See [`docs/architecture.md`](docs/architecture.md) for service ownership and data flow, and [`docs/orbit-display.md`](docs/orbit-display.md) for the globe-track rendering pipeline.
