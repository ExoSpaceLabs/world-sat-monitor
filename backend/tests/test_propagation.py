from __future__ import annotations

from dataclasses import asdict
from datetime import datetime, timedelta, timezone
import math
import unittest

from app.mock_satellite import MOCK_NORAD_ID
from app.orbital_provider import MockOrbitalDataProvider
from app.propagation import SGP4PropagationEngine, gmst_radians


VANGUARD_ELEMENT_SET = {
    "epoch": datetime(2000, 6, 27, 18, 50, 19, 733568, tzinfo=timezone.utc),
    "mean_element_theory": "SGP4",
    "mean_motion": 10.82419157,
    "eccentricity": 0.1859667,
    "inclination_deg": 34.2682,
    "ra_of_asc_node_deg": 348.7242,
    "arg_of_pericenter_deg": 331.7664,
    "mean_anomaly_deg": 19.3264,
    "bstar": 2.8098e-05,
    "mean_motion_dot": 2.3e-07,
    "mean_motion_ddot": 0.0,
    "element_set_no": 475,
    "rev_at_epoch": 41366,
    "raw_payload": {
        "OBJECT_NAME": "VANGUARD 1",
        "OBJECT_ID": "1958-002B",
        "NORAD_CAT_ID": 5,
        "CLASSIFICATION_TYPE": "U",
        "EPHEMERIS_TYPE": 0,
        "CENTER_NAME": "EARTH",
        "REF_FRAME": "TEME",
        "TIME_SYSTEM": "UTC",
    },
}


class PropagationTests(unittest.TestCase):
    def test_sgp4_matches_published_vanguard_reference_state(self):
        engine = SGP4PropagationEngine()
        at = datetime(2000, 6, 29, 12, 50, 19, tzinfo=timezone.utc)
        position, velocity = engine.propagate_teme(VANGUARD_ELEMENT_SET, at)

        expected_position = (5576.056952, -3999.371134, -1521.957159)
        expected_velocity = (4.772627, 5.119817, 4.275553)
        for actual, expected in zip(position, expected_position):
            self.assertAlmostEqual(actual, expected, delta=0.02)
        for actual, expected in zip(velocity, expected_velocity):
            self.assertAlmostEqual(actual, expected, delta=2e-5)

    def test_synthetic_large_catalog_id_is_propagatable(self):
        self.assertGreater(int(MOCK_NORAD_ID), 339999)
        element_set = MockOrbitalDataProvider().fetch_latest(
            {"NORAD_CAT_ID": MOCK_NORAD_ID}
        )
        at = element_set.epoch + timedelta(minutes=5)
        state = SGP4PropagationEngine().propagate(asdict(element_set), at)

        values = (
            *state.teme_position_km,
            *state.teme_velocity_km_s,
            state.ecef.x_ecef_km,
            state.ecef.y_ecef_km,
            state.ecef.z_ecef_km,
            state.geodetic.lat_deg,
            state.geodetic.lon_deg,
            state.geodetic.altitude_km,
        )
        self.assertTrue(all(math.isfinite(value) for value in values))
        self.assertGreater(state.geodetic.altitude_km, 100)

    def test_teme_to_ecef_rotation_preserves_radius(self):
        engine = SGP4PropagationEngine()
        at = datetime(2000, 6, 29, 12, 50, 19, tzinfo=timezone.utc)
        state = engine.propagate(VANGUARD_ELEMENT_SET, at)
        teme_radius = math.sqrt(sum(value * value for value in state.teme_position_km))
        ecef_radius = math.sqrt(
            state.ecef.x_ecef_km**2
            + state.ecef.y_ecef_km**2
            + state.ecef.z_ecef_km**2
        )
        self.assertAlmostEqual(teme_radius, ecef_radius, places=9)
        self.assertTrue(-90 <= state.geodetic.lat_deg <= 90)
        self.assertTrue(-180 <= state.geodetic.lon_deg <= 180)

    def test_gmst_is_normalized(self):
        angle = gmst_radians(datetime(2026, 8, 28, tzinfo=timezone.utc))
        self.assertGreaterEqual(angle, 0)
        self.assertLess(angle, 2 * math.pi)


if __name__ == "__main__":
    unittest.main()
