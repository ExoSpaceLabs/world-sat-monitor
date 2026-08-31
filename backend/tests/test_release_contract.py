from __future__ import annotations

from pathlib import Path
import unittest


ROOT = Path(".")
VERSION = (ROOT / "VERSION").read_text(encoding="utf-8").strip()
LOCAL_COMPOSE = (ROOT / "compose.yaml").read_text(encoding="utf-8")
IMAGE_COMPOSE = (ROOT / "compose.images.yaml").read_text(encoding="utf-8")
PUBLISH = (ROOT / ".github/workflows/publish-images.yml").read_text(encoding="utf-8")


class ReleaseContractTests(unittest.TestCase):
    def test_v1_release_identity_is_explicit(self):
        self.assertEqual(VERSION, "1.0.0")
        self.assertIn("${WORLDSAT_IMAGE_TAG:-1.0.0}", IMAGE_COMPOSE)

    def test_local_and_pull_only_compose_paths_are_separate(self):
        self.assertIn("build:", LOCAL_COMPOSE)
        self.assertNotIn("build:", IMAGE_COMPOSE)
        self.assertIn("ghcr.io/exospacelabs/world-sat-monitor-frontend", IMAGE_COMPOSE)
        self.assertIn("ghcr.io/exospacelabs/world-sat-monitor-backend", IMAGE_COMPOSE)
        self.assertEqual(IMAGE_COMPOSE.count("world-sat-monitor-backend:${WORLDSAT_IMAGE_TAG"), 3)

    def test_image_publication_is_main_only_ci_gated_and_version_immutable(self):
        self.assertIn("workflow_run:", PUBLISH)
        self.assertIn("workflows: [CI]", PUBLISH)
        self.assertIn("branches: [main]", PUBLISH)
        self.assertIn("workflow_run.conclusion == 'success'", PUBLISH)
        self.assertIn("workflow_run.head_branch == 'main'", PUBLISH)
        self.assertNotIn("develop", PUBLISH)
        self.assertNotIn("workflow_dispatch", PUBLISH)
        self.assertIn("contents: write", PUBLISH)
        self.assertIn("packages: write", PUBLISH)
        self.assertIn("linux/amd64,linux/arm64", PUBLISH)
        self.assertIn("Detect release-impacting changes", PUBLISH)
        self.assertIn("No runtime/release inputs changed; skipping image publication and release tagging.", PUBLISH)
        self.assertIn("backend/tests/*", PUBLISH)
        self.assertIn("git ls-remote --tags origin", PUBLISH)
        self.assertIn("bump VERSION before publishing another main revision", PUBLISH)
        self.assertNotIn("legacy_v1", PUBLISH)
        self.assertNotIn("git tag -f", PUBLISH)
        self.assertNotIn("git push --force", PUBLISH)
        self.assertIn('git tag "$RELEASE_TAG" "$VALIDATED_SHA"', PUBLISH)
        self.assertIn('git push origin "refs/tags/${RELEASE_TAG}"', PUBLISH)


if __name__ == "__main__":
    unittest.main()
