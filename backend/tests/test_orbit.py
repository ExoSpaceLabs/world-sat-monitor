from __future__ import annotations

from datetime import datetime, timedelta, timezone
import math
import unittest

from app.orbit import (
    EARTH_RADIUS_KM,
    MOCK_ALTITUDE_KM,
    ecef_to_geodetic_spherical,
    interpolate_ecef,
    mock_ecef_state,
)


class OrbitMathTests(unittest.TestCase):
    def test_mock_state_stays_on_expected_orbit_radius(self):
        epoch = datetime(2026, 8, 15, 10, 0, tzinfo=timezone.utc)
        state = mock_ecef_state(epoch + timedelta(minutes=17), epoch)
        radius = math.sqrt(
            state.x_ecef_km**2 + state.y_ecef_km**2 + state.z_ecef_km**2
        )
        self.assertAlmostEqual(radius, EARTH_RADIUS_KM + MOCK_ALTITUDE_KM, places=6)

    def test_ecef_conversion_returns_mock_altitude(self):
        epoch = datetime(2026, 8, 15, 10, 0, tzinfo=timezone.utc)
        geodetic = ecef_to_geodetic_spherical(mock_ecef_state(epoch, epoch))
        self.assertAlmostEqual(geodetic.altitude_km, MOCK_ALTITUDE_KM, places=6)
        self.assertGreaterEqual(geodetic.lon_deg, -180.0)
        self.assertLessEqual(geodetic.lon_deg, 180.0)

    def test_interpolation_uses_cartesian_space(self):
        start = datetime(2026, 8, 15, 10, 0, tzinfo=timezone.utc)
        end = start + timedelta(seconds=10)
        before = {
            "sample_time": start,
            "x_ecef_km": 1.0,
            "y_ecef_km": 2.0,
            "z_ecef_km": 3.0,
        }
        after = {
            "sample_time": end,
            "x_ecef_km": 3.0,
            "y_ecef_km": 6.0,
            "z_ecef_km": 9.0,
        }
        state, interpolated = interpolate_ecef(before, after, start + timedelta(seconds=5))
        self.assertTrue(interpolated)
        self.assertEqual((state.x_ecef_km, state.y_ecef_km, state.z_ecef_km), (2.0, 4.0, 6.0))


if __name__ == "__main__":
    unittest.main()
