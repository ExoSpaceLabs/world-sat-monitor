from __future__ import annotations

from datetime import datetime, timedelta, timezone
from pathlib import Path
import unittest

from app.sampling_policy import PropagationSamplingPolicy

REPOSITORY = Path("backend/app/repository.py").read_text(encoding="utf-8")
RETENTION = Path("backend/app/retention.py").read_text(encoding="utf-8")
POSITIONS_API = Path("backend/app/positions_api.py").read_text(encoding="utf-8")
SCHEMA = Path("database/init/001_schema.sql").read_text(encoding="utf-8")
MAIN = Path("backend/app/main.py").read_text(encoding="utf-8")


class ScalePolicyTests(unittest.TestCase):
    def test_default_tiered_policy_reduces_two_week_storage(self):
        generated_at = datetime(2026, 8, 28, 12, 0, tzinfo=timezone.utc)
        start = generated_at - timedelta(hours=48)
        end = generated_at + timedelta(days=14)
        policy = PropagationSamplingPolicy(60)
        uniform_count = int((end - start).total_seconds() // 60) + 1
        tiered_count = policy.sample_count(start, end, generated_at)
        self.assertEqual(uniform_count, 23041)
        self.assertLessEqual(tiered_count, 6000)
        self.assertLess(tiered_count / uniform_count, 0.27)
        self.assertEqual(policy.step_seconds_at(generated_at + timedelta(hours=6), generated_at), 60)
        self.assertEqual(policy.step_seconds_at(generated_at + timedelta(hours=36), generated_at), 300)
        self.assertEqual(policy.step_seconds_at(generated_at + timedelta(days=7), generated_at), 900)

    def test_current_state_queries_never_scan_trajectory_samples(self):
        group_section = REPOSITORY.split("def get_group_current_positions", 1)[1].split("def get_group_positions_at", 1)[0]
        selection_section = REPOSITORY.split("def get_current_positions_for_selection", 1)[1].split("def get_run_covering", 1)[0]
        for section in (group_section, selection_section):
            self.assertIn("satellite_current_state", section)
            self.assertNotIn("position_samples", section)

    def test_arbitrary_current_position_batch_is_bounded(self):
        self.assertIn("MAX_CURRENT_POSITION_SELECTION = 10000", POSITIONS_API)
        self.assertIn('@router.post("/current")', POSITIONS_API)

    def test_track_requests_keep_resolution_window_and_size_limits(self):
        self.assertIn("resolution_seconds: int = Query(default=60, ge=10, le=3600)", MAIN)
        self.assertIn("max_points: int = Query(default=5000, ge=2, le=10000)", MAIN)
        self.assertIn("track window cannot exceed 15 days", MAIN)
        track_section = REPOSITORY.split("def get_track_points", 1)[1].split("def get_prediction_errors", 1)[0]
        self.assertIn("DISTINCT ON (sample_bucket)", track_section)

    def test_schema_supports_hot_run_lookup_and_tier_metadata(self):
        self.assertIn("sampling_policy JSONB", SCHEMA)
        self.assertIn("ix_propagation_runs_completed_satellite_generated", SCHEMA)
        self.assertIn("ix_position_samples_satellite_time", SCHEMA)
        self.assertIn("PRIMARY KEY (run_id, sample_time)", SCHEMA)

    def test_retention_prunes_samples_not_quality_metadata(self):
        self.assertIn("DELETE FROM position_samples", RETENTION)
        self.assertNotIn("DELETE FROM propagation_runs", RETENTION)
        self.assertNotIn("prediction_error_daily", RETENTION)
        self.assertIn("latest_active_runs", RETENTION)
        self.assertIn("satellite_current_state", RETENTION)


if __name__ == "__main__":
    unittest.main()
