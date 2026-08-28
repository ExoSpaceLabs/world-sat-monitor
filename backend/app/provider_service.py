from __future__ import annotations

from datetime import datetime, timezone
import logging
import time
from typing import Any

from .catalog import CatalogError, CelesTrakCatalog
from .config import settings
from .db import connect, wait_for_database
from .migrations import migrate_schema
from .orbital_provider import (
    CelesTrakProvider,
    MockOrbitalDataProvider,
    OrbitalDataProvider,
    ProviderError,
)
from .orbital_store import (
    cancel_inactive_pending_jobs,
    ensure_propagation_job,
    get_latest_element_set,
    get_provider_fetch_state,
    insert_element_set,
    record_provider_fetch,
)
from .repository import list_satellites
from .seed import ensure_mock_data
from .worker_health import WorkerHealth, start_health_server

LOGGER = logging.getLogger("worldsat.orbital-provider")


def _provider_for(satellite: dict[str, Any]) -> OrbitalDataProvider:
    preference = str(satellite.get("provider_preference") or "").strip().lower()
    metadata = dict(satellite.get("metadata") or {})
    if preference == "mock" or metadata.get("mock") is True:
        return MockOrbitalDataProvider()
    if preference in {"", "celestrak"}:
        if not settings.celestrak_enabled:
            raise ProviderError("CelesTrak provider is disabled")
        return CelesTrakProvider(
            settings.celestrak_base_url,
            timeout_seconds=settings.celestrak_timeout_seconds,
        )
    raise ProviderError(f"unsupported orbital provider preference: {preference}")


def _is_due(last_success_at: datetime | None, now: datetime) -> bool:
    if last_success_at is None:
        return True
    age = (now - last_success_at.astimezone(timezone.utc)).total_seconds()
    return age >= settings.provider_refresh_seconds


def _ensure_job(connection, satellite_id: int, element_set_id: int) -> bool:
    _, created = ensure_propagation_job(
        connection,
        satellite_id=satellite_id,
        element_set_id=element_set_id,
        history_hours=settings.propagation_history_hours,
        horizon_days=settings.propagation_horizon_days,
        step_seconds=settings.propagation_step_seconds,
    )
    return created


def run_provider_cycle(now: datetime | None = None) -> dict[str, int]:
    now = (now or datetime.now(timezone.utc)).astimezone(timezone.utc)
    metrics = {
        "active": 0,
        "fetched": 0,
        "new_element_sets": 0,
        "jobs_created": 0,
        "errors": 0,
    }

    with connect() as connection:
        cancel_inactive_pending_jobs(connection)
        satellites = list_satellites(connection, active=True)
        connection.commit()

    for satellite in satellites:
        metrics["active"] += 1
        satellite_id = int(satellite["id"])
        provider_name = str(
            satellite.get("provider_preference")
            or ("mock" if dict(satellite.get("metadata") or {}).get("mock") else "celestrak")
        ).lower()

        try:
            provider = _provider_for(satellite)
            provider_name = provider.name
            with connect() as connection:
                state = get_provider_fetch_state(connection, satellite_id, provider.name)
                latest = get_latest_element_set(connection, satellite_id, source=provider.name)
                last_success_at = state["last_success_at"] if state else None

                if latest is not None and not _is_due(last_success_at, now):
                    if _ensure_job(connection, satellite_id, int(latest["id"])):
                        metrics["jobs_created"] += 1
                    connection.commit()
                    continue

            element_set = provider.fetch_latest(satellite["identifiers"])
            metrics["fetched"] += 1
            with connect() as connection:
                element_set_id, inserted = insert_element_set(
                    connection,
                    satellite_id,
                    element_set,
                )
                if inserted:
                    metrics["new_element_sets"] += 1
                record_provider_fetch(
                    connection,
                    satellite_id,
                    provider.name,
                    success=True,
                    element_set_id=element_set_id,
                )
                if _ensure_job(connection, satellite_id, element_set_id):
                    metrics["jobs_created"] += 1
                connection.commit()
        except Exception as error:
            metrics["errors"] += 1
            LOGGER.warning("provider refresh failed for satellite %s: %s", satellite_id, error)
            try:
                with connect() as connection:
                    record_provider_fetch(
                        connection,
                        satellite_id,
                        provider_name,
                        success=False,
                        error=str(error)[:2000],
                    )
                    connection.commit()
            except Exception:
                LOGGER.exception("failed to record provider error for satellite %s", satellite_id)

    return metrics


def _catalog_route(path: str, query: dict[str, list[str]]):
    if path != "/catalog/search":
        return None
    text = (query.get("q") or [""])[0].strip()
    provider = (query.get("provider") or ["celestrak"])[0].strip().lower()
    try:
        limit = max(1, min(50, int((query.get("limit") or ["25"])[0])))
    except ValueError:
        return 422, {"detail": "limit must be an integer"}
    if len(text) < 2:
        return 422, {"detail": "catalog query must contain at least 2 characters"}
    if provider != "celestrak":
        return 422, {"detail": f"unsupported catalog provider: {provider}"}
    if not settings.celestrak_enabled:
        return 503, {"detail": "CelesTrak provider is disabled"}

    try:
        catalog = CelesTrakCatalog(
            settings.celestrak_catalog_url,
            timeout_seconds=settings.celestrak_timeout_seconds,
        )
        results = catalog.search(text, limit=limit)
    except CatalogError as error:
        return 502, {"detail": str(error)}

    payloads = []
    with connect() as connection:
        for item in results:
            payload = item.payload()
            identifiers = payload["identifiers"]
            local = None
            for namespace, value in identifiers.items():
                row = connection.execute(
                    """
                    SELECT s.id, s.active, s.name
                    FROM satellite_identifiers si
                    JOIN satellites s ON s.id = si.satellite_id
                    WHERE si.namespace = %s AND si.value = %s
                    LIMIT 1
                    """,
                    (namespace, value),
                ).fetchone()
                if row is not None:
                    local = {
                        "present": True,
                        "satellite_id": int(row["id"]),
                        "active": bool(row["active"]),
                        "name": row["name"],
                    }
                    break
            payload["local"] = local or {
                "present": False,
                "satellite_id": None,
                "active": False,
                "name": None,
            }
            payloads.append(payload)

    return 200, {
        "query": text,
        "provider": provider,
        "results": payloads,
    }


def main() -> None:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )
    wait_for_database()
    migrate_schema()
    ensure_mock_data()
    health = WorkerHealth("orbital-provider")
    start_health_server(settings.provider_health_port, health, extra_get=_catalog_route)
    LOGGER.info(
        "orbital provider started: poll=%ss refresh=%ss celestrak=%s",
        settings.provider_poll_seconds,
        settings.provider_refresh_seconds,
        settings.celestrak_enabled,
    )

    while True:
        try:
            metrics = run_provider_cycle()
            health.success()
            LOGGER.info("provider cycle: %s", metrics)
        except Exception as error:
            health.failure(error)
            LOGGER.exception("provider cycle failed")
        time.sleep(max(0.2, settings.provider_poll_seconds))


if __name__ == "__main__":
    main()
