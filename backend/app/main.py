from __future__ import annotations

from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from typing import Any

import psycopg
from fastapi import FastAPI, HTTPException, Query, Response, status

from .config import settings
from .db import connect, wait_for_database
from .groups_api import router as groups_router
from .migrations import migrate_legacy_schema
from .orbit import (
    GeodeticState,
    ecef_to_geodetic_spherical,
    initial_bearing_deg,
    interpolate_ecef,
)
from .positions_api import router as positions_router
from .repository import (
    create_satellite,
    delete_satellite,
    get_position_bracket,
    get_prediction_errors,
    get_run_covering,
    get_satellite,
    get_satellite_by_norad,
    get_track_points,
    list_satellites,
    set_satellite_active,
    update_satellite,
)
from .satellite_models import SatelliteCreate, SatelliteUpdate
from .seed import ensure_mock_data
from .settings_store import AppSettings, JsonSettingsStore

app_settings_store = JsonSettingsStore(settings.app_settings_path)


def _normalize_utc(value: datetime | None, default: datetime) -> datetime:
    resolved = value or default
    if resolved.tzinfo is None:
        raise HTTPException(status_code=422, detail="timestamps must include a timezone")
    return resolved.astimezone(timezone.utc)


def _satellite_payload(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": row["id"],
        "name": row["name"],
        "active": row["active"],
        "object_type": row["object_type"],
        "provider_preference": row["provider_preference"],
        "metadata": row["metadata"],
        "identifiers": row["identifiers"],
        "norad_id": row.get("norad_id"),
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
    }


def _raise_identifier_conflict(error: psycopg.Error) -> None:
    if isinstance(error, psycopg.errors.UniqueViolation):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="one or more satellite identifiers already belong to another satellite",
        ) from error
    raise error


@asynccontextmanager
async def lifespan(_: FastAPI):
    app_settings_store.ensure()
    wait_for_database()
    migrate_legacy_schema()
    ensure_mock_data()
    yield


app = FastAPI(
    title="WorldSat Monitor API",
    version="0.4.0",
    lifespan=lifespan,
)
app.include_router(groups_router)
app.include_router(positions_router)


@app.get("/api/v1/health")
def health() -> dict[str, str]:
    with connect() as connection:
        connection.execute("SELECT 1")
    return {"status": "ok", "time": datetime.now(timezone.utc).isoformat()}


@app.get("/api/v1/settings", response_model=AppSettings)
def get_app_settings() -> AppSettings:
    return app_settings_store.load()


@app.put("/api/v1/settings", response_model=AppSettings)
def put_app_settings(value: AppSettings) -> AppSettings:
    return app_settings_store.save(value)


@app.post("/api/v1/settings/reset", response_model=AppSettings)
def reset_app_settings() -> AppSettings:
    return app_settings_store.reset()


@app.get("/api/v1/satellites")
def satellites(active: bool | None = Query(default=None)):
    with connect() as connection:
        rows = list_satellites(connection, active=active)
    return {"satellites": [_satellite_payload(row) for row in rows]}


@app.post("/api/v1/satellites", status_code=status.HTTP_201_CREATED)
def add_satellite(value: SatelliteCreate):
    with connect() as connection:
        try:
            row = create_satellite(connection, value)
            connection.commit()
        except psycopg.Error as error:
            connection.rollback()
            _raise_identifier_conflict(error)
    return _satellite_payload(row)


@app.get("/api/v1/satellites/{satellite_id}")
def satellite_details(satellite_id: int):
    with connect() as connection:
        row = get_satellite(connection, satellite_id)
    if row is None:
        raise HTTPException(status_code=404, detail="satellite not found")
    return _satellite_payload(row)


@app.patch("/api/v1/satellites/{satellite_id}")
def patch_satellite(satellite_id: int, value: SatelliteUpdate):
    changes = value.model_dump(exclude_unset=True)
    with connect() as connection:
        try:
            row = update_satellite(connection, satellite_id, changes)
            if row is None:
                raise HTTPException(status_code=404, detail="satellite not found")
            connection.commit()
        except psycopg.Error as error:
            connection.rollback()
            _raise_identifier_conflict(error)
    return _satellite_payload(row)


@app.post("/api/v1/satellites/{satellite_id}/activate")
def activate_satellite(satellite_id: int):
    with connect() as connection:
        row = set_satellite_active(connection, satellite_id, True)
        if row is None:
            raise HTTPException(status_code=404, detail="satellite not found")
        connection.commit()
    return _satellite_payload(row)


@app.post("/api/v1/satellites/{satellite_id}/deactivate")
def deactivate_satellite(satellite_id: int):
    with connect() as connection:
        row = set_satellite_active(connection, satellite_id, False)
        if row is None:
            raise HTTPException(status_code=404, detail="satellite not found")
        connection.commit()
    return _satellite_payload(row)


@app.delete("/api/v1/satellites/{satellite_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_satellite(satellite_id: int):
    with connect() as connection:
        row = get_satellite(connection, satellite_id)
        if row is None:
            raise HTTPException(status_code=404, detail="satellite not found")
        if row["active"]:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="deactivate satellite before deleting it",
            )
        if not delete_satellite(connection, satellite_id):
            raise HTTPException(status_code=404, detail="satellite not found")
        connection.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@app.get("/api/v1/satellites/{norad_id}/position")
def satellite_position(
    norad_id: str,
    at: datetime | None = Query(default=None),
):
    request_now = datetime.now(timezone.utc)
    at_utc = _normalize_utc(at, request_now)

    with connect() as connection:
        satellite = get_satellite_by_norad(connection, norad_id)
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
        "satellite": {
            "id": satellite["id"],
            "norad_id": satellite["norad_id"],
            "name": satellite["name"],
            "active": satellite["active"],
        },
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
            "sampling_policy": run["sampling_policy"],
            "is_mock": run["is_mock"],
            "source_element_set_id": run["source_element_set_id"],
        },
    }


@app.get("/api/v1/satellites/{norad_id}/track")
def satellite_track(
    norad_id: str,
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
    if end_utc - start_utc > timedelta(days=15):
        raise HTTPException(status_code=422, detail="track window cannot exceed 15 days")

    with connect() as connection:
        satellite = get_satellite_by_norad(connection, norad_id)
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
        "satellite": {
            "id": satellite["id"],
            "norad_id": satellite["norad_id"],
            "name": satellite["name"],
            "active": satellite["active"],
        },
        "start": start_utc.isoformat(),
        "end": end_utc.isoformat(),
        "requested_resolution_seconds": resolution_seconds,
        "resolution_seconds": effective_resolution_seconds,
        "source": {
            "run_id": str(run["id"]),
            "generated_at": run["generated_at"].isoformat(),
            "raw_step_seconds": run["step_seconds"],
            "sampling_policy": run["sampling_policy"],
            "is_mock": run["is_mock"],
            "source_element_set_id": run["source_element_set_id"],
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
def prediction_error(norad_id: str):
    now = datetime.now(timezone.utc)
    with connect() as connection:
        satellite = get_satellite_by_norad(connection, norad_id)
        if satellite is None:
            raise HTTPException(status_code=404, detail="satellite not found")

        run = get_run_covering(connection, satellite["id"], now, now)
        if run is None:
            raise HTTPException(status_code=404, detail="no current propagation run")
        rows = get_prediction_errors(connection, str(run["id"]))

    return {
        "satellite": {
            "id": satellite["id"],
            "norad_id": satellite["norad_id"],
            "name": satellite["name"],
            "active": satellite["active"],
        },
        "run_id": str(run["id"]),
        "reference_note": (
            "Values are disagreement against a later reference orbital element set or ephemeris, "
            "not absolute navigation truth."
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
