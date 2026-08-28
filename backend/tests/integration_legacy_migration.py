from __future__ import annotations

from pathlib import Path

from app.db import connect
from app.migrations import migrate_legacy_schema


fixture = Path("backend/tests/fixtures/legacy_schema.sql").read_text(encoding="utf-8")
with connect() as connection:
    for statement in fixture.split(";"):
        if statement.strip():
            connection.execute(statement)
    connection.commit()

assert migrate_legacy_schema() is True
assert migrate_legacy_schema() is False

with connect() as connection:
    tables = connection.execute(
        """
        SELECT to_regclass('public.tle_sets') AS legacy,
               to_regclass('public.orbital_element_sets') AS elements,
               to_regclass('public.satellite_identifiers') AS identifiers
        """
    ).fetchone()
    assert tables["legacy"] is None
    assert tables["elements"] == "orbital_element_sets"
    assert tables["identifiers"] == "satellite_identifiers"

    identifier = connection.execute(
        "SELECT namespace, value FROM satellite_identifiers WHERE satellite_id = 1"
    ).fetchone()
    assert identifier == {"namespace": "NORAD_CAT_ID", "value": "99001"}

    element_set = connection.execute(
        """
        SELECT source_format, mean_element_theory,
               raw_payload->>'line1' AS line1,
               raw_payload->>'line2' AS line2
        FROM orbital_element_sets WHERE id = 1
        """
    ).fetchone()
    assert element_set == {
        "source_format": "TLE",
        "mean_element_theory": "SGP4",
        "line1": "1 LEGACY",
        "line2": "2 LEGACY",
    }

    run = connection.execute(
        "SELECT source_element_set_id FROM propagation_runs WHERE satellite_id = 1"
    ).fetchone()
    job = connection.execute(
        "SELECT element_set_id FROM propagation_jobs WHERE satellite_id = 1"
    ).fetchone()
    quality = connection.execute(
        "SELECT reference_element_set_id FROM prediction_error_daily WHERE satellite_id = 1"
    ).fetchone()
    assert run["source_element_set_id"] == 1
    assert job["element_set_id"] == 1
    assert quality["reference_element_set_id"] == 1

    legacy_column_count = connection.execute(
        """
        SELECT count(*) AS count
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'satellites'
          AND column_name = 'norad_id'
        """
    ).fetchone()
    assert legacy_column_count["count"] == 0

print("legacy schema migration verified")
