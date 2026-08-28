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
            self.assertEqual(defaults.version, 4)
            self.assertEqual(defaults.map.themed_water_color, "#041018")
            self.assertEqual(defaults.map.themed_land_color, "#0a2c39")
            self.assertTrue(defaults.orbit.direction_vector_enabled)
            self.assertEqual(defaults.orbit.path.mode, "ground")
            self.assertEqual(defaults.orbit.path.prediction_hours, 6)

            changed = defaults.model_copy(deep=True)
            changed.map.themed_water_color = "#01080d"
            changed.map.themed_land_color = "#123f4a"
            changed.orbit.direction_vector_enabled = False
            changed.orbit.path.mode = "orbit"
            changed.orbit.path.prediction_hours = 48
            changed.orbit.position_update_ms = 500
            store.save(changed)

            reloaded = store.load()
            self.assertEqual(reloaded.map.themed_water_color, "#01080d")
            self.assertEqual(reloaded.map.themed_land_color, "#123f4a")
            self.assertFalse(reloaded.orbit.direction_vector_enabled)
            self.assertEqual(reloaded.orbit.path.mode, "orbit")
            self.assertEqual(reloaded.orbit.path.prediction_hours, 48)
            self.assertEqual(reloaded.orbit.position_update_ms, 500)

            raw = json.loads(path.read_text(encoding="utf-8"))
            self.assertEqual(raw["map"]["themed_land_color"], "#123f4a")
            self.assertEqual(raw["orbit"]["path"]["prediction_hours"], 48)
            self.assertNotIn("satellite", raw)

    def test_reset_rewrites_default_values(self):
        with TemporaryDirectory() as temporary:
            path = Path(temporary) / "settings.json"
            store = JsonSettingsStore(path)
            changed = AppSettings()
            changed.map.basemap = "street"
            changed.map.themed_water_color = "#000000"
            changed.map.themed_land_color = "#ffffff"
            changed.orbit.path.enabled = False
            changed.orbit.direction_vector_enabled = False
            store.save(changed)

            reset = store.reset()
            self.assertEqual(reset.map.basemap, "dark")
            self.assertEqual(reset.map.themed_water_color, "#041018")
            self.assertEqual(reset.map.themed_land_color, "#0a2c39")
            self.assertTrue(reset.orbit.path.enabled)
            self.assertTrue(reset.orbit.direction_vector_enabled)
            self.assertEqual(reset.orbit.path.mode, "ground")

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
            self.assertEqual(migrated.version, 4)
            self.assertEqual(migrated.map.basemap, "street")
            self.assertEqual(migrated.map.themed_water_color, "#041018")
            self.assertEqual(migrated.map.themed_land_color, "#0a2c39")
            self.assertEqual(migrated.orbit.position_update_ms, 700)
            self.assertEqual(migrated.orbit.path.history_minutes, 120)
            self.assertEqual(migrated.orbit.path.prediction_hours, 24)
            self.assertTrue(migrated.orbit.direction_vector_enabled)
            self.assertEqual(migrated.orbit.path.mode, "ground")

            raw = json.loads(path.read_text(encoding="utf-8"))
            self.assertEqual(raw["version"], 4)
            self.assertEqual(raw["map"]["themed_water_color"], "#041018")
            self.assertEqual(raw["map"]["themed_land_color"], "#0a2c39")
            self.assertIn("orbit", raw)
            self.assertNotIn("satellite", raw)

    def test_migrates_version_two_orbit_settings(self):
        with TemporaryDirectory() as temporary:
            path = Path(temporary) / "settings.json"
            path.write_text(
                json.dumps({
                    "version": 2,
                    "map": {
                        "basemap": "dark",
                        "space_environment": True,
                        "shadow_opacity": 0.7,
                        "debug": False,
                        "time_scale": 1,
                    },
                    "orbit": {
                        "position_update_ms": 600,
                        "path": {
                            "enabled": False,
                            "history_minutes": 60,
                            "prediction_hours": 12,
                            "resolution_seconds": 20,
                            "refresh_seconds": 10,
                        },
                    },
                }),
                encoding="utf-8",
            )

            migrated = JsonSettingsStore(path).load()
            self.assertEqual(migrated.version, 4)
            self.assertEqual(migrated.map.themed_water_color, "#041018")
            self.assertEqual(migrated.map.themed_land_color, "#0a2c39")
            self.assertTrue(migrated.orbit.direction_vector_enabled)
            self.assertEqual(migrated.orbit.path.mode, "ground")
            self.assertFalse(migrated.orbit.path.enabled)

    def test_migrates_version_three_with_existing_map_preferences(self):
        with TemporaryDirectory() as temporary:
            path = Path(temporary) / "settings.json"
            path.write_text(
                json.dumps({
                    "version": 3,
                    "map": {
                        "basemap": "dark",
                        "space_environment": False,
                        "shadow_opacity": 0.4,
                        "debug": True,
                        "time_scale": 10,
                    },
                    "orbit": {
                        "direction_vector_enabled": False,
                        "position_update_ms": 1000,
                        "path": {
                            "enabled": True,
                            "mode": "ground",
                            "history_minutes": 90,
                            "prediction_hours": 6,
                            "resolution_seconds": 60,
                            "refresh_seconds": 30,
                        },
                    },
                }),
                encoding="utf-8",
            )

            migrated = JsonSettingsStore(path).load()
            self.assertEqual(migrated.version, 4)
            self.assertEqual(migrated.map.themed_water_color, "#041018")
            self.assertEqual(migrated.map.themed_land_color, "#0a2c39")
            self.assertFalse(migrated.map.space_environment)
            self.assertTrue(migrated.map.debug)
            self.assertEqual(migrated.map.time_scale, 10)
            self.assertFalse(migrated.orbit.direction_vector_enabled)


if __name__ == "__main__":
    unittest.main()
