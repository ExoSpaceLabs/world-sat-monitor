from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, HTTPException, Query, Response, status

from .db import connect
from .group_display import release_group_display, request_group_display
from .group_models import (
    SatelliteGroupCreate,
    SatelliteGroupDisplayRequest,
    SatelliteGroupMemberAdd,
    SatelliteGroupUpdate,
)
from .orbit import CartesianState, ecef_to_geodetic_spherical, initial_bearing_deg, interpolate_ecef
from .repository import (
    add_group_member,
    create_group,
    delete_group,
    get_group,
    get_group_current_positions,
    get_group_positions_at,
    get_satellite,
    list_group_members,
    list_groups,
    remove_group_member,
    update_group,
)


MAX_GROUP_POSITION_RESULTS = 10000
router = APIRouter(prefix="/api/v1/groups", tags=["groups"])


def _group_payload(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": row["id"], "name": row["name"], "group_type": row["group_type"],
        "source": row["source"], "source_key": row["source_key"], "metadata": row["metadata"],
        "member_count": row["member_count"], "active_member_count": row["active_member_count"],
        "created_at": row["created_at"], "updated_at": row["updated_at"],
    }


def _member_payload(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": row["id"], "name": row["name"], "active": row["active"],
        "object_type": row["object_type"], "provider_preference": row["provider_preference"],
        "metadata": row["metadata"], "identifiers": row["identifiers"], "norad_id": row.get("norad_id"),
        "membership_metadata": row["membership_metadata"], "added_at": row["added_at"],
    }


def _position_payload(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "satellite": {"id": row["id"], "name": row["name"], "active": row["active"], "norad_id": row.get("norad_id"), "identifiers": row["identifiers"]},
        "state_time": row["state_time"],
        "position": {"lat_deg": row["lat_deg"], "lon_deg": row["lon_deg"], "altitude_km": row["altitude_km"], "heading_deg": None},
        "source": {"run_id": str(row["source_run_id"]), "source_element_set_id": row["source_element_set_id"]},
    }


def _sample_geodetic(sample: dict[str, Any]):
    return ecef_to_geodetic_spherical(CartesianState(
        x_ecef_km=float(sample["x_ecef_km"]),
        y_ecef_km=float(sample["y_ecef_km"]),
        z_ecef_km=float(sample["z_ecef_km"]),
    ))


def _position_at_payload(row: dict[str, Any], at: datetime) -> dict[str, Any]:
    before = {
        "sample_time": row["before_time"],
        "x_ecef_km": row["before_x_ecef_km"],
        "y_ecef_km": row["before_y_ecef_km"],
        "z_ecef_km": row["before_z_ecef_km"],
    }
    after = {
        "sample_time": row["after_time"],
        "x_ecef_km": row["after_x_ecef_km"],
        "y_ecef_km": row["after_y_ecef_km"],
        "z_ecef_km": row["after_z_ecef_km"],
    }
    ecef, _ = interpolate_ecef(before, after, at)
    geodetic = ecef_to_geodetic_spherical(ecef)
    heading = None
    if before["sample_time"] != after["sample_time"]:
        heading = initial_bearing_deg(_sample_geodetic(before), _sample_geodetic(after))
    return {
        "satellite": {"id": row["id"], "name": row["name"], "active": row["active"], "norad_id": row.get("norad_id"), "identifiers": row["identifiers"]},
        "state_time": at.isoformat(),
        "position": {"lat_deg": geodetic.lat_deg, "lon_deg": geodetic.lon_deg, "altitude_km": geodetic.altitude_km, "heading_deg": heading},
        "source": {"run_id": str(row["source_run_id"]), "source_element_set_id": row["source_element_set_id"]},
    }


def _load_group(connection, group_id: int) -> dict[str, Any]:
    group = get_group(connection, group_id)
    if group is None:
        raise HTTPException(status_code=404, detail="satellite group not found")
    return group


def _require_user_managed(group: dict[str, Any]) -> None:
    if group["source"] != "user":
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="provider-managed group cannot be changed through the custom group API")


@router.get("")
def groups():
    with connect() as connection:
        rows = list_groups(connection)
    return {"groups": [_group_payload(row) for row in rows]}


@router.post("", status_code=status.HTTP_201_CREATED)
def add_group(value: SatelliteGroupCreate):
    with connect() as connection:
        row = create_group(connection, value)
        connection.commit()
    return _group_payload(row)


@router.get("/{group_id}")
def group_details(group_id: int):
    with connect() as connection:
        row = _load_group(connection, group_id)
    return _group_payload(row)


@router.patch("/{group_id}")
def patch_group(group_id: int, value: SatelliteGroupUpdate):
    with connect() as connection:
        group = _load_group(connection, group_id)
        _require_user_managed(group)
        row = update_group(connection, group_id, value.model_dump(exclude_unset=True))
        if row is None:
            raise HTTPException(status_code=404, detail="satellite group not found")
        connection.commit()
    return _group_payload(row)


@router.delete("/{group_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_group(group_id: int):
    with connect() as connection:
        group = _load_group(connection, group_id)
        _require_user_managed(group)
        if not delete_group(connection, group_id):
            raise HTTPException(status_code=404, detail="satellite group not found")
        connection.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/{group_id}/members")
def group_members(group_id: int):
    with connect() as connection:
        _load_group(connection, group_id)
        rows = list_group_members(connection, group_id)
    return {"members": [_member_payload(row) for row in rows]}


@router.post("/{group_id}/members", status_code=status.HTTP_201_CREATED)
def add_member(group_id: int, value: SatelliteGroupMemberAdd):
    with connect() as connection:
        group = _load_group(connection, group_id)
        _require_user_managed(group)
        if get_satellite(connection, value.satellite_id) is None:
            raise HTTPException(status_code=404, detail="satellite not found")
        row = add_group_member(connection, group_id, value.satellite_id, value.metadata)
        if row is None:
            raise HTTPException(status_code=500, detail="group member could not be reloaded")
        connection.commit()
    return _member_payload(row)


@router.delete("/{group_id}/members/{satellite_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_member(group_id: int, satellite_id: int):
    with connect() as connection:
        group = _load_group(connection, group_id)
        _require_user_managed(group)
        if not remove_group_member(connection, group_id, satellite_id):
            raise HTTPException(status_code=404, detail="group member not found")
        connection.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/{group_id}/display")
def display_group(group_id: int, value: SatelliteGroupDisplayRequest):
    with connect() as connection:
        group = _load_group(connection, group_id)
        display = request_group_display(
            connection,
            group_id,
            prediction_hours=value.prediction_hours,
            step_seconds=value.step_seconds,
            lease_seconds=value.lease_seconds,
        )
        connection.commit()
    if display is None:
        raise HTTPException(status_code=404, detail="satellite group not found")
    return {
        "group": _group_payload(group),
        "display": {
            "requested_until": display["display_requested_until"],
            "prediction_hours": display["display_prediction_hours"],
            "step_seconds": display["display_step_seconds"],
        },
    }


@router.delete("/{group_id}/display", status_code=status.HTTP_204_NO_CONTENT)
def stop_display_group(group_id: int):
    with connect() as connection:
        _load_group(connection, group_id)
        if not release_group_display(connection, group_id):
            raise HTTPException(status_code=404, detail="satellite group not found")
        connection.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/{group_id}/positions")
def group_positions(
    group_id: int,
    at: datetime | None = Query(default=None),
    active_only: bool = Query(default=False),
    limit: int = Query(default=MAX_GROUP_POSITION_RESULTS, ge=1, le=MAX_GROUP_POSITION_RESULTS),
):
    at_utc: datetime | None = None
    if at is not None:
        if at.tzinfo is None:
            raise HTTPException(status_code=422, detail="timestamps must include a timezone")
        at_utc = at.astimezone(timezone.utc)
    with connect() as connection:
        group = _load_group(connection, group_id)
        if at_utc is None:
            rows = get_group_current_positions(connection, group_id, active_only=active_only, limit=limit)
        else:
            rows = get_group_positions_at(connection, group_id, at_utc, active_only=active_only, limit=limit)
    payloads = (
        [_position_payload(row) for row in rows]
        if at_utc is None
        else [_position_at_payload(row, at_utc) for row in rows]
    )
    return {
        "group": _group_payload(group),
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "at": at_utc.isoformat() if at_utc is not None else None,
        "returned": len(rows),
        "positions": payloads,
    }
