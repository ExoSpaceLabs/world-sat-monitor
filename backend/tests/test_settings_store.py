from __future__ import annotations

import json
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest

from app.settings_store import AppSettings, JsonSettingsStore


class JsonSettingsStoreTests(unittest.TestCase):
    def test_creates_defaults_and_persists_single_and_group_orbit_changes(self):
        with TemporaryDirectory() as temporary:
            path = Path(temporary) / "settings.json"
            store = JsonSettingsStore(path)
            defaults = store.ensure()
            self.assertTrue(path.exists())
            self.assertEqual(defaults.version, 6)
            self.assertEqual(defaults.map.themed_base_color, "#041018")
            self.assertEqual(defaults.orbit.path.prediction_hours, 6)
            self.assertEqual(defaults.group_orbit.prediction_hours, 3)
            self.assertEqual(defaults.group_orbit.step_seconds, 120)

            changed = defaults.model_copy(deep=True)
            changed.orbit.path.prediction_hours = 48
            changed.group_orbit.prediction_hours = 4
            changed.group_orbit.step_seconds = 180
            store.save(changed)

            reloaded = store.load()
            self.assertEqual(reloaded.orbit.path.prediction_hours, 48)
            self.assertEqual(reloaded.group_orbit.prediction_hours, 4)
            self.assertEqual(reloaded.group_orbit.step_seconds, 180)

    def test_reset_rewrites_default_values(self):
        with TemporaryDirectory() as temporary:
            path = Path(temporary) / "settings.json"
            store = JsonSettingsStore(path)
            changed = AppSettings()
            changed.map.basemap = "street"
            changed.orbit.path.enabled = False
            changed.group_orbit.prediction_hours = 8
            store.save(changed)
            reset = store.reset()
            self.assertEqual(reset.map.basemap, "dark")
            self.assertTrue(reset.orbit.path.enabled)
            self.assertEqual(reset.group_orbit.prediction_hours, 3)

    def test_migrates_legacy_satellite_settings_and_adds_group_orbit(self):
        with TemporaryDirectory() as temporary:
            path = Path(temporary) / "settings.json"
            path.write_text(json.dumps({
                "version": 1,
                "map": {"basemap": "street", "space_environment": True, "shadow_opacity": 0.55, "debug": False, "time_scale": 1},
                "satellite": {
                    "position_update_ms": 700,
                    "path": {"enabled": True, "history_minutes": 120, "prediction_hours": 24, "resolution_seconds": 30, "refresh_seconds": 15},
                },
            }), encoding="utf-8")
            migrated = JsonSettingsStore(path).load()
            self.assertEqual(migrated.version, 6)
            self.assertEqual(migrated.orbit.position_update_ms, 700)
            self.assertEqual(migrated.orbit.path.prediction_hours, 24)
            self.assertEqual(migrated.group_orbit.prediction_hours, 3)
            raw = json.loads(path.read_text(encoding="utf-8"))
            self.assertEqual(raw["version"], 6)
            self.assertIn("group_orbit", raw)
            self.assertNotIn("satellite", raw)

    def test_migrates_version_five_without_overwriting_existing_preferences(self):
        with TemporaryDirectory() as temporary:
            path = Path(temporary) / "settings.json"
            path.write_text(json.dumps({
                "version": 5,
                "map": {"basemap": "dark", "themed_base_color": "#01080d", "themed_contrast": 0.18, "space_environment": False, "shadow_opacity": 0.4, "debug": True, "time_scale": 10},
                "orbit": {"direction_vector_enabled": False, "position_update_ms": 600, "path": {"enabled": True, "mode": "orbit", "history_minutes": 60, "prediction_hours": 12, "resolution_seconds": 20, "refresh_seconds": 10}},
            }), encoding="utf-8")
            migrated = JsonSettingsStore(path).load()
            self.assertEqual(migrated.version, 6)
            self.assertEqual(migrated.map.themed_base_color, "#01080d")
            self.assertFalse(migrated.map.space_environment)
            self.assertFalse(migrated.orbit.direction_vector_enabled)
            self.assertEqual(migrated.orbit.path.mode, "orbit")
            self.assertEqual(migrated.group_orbit.position_update_ms, 2000)


if __name__ == "__main__":
    unittest.main()
