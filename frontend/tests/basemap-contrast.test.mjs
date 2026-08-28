import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import test from "node:test";

const mapStyleUrl = new URL("../app/maps/styles.ts", import.meta.url);
const globeMapUrl = new URL("../app/components/globe/GlobeMap.tsx", import.meta.url);
const mapSettingsUrl = new URL("../app/components/settings/MapSettingsPanel.tsx", import.meta.url);
const appSettingsUrl = new URL("../app/domain/settings.ts", import.meta.url);
const themeUrl = new URL("../app/maps/theme.ts", import.meta.url);
const orbitRendererUrl = new URL("../app/components/satellite/OrbitTrackLayer.ts", import.meta.url);
const satelliteLayerUrl = new URL("../app/components/satellite/SatelliteLayer.tsx", import.meta.url);
const satelliteProjectionUrl = new URL("../app/components/satellite/satelliteProjection.ts", import.meta.url);
const satelliteStylesUrl = new URL("../app/components/satellite/styles.css", import.meta.url);

async function source(url) {
  return readFile(url, "utf8");
}

test("themed basemap uses exact land and water fills with reference labels", async () => {
  const text = await source(mapStyleUrl);

  assert.match(text, /ne_110m_land\.geojson/);
  assert.match(text, /World_Dark_Gray_Reference\/MapServer\/tile/);
  assert.match(text, /mode === "dark"\) return themedMapStyle\(themedColors\)/);
  assert.match(text, /"natural-earth-land"/);
  assert.match(text, /id: "worldsat-themed-water"/);
  assert.match(text, /"background-color": colors\.water/);
  assert.match(text, /id: "worldsat-themed-land"/);
  assert.match(text, /"fill-color": colors\.land/);
  assert.doesNotMatch(text, /World_Dark_Gray_Base/);
  assert.doesNotMatch(text, /cartocdn/i);
  assert.doesNotMatch(text, /API_KEY/);
});

test("themed defaults match the supplied object-panel palette", async () => {
  const settings = await source(appSettingsUrl);
  const satelliteStyles = await source(satelliteStylesUrl);

  assert.match(settings, /water: "#041018"/);
  assert.match(settings, /land: "#0a2c39"/);
  assert.match(settings, /version: 4/);
  assert.match(satelliteStyles, /\.sat-card[^\n]*background:rgba\(5,18,26,\.86\)/);
  assert.match(satelliteStyles, /\.follow-button\.active[^\n]*background:#0a2c39/);
});

test("map settings exposes persistent themed water and land color controls", async () => {
  const panel = await source(mapSettingsUrl);
  const globe = await source(globeMapUrl);

  assert.match(panel, /mode === "dark" \? "THEMED"/);
  assert.match(panel, />WATER</);
  assert.match(panel, />LAND</);
  assert.match(panel, /type="color" value=\{themeWaterColor\}/);
  assert.match(panel, /type="color" value=\{themeLandColor\}/);
  assert.match(panel, /onThemeWaterColorChange/);
  assert.match(panel, /onThemeLandColorChange/);
  assert.match(globe, /themeLandColorRef/);
  assert.match(globe, /themeWaterColorRef/);
  assert.match(globe, /themeChanged/);
  assert.match(globe, /loadBasemapStyle\(basemap, \{land: themeLandColor, water: themeWaterColor\}\)/);
});

test("themed basemap source errors install the real fallback style", async () => {
  const text = await source(globeMapUrl);

  assert.match(text, /fallbackActiveRef/);
  assert.match(text, /basemapRef\.current !== "dark"/);
  assert.match(text, /map\.setStyle\(fallbackStyle\(\)\)/);
  assert.match(text, /fallbackActiveRef\.current \? "fallback" : "ready"/);
});

test("street contrast is derived from the active OSM map style", async () => {
  const text = await source(themeUrl);

  assert.match(text, /getSource\("osm-standard"\)/);
  assert.match(text, /getSource\("osm-fallback"\)/);
  assert.match(text, /STREET_SURFACE/);
  assert.match(text, /THEME_CYAN/);
});

test("orbit shader switches street geometry at the projected earth silhouette", async () => {
  const text = await source(orbitRendererUrl);

  assert.match(text, /v_earth_overlap/);
  assert.match(text, /projectToSphere\(a_pos\)/);
  assert.match(text, /u_camera_position/);
  assert.match(text, /camera_ray/);
  assert.match(text, /ray_b \* ray_b - 4\.0 \* ray_a \* ray_c/);
  assert.match(text, /u_surface_color/);
  assert.match(text, /u_space_color/);
  assert.match(text, /u_street_contrast/);
  assert.match(text, /usesStreetContrast\(this\.map\)/);
  assert.match(text, /streetContrast \? THEME_CYAN : THEME_GREEN/);
});

test("street satellite marker uses projected earth-disk overlap for map versus space contrast", async () => {
  const layer = await source(satelliteLayerUrl);
  const projection = await source(satelliteProjectionUrl);
  const styles = await source(satelliteStylesUrl);

  assert.match(layer, /usesStreetContrast\(map\)/);
  assert.match(layer, /isSatelliteOverEarthDisk\(map, satellite\)/);
  assert.match(layer, /street-surface/);
  assert.match(layer, /street-space/);
  assert.match(projection, /projectedRayIntersectsEarth/);
  assert.match(projection, /farRoot > 0/);
  assert.match(projection, /satelliteGlobePosition\(satellite\)/);
  assert.match(styles, /\.satellite-marker\.street-surface/);
  assert.match(styles, /\.satellite-marker\.street-space/);
  assert.match(styles, /#16cfe3/);
});
