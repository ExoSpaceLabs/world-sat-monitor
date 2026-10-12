"""Browser-based UI smoke tests for the production Compose stack."""
from __future__ import annotations

import os
from datetime import datetime, timezone
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
        cls.browser = cls.driver.chromium.launch(
            headless=True,
            args=['--use-gl=angle', '--use-angle=swiftshader',
                  '--enable-unsafe-swiftshader', '--enable-webgl'],
        )

    @classmethod
    def tearDownClass(cls):
        cls.browser.close()
        cls.driver.stop()

    def setUp(self):
        self.context = self.browser.new_context(
            viewport={"width": 1280, "height": 800},
            device_scale_factor=1, timezone_id="UTC", reduced_motion="reduce",
        )
        self.page = self.context.new_page()
        self.page_errors = []
        self.tiles_seen = []
        self.page.on("pageerror", lambda error: self.page_errors.append(str(error)))
        self.context.tracing.start(screenshots=True, snapshots=True, sources=True)
        for pattern in (r"^https://services\.arcgisonline\.com/",
                        r"^https://server\.arcgisonline\.com/",
                        r"^https://tile\.openstreetmap\.org/"):
            self.page.route(re.compile(pattern), self._serve_tile)

    def _serve_tile(self, route):
        url = route.request.url
        self.tiles_seen.append(url)
        route.fulfill(status=200, content_type="image/png",
                      body=STREET_TILE if "openstreetmap.org" in url else DARK_TILE)

    def tearDown(self):
        try:
            if not self.page.is_closed():
                self.page.screenshot(path=str(ARTIFACTS / (self._testMethodName + ".png")))
        finally:
            try:
                self.context.tracing.stop(
                    path=str(ARTIFACTS / (self._testMethodName + "-trace.zip")))
            finally:
                self.context.close()
        self.assertEqual(self.page_errors, [], "Uncaught browser JavaScript errors")

    def _open(self):
        self.page.goto(BASE_URL, wait_until="domcontentloaded")
        status = self.page.locator("footer")
        expect(status).to_contain_text("API ONLINE", timeout=45000)
        expect(status).to_contain_text("MAP READY", timeout=45000)
        canvas = self.page.locator("[data-layer='globe-map'] canvas.maplibregl-canvas")
        expect(canvas).to_be_visible()
        self.assertTrue(canvas.evaluate(
            "(canvas) => Boolean(canvas.getContext('webgl2')) && canvas.width > 0"
        ), "MapLibre WebGL2 rendering canvas is missing")
        return canvas

    def _settings(self):
        trigger = self.page.get_by_role("button", name="Open map settings")
        trigger.click()
        expect(trigger).to_have_attribute("aria-expanded", "true")
        panel = self.page.get_by_label("Map settings", exact=True)
        expect(panel).to_be_visible()
        return panel

    def _capture_globe(self, name):
        return self.page.locator("[data-layer='globe-map']").screenshot(
            path=str(ARTIFACTS / (self._testMethodName + "-" + name + ".png")),
            animations="disabled",
        )

    def test_ui_001_browser_boot_and_panel_clicks(self):
        canvas = self._open()
        self.assertGreater(canvas.bounding_box()["width"], 400)
        expect(self.page.get_by_role("button", name="Open map settings")).to_be_visible()
        self._capture_globe("initial")
        panel = self._settings()
        panel.get_by_role("button", name="Close map settings").click()
        expect(panel).to_have_count(0)
        expect(self.page.get_by_role("button", name="Open map settings")).to_have_attribute(
            "aria-expanded", "false"
        )

    def test_ui_003_basemap_button_changes_rendered_pixels(self):
        self._open()
        panel = self._settings()
        expect(panel.get_by_role("button", name="THEMED", exact=True)).to_have_attribute(
            "aria-pressed", "true"
        )
        before = self._capture_globe("themed")
        with self.page.expect_response(
            lambda response: "tile.openstreetmap.org" in response.url
            and response.status == 200, timeout=30000,
        ):
            panel.get_by_role("button", name="STREET", exact=True).click()
        expect(panel.get_by_role("button", name="STREET", exact=True)).to_have_attribute(
            "aria-pressed", "true"
        )
        expect(self.page.locator("footer")).to_contain_text("MAP READY", timeout=30000)
        # Let raster opacity transition settle after actual tile receipt.
        self.page.wait_for_timeout(400)
        after = self._capture_globe("street")
        self.assertGreater(pixel_difference(before, after), 1.0,
                           "Basemap was selected, but rendered pixels were unchanged")

    def test_ui_004_005_shadow_opacity_changes_actual_globe_pixels(self):
        # At 00:00 UTC the initial Africa-facing viewport is on Earth's night side.
        self.page.clock.install(time=datetime(2026, 10, 12, 0, 0, tzinfo=timezone.utc))
        self._open()
        panel = self._settings()
        environment = panel.get_by_role("switch", name=re.compile("SKY.*NIGHT SHADOW"))
        expect(environment).to_have_attribute("aria-checked", "true")
        panel.get_by_role("switch", name=re.compile("SCENE TELEMETRY")).click()
        telemetry = self.page.get_by_label("Scene debug telemetry")
        expect(telemetry).to_contain_text(re.compile(r"SHADOW RENDER\s+READY"),
                                         timeout=20000)
        triangles = telemetry.locator("dt", has_text="SHADOW MESH").locator(
            "xpath=following-sibling::dd"
        ).inner_text()
        self.assertGreater(int(re.search(r"\d+", triangles).group()), 0)
        opacity = panel.get_by_role("slider", name="Night shadow opacity")
        opacity.fill("0")
        self.page.wait_for_timeout(300)
        no_shadow = self._capture_globe("shadow-zero")
        opacity.fill("100")
        self.page.wait_for_timeout(300)
        full_shadow = self._capture_globe("shadow-full")
        self.assertGreater(pixel_difference(no_shadow, full_shadow), 1.0,
                           "Shadow renderer reported READY but did not change image pixels")
        environment.click()
        expect(environment).to_have_attribute("aria-checked", "false")
        expect(self.page.locator("footer")).to_contain_text("ENVIRONMENT OFF")

    def test_ui_007_manager_create_reload_delete(self):
        self._open()
        name = "UI-E2E-" + uuid.uuid4().hex[:8].upper()
        self.page.get_by_role("button", name="Open object manager").click()
        manager = self.page.get_by_label("Object management")
        expect(manager).to_be_visible()
        manager.get_by_role("textbox", name="Satellite name").fill(name)
        manager.get_by_role("button", name="ADD SATELLITE").click()
        row = manager.locator(".sat-manager-row").filter(has_text=name)
        expect(row).to_be_visible(timeout=20000)
        expect(row).to_contain_text("INACTIVE")
        self.page.reload(wait_until="domcontentloaded")
        expect(self.page.locator("footer")).to_contain_text("API ONLINE", timeout=45000)
        self.page.get_by_role("button", name="Open object manager").click()
        manager = self.page.get_by_label("Object management")
        row = manager.locator(".sat-manager-row").filter(has_text=name)
        expect(row).to_be_visible(timeout=15000)
        self.page.once("dialog", lambda dialog: dialog.accept())
        row.get_by_role("button", name="DEL").click()
        expect(row).to_have_count(0)
