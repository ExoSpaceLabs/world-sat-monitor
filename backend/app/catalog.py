from __future__ import annotations

from dataclasses import asdict, dataclass
from html.parser import HTMLParser
import json
import re
from typing import Any, Mapping
from urllib.parse import parse_qs, urlencode, urlparse
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


# Deliberately small: these stay as the one-click shortcuts in the UI. Search
# uses the live CelesTrak GP-group index and is not limited to this tuple.
CELESTRAK_CONSTELLATION_GROUPS = (
    CatalogGroup(provider="celestrak", key="starlink", name="Starlink"),
    CatalogGroup(provider="celestrak", key="oneweb", name="OneWeb"),
    CatalogGroup(provider="celestrak", key="kuiper", name="Kuiper"),
    CatalogGroup(provider="celestrak", key="iridium-NEXT", name="Iridium NEXT"),
)

# Useful fallback entries when the human-facing group index is temporarily
# unavailable. The live index remains authoritative and contributes additional
# groups automatically.
CELESTRAK_GROUP_FALLBACKS = (
    *CELESTRAK_CONSTELLATION_GROUPS,
    CatalogGroup(provider="celestrak", key="qianfan", name="Qianfan"),
    CatalogGroup(provider="celestrak", key="hulianwang", name="Hulianwang"),
    CatalogGroup(provider="celestrak", key="digui", name="Digui"),
    CatalogGroup(provider="celestrak", key="orbcomm", name="Orbcomm"),
    CatalogGroup(provider="celestrak", key="globalstar", name="Globalstar"),
    CatalogGroup(provider="celestrak", key="planet", name="Planet"),
    CatalogGroup(provider="celestrak", key="spire", name="Spire"),
    CatalogGroup(provider="celestrak", key="gnss", name="GNSS"),
    CatalogGroup(provider="celestrak", key="gps-ops", name="GPS Operational"),
    CatalogGroup(provider="celestrak", key="glo-ops", name="GLONASS Operational"),
    CatalogGroup(provider="celestrak", key="galileo", name="Galileo"),
    CatalogGroup(provider="celestrak", key="beidou", name="Beidou"),
    CatalogGroup(provider="celestrak", key="intelsat", name="Intelsat"),
    CatalogGroup(provider="celestrak", key="ses", name="SES"),
    CatalogGroup(provider="celestrak", key="eutelsat", name="Eutelsat"),
    CatalogGroup(provider="celestrak", key="telesat", name="Telesat"),
)


def celestrak_constellation_groups() -> tuple[CatalogGroup, ...]:
    return CELESTRAK_CONSTELLATION_GROUPS


def celestrak_constellation_group(key: str) -> CatalogGroup | None:
    clean = key.strip().lower()
    return next(
        (group for group in CELESTRAK_CONSTELLATION_GROUPS if group.key.lower() == clean),
        None,
    )


class _CelesTrakGroupIndexParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.groups: dict[str, CatalogGroup] = {}
        self._key: str | None = None
        self._label_parts: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag.lower() != "a":
            return
        href = next((value for name, value in attrs if name.lower() == "href"), None)
        if not href:
            return
        query = parse_qs(urlparse(href).query)
        keys = query.get("GROUP") or query.get("group")
        if not keys:
            return
        key = str(keys[0]).strip()
        if not key or not re.fullmatch(r"[A-Za-z0-9_-]+", key):
            return
        self._key = key
        self._label_parts = []

    def handle_data(self, data: str) -> None:
        if self._key is not None:
            clean = " ".join(data.split())
            if clean:
                self._label_parts.append(clean)

    def handle_endtag(self, tag: str) -> None:
        if tag.lower() != "a" or self._key is None:
            return
        label = " ".join(self._label_parts).strip()
        if not label:
            label = self._key.replace("-", " ").replace("_", " ").title()
        self.groups[self._key.lower()] = CatalogGroup(
            provider="celestrak",
            key=self._key,
            name=label,
        )
        self._key = None
        self._label_parts = []


class CelesTrakGroupCatalog:
    name = "celestrak"

    def __init__(self, index_url: str, timeout_seconds: float = 15.0):
        self.index_url = index_url
        self.timeout_seconds = timeout_seconds

    def _load(self) -> list[CatalogGroup]:
        groups = {group.key.lower(): group for group in CELESTRAK_GROUP_FALLBACKS}
        request = Request(
            self.index_url,
            headers={
                "Accept": "text/html",
                "User-Agent": "WorldSatMonitor/1.0 (+https://github.com/ExoSpaceLabs/world-sat-monitor)",
            },
        )
        try:
            with urlopen(request, timeout=self.timeout_seconds) as response:
                html = response.read().decode("utf-8", errors="replace")
            parser = _CelesTrakGroupIndexParser()
            parser.feed(html)
            groups.update(parser.groups)
        except Exception:
            # Search should remain useful during a transient index-page failure.
            # Importing/fetching the selected group still uses the machine API.
            pass
        return sorted(groups.values(), key=lambda group: (group.name.lower(), group.key.lower()))

    def search(self, query: str, limit: int = 25) -> list[CatalogGroup]:
        clean = query.strip().lower()
        if not clean:
            raise CatalogError("catalog group query cannot be empty")
        matches = [
            group
            for group in self._load()
            if clean in group.name.lower() or clean in group.key.lower()
        ]
        return matches[: max(1, limit)]

    def resolve(self, key: str) -> CatalogGroup | None:
        clean = key.strip().lower()
        if not clean:
            return None
        return next((group for group in self._load() if group.key.lower() == clean), None)


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
        raise CatalogError("CelesTrak record is missing OBJECT_NAME or NORAD_CAT_ID")
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


def _direct_gp_url(base_url: str) -> str | None:
    parsed = urlparse(base_url)
    host = parsed.hostname or ""
    if host.lower() not in {"celestrak.org", "www.celestrak.org"}:
        return None
    scheme = parsed.scheme or "https"
    netloc = parsed.netloc or host
    return f"{scheme}://{netloc}/NORAD/elements/gp.php"


def _gp_params(params: Mapping[str, str]) -> dict[str, str]:
    for key in ("CATNR", "INTDES", "GROUP", "NAME", "SPECIAL"):
        value = params.get(key)
        if value:
            return {key: value, "FORMAT": "JSON"}
    raise CatalogError("CelesTrak GP request has no supported query selector")


class CelesTrakCatalog:
    name = "celestrak"

    def __init__(self, base_url: str, timeout_seconds: float = 15.0):
        self.base_url = base_url
        self.timeout_seconds = timeout_seconds
        self.gp_url = _direct_gp_url(base_url)

    def _request(self, base_url: str, params: Mapping[str, str], label: str) -> list[Mapping[str, Any]]:
        request = Request(
            f"{base_url}?{urlencode(params)}",
            headers={
                "Accept": "application/json",
                "User-Agent": "WorldSatMonitor/1.0 (+https://github.com/ExoSpaceLabs/world-sat-monitor)",
            },
        )
        try:
            with urlopen(request, timeout=self.timeout_seconds) as response:
                payload = json.load(response)
        except Exception as error:
            raise CatalogError(f"CelesTrak {label} request failed: {error}") from error
        if not isinstance(payload, list):
            raise CatalogError(f"CelesTrak {label} returned an invalid JSON payload")
        return [record for record in payload if isinstance(record, Mapping)]

    def _load(self, params: dict[str, str]) -> list[Mapping[str, Any]]:
        # The GP endpoint is the same direct machine API used for orbit-element
        # retrieval and supports CATNR/INTDES/NAME/GROUP JSON queries. Prefer it
        # for interactive catalog lookup so SATCAT slowness does not block the UI.
        # SATCAT remains a fallback and provides richer metadata when GP is down.
        gp_error: CatalogError | None = None
        if self.gp_url and self.gp_url != self.base_url:
            try:
                return self._request(self.gp_url, _gp_params(params), "GP")
            except CatalogError as error:
                gp_error = error

        try:
            return self._request(self.base_url, params, "SATCAT")
        except CatalogError as satcat_error:
            if gp_error is None:
                raise
            raise CatalogError(
                "CelesTrak catalog is temporarily unavailable: direct GP and SATCAT requests both failed"
            ) from satcat_error

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
