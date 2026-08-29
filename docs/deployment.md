# Deployment

WorldSat Monitor supports two Docker Compose paths.

## Local source build

Use the default Compose file while developing or validating source changes:

```bash
docker compose up --build
```

`compose.yaml` builds the frontend and shared Python backend image from the local checkout. The API, orbital provider, and propagator remain separate services even though they share that backend image.

## Published images

Stable deployments can use images published to GitHub Container Registry and avoid local application builds:

```bash
docker compose -f compose.images.yaml pull
docker compose -f compose.images.yaml up -d
```

The current release defaults to `1.0.0`. Override the image tag explicitly when required:

```bash
WORLDSAT_IMAGE_TAG=latest docker compose -f compose.images.yaml up -d
```

or pin a specific published release:

```bash
WORLDSAT_IMAGE_TAG=1.0.0 docker compose -f compose.images.yaml up -d
```

Published project images are:

```text
ghcr.io/exospacelabs/world-sat-monitor-frontend
ghcr.io/exospacelabs/world-sat-monitor-backend
```

`backend`, `orbital-provider`, and `propagator` intentionally reuse the same backend image with different commands. The gateway remains the upstream `nginx:stable-alpine` image and PostgreSQL remains `postgres:17-bookworm`; neither requires a project-specific rebuild.

## Publication policy

Container publication is a stable-branch operation:

1. Changes are developed and validated on `develop`.
2. `main` runs the normal CI workflow.
3. Only a successful CI run whose head branch is `main` triggers the image publication workflow.
4. The workflow reads the canonical release version from the repository-root `VERSION` file.
5. Frontend and backend multi-architecture images are published for `linux/amd64` and `linux/arm64` with these tags:
   - the semantic version, for example `1.0.0`;
   - `latest`;
   - `sha-<commit>` for exact traceability.

Development-branch commits are never published or retagged.
