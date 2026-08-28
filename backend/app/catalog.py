from __future__ import annotations

from dataclasses import asdict, dataclass
import json
import re
from typing import Any, Mapping
from urllib.parse import urlencode
from urllib.request import Request, urlopen


class CatalogError(RuntimeError):
    pass


@dataclass(frozen=True)
class CatalogObject:
    provider: str
    provider_object_id: str
    name: str
    object_type: str | None
    identifiers: dict[str, str]
    metadata: dict[str, Any]

    def payload(self) -> dict[str, Any]:
        return asdict(self)


@dataclass(frozen=True)
class CatalogGroup:
    provider: str
    key: str
    name: str
    group_type: str = "constellation"

    def payload(self) -> dict[str, Any]:
        return asdict(self)


CELESTRAK_CONSTELLATION_GROUPS = (
    CatalogGroup(provider="celestrak", key="starlink", name="Starlink"),
    CatalogGroup(provider="celestrak", key="oneweb", name="OneWeb"),
    CatalogGroup(provider="celestrak", key="kuiper", name="Kuiper"),
    CatalogGroup(provider="celestrak", key="iridium-NEXT", name="Iridium NEXT"),
)


def celestrak_constellation_groups() -> tuple[CatalogGroup, ...]:
    return CELESTRAK_CONSTELLATION_GROUPS


def celestrak_constellation_group(key: str) -> CatalogGroup | None:
    clean = key.strip().lower()
    return next(
        (group for group in CELESTRAK_CONSTELLATION_GROUPS if group.key.lower() == clean),
        None,
    )


def _search_mode(query: str) -> tuple[str, str, str | None]:
    query = query.strip()
    if query.isdigit():
        return "CATNR", query, None
    match = re.fullmatch(r"(\d{4}-\d{3})([A-Z]{1,3})?", query.upper())
    if match:
        full = f"{match.group(1)}{match.group(2) or ''}"
        return "INTDES", match.group(1), full if match.group(2) else None
    return "NAME", query, None


def normalize_satcat_record(record: Mapping[str, Any], provider: str = "celestrak") -> CatalogObject:
    name = str(record.get("OBJECT_NAME") or "").strip()
    norad = str(record.get("NORAD_CAT_ID") or "").strip()
    cospar = str(record.get("OBJECT_ID") or "").strip()
    if not name or not norad:
        raise CatalogError("SATCAT record is missing OBJECT_NAME or NORAD_CAT_ID")
    identifiers = {"NORAD_CAT_ID": norad}
    if cospar:
        identifiers["COSPAR"] = cospar
    metadata = {
        key.lower(): value
        for key, value in {
            "OBJECT_TYPE": record.get("OBJECT_TYPE"),
            "OPS_STATUS_CODE": record.get("OPS_STATUS_CODE"),
            "OWNER": record.get("OWNER"),
            "LAUNCH_DATE": record.get("LAUNCH_DATE"),
            "DECAY_DATE": record.get("DECAY_DATE"),
        }.items()
        if value not in (None, "")
    }
    return CatalogObject(
        provider=provider,
        provider_object_id=norad,
        name=name,
        object_type=str(record.get("OBJECT_TYPE") or "").strip().lower() or None,
        identifiers=identifiers,
        metadata=metadata,
    )


class CelesTrakCatalog:
    name = "celestrak"

    def __init__(self, base_url: str, timeout_seconds: float = 15.0):
        self.base_url = base_url
        self.timeout_seconds = timeout_seconds

    def _load(self, params: dict[str, str]) -> list[Mapping[str, Any]]:
        request = Request(
            f"{self.base_url}?{urlencode(params)}",
            headers={
                "Accept": "application/json",
                "User-Agent": "WorldSatMonitor/0.5 (+https://github.com/ExoSpaceLabs/world-sat-monitor)",
            },
        )
        try:
            with urlopen(request, timeout=self.timeout_seconds) as response:
                payload = json.load(response)
        except Exception as error:
            raise CatalogError(f"CelesTrak SATCAT request failed: {error}") from error
        if not isinstance(payload, list):
            raise CatalogError("CelesTrak SATCAT returned an invalid JSON payload")
        return [record for record in payload if isinstance(record, Mapping)]

    def search(self, query: str, limit: int = 25) -> list[CatalogObject]:
        clean = query.strip()
        if not clean:
            raise CatalogError("catalog query cannot be empty")
        key, value, exact_cospar = _search_mode(clean)
        payload = self._load(
            {key: value, "FORMAT": "JSON", "ONORBIT": "1", "MAX": str(limit)}
        )

        results: list[CatalogObject] = []
        for record in payload:
            if exact_cospar and str(record.get("OBJECT_ID") or "").upper() != exact_cospar:
                continue
            try:
                results.append(normalize_satcat_record(record, self.name))
            except CatalogError:
                continue
            if len(results) >= limit:
                break
        return results

    def group(self, group_key: str) -> list[CatalogObject]:
        clean = group_key.strip()
        if not clean:
            raise CatalogError("catalog group key cannot be empty")
        payload = self._load(
            {
                "GROUP": clean,
                "FORMAT": "JSON",
                "ONORBIT": "1",
                "PAYLOADS": "1",
            }
        )
        results: list[CatalogObject] = []
        for record in payload:
            try:
                results.append(normalize_satcat_record(record, self.name))
            except CatalogError:
                continue
        return results
