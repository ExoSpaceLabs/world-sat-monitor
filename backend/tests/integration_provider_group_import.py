from __future__ import annotations

from pathlib import Path

from app.catalog import CatalogGroup, CatalogObject
from app.db import connect
from app.provider_group_store import sync_provider_group


REPO_ROOT = Path(__file__).resolve().parents[2]


def initialize_schema() -> None:
    schema = (REPO_ROOT / "database/init/001_schema.sql").read_text(encoding="utf-8")
    with connect() as connection:
        for statement in schema.split(";"):
            if statement.strip():
                connection.execute(statement)
        connection.commit()


def member(norad: str, cospar: str, name: str) -> CatalogObject:
    return CatalogObject(
        provider="celestrak",
        provider_object_id=norad,
        name=name,
        object_type="payload",
        identifiers={"NORAD_CAT_ID": norad, "COSPAR": cospar},
        metadata={"owner": "TEST"},
    )


def main() -> None:
    initialize_schema()
    definition = CatalogGroup(
        provider="celestrak",
        key="integration-test",
        name="Integration Test Constellation",
    )
    first_members = [
        member("910001", "2026-901A", "IMPORT-ONE"),
        member("910002", "2026-901B", "IMPORT-TWO"),
    ]

    with connect() as connection:
        result = sync_provider_group(connection, definition, first_members)
        connection.commit()
        assert result["catalog_members"] == 2
        assert result["created_satellites"] == 2
        group_id = int(result["group"]["id"])

    with connect() as connection:
        rows = connection.execute(
            """
            SELECT s.name, s.active, s.provider_preference,
                   s.metadata->>'catalog_source' AS catalog_source,
                   norad.value AS norad_id
            FROM satellite_group_members gm
            JOIN satellites s ON s.id = gm.satellite_id
            JOIN satellite_identifiers norad
              ON norad.satellite_id = s.id
             AND norad.namespace = 'NORAD_CAT_ID'
            WHERE gm.group_id = %s
            ORDER BY norad.value
            """,
            (group_id,),
        ).fetchall()
        assert [row["norad_id"] for row in rows] == ["910001", "910002"]
        assert all(row["active"] is False for row in rows)
        assert all(row["provider_preference"] == "celestrak" for row in rows)
        assert all(row["catalog_source"] == "celestrak" for row in rows)

    # A provider sync owns membership, not monitoring state or satellite lifetime.
    # Removing an object from the provider group must remove only the membership.
    with connect() as connection:
        result = sync_provider_group(connection, definition, [first_members[0]])
        connection.commit()
        assert result["created_satellites"] == 0
        assert result["removed_memberships"] == 1

    with connect() as connection:
        member_count = connection.execute(
            "SELECT COUNT(*)::int AS count FROM satellite_group_members WHERE group_id = %s",
            (group_id,),
        ).fetchone()["count"]
        satellite_count = connection.execute(
            """
            SELECT COUNT(*)::int AS count
            FROM satellite_identifiers
            WHERE namespace = 'NORAD_CAT_ID' AND value IN ('910001', '910002')
            """
        ).fetchone()["count"]
        active_count = connection.execute(
            """
            SELECT COUNT(*)::int AS count
            FROM satellites s
            JOIN satellite_identifiers si ON si.satellite_id = s.id
            WHERE si.namespace = 'NORAD_CAT_ID'
              AND si.value IN ('910001', '910002')
              AND s.active
            """
        ).fetchone()["count"]
        assert member_count == 1
        assert satellite_count == 2
        assert active_count == 0

    print("provider group PostgreSQL integration: ok")


if __name__ == "__main__":
    main()
