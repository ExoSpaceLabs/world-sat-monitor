import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import test from "node:test";

const rendererSourceUrl = new URL("../app/components/satellite/OrbitTrackLayer.ts", import.meta.url);
const satelliteLayerSourceUrl = new URL("../app/components/satellite/SatelliteLayer.tsx", import.meta.url);
const satelliteProjectionSourceUrl = new URL("../app/components/satellite/satelliteProjection.ts", import.meta.url);

async function rendererSource() {
  return readFile(rendererSourceUrl, "utf8");
}

async function satelliteLayerSource() {
  return readFile(satelliteLayerSourceUrl, "utf8");
}

async function satelliteProjectionSource() {
  return readFile(satelliteProjectionSourceUrl, "utf8");
}

test("orbit renderer uses tile-local projection with depth only for elevated orbit mode", async () => {
  const text = await rendererSource();

  assert.match(text, /renderingMode = "3d"/);
  assert.match(text, /projectTileFor3D/);
  assert.match(text, /projectTileWithElevation/);
  assert.match(text, /u_depth_aware/);
  assert.match(text, /path\.mode === "orbit"/);
  assert.match(text, /gl\.depthMask\(false\)/);
  assert.match(text, /gl\.disable\(gl\.DEPTH_TEST\)/);
  assert.match(text, /args\.getProjectionData/);
  assert.match(text, /canonical: \{x: 0, y: 0, z: 0\}/);
  assert.match(text, /coordinate\.x \* maplibre\.EXTENT/);
  assert.match(text, /coordinate\.y \* maplibre\.EXTENT/);
  assert.doesNotMatch(text, /defaultProjectionData/);
});

test("orbit renderer keeps altitude in physical metres for MapLibre tile projection", async () => {
  const text = await rendererSource();

  assert.match(text, /a_elevation/);
  assert.match(text, /Math\.max\(0, point\.altitude\) \* 1000/);
  assert.doesNotMatch(text, /a_elevation_mercator/);
  assert.doesNotMatch(text, /coordinate\.z/);
});

test("orbit renderer keeps long geographic paths segmented safely", async () => {
  const text = await rendererSource();

  assert.match(text, /MAX_RENDER_SEGMENT_ANGLE/);
  assert.match(text, /densifyForGlobe/);
  assert.match(text, /splitAtDateline/);
});

test("orbit renderer reports runtime WebGL failures instead of silently disappearing", async () => {
  const text = await rendererSource();

  assert.match(text, /OrbitDebugState/);
  assert.match(text, /gl\.getError\(\)/);
  assert.match(text, /reportDebug\(true/);
  assert.match(text, /reportDebug\(false/);
  assert.match(text, /Unable to render orbit tracks/);
});

test("satellite marker uses the active 3D camera transform instead of radial pixel altitude", async () => {
  const layerText = await satelliteLayerSource();
  const projectionText = await satelliteProjectionSource();

  assert.match(layerText, /projectSatelliteScreenPosition/);
  assert.doesNotMatch(layerText, /estimateRenderedGlobeRadius/);
  assert.match(projectionText, /modelViewProjectionMatrix/);
  assert.match(projectionText, /satelliteGlobePosition/);
  assert.match(projectionText, /coordinate\.x \* transform\.worldSize/);
  assert.match(projectionText, /Math\.max\(0, satellite\.altitude\) \* 1000/);
});

test("orbit layer installs immediately from an already style-loaded map session", async () => {
  const text = await satelliteLayerSource();

  assert.match(text, /map\.addLayer\(layer\)/);
  assert.doesNotMatch(text, /map\.isStyleLoaded\(\)/);
  assert.doesNotMatch(text, /map\.once\("style\.load"/);
});
