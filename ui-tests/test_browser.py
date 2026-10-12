"""Browser-based UI smoke tests for the production Compose stack."""
from __future__ import annotations

import os
from pathlib import Path
import unittest

from playwright.sync_api import sync_playwright, expect

BASE_URL = os.getenv("WORLDSAT_UI_BASE_URL", "http://localhost:3000")
ARTIFACTS = Path("ui-artifacts")
ARTIFACTS.mkdir(exist_ok=True)


class BrowserSmokeTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.driver = sync_playwright().start()
        cls.browser = cls.driver.chromium.launch(headless=True)

    @classmethod
    def tearDownClass(cls):
        cls.browser.close()
        cls.driver.stop()
