"""Browser-based UI smoke tests for the production Compose stack."""
from __future__ import annotations

import os
from pathlib import Path
import unittest

from io import BytesIO
import re
import uuid

from PIL import Image, ImageChops, ImageDraw, ImageStat


def sample_tile(street=False):
    image = Image.new("RGB", (256, 256), (180, 190, 200) if street else (27, 73, 100))
    draw = ImageDraw.Draw(image)
    draw.polygon([(23, 21), (162, 6), (197, 35), (176, 90), (226, 141),
                  (168, 185), (148, 250), (77, 227), (39, 153), (63, 98)],
                 fill=(220, 192, 128) if street else (90, 147, 112))
    output = BytesIO()
    image.save(output, format="PNG")
    return output.getvalue()


DARK_TILE = sample_tile()
STREET_TILE = sample_tile(street=True)


def pixel_difference(first, second):
    a = Image.open(BytesIO(first)).convert("RGB")
    b = Image.open(BytesIO(second)).convert("RGB")
    if a.size != b.size:
        raise AssertionError("Screenshot dimensions differ")
    return sum(ImageStat.Stat(ImageChops.difference(a, b)).mean) / 3

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
