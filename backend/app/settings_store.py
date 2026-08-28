from __future__ import annotations

import json
import os
from pathlib import Path
from threading import RLock
from typing import Literal

from pydantic import BaseModel, Field

CURRENT_SETTINGS_VERSION = 6
DEFAULT_THEMED_BASE_COLOR = "#041018"
DEFAULT_THEMED_CONTRAST = 0.18
HEX_COLOR_PATTERN = r"^#[0-9A-Fa-f]{6}$"


class MapSettings(BaseModel):
    basemap: Literal["dark", "street", "satellite"] = "dark"
    themed_base_color: str = Field(default=DEFAULT_THEMED_BASE_COLOR, pattern=HEX_COLOR_PATTERN)
    themed_contrast: float = Field(default=DEFAULT_THEMED_CONTRAST, ge=-0.95, le=0.95)
    space_environment: bool = True
    shadow_opacity: float = Field(default=0.70, ge=0.0, le=1.0)
    debug: bool = False
    time_scale: float = Field(default=1.0, ge=0.0, le=360.0)


class OrbitPathSettings(BaseModel):
    enabled: bool = True
    mode: Literal["ground", "orbit"] = "ground"
    history_minutes: int = Field(default=90, ge=0, le=1440)
    prediction_hours: int = Field(default=6, ge=0, le=336)
    resolution_seconds: int = Field(default=60, ge=10, le=3600)
    refresh_seconds: int = Field(default=30, ge=5, le=3600)


class OrbitDisplaySettings(BaseModel):
    """Detailed orbit policy for the single displayed satellite."""

    direction_vector_enabled: bool = True
    position_update_ms: int = Field(default=1000, ge=100, le=10000)
    path: OrbitPathSettings = Field(default_factory=OrbitPathSettings)


class GroupOrbitDisplaySettings(BaseModel):
    """Lightweight propagation/render policy for the displayed group."""

    position_update_ms: int = Field(default=2000, ge=500, le=10000)
    prediction_hours: int = Field(default=3, ge=1, le=336)
    step_seconds: int = Field(default=120, ge=10, le=3600)
    refresh_seconds: int = Field(default=60, ge=15, le=1800)


class AppSettings(BaseModel):
    version: int = Field(default=CURRENT_SETTINGS_VERSION, ge=CURRENT_SETTINGS_VERSION, le=CURRENT_SETTINGS_VERSION)
    map: MapSettings = Field(default_factory=MapSettings)
    orbit: OrbitDisplaySettings = Field(default_factory=OrbitDisplaySettings)
    group_orbit: GroupOrbitDisplaySettings = Field(default_factory=GroupOrbitDisplaySettings)


def default_app_settings() -> AppSettings:
    return AppSettings()


def _migrate_settings(raw: object) -> object:
    """Migrate persisted settings while preserving user-visible configuration."""
    if not isinstance(raw, dict):
        return raw

    migrated = dict(raw)
    legacy_satellite = migrated.pop("satellite", None)

    map_settings = migrated.get("map")
    if not isinstance(map_settings, dict):
        map_settings = {}
    else:
        map_settings = dict(map_settings)

    legacy_water = map_settings.pop("themed_water_color", None)
    map_settings.pop("themed_land_color", None)
    if "themed_base_color" not in map_settings:
        map_settings["themed_base_color"] = legacy_water if isinstance(legacy_water, str) else DEFAULT_THEMED_BASE_COLOR
    map_settings.setdefault("themed_contrast", DEFAULT_THEMED_CONTRAST)
    migrated["map"] = map_settings

    if "orbit" not in migrated and isinstance(legacy_satellite, dict):
        migrated["orbit"] = {
            "position_update_ms": legacy_satellite.get("position_update_ms", 1000),
            "path": legacy_satellite.get("path", {}),
        }

    orbit = migrated.get("orbit")
    if not isinstance(orbit, dict):
        orbit = {}
        migrated["orbit"] = orbit
    else:
        orbit = dict(orbit)
        migrated["orbit"] = orbit

    orbit.setdefault("direction_vector_enabled", True)
    path = orbit.get("path")
    if not isinstance(path, dict):
        path = {}
        orbit["path"] = path
    else:
        path = dict(path)
        orbit["path"] = path
    path.setdefault("mode", "ground")

    group_orbit = migrated.get("group_orbit")
    migrated["group_orbit"] = dict(group_orbit) if isinstance(group_orbit, dict) else {}
    migrated["version"] = CURRENT_SETTINGS_VERSION
    return migrated


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

        migrated = _migrate_settings(raw)
        validated = AppSettings.model_validate(migrated)
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
