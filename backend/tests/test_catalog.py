from __future__ import annotations

from io import BytesIO
import json
from pathlib import Path
import unittest
from unittest.mock import patch

from app.catalog import CelesTrakCatalog, CatalogError, normalize_satcat_record


FIXTURE = json.loads(
    Path("backend/tests/fixtures/celestrak_satcat_iss.json").read_text(encoding="utf-8")
)


class CatalogTests(unittest.TestCase):
    def test_normalizes_satcat_identifiers_and_metadata(self):
        result = normalize_satcat_record(FIXTURE[0])
        self.assertEqual(result.provider, "celestrak")
        self.assertEqual(result.provider_object_id, "25544")
        self.assertEqual(result.name, "ISS (ZARYA)")
        self.assertEqual(result.object_type, "payload")
        self.assertEqual(result.identifiers["NORAD_CAT_ID"], "25544")
        self.assertEqual(result.identifiers["COSPAR"], "1998-067A")
        self.assertEqual(result.metadata["owner"], "ISS")

    def test_numeric_query_uses_catnr(self):
        body = json.dumps([FIXTURE[0]]).encode()
        with patch("app.catalog.urlopen", return_value=BytesIO(body)) as mocked:
            result = CelesTrakCatalog("https://example.test/records.php").search("25544")
        url = mocked.call_args.args[0].full_url
        self.assertIn("CATNR=25544", url)
        self.assertIn("FORMAT=JSON", url)
        self.assertIn("ONORBIT=1", url)
        self.assertEqual(result[0].name, "ISS (ZARYA)")

    def test_name_query_uses_name(self):
        body = json.dumps([FIXTURE[0]]).encode()
        with patch("app.catalog.urlopen", return_value=BytesIO(body)) as mocked:
            CelesTrakCatalog("https://example.test/records.php").search("ISS ZARYA")
        self.assertIn("NAME=ISS+ZARYA", mocked.call_args.args[0].full_url)

    def test_cospar_query_uses_launch_and_filters_exact_object(self):
        body = json.dumps(FIXTURE).encode()
        with patch("app.catalog.urlopen", return_value=BytesIO(body)) as mocked:
            result = CelesTrakCatalog("https://example.test/records.php").search("1998-067A")
        self.assertIn("INTDES=1998-067", mocked.call_args.args[0].full_url)
        self.assertEqual([item.identifiers["COSPAR"] for item in result], ["1998-067A"])

    def test_celestrak_host_prefers_direct_gp_for_interactive_search(self):
        body = json.dumps([FIXTURE[0]]).encode()
        with patch("app.catalog.urlopen", return_value=BytesIO(body)) as mocked:
            result = CelesTrakCatalog("https://celestrak.org/satcat/records.php").search("ISS")
        url = mocked.call_args.args[0].full_url
        self.assertIn("/NORAD/elements/gp.php?", url)
        self.assertIn("NAME=ISS", url)
        self.assertIn("FORMAT=JSON", url)
        self.assertNotIn("ONORBIT", url)
        self.assertNotIn("MAX=", url)
        self.assertEqual(result[0].identifiers["NORAD_CAT_ID"], "25544")

    def test_satcat_is_used_when_direct_gp_fails(self):
        body = json.dumps([FIXTURE[0]]).encode()
        with patch(
            "app.catalog.urlopen",
            side_effect=[OSError("gp timeout"), BytesIO(body)],
        ) as mocked:
            result = CelesTrakCatalog("https://celestrak.org/satcat/records.php").search("ISS")
        self.assertEqual(mocked.call_count, 2)
        self.assertIn("/NORAD/elements/gp.php?", mocked.call_args_list[0].args[0].full_url)
        satcat_url = mocked.call_args_list[1].args[0].full_url
        self.assertIn("/satcat/records.php?", satcat_url)
        self.assertIn("ONORBIT=1", satcat_url)
        self.assertEqual(result[0].name, "ISS (ZARYA)")

    def test_group_direct_gp_query_drops_satcat_only_filters(self):
        body = json.dumps([FIXTURE[0]]).encode()
        with patch("app.catalog.urlopen", return_value=BytesIO(body)) as mocked:
            CelesTrakCatalog("https://celestrak.org/satcat/records.php").group("stations")
        url = mocked.call_args.args[0].full_url
        self.assertIn("GROUP=stations", url)
        self.assertIn("FORMAT=JSON", url)
        self.assertNotIn("PAYLOADS", url)
        self.assertNotIn("ONORBIT", url)

    def test_provider_failure_is_wrapped(self):
        with patch("app.catalog.urlopen", side_effect=OSError("offline")):
            with self.assertRaisesRegex(CatalogError, "request failed"):
                CelesTrakCatalog("https://example.test/records.php").search("ISS")

    def test_direct_and_satcat_failure_reports_temporary_unavailability(self):
        with patch("app.catalog.urlopen", side_effect=OSError("offline")):
            with self.assertRaisesRegex(CatalogError, "temporarily unavailable"):
                CelesTrakCatalog("https://celestrak.org/satcat/records.php").search("ISS")


if __name__ == "__main__":
    unittest.main()
