# ChatGPT Sites deployment (no external server)

[WorldSat Monitor](../README.md) supports **one frontend and one HTTP API contract**
with two runtime adapters:

| Runtime | Frontend | API + SGP4 | Persistence |
| --- | --- | --- | --- |
| Docker Compose (unchanged) | Next.js | Python API + provider + propagator | PostgreSQL |
| ChatGPT Sites | **Same** Next.js build | Sites Worker: on-demand `satellite.js`/SGP4 | Built-in D1 |

Sites does not run a Python process or Docker Compose. There is no external
server, tunnel, paid host or external database required for the Sites demo.
The adapter is in `frontend/edge/{api,orbit,schema}.ts`, attached to the
existing `frontend/worker/index.ts`. No copy of the UI is maintained.
The Sites worker also restores the nginx `/map/openfreemap/*` proxy route.

## Public demo semantics

- Every visitor receives a separate, random seven-day HTTP-only cookie and
  D1-backed satellite, group and settings state; visitors cannot alter each
  other's records using API requests. This is a guest **demo**, not user login.
- A labeled synthetic `WORLDSAT-01` spacecraft provides the initial orbit.
  CelesTrak single-object elements and selected small catalog groups use
  OMM/JSON and SGP4 **on demand**. The provider's fetched element sets are
  cached in D1 for two hours, including stale-on-error fallback.
- No continuous provider or propagation workers run in Sites: results are
  computed at request time. Timestamps/provenance indicate this.
- Public safety bounds: 200 satellites per visitor, 200 members per group,
  20 groups per visitor, 1,000 track points per request and a 5,000 API
  request/day visitor allowance. Large constellations are intentionally
  unsupported here. The original Docker implementation remains unrestricted
  by these demo caps.
- D1 has a Sites-side 10 GB cap. Set an access policy, monitor traffic and
  storage, and add stronger authentication/rate limiting for production usage.
  Guest cookies are NOT authenticated user identities or a defence against
  determined abuse. D1 session cleanup, global quotas, and upstream API
  throttling require operational verification before unrestricted public launch.
- CelesTrak GP and SATCAT are external public *data sources*, not user-hosted
  infrastructure. Site hosting and storage remain inside Sites.

The Python and JavaScript adapters share the URL and response envelope
contracts but are **not byte-identical**. Do not claim Docker worker/job-queue
semantics, exact numerical equality or unrestricted constellation scalability
on Sites. These are explicit technical tradeoffs of serverless hosting.

## Rebuild from GitHub

The authoritative repository is
`https://github.com/ExoSpaceLabs/world-sat-monitor`.

```bash
# Uses a fresh clone of latest main and Node 22.13.0; validates Sites artifact.
bash scripts/sites-rebuild.sh main

# Recreate an identified historical source revision:
WORLDSAT_SOURCE_SHA=<full-commit-sha> bash scripts/sites-rebuild.sh main

# Docker still uses the original workflow:
docker compose -f compose.images.yaml up -d
```

The script prints the **fresh checkout** under `sites_project_dir` and
`provenance.txt`. Deploy that exact directory (not the current workspace).
`npm ci`, lint, tests, build, benchmarks and artifact validation must pass.
Do not edit Sites-only code outside the repository; submit fixes as PRs.

In ChatGPT **Work** with `@Sites`:

1. Pull `main` and require its latest commit's GitHub CI to be green.
2. Run the rebuild script from a clean checkout, recording source SHA,
   lockfile SHA and resulting Sites artifacts.
3. Reuse the existing `project_id` in `frontend/.openai/hosting.json`
   and provision `d1: "DB"` for this Site. Do NOT create a duplicate Site.
4. Confirm D1 initialization via `GET /api/v1/health`, test
   `/api/v1/settings`, `/api/v1/satellites`, on-demand SGP4 position
   and track, catalog search and small-group import.
5. In Sites preview, test MapLibre globe, the three basemap modes,
   the OpenFreeMap proxy, star background, shadow, clock,
   satellite selection/follow and group markers. Test from a fresh browser
   session that guest data is isolated.
6. Save a **version** first. After review, deploy it to the existing URL,
   choose public sharing, and record version ID + commit SHA.

Do not report the site published until Sites confirms deployment and supplies
its actual public URL. A clean build does not establish runtime compatibility.
