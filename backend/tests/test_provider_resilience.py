from __future__ import annotations

from datetime import datetime, timedelta, timezone
import unittest

from app.provider_resilience import provider_health, retry_blocked, retry_delay_seconds, source_freshness


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


if __name__ == "__main__":
    unittest.main()
