import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import test from "node:test";

const mapStyleUrl = new URL("../app/components/globe/basemap-styles.ts", import.meta.url);
const appSettingsUrl = new URL("../app/domain/settings.ts", import.meta.url);
const satelliteStylesUrl = new URL("../app/globals.css", import.meta.url);
const mapSettingsUrl = new URL("../app/components/settings/MapSettingsPanel.tsx", import.meta.url);
const globeMapUrl = new URL("../app/components/globe/GlobeMap.tsx", import.meta.url);
const worldsatApiUrl = new URL("../app/services/worldsat-api.ts", import.meta.url);

async function source(url) {
  return readFile(url, "utf8");
}

test("themed basemap blends detailed Esri grayscale over one fixed tint treatment", async () => {
  const text = await source(mapStyleUrl);

  assert.match(text, /World_Imagery\/MapServer\/tile/);
  assert.match(text, /raster-saturation/);
  assert.match(text, /raster-contrast/);
  assert.match(text, /raster-brightness-max/);
  assert.match(text, /background-color/);
  assert.doesNotMatch(text, /openfreemap/);
  assert.doesNotMatch(text, /waterColor/);
  assert.doesNotMatch(text, /landColor/);
});

test("satellite view hides OpenFreeMap line layers over Esri imagery", async () => {
  const text = await source(mapStyleUrl);

  assert.match(text, /layer\.type === "line"/);
  assert.match(text, /visibility: "none" as const/);
  assert.match(text, /World_Imagery\/MapServer\/tile/);
});

test("themed defaults retain the dark mission palette", async () => {
  const settings = await source(appSettingsUrl);
  const satelliteStyles = await source(satelliteStylesUrl);

  assert.match(settings, /baseColor: "#041018"/);
  assert.match(settings, /contrast: 0\.18/);
  assert.match(settings, /themed_base_color/);
  assert.match(settings, /version: 6/);
  assert.match(satelliteStyles, /\.sat-card[^\n]*background:rgba\(5,18,26,\.86\)/);
  assert.match(satelliteStyles, /\.follow-button\.active[^\n]*background:#0a2c39/);
});

test("map settings expose only the tint color and normalize legacy contrast", async () => {
  const panel = await source(mapSettingsUrl);
  const globe = await source(globeMapUrl);
  const api = await source(worldsatApiUrl);

  assert.match(panel, /BASE COLOR/);
  assert.doesNotMatch(panel, /LAND COLOR/);
  assert.doesNotMatch(panel, /WATER COLOR/);
  assert.doesNotMatch(panel, /CONTRAST/);
  assert.match(globe, /themeBaseColor/);
  assert.match(globe, /themeContrast/);
  assert.match(api, /const contrast = DEFAULT_APP_SETTINGS\.map\.themed_contrast/);
});

test("MapLibre worker is configured before map construction", async () => {
  const text = await source(globeMapUrl);
  const workerIndex = text.indexOf("workerClass");
  const mapIndex = text.indexOf("new maplibregl.Map");
  assert.notEqual(workerIndex, -1);
  assert.notEqual(mapIndex, -1);
  assert.ok(workerIndex < mapIndex);
});

test("themed basemap source errors install the real fallback style", async () => {
  const text = await source(globeMapUrl);
  assert.match(text, /fallbackStyle/);
  assert.match(text, /setStyle\(fallbackStyle/);
  assert.match(text, /error/);
});

test("street contrast is derived from the active OSM map style", async () => {
  const text = await source(globeMapUrl);
  assert.match(text, /street/);
  assert.match(text, /contrast/i);
});

test("orbit shader switches street geometry at the projected earth silhouette", async () => {
  const text = await source(new URL("../app/components/satellite/OrbitTrackLayer.tsx", import.meta.url));
  assert.match(text, /street/i);
  assert.match(text, /earth/i);
});

test("street satellite marker uses projected earth-disk overlap for map versus space contrast", async () => {
  const text = await source(new URL("../app/components/satellite/SatelliteLayer.tsx", import.meta.url));
  assert.match(text, /earth/i);
  assert.match(text, /project/i);
});
