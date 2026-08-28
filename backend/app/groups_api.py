from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, HTTPException, Response, status

from .db import connect
from .group_models import SatelliteGroupCreate, SatelliteGroupMemberAdd, SatelliteGroupUpdate
from .repository import (
    add_group_member,
    create_group,
    delete_group,
    get_group,
    get_group_current_positions,
    get_satellite,
    list_group_members,
    list_groups,
    remove_group_member,
    update_group,
)


router = APIRouter(prefix="/api/v1/groups", tags=["groups"])


def _group_payload(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": row["id"],
        "name": row["name"],
        "group_type": row["group_type"],
        "source": row["source"],
        "source_key": row["source_key"],
        "metadata": row["metadata"],
        "member_count": row["member_count"],
        "active_member_count": row["active_member_count"],
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
    }


def _member_payload(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": row["id"],
        "name": row["name"],
        "active": row["active"],
        "object_type": row["object_type"],
        "provider_preference": row["provider_preference"],
        "metadata": row["metadata"],
        "identifiers": row["identifiers"],
        "norad_id": row.get("norad_id"),
        "membership_metadata": row["membership_metadata"],
        "added_at": row["added_at"],
    }


def _load_group(connection, group_id: int) -> dict[str, Any]:
    group = get_group(connection, group_id)
    if group is None:
        raise HTTPException(status_code=404, detail="satellite group not found")
    return group


def _require_user_managed(group: dict[str, Any]) -> None:
    if group["source"] != "user":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="provider-managed group cannot be changed through the custom group API",
        )


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


@router.get("/{group_id}/positions")
def group_positions(group_id: int):
    with connect() as connection:
        group = _load_group(connection, group_id)
        rows = get_group_current_positions(connection, group_id)

    return {
        "group": _group_payload(group),
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "positions": [
            {
                "satellite": {
                    "id": row["id"],
                    "name": row["name"],
                    "active": row["active"],
                    "norad_id": row.get("norad_id"),
                    "identifiers": row["identifiers"],
                },
                "state_time": row["state_time"],
                "position": None if row["state_time"] is None else {
                    "lat_deg": row["lat_deg"],
                    "lon_deg": row["lon_deg"],
                    "altitude_km": row["altitude_km"],
                },
                "source": None if row["state_time"] is None else {
                    "run_id": str(row["source_run_id"]),
                    "source_element_set_id": row["source_element_set_id"],
                },
            }
            for row in rows
        ],
    }
