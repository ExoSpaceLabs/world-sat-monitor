import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const readRoot = (path) => readFile(new URL(`../../${path}`, import.meta.url), "utf8");

test("release UI keeps display panels geometrically consistent", async () => {
  const satelliteCss = await read("app/components/satellite/styles.css");
  const groupCss = await read("app/components/groups/styles.css");
  assert.match(satelliteCss, /\.sat-card,\.details-card\{[^}]*width:300px/);
  assert.match(groupCss, /\.group-panel\{[^}]*width:300px/);
  assert.match(groupCss, /background:rgba\(5,18,26,\.86\)/);
});

test("globe illumination uses the mode-independent compositing pass", async () => {
  const source = await read("app/components/day-night/DayNightLayer.tsx");
  assert.match(source, /readonly renderingMode = "2d" as const/);
  assert.doesNotMatch(source, /readonly renderingMode = "3d" as const/);
});

test("environment shadow owns WebGL state and does not depend on display or orbit mode", async () => {
  const shadowSource = await read("app/components/day-night/DayNightLayer.tsx");
  const monitorSource = await read("app/components/world-sat-monitor/WorldSatMonitor.tsx");
  const dayNightInvocation = monitorSource.match(/<DayNightLayer[^>]+\/>/)?.[0] ?? "";

  assert.match(shadowSource, /const previousState = captureRenderState\(gl\)/);
  assert.match(shadowSource, /gl\.disable\(gl\.DEPTH_TEST\);\s*gl\.depthMask\(false\);/);
  assert.match(shadowSource, /finally \{\s*restoreRenderState\(gl, previousState\);\s*\}/);
  assert.match(dayNightInvocation, /enabled=\{scene\.spaceEnvironment\}/);
  assert.doesNotMatch(dayNightInvocation, /displayTarget|pathActive|orbit/);
});

test("single and group placement controls use the same NADIR then ORBIT language", async () => {
  const panel = await read("app/components/satellite/OrbitSettingsPanel.tsx");

  assert.equal((panel.match(/>NADIR<\/button>/g) ?? []).length, 2);
  assert.equal((panel.match(/>ORBIT<\/button>/g) ?? []).length, 2);
  assert.doesNotMatch(panel, />GROUND<\/button>/);

  const singleNadir = panel.indexOf('setTrackMode("ground")}>NADIR');
  const singleOrbit = panel.indexOf('setTrackMode("orbit")}>ORBIT');
  const groupNadir = panel.indexOf('setGroupPlacement("nadir")}>NADIR');
  const groupOrbit = panel.indexOf('setGroupPlacement("orbit")}>ORBIT');
  assert.ok(singleNadir >= 0 && singleNadir < singleOrbit);
  assert.ok(groupNadir >= 0 && groupNadir < groupOrbit);
});

test("published-image quick start is self-contained", async () => {
  const readme = await readRoot("README.md");

  assert.match(readme, /git clone https:\/\/github\.com\/ExoSpaceLabs\/world-sat-monitor\.git/);
  assert.match(readme, /cd world-sat-monitor/);
  assert.match(readme, /docker compose -f compose\.images\.yaml up -d/);
  assert.doesNotMatch(readme, /docker compose -f compose\.images\.yaml pull/);
  assert.match(readme, /http:\/\/localhost:3000/);
  assert.match(readme, /docker compose -f compose\.images\.yaml down/);
});

test("about control is docked in the footer band", async () => {
  const css = await read("app/components/about/styles.css");
  assert.match(css, /\.about-trigger\{[^}]*bottom:3px/);
  assert.match(css, /\.about-panel\{[^}]*bottom:42px/);
});
