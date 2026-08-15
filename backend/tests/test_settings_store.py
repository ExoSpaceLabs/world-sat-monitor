from __future__ import annotations

import json
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest

from app.settings_store import AppSettings, JsonSettingsStore


class JsonSettingsStoreTests(unittest.TestCase):
    def test_creates_defaults_and_persists_changes(self):
        with TemporaryDirectory() as temporary:
            path = Path(temporary) / "settings.json"
            store = JsonSettingsStore(path)

            defaults = store.ensure()
            self.assertTrue(path.exists())
            self.assertEqual(defaults.version, 2)
            self.assertEqual(defaults.orbit.path.prediction_hours, 6)

            changed = defaults.model_copy(deep=True)
            changed.orbit.path.prediction_hours = 48
            changed.orbit.position_update_ms = 500
            store.save(changed)

            reloaded = store.load()
            self.assertEqual(reloaded.orbit.path.prediction_hours, 48)
            self.assertEqual(reloaded.orbit.position_update_ms, 500)

            raw = json.loads(path.read_text(encoding="utf-8"))
            self.assertEqual(raw["orbit"]["path"]["prediction_hours"], 48)
            self.assertNotIn("satellite", raw)

    def test_reset_rewrites_default_values(self):
        with TemporaryDirectory() as temporary:
            path = Path(temporary) / "settings.json"
            store = JsonSettingsStore(path)
            changed = AppSettings()
            changed.map.basemap = "street"
            changed.orbit.path.enabled = False
            store.save(changed)

            reset = store.reset()
            self.assertEqual(reset.map.basemap, "dark")
            self.assertTrue(reset.orbit.path.enabled)

    def test_migrates_legacy_satellite_settings_to_global_orbit_settings(self):
        with TemporaryDirectory() as temporary:
            path = Path(temporary) / "settings.json"
            path.write_text(
                json.dumps({
                    "version": 1,
                    "map": {
                        "basemap": "street",
                        "space_environment": True,
                        "shadow_opacity": 0.55,
                        "debug": False,
                        "time_scale": 1,
                    },
                    "satellite": {
                        "selected_norad_id": 99001,
                        "position_update_ms": 700,
                        "path": {
                            "enabled": True,
                            "history_minutes": 120,
                            "prediction_hours": 24,
                            "resolution_seconds": 30,
                            "refresh_seconds": 15,
                        },
                    },
                }),
                encoding="utf-8",
            )

            migrated = JsonSettingsStore(path).load()
            self.assertEqual(migrated.version, 2)
            self.assertEqual(migrated.map.basemap, "street")
            self.assertEqual(migrated.orbit.position_update_ms, 700)
            self.assertEqual(migrated.orbit.path.history_minutes, 120)
            self.assertEqual(migrated.orbit.path.prediction_hours, 24)

            raw = json.loads(path.read_text(encoding="utf-8"))
            self.assertEqual(raw["version"], 2)
            self.assertIn("orbit", raw)
            self.assertNotIn("satellite", raw)


if __name__ == "__main__":
    unittest.main()
