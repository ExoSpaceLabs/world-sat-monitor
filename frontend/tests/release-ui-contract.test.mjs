import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("release UI keeps display panels geometrically consistent", async () => {
  const satelliteCss = await read("app/components/satellite/styles.css");
  const groupCss = await read("app/components/groups/styles.css");
  assert.match(satelliteCss, /\.sat-card,\.details-card\{[^}]*width:300px/);
  assert.match(groupCss, /\.group-panel\{[^}]*width:300px/);
  assert.match(groupCss, /background:rgba\(5,18,26,\.86\)/);
});

test("globe illumination remains in the 3d render pass", async () => {
  const source = await read("app/components/day-night/DayNightLayer.tsx");
  assert.match(source, /readonly renderingMode = "3d" as const/);
});

test("environment shadow owns depth state and does not depend on orbit paths", async () => {
  const shadowSource = await read("app/components/day-night/DayNightLayer.tsx");
  const monitorSource = await read("app/components/world-sat-monitor/WorldSatMonitor.tsx");
  const dayNightInvocation = monitorSource.match(/<DayNightLayer[^>]+\/>/)?.[0] ?? "";

  assert.match(shadowSource, /const previousDepthMask = gl\.getParameter\(gl\.DEPTH_WRITEMASK\) as boolean/);
  assert.match(shadowSource, /gl\.disable\(gl\.DEPTH_TEST\);\s*gl\.depthMask\(false\);/);
  assert.match(shadowSource, /finally \{\s*gl\.depthMask\(previousDepthMask\);\s*\}/);
  assert.match(dayNightInvocation, /enabled=\{scene\.spaceEnvironment\}/);
  assert.doesNotMatch(dayNightInvocation, /pathActive|orbit/);
});

test("about control is docked in the footer band", async () => {
  const css = await read("app/components/about/styles.css");
  assert.match(css, /\.about-trigger\{[^}]*bottom:3px/);
  assert.match(css, /\.about-panel\{[^}]*bottom:42px/);
});
