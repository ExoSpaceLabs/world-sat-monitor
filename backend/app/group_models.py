from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator


GroupType = Literal["constellation", "custom", "mission"]


class SatelliteGroupCreate(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    group_type: GroupType = "custom"
    metadata: dict[str, Any] = Field(default_factory=dict)

    @field_validator("name")
    @classmethod
    def strip_name(cls, value: str) -> str:
        return value.strip()


class SatelliteGroupUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=255)
    group_type: GroupType | None = None
    metadata: dict[str, Any] | None = None

    @field_validator("name")
    @classmethod
    def strip_optional_name(cls, value: str | None) -> str | None:
        return value.strip() if value is not None else None


class SatelliteGroupMemberAdd(BaseModel):
    satellite_id: int = Field(gt=0)
    metadata: dict[str, Any] = Field(default_factory=dict)
