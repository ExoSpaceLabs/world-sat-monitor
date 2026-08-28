from __future__ import annotations

from io import BytesIO
import json
from pathlib import Path
import unittest
from unittest.mock import patch

from app.catalog import (
    CelesTrakCatalog,
    celestrak_constellation_group,
    celestrak_constellation_groups,
)


FIXTURE = json.loads(Path("backend/tests/fixtures/celestrak_satcat_iss.json").read_text(encoding="utf-8"))
STORE = Path("backend/app/provider_group_store.py").read_text(encoding="utf-8")
SERVICE = Path("backend/app/provider_service.py").read_text(encoding="utf-8")
WORKER_HEALTH = Path("backend/app/worker_health.py").read_text(encoding="utf-8")


class ProviderGroupTests(unittest.TestCase):
    def test_curated_celestrak_constellations_are_explicit(self):
        groups = {group.key: group.name for group in celestrak_constellation_groups()}
        self.assertEqual(groups["starlink"], "Starlink")
        self.assertEqual(groups["oneweb"], "OneWeb")
        self.assertEqual(groups["kuiper"], "Kuiper")
        self.assertEqual(groups["iridium-NEXT"], "Iridium NEXT")
        self.assertEqual(celestrak_constellation_group("IRIDIUM-next").key, "iridium-NEXT")
        self.assertIsNone(celestrak_constellation_group("weather"))

    def test_group_query_uses_satcat_group_without_ui_result_cap(self):
        body = json.dumps([FIXTURE[0]]).encode()
        with patch("app.catalog.urlopen", return_value=BytesIO(body)) as mocked:
            result = CelesTrakCatalog("https://example.test/records.php").group("kuiper")
        url = mocked.call_args.args[0].full_url
        self.assertIn("GROUP=kuiper", url)
        self.assertIn("FORMAT=JSON", url)
        self.assertIn("ONORBIT=1", url)
        self.assertIn("PAYLOADS=1", url)
        self.assertNotIn("MAX=", url)
        self.assertEqual(result[0].identifiers["NORAD_CAT_ID"], "25544")

    def test_provider_import_creates_missing_satellites_inactive_and_types_json_parameters(self):
        insertion = STORE.split("INSERT INTO satellites", 1)[1].split("RETURNING id", 1)[0]
        self.assertIn("FALSE", insertion)
        self.assertIn("%s::text", insertion)
        self.assertNotIn("UPDATE satellites", STORE)
        self.assertIn("satellite_group_members", STORE)
        self.assertIn("ON CONFLICT (group_id, satellite_id)", STORE)
        self.assertIn("DELETE FROM satellite_group_members", STORE)

    def test_provider_catalog_routes_are_read_and_explicit_import(self):
        self.assertIn('path == "/catalog/groups"', SERVICE)
        self.assertIn('r"/catalog/groups/([^/]+)/import"', SERVICE)
        self.assertIn("catalog.group(definition.key)", SERVICE)
        self.assertIn("sync_provider_group(connection, definition, members)", SERVICE)
        self.assertIn("extra_post=_catalog_post_route", SERVICE)
        self.assertIn("def do_POST", WORKER_HEALTH)


if __name__ == "__main__":
    unittest.main()
