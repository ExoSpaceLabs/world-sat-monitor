# Deployment and release flow

WorldSat Monitor v1 supports two Docker Compose deployment modes: source builds for development and published container images for normal release deployment.

## Requirements

- Docker Engine with Compose v2
- network access to the selected orbital/map providers
- approximately the resources required by PostgreSQL plus the configured number of actively propagated satellites

The application is exposed through the gateway on:

```text
http://localhost:3000
```

## 1. Published-image deployment

`compose.images.yaml` is the release-oriented Compose file. It contains no local WorldSat Monitor `build:` directives.

Start the current v1 image set:

```bash
docker compose -f compose.images.yaml pull
docker compose -f compose.images.yaml up -d
```

Stop it without deleting persistent volumes:

```bash
docker compose -f compose.images.yaml down
```

Delete the stack and its local database/settings volumes:

```bash
docker compose -f compose.images.yaml down -v
```

The WorldSat images are:

```text
ghcr.io/exospacelabs/world-sat-monitor-frontend
ghcr.io/exospacelabs/world-sat-monitor-backend
```

The backend image is reused by:

- `backend`
- `orbital-provider`
- `propagator`

nginx and PostgreSQL use their upstream images directly.

### Pin a release

`compose.images.yaml` resolves the project image version from `WORLDSAT_IMAGE_TAG` and defaults to the release version declared for the stack.

Pin v1.0.0 explicitly:

```bash
WORLDSAT_IMAGE_TAG=1.0.0 docker compose -f compose.images.yaml pull
WORLDSAT_IMAGE_TAG=1.0.0 docker compose -f compose.images.yaml up -d
```

Using a semantic version is recommended for reproducible deployments. `latest` is convenient for interactive evaluation but is intentionally less reproducible.

## 2. Source-build deployment

`compose.yaml` is the development/source path. It builds the frontend and backend images from the checked-out repository.

```bash
docker compose up --build -d
```

This is the correct mode while modifying code on `develop`.

Useful operations:

```bash
docker compose ps
docker compose logs -f
docker compose logs -f backend orbital-provider propagator
docker compose down
docker compose down -v
```

## Persistent data

The Compose stack persists:

- PostgreSQL data in `postgres_data`;
- backend application settings in `settings_data`.

Recreating a container does not remove those volumes. `docker compose down -v` does.

## Runtime services

| Service | Container source | Purpose |
| --- | --- | --- |
| gateway | `nginx:stable-alpine` | ingress and routing |
| frontend | WorldSat frontend image | web UI |
| backend | WorldSat backend image | API/settings/query service |
| orbital-provider | WorldSat backend image | catalog/orbital acquisition |
| propagator | WorldSat backend image | SGP4 worker/retention |
| db | `postgres:17-bookworm` | durable database/job queue |

## Provider configuration

Common provider variables include:

```text
PROVIDER_POLL_SECONDS
PROVIDER_REFRESH_SECONDS
CELESTRAK_ENABLED
CELESTRAK_BASE_URL
CELESTRAK_CATALOG_URL
CELESTRAK_TIMEOUT_SECONDS
```

CI disables live CelesTrak access and uses deterministic fixtures/mock data. A normal deployment enables CelesTrak unless explicitly configured otherwise.

## Propagation configuration

Common propagation variables include:

```text
PROPAGATION_HISTORY_HOURS
PROPAGATION_HORIZON_DAYS
PROPAGATION_STEP_SECONDS
PROPAGATION_NEAR_HORIZON_HOURS
PROPAGATION_MID_HORIZON_HOURS
PROPAGATION_MID_STEP_SECONDS
PROPAGATION_FAR_STEP_SECONDS
PROPAGATION_SAMPLE_RETENTION_HOURS
PROPAGATION_CLEANUP_INTERVAL_SECONDS
PROPAGATION_CLEANUP_BATCH_SIZE
```

See [performance.md](performance.md) for the storage/sampling policy.

## Health checks

Gateway-visible backend health:

```bash
curl http://localhost:3000/api/v1/health
```

Compose also checks internal provider and propagator health endpoints. Their health is intentionally independent from frontend/browser state.

## Release branch policy

WorldSat Monitor uses:

- `develop` as the integration branch;
- `main` as the stable/release branch.

Both branches run CI, but **only `main` is allowed to publish release images or create a release tag**.

The release publisher uses GitHub Actions `workflow_run` and proceeds only when all of these conditions are true:

1. the completed workflow is `CI`;
2. the CI conclusion is `success`;
3. the CI head branch is `main`.

There is no `develop` publication path and no manual/tag trigger that bypasses the main CI gate. The semantic Git tag is an output of a successful main release, not its trigger.

## Immutable version contract

The publisher reads the semantic version from the root `VERSION` file and derives the Git tag:

```text
VERSION=1.0.0 -> v1.0.0
```

Before publishing, it checks the remote tag namespace:

- if `v<VERSION>` does not exist, the release may proceed;
- if the tag already points to the same validated main commit, a workflow rerun is allowed;
- if the tag exists on another commit, publication stops and `VERSION` must be bumped.

This prevents a later `main` commit from silently overwriting the immutable `1.0.0` container tag while still claiming to be the same release.

## Image publication

After successful CI on `main`, GitHub Actions builds frontend/backend images for:

```text
linux/amd64
linux/arm64
```

Published tags include:

```text
<version>
latest
sha-<validated-main-sha>
```

After both project images are published successfully, the workflow creates the lightweight Git tag `v<VERSION>` on that exact validated main commit if it does not already exist there.

The provider and propagator are not separately built because they execute different entry points from the same backend image.

## v1 release procedure

The v1.0.0 procedure is therefore:

1. finish and validate changes on `develop`;
2. ensure the complete `develop` CI pipeline is green;
3. merge `develop` to `main`;
4. allow the same CI pipeline to complete successfully on `main`;
5. the release workflow verifies that `v1.0.0` is not already owned by another commit;
6. it publishes the multi-architecture frontend/backend images;
7. it creates `v1.0.0` on the validated main commit;
8. verify the image-based Compose deployment using `WORLDSAT_IMAGE_TAG=1.0.0`.

No development commit is tagged merely to provoke automation. Future releases require a deliberate `VERSION` bump before another stable main revision can claim a new semantic release.

## Upgrade

For an image-based deployment pinned to a version:

```bash
WORLDSAT_IMAGE_TAG=<new-version> docker compose -f compose.images.yaml pull
WORLDSAT_IMAGE_TAG=<new-version> docker compose -f compose.images.yaml up -d
```

Database migrations are applied by the Python services during startup. Existing persistent volumes should still be backed up before production upgrades.
