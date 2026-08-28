from __future__ import annotations

from pathlib import Path
import unittest


REPOSITORY = Path("backend/app/repository.py").read_text(encoding="utf-8")
API = Path("backend/app/groups_api.py").read_text(encoding="utf-8")
MIGRATIONS = Path("backend/app/migrations.py").read_text(encoding="utf-8")


class GroupContractTests(unittest.TestCase):
    def test_group_crud_and_membership_routes_are_explicit(self):
        self.assertIn('APIRouter(prefix="/api/v1/groups"', API)
        self.assertIn('@router.post("")', API)
        self.assertIn('@router.patch("/{group_id}")', API)
        self.assertIn('@router.delete("/{group_id}"', API)
        self.assertIn('@router.get("/{group_id}/members")', API)
        self.assertIn('@router.post("/{group_id}/members"', API)
        self.assertIn('@router.delete("/{group_id}/members/{satellite_id}"', API)
        self.assertIn('@router.get("/{group_id}/positions")', API)

    def test_group_positions_use_current_state_not_trajectory_fanout(self):
        section = REPOSITORY.split("def get_group_current_positions", 1)[1].split("def get_run_covering", 1)[0]
        self.assertIn("satellite_current_state", section)
        self.assertIn("satellite_group_members", section)
        self.assertNotIn("position_samples", section)
        self.assertNotIn("get_position_bracket", section)

    def test_membership_does_not_change_monitoring_state(self):
        section = REPOSITORY.split("def add_group_member", 1)[1].split("def get_group_current_positions", 1)[0]
        self.assertIn("satellite_group_members", section)
        self.assertNotIn("UPDATE satellites", section)
        self.assertNotIn("DELETE FROM satellites", section)

    def test_existing_databases_receive_group_tables(self):
        self.assertIn("CREATE TABLE IF NOT EXISTS satellite_groups", MIGRATIONS)
        self.assertIn("CREATE TABLE IF NOT EXISTS satellite_group_members", MIGRATIONS)


if __name__ == "__main__":
    unittest.main()
