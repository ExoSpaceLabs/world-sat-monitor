from __future__ import annotations

from pathlib import Path
import unittest


REPOSITORY = Path("backend/app/repository.py").read_text(encoding="utf-8")
API = Path("backend/app/groups_api.py").read_text(encoding="utf-8")
MIGRATIONS = Path("backend/app/migrations.py").read_text(encoding="utf-8")
STORE = Path("backend/app/orbital_store.py").read_text(encoding="utf-8")
PROPAGATOR = Path("backend/app/propagator_service.py").read_text(encoding="utf-8")
PROVIDER = Path("backend/app/provider_service.py").read_text(encoding="utf-8")


class GroupContractTests(unittest.TestCase):
    def test_group_crud_membership_display_and_positions_routes_are_explicit(self):
        self.assertIn('APIRouter(prefix="/api/v1/groups"', API)
        self.assertIn('@router.post("", status_code=status.HTTP_201_CREATED)', API)
        self.assertIn('@router.patch("/{group_id}")', API)
        self.assertIn('@router.delete("/{group_id}"', API)
        self.assertIn('@router.get("/{group_id}/members")', API)
        self.assertIn('@router.post("/{group_id}/members"', API)
        self.assertIn('@router.delete("/{group_id}/members/{satellite_id}"', API)
        self.assertIn('@router.post("/{group_id}/display")', API)
        self.assertIn('@router.delete("/{group_id}/display"', API)
        self.assertIn('@router.get("/{group_id}/positions")', API)

    def test_group_current_positions_use_current_state_not_trajectory_fanout(self):
        section = REPOSITORY.split("def get_group_current_positions", 1)[1].split("def get_group_positions_at", 1)[0]
        self.assertIn("satellite_current_state", section)
        self.assertIn("satellite_group_members", section)
        self.assertNotIn("position_samples", section)

    def test_group_time_positions_are_one_batched_trajectory_query(self):
        section = REPOSITORY.split("def get_group_positions_at", 1)[1].split("def get_current_positions_for_selection", 1)[0]
        self.assertIn("JOIN LATERAL", section)
        self.assertIn("position_samples", section)
        self.assertIn("propagation_runs", section)
        self.assertNotIn("get_position_bracket", section)

    def test_membership_does_not_change_monitoring_state(self):
        section = REPOSITORY.split("def add_group_member", 1)[1].split("def get_group_current_positions", 1)[0]
        self.assertIn("satellite_group_members", section)
        self.assertNotIn("UPDATE satellites", section)
        self.assertNotIn("DELETE FROM satellites", section)

    def test_inactive_display_members_can_be_propagated_without_activation(self):
        self.assertIn("display_requested_until > NOW()", STORE)
        self.assertIn("is_satellite_propagation_requested", PROPAGATOR)
        self.assertIn("horizon_hours", STORE)
        self.assertIn("job.get(\"horizon_hours\")", PROPAGATOR)
        self.assertIn("fetch_group", PROVIDER)
        self.assertIn("display_jobs_created", PROVIDER)

    def test_existing_databases_receive_group_display_columns(self):
        self.assertIn("CREATE TABLE IF NOT EXISTS satellite_groups", MIGRATIONS)
        self.assertIn("display_requested_until", MIGRATIONS)
        self.assertIn("display_prediction_hours", MIGRATIONS)
        self.assertIn("horizon_hours", MIGRATIONS)


if __name__ == "__main__":
    unittest.main()
