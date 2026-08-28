from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field, field_validator, model_validator


class SatelliteIdentifierInput(BaseModel):
    namespace: str = Field(min_length=1, max_length=64)
    value: str = Field(min_length=1, max_length=128)

    @field_validator("namespace")
    @classmethod
    def normalize_namespace(cls, value: str) -> str:
        return value.strip().upper()

    @field_validator("value")
    @classmethod
    def normalize_value(cls, value: str) -> str:
        return value.strip()


class SatelliteCreate(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    active: bool = False
    object_type: str = Field(default="payload", min_length=1, max_length=64)
    provider_preference: str | None = Field(default=None, max_length=128)
    metadata: dict[str, Any] = Field(default_factory=dict)
    identifiers: list[SatelliteIdentifierInput] = Field(default_factory=list)

    @field_validator("name", "object_type")
    @classmethod
    def strip_required_text(cls, value: str) -> str:
        return value.strip()

    @field_validator("provider_preference")
    @classmethod
    def strip_optional_text(cls, value: str | None) -> str | None:
        if value is None:
            return None
        stripped = value.strip()
        return stripped or None

    @model_validator(mode="after")
    def unique_identifier_namespaces(self):
        namespaces = [identifier.namespace for identifier in self.identifiers]
        if len(namespaces) != len(set(namespaces)):
            raise ValueError("identifier namespaces must be unique per satellite")
        return self


class SatelliteUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=255)
    object_type: str | None = Field(default=None, min_length=1, max_length=64)
    provider_preference: str | None = Field(default=None, max_length=128)
    metadata: dict[str, Any] | None = None
    identifiers: list[SatelliteIdentifierInput] | None = None

    @field_validator("name", "object_type")
    @classmethod
    def strip_optional_required_text(cls, value: str | None) -> str | None:
        return value.strip() if value is not None else None

    @field_validator("provider_preference")
    @classmethod
    def strip_provider_preference(cls, value: str | None) -> str | None:
        if value is None:
            return None
        stripped = value.strip()
        return stripped or None

    @model_validator(mode="after")
    def unique_identifier_namespaces(self):
        if self.identifiers is None:
            return self
        namespaces = [identifier.namespace for identifier in self.identifiers]
        if len(namespaces) != len(set(namespaces)):
            raise ValueError("identifier namespaces must be unique per satellite")
        return self
