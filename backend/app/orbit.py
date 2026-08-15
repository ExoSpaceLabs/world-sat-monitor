from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
import math
from typing import Mapping, Any

EARTH_RADIUS_KM = 6371.0
EARTH_ROTATION_RAD_S = 7.2921150e-5
EARTH_MU_KM3_S2 = 398600.4418
MOCK_ALTITUDE_KM = 547.0
MOCK_INCLINATION_DEG = 51.6


@dataclass(frozen=True)
class CartesianState:
    x_ecef_km: float
    y_ecef_km: float
    z_ecef_km: float


@dataclass(frozen=True)
class GeodeticState:
    lat_deg: float
    lon_deg: float
    altitude_km: float


def _utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        raise ValueError("datetime must include a timezone")
    return value.astimezone(timezone.utc)


def mock_ecef_state(at: datetime, epoch: datetime) -> CartesianState:
    """Generate a deterministic circular-orbit mock state in ECEF coordinates."""
    at_utc = _utc(at)
    epoch_utc = _utc(epoch)
    radius = EARTH_RADIUS_KM + MOCK_ALTITUDE_KM
    inclination = math.radians(MOCK_INCLINATION_DEG)
    mean_motion = math.sqrt(EARTH_MU_KM3_S2 / radius**3)
    phase = mean_motion * (at_utc - epoch_utc).total_seconds()

    x_eci = radius * math.cos(phase)
    y_eci = radius * math.sin(phase) * math.cos(inclination)
    z_eci = radius * math.sin(phase) * math.sin(inclination)

    seconds_from_unix_epoch = at_utc.timestamp()
    earth_angle = (EARTH_ROTATION_RAD_S * seconds_from_unix_epoch) % (2 * math.pi)
    cos_theta = math.cos(earth_angle)
    sin_theta = math.sin(earth_angle)

    return CartesianState(
        x_ecef_km=cos_theta * x_eci + sin_theta * y_eci,
        y_ecef_km=-sin_theta * x_eci + cos_theta * y_eci,
        z_ecef_km=z_eci,
    )


def ecef_to_geodetic_spherical(state: CartesianState) -> GeodeticState:
    radius_xy = math.hypot(state.x_ecef_km, state.y_ecef_km)
    radius = math.sqrt(
        state.x_ecef_km**2 + state.y_ecef_km**2 + state.z_ecef_km**2
    )
    lat = math.atan2(state.z_ecef_km, radius_xy)
    lon = math.atan2(state.y_ecef_km, state.x_ecef_km)
    return GeodeticState(
        lat_deg=math.degrees(lat),
        lon_deg=math.degrees(lon),
        altitude_km=radius - EARTH_RADIUS_KM,
    )


def initial_bearing_deg(start: GeodeticState, end: GeodeticState) -> float:
    lat1 = math.radians(start.lat_deg)
    lat2 = math.radians(end.lat_deg)
    delta_lon = math.radians(end.lon_deg - start.lon_deg)
    y = math.sin(delta_lon) * math.cos(lat2)
    x = (
        math.cos(lat1) * math.sin(lat2)
        - math.sin(lat1) * math.cos(lat2) * math.cos(delta_lon)
    )
    return (math.degrees(math.atan2(y, x)) + 360.0) % 360.0


def interpolate_ecef(
    before: Mapping[str, Any],
    after: Mapping[str, Any],
    at: datetime,
) -> tuple[CartesianState, bool]:
    before_time = _utc(before["sample_time"])
    after_time = _utc(after["sample_time"])
    at_utc = _utc(at)

    span = (after_time - before_time).total_seconds()
    if span <= 0:
        fraction = 0.0
    else:
        fraction = (at_utc - before_time).total_seconds() / span
        fraction = min(1.0, max(0.0, fraction))

    state = CartesianState(
        x_ecef_km=float(before["x_ecef_km"])
        + (float(after["x_ecef_km"]) - float(before["x_ecef_km"])) * fraction,
        y_ecef_km=float(before["y_ecef_km"])
        + (float(after["y_ecef_km"]) - float(before["y_ecef_km"])) * fraction,
        z_ecef_km=float(before["z_ecef_km"])
        + (float(after["z_ecef_km"]) - float(before["z_ecef_km"])) * fraction,
    )
    exact = at_utc == before_time or at_utc == after_time
    return state, not exact
