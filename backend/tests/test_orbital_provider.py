from __future__ import annotations

from io import BytesIO
import json
from pathlib import Path
import unittest
from unittest.mock import patch

from app.mock_satellite import MOCK_NORAD_ID
from app.orbital_provider import (
    CelesTrakProvider,
    MockOrbitalDataProvider,
    ProviderError,
    normalize_omm_payload,
)


FIXTURE_PATH = Path("backend/tests/fixtures/celestrak_gp_mario.json")


class OrbitalProviderTests(unittest.TestCase):
    def setUp(self):
        self.records = json.loads(FIXTURE_PATH.read_text(encoding="utf-8"))

    def test_normalizes_omm_json_fields(self):
        element_set = normalize_omm_payload(self.records[0], source="celestrak")
        self.assertEqual(element_set.source, "celestrak")
        self.assertEqual(element_set.source_format, "OMM_JSON")
        self.assertEqual(element_set.mean_element_theory, "SGP4")
        self.assertAlmostEqual(element_set.mean_motion, 15.99081912)
        self.assertAlmostEqual(element_set.eccentricity, 0.0014649)
        self.assertEqual(element_set.element_set_no, 999)
        self.assertEqual(element_set.rev_at_epoch, 1839)
        self.assertEqual(element_set.epoch.isoformat(), "2023-04-25T10:45:30.642912+00:00")

    def test_fingerprint_is_stable_and_changes_with_orbit(self):
        first = normalize_omm_payload(self.records[0], source="celestrak")
        reordered = dict(reversed(list(self.records[0].items())))
        second = normalize_omm_payload(reordered, source="celestrak")
        changed = dict(self.records[0], MEAN_MOTION=15.9909)
        third = normalize_omm_payload(changed, source="celestrak")
        self.assertEqual(first.fingerprint(), second.fingerprint())
        self.assertNotEqual(first.fingerprint(), third.fingerprint())

    def test_celestrak_provider_uses_json_gp_query(self):
        body = json.dumps(self.records).encode("utf-8")
        with patch("app.orbital_provider.urlopen", return_value=BytesIO(body)) as mocked:
            provider = CelesTrakProvider("https://example.test/gp.php", timeout_seconds=3)
            element_set = provider.fetch_latest({"NORAD_CAT_ID": "55123"})
        request = mocked.call_args.args[0]
        self.assertIn("CATNR=55123", request.full_url)
        self.assertIn("FORMAT=JSON", request.full_url)
        self.assertEqual(element_set.raw_payload["OBJECT_NAME"], "MARIO")

    def test_mock_provider_returns_same_valid_element_set(self):
        provider = MockOrbitalDataProvider()
        first = provider.fetch_latest({"NORAD_CAT_ID": MOCK_NORAD_ID})
        second = provider.fetch_latest({})
        self.assertEqual(first.fingerprint(), second.fingerprint())
        self.assertEqual(first.raw_payload["NORAD_CAT_ID"], int(MOCK_NORAD_ID))
        self.assertGreater(first.mean_motion, 0)
        self.assertGreaterEqual(first.eccentricity, 0)
        self.assertLess(first.eccentricity, 1)

    def test_celestrak_network_failure_is_wrapped(self):
        with patch("app.orbital_provider.urlopen", side_effect=OSError("offline")):
            provider = CelesTrakProvider("https://example.test/gp.php", timeout_seconds=1)
            with self.assertRaisesRegex(ProviderError, "request failed"):
                provider.fetch_latest({"NORAD_CAT_ID": "55123"})

    def test_rejects_malformed_payload(self):
        with self.assertRaisesRegex(ProviderError, "MEAN_MOTION"):
            normalize_omm_payload(
                {"EPOCH": "2026-01-01T00:00:00", "ECCENTRICITY": 0.1},
                source="test",
            )


if __name__ == "__main__":
    unittest.main()
