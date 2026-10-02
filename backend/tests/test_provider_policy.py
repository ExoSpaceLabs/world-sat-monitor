from __future__ import annotations

import unittest
from pathlib import Path

from app.satellite_models import SatelliteCreate, SatelliteUpdate
from app.provider_policy import (
    DEFAULT_PROVIDER,
    normalize_provider_priority,
    primary_provider_for,
    provider_priority_for,
)


class ProviderPolicyTests(unittest.TestCase):
    def test_priority_is_normalized_deduplicated_and_ordered(self):
        self.assertEqual(
            normalize_provider_priority([" SpaceTrack ", "CELESTRAK", "spacetrack"]),
            ("spacetrack", "celestrak"),
        )

    def test_mock_metadata_is_never_routed_to_external_provider(self):
        satellite = {
            "provider_preference": "celestrak",
            "provider_priority": ["celestrak", "spacetrack"],
            "metadata": {"mock": True},
        }
        self.assertEqual(provider_priority_for(satellite), ("mock",))
        self.assertEqual(primary_provider_for(satellite), "mock")

    def test_legacy_preference_and_default_remain_compatible(self):
        self.assertEqual(
            provider_priority_for({"provider_preference": "CELESTRAK"}),
            ("celestrak",),
        )
        self.assertEqual(provider_priority_for({}), (DEFAULT_PROVIDER,))

    def test_create_policy_keeps_legacy_alias_in_sync(self):
        created = SatelliteCreate(
            name="demo",
            provider_priority=["SpaceTrack", "CelesTrak"],
        )
        self.assertEqual(created.provider_priority, ["spacetrack", "celestrak"])
        self.assertEqual(created.provider_preference, "spacetrack")

    def test_legacy_create_preference_builds_single_provider_priority(self):
        created = SatelliteCreate(name="demo", provider_preference="CelesTrak")
        self.assertEqual(created.provider_priority, ["celestrak"])
        self.assertEqual(created.provider_preference, "celestrak")

    def test_update_priority_updates_legacy_alias(self):
        update = SatelliteUpdate(provider_priority=["SpaceTrack", "CelesTrak"])
        self.assertEqual(update.provider_preference, "spacetrack")

    def test_empty_priority_is_rejected(self):
        with self.assertRaises(ValueError):
            SatelliteCreate(name="demo", provider_priority=[])


    def test_runtime_modules_do_not_depend_on_legacy_preference(self):
        for path in (
            "backend/app/provider_service.py",
            "backend/app/provider_group_store.py",
        ):
            text = Path(path).read_text(encoding="utf-8")
            self.assertNotIn('get("provider_preference")', text)
            self.assertNotIn("satellite.provider_preference =", text)


if __name__ == "__main__":
    unittest.main()
