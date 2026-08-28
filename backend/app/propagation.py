from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
import math
from typing import Any, Mapping, Protocol

from sgp4 import omm
from sgp4.api import SGP4_ERRORS, Satrec, jday

from .orbit import CartesianState, GeodeticState, ecef_to_geodetic_spherical


class PropagationError(RuntimeError):
    pass


@dataclass(frozen=True)
class PropagatedState:
    at: datetime
    teme_position_km: tuple[float, float, float]
    teme_velocity_km_s: tuple[float, float, float]
    ecef: CartesianState
    geodetic: GeodeticState


class PropagationEngine(Protocol):
    name: str

    def propagate(self, element_set: Mapping[str, Any], at: datetime) -> PropagatedState:
        ...


def _utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        raise ValueError("datetime must include a timezone")
    return value.astimezone(timezone.utc)


def _required(element_set: Mapping[str, Any], key: str) -> Any:
    value = element_set.get(key)
    if value is None:
        raise PropagationError(f"element set is missing {key}")
    return value


def _sgp4_catalog_number(value: Any) -> int:
    """Return a python-sgp4-compatible identity number.

    python-sgp4 currently constrains Satrec.satnum to 0..339999 even when OMM
    carries a larger catalog identifier. The number is metadata only and does
    not participate in SGP4 dynamics, so retain the real identifier in the raw
    OMM payload/database and use zero as the local Satrec sentinel when needed.
    """
    try:
        number = int(value)
    except (TypeError, ValueError):
        return 0
    return number if 0 <= number <= 339999 else 0


def _omm_fields(element_set: Mapping[str, Any]) -> dict[str, Any]:
    theory = str(element_set.get("mean_element_theory") or "").upper()
    if theory != "SGP4":
        raise PropagationError(f"unsupported mean element theory: {theory or 'missing'}")

    epoch = _utc(_required(element_set, "epoch"))
    raw = dict(element_set.get("raw_payload") or {})
    return {
        "OBJECT_NAME": raw.get("OBJECT_NAME", "WORLDSAT"),
        "OBJECT_ID": raw.get("OBJECT_ID", ""),
        "CENTER_NAME": raw.get("CENTER_NAME", "EARTH"),
        "REF_FRAME": raw.get("REF_FRAME", "TEME"),
        "TIME_SYSTEM": raw.get("TIME_SYSTEM", "UTC"),
        "MEAN_ELEMENT_THEORY": "SGP4",
        "EPOCH": epoch.replace(tzinfo=None).isoformat(timespec="microseconds"),
        "MEAN_MOTION": float(_required(element_set, "mean_motion")),
        "ECCENTRICITY": float(_required(element_set, "eccentricity")),
        "INCLINATION": float(_required(element_set, "inclination_deg")),
        "RA_OF_ASC_NODE": float(_required(element_set, "ra_of_asc_node_deg")),
        "ARG_OF_PERICENTER": float(_required(element_set, "arg_of_pericenter_deg")),
        "MEAN_ANOMALY": float(_required(element_set, "mean_anomaly_deg")),
        "EPHEMERIS_TYPE": int(raw.get("EPHEMERIS_TYPE", 0)),
        "CLASSIFICATION_TYPE": str(raw.get("CLASSIFICATION_TYPE", "U")),
        "NORAD_CAT_ID": _sgp4_catalog_number(raw.get("NORAD_CAT_ID", 0)),
        "ELEMENT_SET_NO": int(element_set.get("element_set_no") or 0),
        "REV_AT_EPOCH": int(element_set.get("rev_at_epoch") or 0),
        "BSTAR": float(element_set.get("bstar") or 0.0),
        "MEAN_MOTION_DOT": float(element_set.get("mean_motion_dot") or 0.0),
        "MEAN_MOTION_DDOT": float(element_set.get("mean_motion_ddot") or 0.0),
    }


def gmst_radians(at: datetime) -> float:
    """IAU-82/Vallado GMST approximation, using UTC as UT1 for visualization."""
    at_utc = _utc(at)
    jd, fr = jday(
        at_utc.year,
        at_utc.month,
        at_utc.day,
        at_utc.hour,
        at_utc.minute,
        at_utc.second + at_utc.microsecond / 1_000_000.0,
    )
    jd_ut1 = jd + fr
    tut1 = (jd_ut1 - 2451545.0) / 36525.0
    gmst_seconds = (
        67310.54841
        + (876600.0 * 3600.0 + 8640184.812866) * tut1
        + 0.093104 * tut1 * tut1
        - 6.2e-6 * tut1 * tut1 * tut1
    )
    return math.radians((gmst_seconds / 240.0) % 360.0)


def teme_to_ecef(position_km: tuple[float, float, float], at: datetime) -> CartesianState:
    theta = gmst_radians(at)
    cos_theta = math.cos(theta)
    sin_theta = math.sin(theta)
    x, y, z = position_km
    return CartesianState(
        x_ecef_km=cos_theta * x + sin_theta * y,
        y_ecef_km=-sin_theta * x + cos_theta * y,
        z_ecef_km=z,
    )


class SGP4PropagationEngine:
    name = "sgp4"

    def prepare(self, element_set: Mapping[str, Any]) -> Satrec:
        satellite = Satrec()
        try:
            omm.initialize(satellite, _omm_fields(element_set))
        except Exception as error:
            raise PropagationError(f"failed to initialize SGP4 from OMM fields: {error}") from error
        return satellite

    def propagate_prepared_teme(
        self,
        satellite: Satrec,
        at: datetime,
    ) -> tuple[tuple[float, float, float], tuple[float, float, float]]:
        at_utc = _utc(at)
        jd, fr = jday(
            at_utc.year,
            at_utc.month,
            at_utc.day,
            at_utc.hour,
            at_utc.minute,
            at_utc.second + at_utc.microsecond / 1_000_000.0,
        )
        error_code, position, velocity = satellite.sgp4(jd, fr)
        if error_code:
            message = SGP4_ERRORS.get(error_code, f"unknown SGP4 error {error_code}")
            raise PropagationError(message)
        return tuple(position), tuple(velocity)

    def propagate_teme(
        self,
        element_set: Mapping[str, Any],
        at: datetime,
    ) -> tuple[tuple[float, float, float], tuple[float, float, float]]:
        return self.propagate_prepared_teme(self.prepare(element_set), at)

    def propagate_prepared(self, satellite: Satrec, at: datetime) -> PropagatedState:
        at_utc = _utc(at)
        position, velocity = self.propagate_prepared_teme(satellite, at_utc)
        ecef = teme_to_ecef(position, at_utc)
        return PropagatedState(
            at=at_utc,
            teme_position_km=position,
            teme_velocity_km_s=velocity,
            ecef=ecef,
            geodetic=ecef_to_geodetic_spherical(ecef),
        )

    def propagate(self, element_set: Mapping[str, Any], at: datetime) -> PropagatedState:
        return self.propagate_prepared(self.prepare(element_set), at)
