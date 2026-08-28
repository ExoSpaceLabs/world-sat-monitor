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

    def test_provider_failure_is_wrapped(self):
        with patch("app.catalog.urlopen", side_effect=OSError("offline")):
            with self.assertRaisesRegex(CatalogError, "request failed"):
                CelesTrakCatalog("https://example.test/records.php").search("ISS")


if __name__ == "__main__":
    unittest.main()
