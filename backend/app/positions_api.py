from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter
from pydantic import BaseModel, Field, field_validator, model_validator

from .db import connect
from .repository import get_current_positions_for_selection


MAX_CURRENT_POSITION_SELECTION = 10000
router = APIRouter(prefix="/api/v1/positions", tags=["positions"])


class CurrentPositionSelection(BaseModel):
    satellite_ids: list[int] = Field(default_factory=list, max_length=MAX_CURRENT_POSITION_SELECTION)
    norad_ids: list[str] = Field(default_factory=list, max_length=MAX_CURRENT_POSITION_SELECTION)
    active_only: bool = True

    @field_validator("satellite_ids")
    @classmethod
    def normalize_satellite_ids(cls, values: list[int]) -> list[int]:
        if any(value <= 0 for value in values):
            raise ValueError("satellite IDs must be positive")
        return list(dict.fromkeys(values))

    @field_validator("norad_ids")
    @classmethod
    def normalize_norad_ids(cls, values: list[str]) -> list[str]:
        cleaned = [value.strip() for value in values if value.strip()]
        return list(dict.fromkeys(cleaned))

    @model_validator(mode="after")
    def validate_selection(self):
        total = len(self.satellite_ids) + len(self.norad_ids)
        if total == 0:
            raise ValueError("at least one satellite or NORAD ID is required")
        if total > MAX_CURRENT_POSITION_SELECTION:
            raise ValueError(f"current-position selection cannot exceed {MAX_CURRENT_POSITION_SELECTION} identifiers")
        return self


def _position_payload(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "satellite": {
            "id": row["id"], "name": row["name"], "active": row["active"],
            "norad_id": row.get("norad_id"), "identifiers": row["identifiers"],
        },
        "state_time": row["state_time"],
        "position": {"lat_deg": row["lat_deg"], "lon_deg": row["lon_deg"], "altitude_km": row["altitude_km"]},
        "source": {"run_id": str(row["source_run_id"]), "source_element_set_id": row["source_element_set_id"]},
    }


@router.post("/current")
def current_positions(value: CurrentPositionSelection):
    with connect() as connection:
        rows = get_current_positions_for_selection(
            connection,
            satellite_ids=value.satellite_ids,
            norad_ids=value.norad_ids,
            active_only=value.active_only,
            limit=MAX_CURRENT_POSITION_SELECTION,
        )
    return {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "requested": len(value.satellite_ids) + len(value.norad_ids),
        "returned": len(rows),
        "positions": [_position_payload(row) for row in rows],
    }
