#!/usr/bin/env bash
# Prepare a reproducible Sites frontend build from a fresh GitHub checkout.
# This script builds and verifies artifacts; it does NOT publish a Site.
set -euo pipefail

if [[ $# -gt 1 ]]; then
  echo "Usage: $0 [source-branch] (default: main)" >&2
  exit 64
fi

source_branch="${1:-main}"
if [[ ! "$source_branch" =~ ^[A-Za-z0-9][A-Za-z0-9._/-]*$ ]]; then
  echo "Invalid branch name: $source_branch" >&2
  exit 64
fi

for command in git node npm sha256sum; do
  command -v "$command" >/dev/null || {
    echo "Missing required command: $command" >&2
    exit 69
  }
done

expected_node="v22.13.0"
actual_node="$(node --version)"
if [[ "$actual_node" != "$expected_node" ]]; then
  echo "Use Node $expected_node (detected $actual_node); refusing an unpinned build." >&2
  exit 69
fi

workspace="$(mktemp -d "${TMPDIR:-/tmp}/worldsat-sites-XXXXXXXX")"
source_dir="$workspace/source"
repo_url="https://github.com/ExoSpaceLabs/world-sat-monitor.git"

echo "Fetching fresh source from $repo_url ($source_branch)"
git clone --quiet --filter=blob:none --no-tags --single-branch \
  --branch "$source_branch" --depth 1 "$repo_url" "$source_dir"

# Rebuild an earlier deployment exactly at its recorded source revision:
# WORLDSAT_SOURCE_SHA=<40-character commit SHA> scripts/sites-rebuild.sh main
if [[ -n "${WORLDSAT_SOURCE_SHA:-}" ]]; then
  if [[ ! "$WORLDSAT_SOURCE_SHA" =~ ^[0-9a-fA-F]{40}$ ]]; then
    echo "WORLDSAT_SOURCE_SHA must be a full 40-character Git SHA." >&2
    exit 64
  fi
  git -C "$source_dir" fetch --quiet --no-tags --depth 1 origin "$WORLDSAT_SOURCE_SHA"
  git -C "$source_dir" checkout --quiet --detach "$WORLDSAT_SOURCE_SHA"
fi

source_sha="$(git -C "$source_dir" rev-parse HEAD)"
lock_sha="$(sha256sum "$source_dir/frontend/package-lock.json" | awk '{print $1}')"
npm_version="$(npm --version)"

echo "Source revision: $source_sha"
echo "Frontend lockfile SHA-256: $lock_sha"
echo "Using Node $actual_node and npm $npm_version"

(
  cd "$source_dir/frontend"
  npm ci
  npm run lint
  npm test
  npm run benchmark:groups
  npm run validate:artifact
)

# The authoritative Git source must remain unchanged; generated/ignored
# build artifacts are permitted in the isolated checkout.
git -C "$source_dir" diff --exit-code
git -C "$source_dir" diff --cached --exit-code

cat > "$workspace/provenance.txt" <<EOF
repository=$repo_url
requested_branch=$source_branch
source_sha=$source_sha
node_version=$actual_node
npm_version=$npm_version
frontend_lock_sha256=$lock_sha
sites_project_dir=$source_dir/frontend
EOF

echo
echo "Verified Sites build source: $source_dir/frontend"
echo "Build provenance: $workspace/provenance.txt"
echo "Use this exact source checkout for Sites version creation."
echo "Saving a Sites version and deploying it are separate operations."
