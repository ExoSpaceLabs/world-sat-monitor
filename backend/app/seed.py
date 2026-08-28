from __future__ import annotations

from psycopg.types.json import Jsonb

from .config import settings
from .db import connect
from .mock_satellite import MOCK_NAME, MOCK_NORAD_ID, MOCK_PROVIDER

LEGACY_MOCK_NORAD_ID = "99001"


def _ensure_mock_satellite(connection) -> int:
    satellite = connection.execute(
        """
        SELECT DISTINCT s.id
        FROM satellites s
        LEFT JOIN satellite_identifiers si ON si.satellite_id = s.id
        WHERE s.name = %s
           OR s.metadata->>'mock' = 'true'
           OR (si.namespace = 'NORAD_CAT_ID' AND si.value IN (%s, %s))
        ORDER BY s.id
        LIMIT 1
        """,
        (MOCK_NAME, LEGACY_MOCK_NORAD_ID, MOCK_NORAD_ID),
    ).fetchone()

    metadata = {
        "mock": True,
        "synthetic": True,
        "catalog_id_scope": "worldsat-reserved",
        "note": "Synthetic test object; identifier is not an official USSF/NORAD assignment.",
    }
    if satellite is None:
        satellite = connection.execute(
            """
            INSERT INTO satellites (
                name, active, object_type, provider_preference, metadata
            )
            VALUES (%s, TRUE, 'payload', %s, %s)
            RETURNING id
            """,
            (MOCK_NAME, MOCK_PROVIDER, Jsonb(metadata)),
        ).fetchone()
    else:
        connection.execute(
            """
            UPDATE satellites
            SET name = %s,
                provider_preference = %s,
                metadata = metadata || %s,
                updated_at = NOW()
            WHERE id = %s
            """,
            (MOCK_NAME, MOCK_PROVIDER, Jsonb(metadata), satellite["id"]),
        )

    satellite_id = int(satellite["id"])
    connection.execute(
        """
        DELETE FROM satellite_identifiers
        WHERE satellite_id = %s
          AND namespace = 'NORAD_CAT_ID'
          AND value <> %s
        """,
        (satellite_id, MOCK_NORAD_ID),
    )
    connection.execute(
        """
        INSERT INTO satellite_identifiers (satellite_id, namespace, value)
        VALUES (%s, 'NORAD_CAT_ID', %s)
        ON CONFLICT (namespace, value) DO NOTHING
        """,
        (satellite_id, MOCK_NORAD_ID),
    )
    return satellite_id


def ensure_mock_data() -> None:
    """Ensure the deterministic mock object exists; workers create its orbit products."""
    if not settings.mock_seed_enabled:
        return
    with connect() as connection:
        _ensure_mock_satellite(connection)
        connection.commit()
