"""Space-Track GP/OMM adapter. This module owns authentication and request budgeting.

Only the orbital-provider worker uses credentials. Single-satellite lookups are
served from primed batches; they never initiate a network request.
"""
from __future__ import annotations

from collections import deque
from http.cookiejar import CookieJar
import json
import re
import time
from typing import Any, Iterable, Mapping
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import HTTPCookieProcessor, Request, build_opener

from .orbital_provider import NormalizedElementSet, ProviderError, normalize_omm_payload


_NORAD_ID = re.compile(r"^[0-9]{1,9}$")


class ProviderDeferred(ProviderError):
    """Provider has not acquired this object's batch; try another source without backoff."""


class SpaceTrackProvider:
    name = "spacetrack"

    def __init__(
        self,
        identity: str,
        password: str,
        *,
        base_url: str = "https://www.space-track.org",
        timeout_seconds: float = 15.0,
        refresh_seconds: float = 3600.0,
        batch_size: int = 80,
        opener: Any = None,
        clock: Any = time.monotonic,
    ):
        if not identity or not password:
            raise ProviderError("Space-Track requires SPACETRACK_IDENTITY and SPACETRACK_PASSWORD")
        if not base_url.startswith("https://") or "@" in base_url or "?" in base_url or "#" in base_url:
            raise ProviderError("Space-Track base URL must be an HTTPS origin without credentials")
        self._identity = identity
        self._password = password
        self.base_url = base_url.rstrip("/")
        self.timeout_seconds = max(1.0, float(timeout_seconds))
        # The provider documents GP retrieval as hourly, not per-satellite polling.
        self.refresh_seconds = max(3600.0, float(refresh_seconds))
        self.batch_size = max(1, min(100, int(batch_size)))
        self._opener = opener or build_opener(HTTPCookieProcessor(CookieJar()))
        self._clock = clock
        self._authenticated = False
        self._records: dict[str, tuple[float, NormalizedElementSet | None]] = {}
        self._requests: deque[float] = deque()
        self._retry_at = 0.0
        self._failed_ids: set[str] = set()
        self._last_error: str | None = None

    @staticmethod
    def _identifier(identifiers: Mapping[str, str]) -> str:
        value = str(identifiers.get("NORAD_CAT_ID") or "").strip()
        if not _NORAD_ID.fullmatch(value) or int(value) <= 0:
            raise ProviderError("Space-Track requires a positive numeric NORAD_CAT_ID (up to 9 digits)")
        return str(int(value))

    def _open(self, request: Request) -> bytes:
        with self._opener.open(request, timeout=self.timeout_seconds) as response:
            return response.read()

    def _login(self) -> None:
        body = urlencode({"identity": self._identity, "password": self._password}).encode("utf-8")
        request = Request(
            self.base_url + "/ajaxauth/login",
            data=body,
            headers={"Content-Type": "application/x-www-form-urlencoded", "Accept": "application/json"},
            method="POST",
        )
        try:
            response = self._open(request)
        except (HTTPError, URLError, OSError) as error:
            # Never include upstream response bodies, URL query strings or credentials.
            raise ProviderError("Space-Track authentication request failed") from error
        # An unsuccessful login can return HTTP 200 with an error payload.
        lower = response.strip().lower()
        if b"failed" in lower or b"incorrect" in lower or b"invalid" in lower or lower.startswith(b"<!doctype"):
            raise ProviderError("Space-Track authentication rejected")
        self._authenticated = True

    def _fetch_batch(self, ids: list[str]) -> dict[str, NormalizedElementSet]:
        if not self._authenticated:
            self._login()
        query = ",".join(ids)  # Sanitized decimal catalog numbers only.
        url = self.base_url + f"/basicspacedata/query/class/gp/NORAD_CAT_ID/{query}/format/json"
        request = Request(url, headers={"Accept": "application/json", "User-Agent": "WorldSatMonitor/1.1"})
        try:
            body = self._open(request)
        except HTTPError as error:
            if error.code in (401, 403):
                self._authenticated = False
                raise ProviderError("Space-Track authentication expired or access denied") from error
            raise ProviderError(f"Space-Track GP query returned HTTP {error.code}") from error
        except (URLError, OSError) as error:
            raise ProviderError("Space-Track GP query failed") from error

        try:
            payload = json.loads(body)
        except (ValueError, UnicodeError) as error:
            self._authenticated = False
            raise ProviderError("Space-Track returned invalid GP JSON or an expired session") from error
        if not isinstance(payload, list):
            raise ProviderError("Space-Track GP response must be a JSON list")
        results: dict[str, NormalizedElementSet] = {}
        requested = set(ids)
        for item in payload:
            if not isinstance(item, dict):
                raise ProviderError("Space-Track GP response contains an invalid record")
            try:
                record_id = self._identifier({"NORAD_CAT_ID": str(item.get("NORAD_CAT_ID") or "")})
            except ProviderError as error:
                raise ProviderError("Space-Track GP response contains an invalid NORAD ID") from error
            if record_id in requested:
                results[record_id] = normalize_omm_payload(item, source=self.name)
        return results

    def _budget_available(self, now: float) -> bool:
        while self._requests and now - self._requests[0] >= 3600:
            self._requests.popleft()
        in_minute = sum(1 for moment in self._requests if now - moment < 60)
        # Keep headroom below the published 30/minute and 300/hour limits.
        return in_minute < 24 and len(self._requests) < 240

    def prime(self, identifiers: Iterable[Mapping[str, str]]) -> None:
        """Load at most one missing/stale batch per worker cycle.

        Failed/missing records never masquerade as successful fetches. Remaining
        IDs are deferred until subsequent worker cycles, with no per-object IO.
        """
        now = self._clock()
        pending: set[str] = set()
        for item in identifiers:
            try:
                norad_id = self._identifier(item)
            except ProviderError:
                continue
            cached = self._records.get(norad_id)
            if cached is None or now - cached[0] >= self.refresh_seconds:
                pending.add(norad_id)
        if not pending or now < self._retry_at or not self._budget_available(now):
            return
        ids = sorted(pending, key=int)[:self.batch_size]
        self._requests.append(now)
        try:
            elements = self._fetch_batch(ids)
        except ProviderError as error:
            self._failed_ids.update(ids)
            self._last_error = str(error)
            self._retry_at = now + 300.0
            raise
        self._failed_ids.difference_update(ids)
        self._last_error = None
        for norad_id in ids:
            self._records[norad_id] = (now, elements.get(norad_id))

    def fetch_latest(self, identifiers: Mapping[str, str]) -> NormalizedElementSet:
        norad_id = self._identifier(identifiers)
        cached = self._records.get(norad_id)
        if cached is None or self._clock() - cached[0] >= self.refresh_seconds:
            if norad_id in self._failed_ids and self._last_error:
                raise ProviderError(self._last_error)
            raise ProviderDeferred("Space-Track batch pending or request budget exhausted")
        if cached[1] is None:
            raise ProviderError("Space-Track returned no current GP element set for this object")
        return cached[1]
