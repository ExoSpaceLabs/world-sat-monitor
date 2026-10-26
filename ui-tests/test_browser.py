"""Browser-based UI smoke tests for the production Compose stack."""
from __future__ import annotations

import os
from datetime import datetime, timezone
from pathlib import Path
import unittest

from io import BytesIO
import re
import uuid
from urllib.parse import urlsplit

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

def centre_pixel_difference(first, second):
    """Compare only the Earth-centre ROI, excluding Settings and other chrome."""
    a = Image.open(BytesIO(first)).convert("RGB")
    b = Image.open(BytesIO(second)).convert("RGB")
    if a.size != b.size:
        raise AssertionError("Screenshot dimensions differ")
    width, height = a.size
    roi = (
        width * 2 // 5, height * 2 // 5,
        width * 3 // 5, height * 3 // 5,
    )
    return sum(ImageStat.Stat(ImageChops.difference(
        a.crop(roi), b.crop(roi))).mean) / 3


from playwright.sync_api import sync_playwright, expect

BASE_URL = os.getenv("WORLDSAT_UI_BASE_URL", "http://localhost:3000").rstrip("/")
TARGET = os.getenv("WORLDSAT_UI_TARGET", "compose").lower()
if TARGET not in {"compose", "sites"}:
    raise ValueError("WORLDSAT_UI_TARGET must be 'compose' or 'sites'")
if TARGET == "sites" and not BASE_URL.startswith("https://"):
    raise ValueError("Hosted Sites tests require an explicit HTTPS WORLDSAT_UI_BASE_URL")
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
        mobile = self._testMethodName.startswith("test_ui_011_mobile")
        self.context = self.browser.new_context(
            viewport={"width": 390, "height": 844} if mobile else {"width": 1280, "height": 800},
            device_scale_factor=1, timezone_id="UTC", reduced_motion="reduce",
            is_mobile=mobile, has_touch=mobile,
        )
        self.page = self.context.new_page()
        self.page_errors = []
        self.console_errors = []
        self.unexpected_api_errors = []
        self.expected_api_errors = set()
        self.tiles_seen = []
        self.page.on("pageerror", lambda error: self.page_errors.append(str(error)))
        self.page.on("console", lambda message: self.console_errors.append(message.text)
                     if message.type == "error" else None)
        self.page.on("response", self._observe_api_response)
        # Compose CI owns a disposable database and can reset shared settings.
        # Sites has no settings/reset endpoint: each browser context instead
        # starts with a new isolated guest cookie and default D1 state.
        if TARGET == "compose":
            reset = self.context.request.post(BASE_URL + "/api/v1/settings/reset")
            if not reset.ok:
                raise AssertionError(f"Fixture settings reset failed: HTTP {reset.status}")
        self.context.tracing.start(screenshots=True, snapshots=True, sources=True)
        for pattern in (r"^https://services\.arcgisonline\.com/",
                        r"^https://server\.arcgisonline\.com/",
                        r"^https://tile\.openstreetmap\.org/"):
            self.page.route(re.compile(pattern), self._serve_tile)


    def _observe_api_response(self, response):
        path = urlsplit(response.url).path
        if not response.url.startswith(BASE_URL + "/api/v1/") or response.status < 500:
            return
        key = (response.request.method, path, response.status)
        if key not in self.expected_api_errors:
            self.unexpected_api_errors.append(f"{response.status} {response.request.method} {response.url}")

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
        (ARTIFACTS / (self._testMethodName + "-console.txt")).write_text(
            "\n".join(self.console_errors + self.page_errors + self.unexpected_api_errors),
            encoding="utf-8",
        )
        self.assertEqual(self.page_errors, [], "Uncaught browser JavaScript errors")
        self.assertEqual(self.unexpected_api_errors, [], "Unexpected API HTTP 5xx responses")

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
        expect(
            telemetry.locator("dt", has_text="SHADOW RENDER")
            .locator("xpath=following-sibling::dd")
        ).to_have_text("READY", timeout=20000)
        triangles = telemetry.locator("dt", has_text="SHADOW MESH").locator(
            "xpath=following-sibling::dd"
        ).inner_text()
        self.assertGreater(int(re.search(r"\d+", triangles).group()), 0)
        opacity = panel.get_by_role("slider", name="Night shadow opacity")
        opacity.focus()
        opacity.press("Home")
        self.page.wait_for_timeout(300)
        no_shadow = self._capture_globe("shadow-zero")
        self.page.wait_for_timeout(300)
        no_shadow_repeat = self._capture_globe("shadow-zero-repeat")
        baseline_noise = pixel_difference(no_shadow, no_shadow_repeat)
        opacity.press("End")
        self.page.wait_for_timeout(300)
        full_shadow = self._capture_globe("shadow-full")
        shadow_effect = pixel_difference(no_shadow_repeat, full_shadow)
        print(f"Shadow comparison: baseline noise={baseline_noise:.3f}, effect={shadow_effect:.3f}")
        self.assertGreater(
            shadow_effect,
            max(1.5, baseline_noise * 3 + 0.5),
            "Shadow shader reported READY but opacity change did not exceed image baseline noise",
        )
        environment.click()
        expect(environment).to_have_attribute("aria-checked", "false")
        expect(self.page.locator("footer")).to_contain_text("ENVIRONMENT OFF")

    def test_ui_005b_equinox_night_is_dark_and_noon_is_sunlit(self):
        """Same camera, equinox noon/midnight: the visible hemisphere matters.

        Unlike the generic opacity-pixel test, this explicitly fails an
        inverted night mask or a shader that darkens the entire planet.
        """
        def centre_shadow_effect(instant, label):
            self.page.clock.install(time=datetime.fromisoformat(instant))
            self._open()
            panel = self._settings()
            opacity = panel.get_by_role("slider", name="Night shadow opacity")
            opacity.focus()
            opacity.press("Home")
            expect(panel.locator(".shadow-opacity output")).to_have_text("0%")
            self.page.wait_for_timeout(350)
            unshaded = self._capture_globe(label + "-zero")
            opacity.press("End")
            expect(panel.locator(".shadow-opacity output")).to_have_text("100%")
            self.page.wait_for_timeout(350)
            shaded = self._capture_globe(label + "-full")
            return centre_pixel_difference(unshaded, shaded)

        # Africa-centred INITIAL_VIEW (13E, 18N), same orientation and raster
        # tiles on both fresh loads. Noon and midnight are astronomical reference
        # states at the March equinox; no private map hooks are required.
        midday = centre_shadow_effect("2026-03-20T12:00:00+00:00", "equinox-noon")
        self.page.close()
        self.page = self.context.new_page()
        self.page.on("pageerror", lambda error: self.page_errors.append(str(error)))
        self.page.on("response", self._observe_api_response)
        midnight = centre_shadow_effect("2026-03-20T00:00:00+00:00", "equinox-midnight")
        print(f"Terminator hemisphere ROI: noon={midday:.3f}, midnight={midnight:.3f}")
        self.assertGreater(midnight, 3.0,
                           "Night-side core must visibly darken")
        self.assertLess(midday, max(0.7, midnight * 0.25),
                        "Daylight core must remain mostly undarkened at equinox noon")

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

    def test_ui_006_reset_view_restores_camera_zoom(self):
        """Exercise actual wheel input and require a camera response and reset."""
        # Camera movement is asynchronous (MapLibre animation frames). Do
        # not install Playwright's virtual clock: that freezes or advances the
        # same timers driving wheel-zoom transitions on some browser versions.
        canvas = self._open()
        coordinates = self.page.locator(".coordinates")
        expect(coordinates).to_contain_text("Z1.4")
        # Close the docked Details overlay so it cannot intercept map input.
        details = self.page.get_by_role("button", name="Toggle display details")
        details.click()
        expect(details).to_have_attribute("aria-expanded", "false")
        canvas.hover(position={"x": 800, "y": 350})
        for _ in range(3):
            self.page.mouse.wheel(0, -600)
        self.page.wait_for_function(
            "() => { const match = document.querySelector('.coordinates')?.textContent?.match(/Z([0-9.]+)/); return match && Number(match[1]) >= 1.8; }",
            timeout=15000,
        )
        self.page.get_by_role("button", name="Reset globe camera").click()
        # INITIAL_VIEW.zoom = 1.35. The UI reports one decimal place, and
        # floating-point rounding around the 1.35 boundary can show 1.3 or
        # 1.4 after MapLibre's animated easing, depending on browser frames.
        # Both represent the same initial view at the display's precision.
        expect(coordinates).to_contain_text(re.compile(r"Z1\\.[34]\\b"), timeout=15000)
        expect(coordinates).to_contain_text("18.000° N", timeout=15000)

    def test_ui_008_group_creation_membership_display_and_cleanup(self):
        """Manager creation, membership, group display and deletion are end-to-end."""
        self._open()
        name = "UI-GROUP-" + uuid.uuid4().hex[:8].upper()
        self.page.get_by_role("button", name="Open object manager").click()
        manager = self.page.get_by_label("Object management")
        manager.get_by_role("tab", name="GROUPED").click()
        manager.get_by_role("textbox", name="New group name").fill(name)
        manager.locator(".manager-group-create").get_by_role("button", name="CREATE").click()
        entry = manager.locator(".manager-group-entry").filter(has_text=name)
        expect(entry).to_be_visible(timeout=20000)

        # Add the deterministic fixture, not a live CelesTrak object.
        candidates = entry.get_by_label("Add satellite to group")
        fixture = candidates.locator(".group-member-candidate").filter(has_text="WORLDSAT-01")
        expect(fixture).to_be_visible(timeout=15000)
        fixture.get_by_role("button", name="ADD").click()
        expect(entry.locator(".manager-group-expand")).to_contain_text("1 MEMBERS", timeout=20000)

        api_groups = self.context.request.get(BASE_URL + "/api/v1/groups")
        self.assertTrue(api_groups.ok)
        group = next((g for g in api_groups.json()["groups"] if g["name"] == name), None)
        self.assertIsNotNone(group, "Created group not found in backend")
        group_id = group["id"]
        try:
            manager.get_by_role("button", name="Close manager").click()
            self.page.get_by_role("group", name="Display mode").get_by_role("button", name="GROUP").click()
            listing = self.page.get_by_label("Group display list")
            display = listing.locator(".group-display-row").filter(has_text=name)
            expect(display).to_be_visible(timeout=15000)
            display.click()
            expect(display).to_have_attribute("aria-pressed", "true")
            expect(self.page.locator("footer")).to_contain_text("GROUP " + name + " DISPLAYED")
            expect(self.page.locator("footer")).to_contain_text("1/1 POSITIONS READY", timeout=30000)
            expect(self.page.get_by_label("Interactive rotating 3D Earth map")).to_be_visible()
        finally:
            # API cleanup is acceptable in a test fixture; UI creation/display
            # and the group membership were explicitly validated above.
            deleted = self.context.request.delete(BASE_URL + f"/api/v1/groups/{group_id}")
            self.assertEqual(deleted.status, 204, "Fixture group cleanup failed")

    def test_ui_009_orbit_controls_persist_after_reload(self):
        self._open()
        self.page.get_by_role("button", name="Open orbital settings").click()
        settings = self.page.get_by_label("Object settings")
        draw_path = settings.get_by_role("switch", name=re.compile("DRAW ORBIT PATH"))
        expect(draw_path).to_have_attribute("aria-checked", "true")
        draw_path.click()
        expect(draw_path).to_have_attribute("aria-checked", "false")
        expect(self.page.locator("footer")).to_contain_text("SETTINGS SAVED", timeout=15000)
        response = self.context.request.get(BASE_URL + "/api/v1/settings")
        self.assertTrue(response.ok)
        self.assertFalse(response.json()["orbit"]["path"]["enabled"])

        self.page.reload(wait_until="domcontentloaded")
        expect(self.page.locator("footer")).to_contain_text("API ONLINE", timeout=45000)
        self.page.get_by_role("button", name="Open orbital settings").click()
        settings = self.page.get_by_label("Object settings")
        draw_path = settings.get_by_role("switch", name=re.compile("DRAW ORBIT PATH"))
        expect(draw_path).to_have_attribute("aria-checked", "false")
        draw_path.click()
        expect(draw_path).to_have_attribute("aria-checked", "true")
        expect(self.page.locator("footer")).to_contain_text("SETTINGS SAVED", timeout=15000)

    def test_ui_010_group_create_failure_is_visible_and_non_destructive(self):
        """A controlled API 503 should surface to the user, not fake a group."""
        self._open()
        name = "UI-FAILED-" + uuid.uuid4().hex[:8].upper()
        self.page.get_by_role("button", name="Open object manager").click()
        manager = self.page.get_by_label("Object management")
        manager.get_by_role("tab", name="GROUPED").click()

        def unavailable_group_create(route):
            if route.request.method == "POST":
                route.fulfill(status=503, content_type="application/json",
                              body='{"detail":"Simulated group service unavailable"}')
            else:
                route.continue_()

        self.expected_api_errors.add(("POST", "/api/v1/groups", 503))
        self.page.route(re.compile(r"/api/v1/groups(?:\?.*)?$"),
                        unavailable_group_create)
        manager.get_by_role("textbox", name="New group name").fill(name)
        manager.locator(".manager-group-create").get_by_role("button", name="CREATE").click()
        expect(manager.get_by_role("alert")).to_contain_text(
            "Simulated group service unavailable", timeout=15000)
        expect(manager.locator(".manager-group-entry").filter(has_text=name)).to_have_count(0)
        # The failed mutation must not silently create local/backend state.
        groups = self.context.request.get(BASE_URL + "/api/v1/groups")
        self.assertTrue(groups.ok)
        self.assertNotIn(name, [g["name"] for g in groups.json()["groups"]])
        manager.get_by_role("button", name="Close manager").click()
        expect(self.page.get_by_label("Interactive rotating 3D Earth map")).to_be_visible()

    def test_ui_011_mobile_controls_and_panels_fit_viewport(self):
        """Exercise real mobile CSS, not a scaled desktop screenshot."""
        self._open()
        width = self.page.evaluate("window.innerWidth")
        self.assertEqual(width, 390, "Unexpected mobile CSS viewport")
        scroll_width = self.page.evaluate(
            "Math.max(document.body.scrollWidth, document.documentElement.scrollWidth)")
        self.assertLessEqual(scroll_width, width + 2,
                             "Mobile page has horizontal overflow")
        for accessible_name, panel_label in (
            ("Open map settings", "Map settings"),
            ("Open orbital settings", "Object settings"),
            ("Open object manager", "Object management"),
        ):
            button = self.page.get_by_role("button", name=accessible_name)
            expect(button).to_be_visible()
            box = button.bounding_box()
            self.assertIsNotNone(box)
            self.assertGreaterEqual(box["x"], -1, accessible_name + " off-screen")
            self.assertLessEqual(box["x"] + box["width"], width + 1,
                                 accessible_name + " off-screen")
            button.click()
            panel = self.page.get_by_label(panel_label, exact=True)
            expect(panel).to_be_visible()
            rect = panel.bounding_box()
            self.assertIsNotNone(rect)
            self.assertGreaterEqual(rect["x"], 0, panel_label + " clipped")
            self.assertLessEqual(rect["x"] + rect["width"], width + 1,
                                 panel_label + " clipped")
            if panel_label == "Map settings":
                panel.get_by_role("button", name="Close map settings").click()
            elif panel_label == "Object settings":
                panel.get_by_role("button", name="Close settings").click()
            else:
                panel.get_by_role("button", name="Close manager").click()
            expect(panel).to_have_count(0)
