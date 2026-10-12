from __future__ import annotations

from datetime import datetime, timedelta, timezone
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

from app.orbital_provider import ProviderError
from app.provider_registry import build_orbital_provider, provider_descriptors, registered_provider_names
from app.provider_service import _process_active_satellite

ORBITAL_STORE = Path("backend/app/orbital_store.py").read_text(encoding="utf-8")
MAIN = Path("backend/app/main.py").read_text(encoding="utf-8")


class _Provider:
    def __init__(self, name: str):
        self.name = name

    def fetch_latest(self, identifiers):
        return object()


class ProviderStrategyTests(unittest.TestCase):
    def _metrics(self):
        return {
            "active": 0,
            "fetched": 0,
            "new_element_sets": 0,
            "jobs_created": 0,
            "display_groups": 0,
            "display_fetches": 0,
            "display_jobs_created": 0,
            "backoff_skips": 0,
            "provider_failures": 0,
            "provider_failovers": 0,
            "stale_fallbacks": 0,
            "errors": 0,
        }

    def test_registry_is_explicit_and_unknown_provider_is_rejected(self):
        self.assertEqual(registered_provider_names(), ("mock", "celestrak"))
        with self.assertRaisesRegex(ProviderError, "unsupported orbital provider"):
            build_orbital_provider("not-a-provider")

    def test_registry_describes_runtime_capabilities(self):
        descriptors = {item["name"]: item for item in provider_descriptors()}
        self.assertEqual(descriptors["mock"]["kind"], "synthetic")
        self.assertFalse(descriptors["mock"]["supports_catalog"])
        self.assertEqual(descriptors["celestrak"]["kind"], "external")
        self.assertTrue(descriptors["celestrak"]["supports_group_fetch"])
        self.assertTrue(descriptors["celestrak"]["supports_catalog"])

    def test_worker_fails_over_to_next_provider(self):
        now = datetime(2026, 10, 2, 12, 0, tzinfo=timezone.utc)
        satellite = {
            "id": 7,
            "provider_priority": ["primary", "secondary"],
            "provider_preference": "primary",
            "metadata": {},
            "identifiers": {"NORAD_CAT_ID": "123"},
        }
        metrics = self._metrics()
        connection = MagicMock()
        manager = MagicMock()
        manager.__enter__.return_value = connection
        manager.__exit__.return_value = False

        with (
            patch("app.provider_service.connect", return_value=manager),
            patch("app.provider_service.get_provider_fetch_state", return_value=None),
            patch("app.provider_service.get_latest_element_set", return_value=None),
            patch(
                "app.provider_service.build_orbital_provider",
                side_effect=[ProviderError("primary down"), _Provider("secondary")],
            ) as build,
            patch("app.provider_service._record_satellite_provider_failure") as record_failure,
            patch("app.provider_service.insert_element_set", return_value=(42, True)),
            patch("app.provider_service.record_provider_fetch") as record_success,
            patch("app.provider_service._ensure_job", return_value=True),
        ):
            self.assertTrue(_process_active_satellite(satellite, now, metrics))

        self.assertEqual(
            [call.args[0] for call in build.call_args_list],
            ["primary", "secondary"],
        )
        record_failure.assert_called_once()
        self.assertEqual(record_failure.call_args.args[1], "primary")
        record_success.assert_called_once()
        self.assertEqual(record_success.call_args.args[2], "secondary")
        self.assertEqual(metrics["provider_failures"], 1)
        self.assertEqual(metrics["provider_failovers"], 1)
        self.assertEqual(metrics["fetched"], 1)
        self.assertEqual(metrics["new_element_sets"], 1)
        self.assertEqual(metrics["jobs_created"], 1)

    def test_backoff_preserves_stored_primary_elements_when_all_live_sources_blocked(self):
        now = datetime(2026, 10, 2, 12, 0, tzinfo=timezone.utc)
        satellite = {
            "id": 9,
            "provider_priority": ["primary", "secondary"],
            "provider_preference": "primary",
            "metadata": {},
            "identifiers": {"NORAD_CAT_ID": "999"},
        }
        metrics = self._metrics()
        connection = MagicMock()
        manager = MagicMock()
        manager.__enter__.return_value = connection
        manager.__exit__.return_value = False
        blocked = {
            "next_retry_at": now + timedelta(minutes=10),
            "last_success_at": now - timedelta(hours=3),
        }

        def latest(_connection, _satellite_id, source=None):
            return {"id": 11, "source": "primary"} if source == "primary" else None

        with (
            patch("app.provider_service.connect", return_value=manager),
            patch("app.provider_service.get_provider_fetch_state", return_value=blocked),
            patch("app.provider_service.get_latest_element_set", side_effect=latest),
            patch("app.provider_service.build_orbital_provider") as build,
            patch("app.provider_service._ensure_job", return_value=False),
        ):
            self.assertTrue(_process_active_satellite(satellite, now, metrics))

        build.assert_not_called()
        self.assertEqual(metrics["backoff_skips"], 2)
        self.assertEqual(metrics["stale_fallbacks"], 1)
        self.assertEqual(metrics["provider_failovers"], 0)


class ProviderProvenanceContractTests(unittest.TestCase):
    def test_status_prefers_current_state_element_provenance(self):
        section = ORBITAL_STORE.split("def get_orbital_source_status", 1)[1].split("def get_group_orbital_source_summary", 1)[0]
        current_state_index = section.index("source_element_set_id")
        active_element_index = section.index("SELECT * FROM orbital_element_sets WHERE id = %s")
        policy_fallback_index = section.index("get_latest_element_set_by_priority")
        self.assertLess(current_state_index, active_element_index)
        self.assertLess(active_element_index, policy_fallback_index)

    def test_provider_capability_endpoint_is_registry_backed(self):
        self.assertIn('@app.get("/api/v1/providers")', MAIN)
        section = MAIN.split('def providers()', 1)[1].split('@app.get("/api/v1/settings"', 1)[0]
        self.assertIn("provider_descriptors()", section)


if __name__ == "__main__":
    unittest.main()
