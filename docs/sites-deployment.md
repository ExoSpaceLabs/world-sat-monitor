# ChatGPT Sites deployment contract

WorldSat Monitor's authoritative source is
[ExoSpaceLabs/world-sat-monitor](https://github.com/ExoSpaceLabs/world-sat-monitor).
ChatGPT Sites is a public-facing UI hosting target, **not** a replacement for
the Python orbital-processing workers or PostgreSQL.

## Current architecture and compatibility

- Sites source directory: `frontend/`
- Sites project linkage: `frontend/.openai/hosting.json`
- Frontend stack: Next.js/React, vinext/Vite and MapLibre.
- Backend stack: `backend`, `orbital-provider`, `propagator`, PostgreSQL.
- Docker gateway currently routes `/api/`, `/api/v1/catalog/`, and
  `/map/openfreemap/`. Sites does **not** inherit that nginx configuration.
- Frontend API calls are same-origin relative paths, so publishing the frontend
  without configuring equivalent API routing will cause API failures.
- The satellite imagery basemap uses OpenFreeMap style routing as configured
  in `frontend/app/maps/styles.ts`; restore this route before public deployment.

Do not replace the real UI or orbital calculations with an invented demo to
make the build appear green. In a separate **public-demo deployment**, expose a
constrained read-only API surface with rate limits and resource limits. The
current browser UI contains management, settings, group and catalog mutation
calls. Do not proxy write methods to a public shared backend without explicit
visitor authentication, per-user isolation, and authorization. A UI-only
disabled button is not an API security boundary.

## Deterministic source rebuild

There are two intentional operations:

- **Update:** fetch the latest approved `main` commit, then build that exact
  commit. The revision advances only when GitHub's `main` advances.
- **Replay:** set `WORLDSAT_SOURCE_SHA` to a previously recorded full Git
  commit SHA and rebuild that revision. No new source changes are used.

From a Work/Codex environment with GitHub network access and Node 22.13.0:

```bash
bash scripts/sites-rebuild.sh main

# To reproduce a historical source revision:
WORLDSAT_SOURCE_SHA=<full-40-character-commit-sha> \
  bash scripts/sites-rebuild.sh main
```

The entry point always obtains a **fresh checkout** from GitHub, installs
exactly the `frontend/package-lock.json` dependencies via `npm ci`, and
runs the established frontend lint, test/build, group benchmark and Sites
artifact validation steps. On failure it must not publish.

On success the script reports:

- `sites_project_dir`: use this exact `frontend/` checkout for Sites
  version creation, rather than an old local workspace or regenerated code.
- `source_sha`: immutable Git commit used for the build.
- `frontend_lock_sha256`, Node and npm versions in `provenance.txt`.

A clean frontend build does **not** prove the remote backend or browser behavior
is functional. Before publishing, additionally check live API health, map tile
loading, UTC/day-night shader, shadows, globe rendering, satellite position and
track, group markers, and all applicable UI actions in the Sites preview.

## Release deployment

1. Require a green GitHub CI run for the selected `main` commit. If a Sites
   compatibility change is needed, submit a pull request and merge only after
   CI. Never patch the Sites working copy independently of the repository.
2. Run `scripts/sites-rebuild.sh main` and capture the source SHA and
   provenance file. For exact replay, provide `WORLDSAT_SOURCE_SHA`.
3. Configure Sites to serve the resulting `sites_project_dir` and link it
   to the existing project in `.openai/hosting.json`; inspect that project
   linkage rather than creating a duplicate hosted Site.
4. Configure HTTPS same-origin API routing or a securely configured alternative
   and test `/api/v1/health`, catalogue routes and map resource loading.
   Keep Python orbital workers and PostgreSQL on external Docker infrastructure.
5. **Save a Sites version** for review and associate it with the captured
   commit SHA. Save is not deploy.
6. Validate browser behavior from the Sites preview, especially map rendering
   and protected management operations; then deploy the reviewed version to the
   existing Sites URL. Enable public access only after security checks pass.
7. Keep a deployment record with Git SHA, frontend lock digest, backend image
   digests, CI URL, Sites version ID and public URL.

## What this does and does not guarantee

The script makes the **source selection and validation procedure repeatable**.
`npm ci` verifies packages using lockfile integrity data, with Node 22.13.0
pinned to match CI. This is not yet a byte-for-byte reproducible **entire
operational stack**:

- `compose.images.yaml` uses semver image tags, and nginx/Postgres use mutable
  upstream tags. Pin resolved OCI digests and capture them in the deployment
  record before claiming exact backend replay.
- Live CelesTrak orbital records, map-provider tiles, external availability and
  persistent PostgreSQL state change over time by design.
- No GitHub-to-Sites automatic deploy trigger is claimed here. A request to
  rebuild in Work must execute the fresh-source entry point and then perform
  Sites save/deploy deliberately.

Use this process instead of Sites-only edits. Changes belong in GitHub first.
