from __future__ import annotations

from pathlib import Path
import unittest


SCHEMA = Path("database/init/001_schema.sql").read_text(encoding="utf-8")


class SchemaContractTests(unittest.TestCase):
    def test_orbital_elements_are_canonical_not_tle_lines(self):
        self.assertIn("CREATE TABLE IF NOT EXISTS orbital_element_sets", SCHEMA)
        self.assertNotIn("CREATE TABLE IF NOT EXISTS tle_sets", SCHEMA)
        self.assertNotIn("line1 TEXT", SCHEMA)
        self.assertNotIn("line2 TEXT", SCHEMA)

    def test_satellite_external_identifiers_are_separate(self):
        self.assertIn("CREATE TABLE IF NOT EXISTS satellite_identifiers", SCHEMA)
        satellites_block = SCHEMA.split("CREATE TABLE IF NOT EXISTS satellites", 1)[1].split(");", 1)[0]
        self.assertNotIn("norad_id", satellites_block)

    def test_propagation_references_generalized_element_sets(self):
        self.assertIn("source_element_set_id", SCHEMA)
        self.assertIn("element_set_id BIGINT", SCHEMA)
        self.assertIn("reference_element_set_id", SCHEMA)
        self.assertNotIn("source_tle_id", SCHEMA)
        self.assertNotIn("reference_tle_id", SCHEMA)


if __name__ == "__main__":
    unittest.main()
