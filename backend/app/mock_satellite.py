from __future__ import annotations

MOCK_NAME = "WORLDSAT-01"
# Project-reserved synthetic NORAD-compatible identifier. It is never sent to external providers
# and is not claimed to be an official USSF/NORAD catalog assignment.
MOCK_NORAD_ID = "999999999"
MOCK_PROVIDER = "mock"

MOCK_OMM = {
    "OBJECT_NAME": MOCK_NAME,
    "OBJECT_ID": "WORLDSAT-000A",
    "EPOCH": "2026-01-01T00:00:00.000000",
    "MEAN_MOTION": 15.35,
    "ECCENTRICITY": 0.0012,
    "INCLINATION": 51.6,
    "RA_OF_ASC_NODE": 112.0,
    "ARG_OF_PERICENTER": 74.0,
    "MEAN_ANOMALY": 21.0,
    "EPHEMERIS_TYPE": 0,
    "CLASSIFICATION_TYPE": "U",
    "NORAD_CAT_ID": int(MOCK_NORAD_ID),
    "ELEMENT_SET_NO": 1,
    "REV_AT_EPOCH": 1,
    "BSTAR": 0.00008,
    "MEAN_MOTION_DOT": 0.00001,
    "MEAN_MOTION_DDOT": 0.0,
    "CENTER_NAME": "EARTH",
    "REF_FRAME": "TEME",
    "TIME_SYSTEM": "UTC",
    "MEAN_ELEMENT_THEORY": "SGP4",
}
