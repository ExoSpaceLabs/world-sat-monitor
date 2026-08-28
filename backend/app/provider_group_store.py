from __future__ import annotations

from datetime import datetime, timezone
import json
from typing import Any, Iterable

from psycopg.types.json import Jsonb

from .catalog import CatalogGroup, CatalogObject


def get_provider_group(connection, provider: str, source_key: str) -> dict[str, Any] | None:
    return connection.execute(
        """
        SELECT g.id, g.name, g.group_type, g.source, g.source_key, g.metadata,
               g.created_at, g.updated_at,
               COUNT(gm.satellite_id)::int AS member_count,
               COUNT(gm.satellite_id) FILTER (WHERE s.active)::int AS active_member_count
        FROM satellite_groups g
        LEFT JOIN satellite_group_members gm ON gm.group_id = g.id
        LEFT JOIN satellites s ON s.id = gm.satellite_id
        WHERE g.source = %s AND g.source_key = %s
        GROUP BY g.id
        """,
        (provider, source_key),
    ).fetchone()


def sync_provider_group(
    connection,
    definition: CatalogGroup,
    members: Iterable[CatalogObject],
) -> dict[str, Any]:
    member_list = list(members)
    if not member_list:
        raise ValueError("provider constellation returned no catalog members")

    now = datetime.now(timezone.utc).isoformat()
    group_row = connection.execute(
        """
        INSERT INTO satellite_groups (
            name, group_type, source, source_key, metadata
        )
        VALUES (%s, 'constellation', %s, %s, %s)
        ON CONFLICT (source, source_key) WHERE source_key IS NOT NULL
        DO UPDATE SET
            name = EXCLUDED.name,
            group_type = 'constellation',
            metadata = EXCLUDED.metadata,
            updated_at = NOW()
        RETURNING id
        """,
        (
            definition.name,
            definition.provider,
            definition.key,
            Jsonb(
                {
                    "provider": definition.provider,
                    "source_key": definition.key,
                    "catalog": "SATCAT",
                    "last_synced_at": now,
                }
            ),
        ),
    ).fetchone()
    group_id = int(group_row["id"])

    connection.execute(
        """
        CREATE TEMP TABLE worldsat_provider_group_import (
            norad_id TEXT PRIMARY KEY,
            cospar TEXT,
            name TEXT NOT NULL,
            object_type TEXT NOT NULL,
            metadata JSONB NOT NULL
        ) ON COMMIT DROP
        """
    )
    with connection.cursor() as cursor:
        with cursor.copy(
            """
            COPY worldsat_provider_group_import (
                norad_id, cospar, name, object_type, metadata
            ) FROM STDIN
            """
        ) as copy:
            for member in member_list:
                norad_id = str(member.identifiers.get("NORAD_CAT_ID") or "").strip()
                if not norad_id:
                    continue
                copy.write_row(
                    (
                        norad_id,
                        member.identifiers.get("COSPAR"),
                        member.name,
                        member.object_type or "payload",
                        json.dumps(member.metadata, separators=(",", ":")),
                    )
                )

    catalog_members = int(
        connection.execute(
            "SELECT COUNT(*)::int AS count FROM worldsat_provider_group_import"
        ).fetchone()["count"]
    )
    if catalog_members == 0:
        raise ValueError("provider constellation contained no usable catalog members")

    created_rows = connection.execute(
        """
        INSERT INTO satellites (
            name, active, object_type, provider_preference, metadata
        )
        SELECT
            incoming.name,
            FALSE,
            incoming.object_type,
            %s,
            incoming.metadata
                || jsonb_build_object(
                    'catalog_source', %s,
                    'provider_object_id', incoming.norad_id
                )
        FROM worldsat_provider_group_import incoming
        WHERE NOT EXISTS (
            SELECT 1
            FROM satellite_identifiers existing
            WHERE (existing.namespace = 'NORAD_CAT_ID' AND existing.value = incoming.norad_id)
               OR (
                    incoming.cospar IS NOT NULL
                    AND existing.namespace = 'COSPAR'
                    AND existing.value = incoming.cospar
               )
        )
        RETURNING id
        """,
        (definition.provider, definition.provider),
    ).fetchall()

    # Provider-created catalog objects carry their provider object id in metadata,
    # which lets this set-based step attach the authoritative NORAD identifier
    # without changing the active state of any existing satellite.
    connection.execute(
        """
        INSERT INTO satellite_identifiers (satellite_id, namespace, value)
        SELECT satellite.id, 'NORAD_CAT_ID', incoming.norad_id
        FROM worldsat_provider_group_import incoming
        JOIN satellites satellite
          ON satellite.provider_preference = %s
         AND satellite.metadata->>'catalog_source' = %s
         AND satellite.metadata->>'provider_object_id' = incoming.norad_id
        ON CONFLICT DO NOTHING
        """,
        (definition.provider, definition.provider),
    )

    # If an object already existed locally with only its COSPAR identifier,
    # enrich its identity rather than creating another local object.
    connection.execute(
        """
        INSERT INTO satellite_identifiers (satellite_id, namespace, value)
        SELECT cospar.satellite_id, 'NORAD_CAT_ID', incoming.norad_id
        FROM worldsat_provider_group_import incoming
        JOIN satellite_identifiers cospar
          ON incoming.cospar IS NOT NULL
         AND cospar.namespace = 'COSPAR'
         AND cospar.value = incoming.cospar
        LEFT JOIN satellite_identifiers norad
          ON norad.namespace = 'NORAD_CAT_ID'
         AND norad.value = incoming.norad_id
        WHERE norad.satellite_id IS NULL
        ON CONFLICT DO NOTHING
        """
    )

    connection.execute(
        """
        INSERT INTO satellite_identifiers (satellite_id, namespace, value)
        SELECT norad.satellite_id, 'COSPAR', incoming.cospar
        FROM worldsat_provider_group_import incoming
        JOIN satellite_identifiers norad
          ON norad.namespace = 'NORAD_CAT_ID'
         AND norad.value = incoming.norad_id
        WHERE incoming.cospar IS NOT NULL
        ON CONFLICT DO NOTHING
        """
    )

    membership_metadata = Jsonb(
        {"provider": definition.provider, "source_key": definition.key}
    )
    connection.execute(
        """
        INSERT INTO satellite_group_members (group_id, satellite_id, metadata)
        SELECT %s, COALESCE(norad.satellite_id, cospar.satellite_id), %s
        FROM worldsat_provider_group_import incoming
        LEFT JOIN satellite_identifiers norad
          ON norad.namespace = 'NORAD_CAT_ID'
         AND norad.value = incoming.norad_id
        LEFT JOIN satellite_identifiers cospar
          ON incoming.cospar IS NOT NULL
         AND cospar.namespace = 'COSPAR'
         AND cospar.value = incoming.cospar
        WHERE COALESCE(norad.satellite_id, cospar.satellite_id) IS NOT NULL
        ON CONFLICT (group_id, satellite_id)
        DO UPDATE SET metadata = EXCLUDED.metadata
        """,
        (group_id, membership_metadata),
    )

    removed_rows = connection.execute(
        """
        WITH resolved AS (
            SELECT DISTINCT COALESCE(norad.satellite_id, cospar.satellite_id) AS satellite_id
            FROM worldsat_provider_group_import incoming
            LEFT JOIN satellite_identifiers norad
              ON norad.namespace = 'NORAD_CAT_ID'
             AND norad.value = incoming.norad_id
            LEFT JOIN satellite_identifiers cospar
              ON incoming.cospar IS NOT NULL
             AND cospar.namespace = 'COSPAR'
             AND cospar.value = incoming.cospar
            WHERE COALESCE(norad.satellite_id, cospar.satellite_id) IS NOT NULL
        )
        DELETE FROM satellite_group_members membership
        WHERE membership.group_id = %s
          AND NOT EXISTS (
              SELECT 1
              FROM resolved
              WHERE resolved.satellite_id = membership.satellite_id
          )
        RETURNING satellite_id
        """,
        (group_id,),
    ).fetchall()

    group = get_provider_group(connection, definition.provider, definition.key)
    if group is None:
        raise RuntimeError("provider constellation could not be reloaded")

    return {
        "group": group,
        "catalog_members": catalog_members,
        "created_satellites": len(created_rows),
        "removed_memberships": len(removed_rows),
    }
