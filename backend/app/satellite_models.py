from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field, field_validator, model_validator

from .provider_policy import DEFAULT_PROVIDER, normalize_provider_name, normalize_provider_priority


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
    provider_priority: list[str] = Field(default_factory=lambda: [DEFAULT_PROVIDER], min_length=1, max_length=8)
    metadata: dict[str, Any] = Field(default_factory=dict)
    identifiers: list[SatelliteIdentifierInput] = Field(default_factory=list)

    @field_validator("name", "object_type")
    @classmethod
    def strip_required_text(cls, value: str) -> str:
        return value.strip()

    @field_validator("provider_preference")
    @classmethod
    def normalize_optional_provider(cls, value: str | None) -> str | None:
        if value is None or not value.strip():
            return None
        return normalize_provider_name(value)

    @field_validator("provider_priority")
    @classmethod
    def normalize_priority(cls, value: list[str]) -> list[str]:
        return list(normalize_provider_priority(value))

    @model_validator(mode="after")
    def synchronize_provider_policy(self):
        if "provider_priority" in self.model_fields_set:
            self.provider_preference = self.provider_priority[0]
        elif self.provider_preference is not None:
            self.provider_priority = [self.provider_preference]
        else:
            self.provider_preference = self.provider_priority[0]
        return self

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
    provider_priority: list[str] | None = Field(default=None, min_length=1, max_length=8)
    metadata: dict[str, Any] | None = None
    identifiers: list[SatelliteIdentifierInput] | None = None

    @field_validator("name", "object_type")
    @classmethod
    def strip_optional_required_text(cls, value: str | None) -> str | None:
        return value.strip() if value is not None else None

    @field_validator("provider_preference")
    @classmethod
    def normalize_update_provider(cls, value: str | None) -> str | None:
        if value is None or not value.strip():
            return None
        return normalize_provider_name(value)

    @field_validator("provider_priority")
    @classmethod
    def normalize_update_priority(cls, value: list[str] | None) -> list[str] | None:
        return None if value is None else list(normalize_provider_priority(value))

    @model_validator(mode="after")
    def synchronize_provider_policy(self):
        if self.provider_priority is not None:
            self.provider_preference = self.provider_priority[0]
        elif "provider_preference" in self.model_fields_set:
            provider = self.provider_preference or DEFAULT_PROVIDER
            self.provider_preference = provider
            self.provider_priority = [provider]
        return self

    @model_validator(mode="after")
    def unique_identifier_namespaces(self):
        if self.identifiers is None:
            return self
        namespaces = [identifier.namespace for identifier in self.identifiers]
        if len(namespaces) != len(set(namespaces)):
            raise ValueError("identifier namespaces must be unique per satellite")
        return self
