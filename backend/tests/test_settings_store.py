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
            self.assertEqual(defaults.satellite.path.prediction_hours, 6)

            changed = defaults.model_copy(deep=True)
            changed.satellite.path.prediction_hours = 48
            changed.satellite.position_update_ms = 500
            store.save(changed)

            reloaded = store.load()
            self.assertEqual(reloaded.satellite.path.prediction_hours, 48)
            self.assertEqual(reloaded.satellite.position_update_ms, 500)

            raw = json.loads(path.read_text(encoding="utf-8"))
            self.assertEqual(raw["satellite"]["path"]["prediction_hours"], 48)

    def test_reset_rewrites_default_values(self):
        with TemporaryDirectory() as temporary:
            path = Path(temporary) / "settings.json"
            store = JsonSettingsStore(path)
            changed = AppSettings()
            changed.map.basemap = "street"
            changed.satellite.path.enabled = False
            store.save(changed)

            reset = store.reset()
            self.assertEqual(reset.map.basemap, "dark")
            self.assertTrue(reset.satellite.path.enabled)


if __name__ == "__main__":
    unittest.main()
