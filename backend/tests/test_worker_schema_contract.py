from __future__ import annotations

from pathlib import Path
import unittest


SCHEMA = Path("database/init/001_schema.sql").read_text(encoding="utf-8")
MIGRATIONS = Path("backend/app/migrations.py").read_text(encoding="utf-8")
COMPOSE = Path("compose.yaml").read_text(encoding="utf-8")
STORE = Path("backend/app/orbital_store.py").read_text(encoding="utf-8")


class WorkerSchemaContractTests(unittest.TestCase):
    def test_provider_and_current_state_tables_exist(self):
        self.assertIn("CREATE TABLE IF NOT EXISTS provider_fetch_state", SCHEMA)
        self.assertIn("CREATE TABLE IF NOT EXISTS satellite_current_state", SCHEMA)
        self.assertIn("source_element_set_id", SCHEMA)

    def test_jobs_support_history_and_cancellation(self):
        self.assertIn("history_hours INTEGER NOT NULL DEFAULT 48", SCHEMA)
        self.assertIn("'cancelled'", SCHEMA)
        self.assertIn("ux_propagation_jobs_active_element", SCHEMA)

    def test_additive_migration_covers_worker_schema(self):
        self.assertIn("CURRENT_SCHEMA_SQL", MIGRATIONS)
        self.assertIn("provider_fetch_state", MIGRATIONS)
        self.assertIn("satellite_current_state", MIGRATIONS)
        self.assertIn("pg_advisory_xact_lock", MIGRATIONS)

    def test_job_claim_uses_skip_locked(self):
        self.assertIn("FOR UPDATE OF pj SKIP LOCKED", STORE)

    def test_compose_has_independent_workers(self):
        self.assertIn("orbital-provider:", COMPOSE)
        self.assertIn('command: ["python", "-m", "app.provider_service"]', COMPOSE)
        self.assertIn("propagator:", COMPOSE)
        self.assertIn('command: ["python", "-m", "app.propagator_service"]', COMPOSE)


if __name__ == "__main__":
    unittest.main()
