from __future__ import annotations

import json
import os
from pathlib import Path
from threading import RLock
from typing import Literal

from pydantic import BaseModel, Field


class MapSettings(BaseModel):
    basemap: Literal["dark", "street", "satellite"] = "dark"
    space_environment: bool = True
    shadow_opacity: float = Field(default=0.70, ge=0.0, le=1.0)
    debug: bool = False
    time_scale: float = Field(default=1.0, ge=0.0, le=360.0)


class SatellitePathSettings(BaseModel):
    enabled: bool = True
    history_minutes: int = Field(default=90, ge=0, le=1440)
    prediction_hours: int = Field(default=6, ge=0, le=336)
    resolution_seconds: int = Field(default=60, ge=10, le=3600)
    refresh_seconds: int = Field(default=30, ge=5, le=3600)


class SatelliteSettings(BaseModel):
    selected_norad_id: int = Field(default=99001, gt=0)
    position_update_ms: int = Field(default=1000, ge=100, le=10000)
    path: SatellitePathSettings = Field(default_factory=SatellitePathSettings)


class AppSettings(BaseModel):
    version: int = Field(default=1, ge=1)
    map: MapSettings = Field(default_factory=MapSettings)
    satellite: SatelliteSettings = Field(default_factory=SatelliteSettings)


def default_app_settings() -> AppSettings:
    return AppSettings()


class JsonSettingsStore:
    """Versioned, atomically-written application settings persisted as JSON."""

    def __init__(self, path: str | Path):
        self.path = Path(path)
        self._lock = RLock()

    def ensure(self) -> AppSettings:
        with self._lock:
            if not self.path.exists():
                return self._write_unlocked(default_app_settings())
            return self._load_unlocked()

    def load(self) -> AppSettings:
        with self._lock:
            return self._load_unlocked()

    def save(self, value: AppSettings) -> AppSettings:
        with self._lock:
            return self._write_unlocked(value)

    def reset(self) -> AppSettings:
        with self._lock:
            return self._write_unlocked(default_app_settings())

    def _load_unlocked(self) -> AppSettings:
        if not self.path.exists():
            return self._write_unlocked(default_app_settings())

        with self.path.open("r", encoding="utf-8") as stream:
            raw = json.load(stream)

        validated = AppSettings.model_validate(raw)
        if validated.model_dump(mode="json") != raw:
            return self._write_unlocked(validated)
        return validated

    def _write_unlocked(self, value: AppSettings) -> AppSettings:
        validated = AppSettings.model_validate(value)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        temporary = self.path.with_name(f".{self.path.name}.tmp")
        payload = validated.model_dump(mode="json")
        with temporary.open("w", encoding="utf-8") as stream:
            json.dump(payload, stream, indent=2)
            stream.write("\n")
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, self.path)
        return validated
