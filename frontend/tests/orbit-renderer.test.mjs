import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import test from "node:test";

const sourceUrl = new URL("../app/components/satellite/OrbitTrackLayer.ts", import.meta.url);

async function source() {
  return readFile(sourceUrl, "utf8");
}

test("orbit renderer uses elevated overlay projection instead of screen-space offsets", async () => {
  const text = await source();

  assert.match(text, /renderingMode = "2d"/);
  assert.match(text, /projectTileWithElevation/);
  assert.doesNotMatch(text, /projectTileFor3D/);
  assert.doesNotMatch(text, /map\.project\(/);
  assert.doesNotMatch(text, /estimateRenderedGlobeRadius/);
});

test("orbit renderer carries projection-specific altitude representations", async () => {
  const text = await source();

  assert.match(text, /a_elevation_meters/);
  assert.match(text, /a_elevation_mercator/);
  assert.match(text, /MercatorCoordinate\.fromLngLat/);
  assert.match(text, /#ifdef GLOBE/);
});

test("orbit renderer keeps long geographic paths segmented safely", async () => {
  const text = await source();

  assert.match(text, /MAX_RENDER_SEGMENT_ANGLE/);
  assert.match(text, /densifyForGlobe/);
  assert.match(text, /splitAtDateline/);
});
