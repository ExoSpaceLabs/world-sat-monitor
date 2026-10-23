# WorldSat Monitor agent contract

GitHub is the sole source of truth for both deployment targets. Preserve the
existing `compose.yaml` / `compose.images.yaml` Docker production behavior
when changing the Sites adapter.

## ChatGPT Sites

Read [docs/sites-deployment.md](docs/sites-deployment.md) before changing or
deploying a Site. Sites uses the SAME `frontend/` Next.js UI and HTTP paths,
with a Worker-hosted API, `satellite.js` SGP4 and built-in D1 database; it
does NOT need, and cannot run, the Python/PostgreSQL Docker stack.

- Build only a fresh `main` checkout using `scripts/sites-rebuild.sh main`
  (or explicitly pin `WORLDSAT_SOURCE_SHA` for exact source replay).
- Honor the returned `sites_project_dir` and capture commit, lockfile
  digest, green CI run and deployment version in the release record.
- Existing Sites linkage is `frontend/.openai/hosting.json`, with `d1=DB`.
  Provision D1 and reuse this project; do not create a duplicate Site.
- Do not turn demo fixtures into purported live ephemerides. Verify real
  catalog/GP ingestion, position+track, globe tiles and WebGL day/night before
  saving a version. Respect the Sites demo scale limits and public security.
- Save a Sites version for review; only deploy after tests pass. Do not claim
  publication without a confirmed production URL.
- Make all changes in a Git branch/PR, never in a separate uncommitted
  Sites-only copy. Rebuild from GitHub after merging.
