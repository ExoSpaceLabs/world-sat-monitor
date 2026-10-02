from __future__ import annotations

import unittest

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

    def test_empty_priority_is_rejected(self):
        with self.assertRaisesRegex(ValueError, "cannot be empty"):
            normalize_provider_priority([])


if __name__ == "__main__":
    unittest.main()
