from __future__ import annotations

from datetime import datetime, timedelta, timezone
import unittest
from unittest.mock import patch

from app.provider_resilience import provider_health, retry_blocked, retry_delay_seconds, source_freshness
from app.provider_service import _local_catalog_results


class ProviderResilienceTests(unittest.TestCase):
    def test_retry_delay_is_exponential_and_capped(self):
        self.assertEqual(retry_delay_seconds(0, base_seconds=30, max_seconds=1800), 30)
        self.assertEqual(retry_delay_seconds(1, base_seconds=30, max_seconds=1800), 60)
        self.assertEqual(retry_delay_seconds(5, base_seconds=30, max_seconds=1800), 960)
        self.assertEqual(retry_delay_seconds(6, base_seconds=30, max_seconds=1800), 1800)

    def test_retry_blocked_and_health_follow_retry_window(self):
        now = datetime(2026, 10, 2, 8, 0, tzinfo=timezone.utc)
        state = {"next_retry_at": now + timedelta(minutes=5), "consecutive_failures": 2, "last_error": "timeout", "last_success_at": now - timedelta(hours=1)}
        self.assertTrue(retry_blocked(state, now))
        self.assertEqual(provider_health(state, now), "backoff")
        self.assertFalse(retry_blocked(state, now + timedelta(minutes=6)))
        self.assertEqual(provider_health(state, now + timedelta(minutes=6)), "degraded")

    def test_success_state_is_healthy(self):
        now = datetime(2026, 10, 2, 8, 0, tzinfo=timezone.utc)
        state = {"next_retry_at": None, "consecutive_failures": 0, "last_error": None, "last_success_at": now}
        self.assertEqual(provider_health(state, now), "healthy")

    def test_source_freshness_tracks_refresh_expectation(self):
        now = datetime(2026, 10, 2, 12, 0, tzinfo=timezone.utc)
        age, state = source_freshness(now - timedelta(hours=2), now, 7200)
        self.assertEqual(age, 7200)
        self.assertEqual(state, "fresh")
        _, state = source_freshness(now - timedelta(hours=8), now, 7200)
        self.assertEqual(state, "aging")
        _, state = source_freshness(now - timedelta(hours=30), now, 7200)
        self.assertEqual(state, "stale")

    def test_local_catalog_fallback_matches_name_and_identifiers(self):
        satellites = [
            {
                "id": 7,
                "name": "ION-SCV21",
                "active": True,
                "object_type": "payload",
                "provider_preference": "celestrak",
                "metadata": {},
                "identifiers": {"NORAD_CAT_ID": "56228", "COSPAR": "2023-054X"},
            },
            {
                "id": 8,
                "name": "OTHER",
                "active": False,
                "object_type": "payload",
                "provider_preference": None,
                "metadata": {},
                "identifiers": {"NORAD_CAT_ID": "99999"},
            },
        ]
        with patch("app.provider_service.connect") as connect:
            connection = connect.return_value.__enter__.return_value
            with patch("app.provider_service.list_satellites", return_value=satellites):
                by_name = _local_catalog_results("ion", 25)
                by_norad = _local_catalog_results("56228", 25)

        self.assertEqual([item["name"] for item in by_name], ["ION-SCV21"])
        self.assertEqual([item["name"] for item in by_norad], ["ION-SCV21"])
        self.assertTrue(by_name[0]["local"]["present"])
        self.assertEqual(by_name[0]["metadata"]["catalog_fallback"], "local")


if __name__ == "__main__":
    unittest.main()
