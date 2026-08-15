from __future__ import annotations

from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone

from fastapi import FastAPI, HTTPException, Query

from .db import connect, wait_for_database
from .orbit import (
    GeodeticState,
    ecef_to_geodetic_spherical,
    initial_bearing_deg,
    interpolate_ecef,
)
from .repository import (
    get_position_bracket,
    get_prediction_errors,
    get_run_covering,
    get_satellite,
    get_track_points,
    list_satellites,
)
from .seed import ensure_mock_data


def _normalize_utc(value: datetime | None, default: datetime) -> datetime:
    resolved = value or default
    if resolved.tzinfo is None:
        raise HTTPException(status_code=422, detail="timestamps must include a timezone")
    return resolved.astimezone(timezone.utc)


@asynccontextmanager
async def lifespan(_: FastAPI):
    wait_for_database()
    ensure_mock_data()
    yield


app = FastAPI(
    title="WorldSat Monitor API",
    version="0.1.0",
    lifespan=lifespan,
)


@app.get("/api/v1/health")
def health() -> dict[str, str]:
    with connect() as connection:
        connection.execute("SELECT 1")
    return {"status": "ok", "time": datetime.now(timezone.utc).isoformat()}


@app.get("/api/v1/satellites")
def satellites():
    with connect() as connection:
        rows = list_satellites(connection)
    return {
        "satellites": [
            {
                "norad_id": row["norad_id"],
                "name": row["name"],
                "active": row["active"],
            }
            for row in rows
        ]
    }


@app.get("/api/v1/satellites/{norad_id}/position")
def satellite_position(
    norad_id: int,
    at: datetime | None = Query(default=None),
):
    request_now = datetime.now(timezone.utc)
    at_utc = _normalize_utc(at, request_now)

    with connect() as connection:
        satellite = get_satellite(connection, norad_id)
        if satellite is None:
            raise HTTPException(status_code=404, detail="satellite not found")

        run = get_run_covering(connection, satellite["id"], at_utc, at_utc)
        if run is None:
            raise HTTPException(status_code=404, detail="no propagated state covers timestamp")

        before, after = get_position_bracket(connection, str(run["id"]), at_utc)
        if before is None or after is None:
            raise HTTPException(status_code=404, detail="position samples do not bracket timestamp")

    ecef, interpolated = interpolate_ecef(before, after, at_utc)
    geodetic = ecef_to_geodetic_spherical(ecef)
    before_geo = GeodeticState(
        lat_deg=float(before["lat_deg"]),
        lon_deg=float(before["lon_deg"]),
        altitude_km=float(before["altitude_km"]),
    )
    after_geo = GeodeticState(
        lat_deg=float(after["lat_deg"]),
        lon_deg=float(after["lon_deg"]),
        altitude_km=float(after["altitude_km"]),
    )
    heading = initial_bearing_deg(before_geo, after_geo)

    return {
        "satellite": {"norad_id": satellite["norad_id"], "name": satellite["name"]},
        "at": at_utc.isoformat(),
        "segment": "prediction" if at_utc > request_now else "history",
        "position": {
            "lat_deg": geodetic.lat_deg,
            "lon_deg": geodetic.lon_deg,
            "altitude_km": geodetic.altitude_km,
            "heading_deg": heading,
            "x_ecef_km": ecef.x_ecef_km,
            "y_ecef_km": ecef.y_ecef_km,
            "z_ecef_km": ecef.z_ecef_km,
        },
        "interpolated": interpolated,
        "source": {
            "run_id": str(run["id"]),
            "generated_at": run["generated_at"].isoformat(),
            "step_seconds": run["step_seconds"],
            "is_mock": run["is_mock"],
            "source_tle_id": run["source_tle_id"],
        },
    }


@app.get("/api/v1/satellites/{norad_id}/track")
def satellite_track(
    norad_id: int,
    start: datetime | None = Query(default=None),
    end: datetime | None = Query(default=None),
    resolution_seconds: int = Query(default=60, ge=10, le=3600),
    max_points: int = Query(default=5000, ge=2, le=10000),
):
    request_now = datetime.now(timezone.utc)
    start_utc = _normalize_utc(start, request_now - timedelta(minutes=90))
    end_utc = _normalize_utc(end, request_now + timedelta(minutes=90))
    if end_utc <= start_utc:
        raise HTTPException(status_code=422, detail="end must be after start")
    if end_utc - start_utc > timedelta(days=14):
        raise HTTPException(status_code=422, detail="track window cannot exceed 14 days")

    with connect() as connection:
        satellite = get_satellite(connection, norad_id)
        if satellite is None:
            raise HTTPException(status_code=404, detail="satellite not found")

        run = get_run_covering(connection, satellite["id"], start_utc, end_utc)
        if run is None:
            raise HTTPException(status_code=404, detail="no propagation run covers requested window")

        points, effective_resolution_seconds = get_track_points(
            connection,
            str(run["id"]),
            start_utc,
            end_utc,
            int(run["step_seconds"]),
            resolution_seconds,
            max_points,
        )

    return {
        "satellite": {"norad_id": satellite["norad_id"], "name": satellite["name"]},
        "start": start_utc.isoformat(),
        "end": end_utc.isoformat(),
        "requested_resolution_seconds": resolution_seconds,
        "resolution_seconds": effective_resolution_seconds,
        "source": {
            "run_id": str(run["id"]),
            "generated_at": run["generated_at"].isoformat(),
            "raw_step_seconds": run["step_seconds"],
            "is_mock": run["is_mock"],
        },
        "points": [
            {
                "time": point["sample_time"].isoformat(),
                "lat_deg": point["lat_deg"],
                "lon_deg": point["lon_deg"],
                "altitude_km": point["altitude_km"],
                "segment": "prediction" if point["sample_time"] > request_now else "history",
            }
            for point in points
        ],
    }


@app.get("/api/v1/satellites/{norad_id}/prediction-error")
def prediction_error(norad_id: int):
    now = datetime.now(timezone.utc)
    with connect() as connection:
        satellite = get_satellite(connection, norad_id)
        if satellite is None:
            raise HTTPException(status_code=404, detail="satellite not found")

        run = get_run_covering(connection, satellite["id"], now, now)
        if run is None:
            raise HTTPException(status_code=404, detail="no current propagation run")
        rows = get_prediction_errors(connection, str(run["id"]))

    return {
        "satellite": {"norad_id": satellite["norad_id"], "name": satellite["name"]},
        "run_id": str(run["id"]),
        "reference_note": (
            "Values are disagreement against a later reference ephemeris/TLE, not absolute truth."
        ),
        "buckets": [
            {
                "horizon_day": row["horizon_day"],
                "mean_error_km": row["mean_error_km"],
                "rms_error_km": row["rms_error_km"],
                "p95_error_km": row["p95_error_km"],
                "max_error_km": row["max_error_km"],
                "sample_count": row["sample_count"],
                "evaluated_at": row["evaluated_at"].isoformat(),
                "reference_kind": row["reference_kind"],
            }
            for row in rows
        ],
    }
