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

test("about control is docked in the footer band", async () => {
  const css = await read("app/components/about/styles.css");
  assert.match(css, /\.about-trigger\{[^}]*bottom:3px/);
  assert.match(css, /\.about-panel\{[^}]*bottom:42px/);
});
