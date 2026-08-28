from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
import hashlib
import json
import math
from typing import Any, Mapping, Protocol
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from .mock_satellite import MOCK_OMM


class ProviderError(RuntimeError):
    pass


@dataclass(frozen=True)
class NormalizedElementSet:
    epoch: datetime
    source: str
    source_format: str
    mean_element_theory: str
    mean_motion: float
    eccentricity: float
    inclination_deg: float
    ra_of_asc_node_deg: float
    arg_of_pericenter_deg: float
    mean_anomaly_deg: float
    bstar: float
    mean_motion_dot: float
    mean_motion_ddot: float
    element_set_no: int | None
    rev_at_epoch: int | None
    raw_payload: dict[str, Any]

    def fingerprint(self) -> str:
        payload = {
            "epoch": self.epoch.astimezone(timezone.utc).isoformat(),
            "source": self.source,
            "source_format": self.source_format,
            "mean_element_theory": self.mean_element_theory,
            "mean_motion": self.mean_motion,
            "eccentricity": self.eccentricity,
            "inclination_deg": self.inclination_deg,
            "ra_of_asc_node_deg": self.ra_of_asc_node_deg,
            "arg_of_pericenter_deg": self.arg_of_pericenter_deg,
            "mean_anomaly_deg": self.mean_anomaly_deg,
            "bstar": self.bstar,
            "mean_motion_dot": self.mean_motion_dot,
            "mean_motion_ddot": self.mean_motion_ddot,
            "element_set_no": self.element_set_no,
            "rev_at_epoch": self.rev_at_epoch,
        }
        encoded = json.dumps(payload, sort_keys=True, separators=(",", ":")).encode("utf-8")
        return hashlib.sha256(encoded).hexdigest()


class OrbitalDataProvider(Protocol):
    name: str

    def fetch_latest(self, identifiers: Mapping[str, str]) -> NormalizedElementSet:
        ...


def _parse_epoch(value: Any) -> datetime:
    if not value:
        raise ProviderError("OMM payload is missing EPOCH")
    text = str(value).strip()
    if text.endswith("Z"):
        text = text[:-1] + "+00:00"
    try:
        parsed = datetime.fromisoformat(text)
    except ValueError as error:
        raise ProviderError(f"invalid OMM EPOCH: {value!r}") from error
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def _float(payload: Mapping[str, Any], key: str, default: float | None = None) -> float:
    value = payload.get(key, default)
    if value is None:
        raise ProviderError(f"OMM payload is missing {key}")
    try:
        result = float(value)
    except (TypeError, ValueError) as error:
        raise ProviderError(f"invalid OMM {key}: {value!r}") from error
    if not math.isfinite(result):
        raise ProviderError(f"invalid OMM {key}: non-finite value")
    return result


def _optional_int(payload: Mapping[str, Any], key: str) -> int | None:
    value = payload.get(key)
    if value in (None, ""):
        return None
    try:
        return int(value)
    except (TypeError, ValueError) as error:
        raise ProviderError(f"invalid OMM {key}: {value!r}") from error


def normalize_omm_payload(
    payload: Mapping[str, Any],
    *,
    source: str,
    source_format: str = "OMM_JSON",
) -> NormalizedElementSet:
    mean_motion = _float(payload, "MEAN_MOTION")
    eccentricity = _float(payload, "ECCENTRICITY")
    inclination = _float(payload, "INCLINATION")
    if mean_motion <= 0:
        raise ProviderError("OMM MEAN_MOTION must be positive")
    if not 0 <= eccentricity < 1:
        raise ProviderError("OMM ECCENTRICITY must be in [0, 1)")
    if not 0 <= inclination <= 180:
        raise ProviderError("OMM INCLINATION must be in [0, 180]")

    theory = str(payload.get("MEAN_ELEMENT_THEORY") or "SGP4").strip().upper()
    return NormalizedElementSet(
        epoch=_parse_epoch(payload.get("EPOCH")),
        source=source,
        source_format=source_format,
        mean_element_theory=theory,
        mean_motion=mean_motion,
        eccentricity=eccentricity,
        inclination_deg=inclination,
        ra_of_asc_node_deg=_float(payload, "RA_OF_ASC_NODE"),
        arg_of_pericenter_deg=_float(payload, "ARG_OF_PERICENTER"),
        mean_anomaly_deg=_float(payload, "MEAN_ANOMALY"),
        bstar=_float(payload, "BSTAR", 0.0),
        mean_motion_dot=_float(payload, "MEAN_MOTION_DOT", 0.0),
        mean_motion_ddot=_float(payload, "MEAN_MOTION_DDOT", 0.0),
        element_set_no=_optional_int(payload, "ELEMENT_SET_NO"),
        rev_at_epoch=_optional_int(payload, "REV_AT_EPOCH"),
        raw_payload=dict(payload),
    )


class MockOrbitalDataProvider:
    name = "mock"

    def fetch_latest(self, identifiers: Mapping[str, str]) -> NormalizedElementSet:
        del identifiers
        return normalize_omm_payload(MOCK_OMM, source=self.name)


class CelesTrakProvider:
    name = "celestrak"

    def __init__(self, base_url: str, timeout_seconds: float = 15.0):
        self.base_url = base_url
        self.timeout_seconds = timeout_seconds

    def _load(self, parameters: Mapping[str, str]) -> list[dict[str, Any]]:
        query = urlencode(parameters)
        request = Request(
            f"{self.base_url}?{query}",
            headers={
                "Accept": "application/json",
                "User-Agent": "WorldSatMonitor/0.4 (+https://github.com/ExoSpaceLabs/world-sat-monitor)",
            },
        )
        try:
            with urlopen(request, timeout=self.timeout_seconds) as response:
                payload = json.load(response)
        except Exception as error:
            raise ProviderError(f"CelesTrak request failed: {error}") from error
        if not isinstance(payload, list) or not payload:
            raise ProviderError("CelesTrak returned no GP data")
        records = [item for item in payload if isinstance(item, dict)]
        if not records:
            raise ProviderError("CelesTrak returned invalid GP JSON records")
        return records

    def fetch_latest(self, identifiers: Mapping[str, str]) -> NormalizedElementSet:
        norad_id = identifiers.get("NORAD_CAT_ID")
        if not norad_id:
            raise ProviderError("CelesTrak requires a NORAD_CAT_ID identifier")
        records = self._load({"CATNR": str(norad_id), "FORMAT": "JSON"})
        record = next(
            (item for item in records if str(item.get("NORAD_CAT_ID", "")) == str(norad_id)),
            records[0],
        )
        return normalize_omm_payload(record, source=self.name)

    def fetch_group(self, group_key: str) -> dict[str, NormalizedElementSet]:
        records = self._load({"GROUP": group_key, "FORMAT": "JSON"})
        result: dict[str, NormalizedElementSet] = {}
        for record in records:
            norad_id = str(record.get("NORAD_CAT_ID") or "").strip()
            if not norad_id:
                continue
            result[norad_id] = normalize_omm_payload(record, source=self.name)
        if not result:
            raise ProviderError(f"CelesTrak returned no usable GP data for group {group_key}")
        return result
