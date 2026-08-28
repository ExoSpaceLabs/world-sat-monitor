from __future__ import annotations

import unittest

from pydantic import ValidationError

from app.satellite_models import SatelliteCreate, SatelliteIdentifierInput, SatelliteUpdate


class SatelliteModelsTests(unittest.TestCase):
    def test_identifier_is_normalized(self):
        identifier = SatelliteIdentifierInput(namespace=" norad_cat_id ", value=" 100001 ")
        self.assertEqual(identifier.namespace, "NORAD_CAT_ID")
        self.assertEqual(identifier.value, "100001")

    def test_duplicate_identifier_namespace_is_rejected(self):
        with self.assertRaises(ValidationError):
            SatelliteCreate(
                name="TESTSAT",
                identifiers=[
                    {"namespace": "NORAD_CAT_ID", "value": "100001"},
                    {"namespace": "norad_cat_id", "value": "100002"},
                ],
            )

    def test_satellite_defaults_to_inactive(self):
        satellite = SatelliteCreate(name=" TESTSAT ")
        self.assertEqual(satellite.name, "TESTSAT")
        self.assertFalse(satellite.active)
        self.assertEqual(satellite.object_type, "payload")

    def test_patch_does_not_expose_active_field(self):
        patch = SatelliteUpdate(name="Renamed")
        self.assertNotIn("active", patch.model_dump(exclude_unset=True))


if __name__ == "__main__":
    unittest.main()
