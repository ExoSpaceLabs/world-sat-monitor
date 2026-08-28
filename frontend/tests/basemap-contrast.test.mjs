import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import test from "node:test";

const mapStyleUrl = new URL("../app/maps/styles.ts", import.meta.url);
const globeMapUrl = new URL("../app/components/globe/GlobeMap.tsx", import.meta.url);
const themeUrl = new URL("../app/maps/theme.ts", import.meta.url);
const monitorStylesUrl = new URL("../app/components/world-sat-monitor/styles.css", import.meta.url);
const orbitRendererUrl = new URL("../app/components/satellite/OrbitTrackLayer.ts", import.meta.url);
const satelliteLayerUrl = new URL("../app/components/satellite/SatelliteLayer.tsx", import.meta.url);
const satelliteProjectionUrl = new URL("../app/components/satellite/satelliteProjection.ts", import.meta.url);
const satelliteStylesUrl = new URL("../app/components/satellite/styles.css", import.meta.url);

async function source(url) {
  return readFile(url, "utf8");
}

test("dark basemap uses the keyless Esri dark-gray raster base and reference layers", async () => {
  const text = await source(mapStyleUrl);

  assert.match(text, /World_Dark_Gray_Base\/MapServer\/tile/);
  assert.match(text, /World_Dark_Gray_Reference\/MapServer\/tile/);
  assert.match(text, /mode === "dark"\) return darkRasterStyle\(\)/);
  assert.match(text, /"esri-dark-base"/);
  assert.match(text, /"esri-dark-reference"/);
  assert.doesNotMatch(text, /cartocdn/i);
  assert.doesNotMatch(text, /dark_all/);
  assert.doesNotMatch(text, /API_KEY/);
});

test("dark basemap is anchored to the exact top-menu inactive and active surfaces", async () => {
  const text = await source(mapStyleUrl);
  const menu = await source(monitorStylesUrl);

  assert.match(menu, /background:rgba\(6,23,32,\.82\)/);
  assert.match(menu, /background:#0a2734/);
  assert.match(text, /MENU_INACTIVE_SURFACE = "#061720"/);
  assert.match(text, /MENU_ACTIVE_SURFACE = "#0a2734"/);
  assert.match(text, /"background-color": MENU_INACTIVE_SURFACE/);
  assert.match(text, /"worldsat:inactive-surface": MENU_INACTIVE_SURFACE/);
  assert.match(text, /"worldsat:active-surface": MENU_ACTIVE_SURFACE/);
  assert.match(text, /"raster-opacity": 0\.3/);
  assert.match(text, /"raster-saturation": -1/);
  assert.match(text, /"raster-contrast": 0\.16/);
  assert.match(text, /"raster-brightness-max": 0\.44/);
  assert.match(text, /"raster-opacity": 0\.78/);
  assert.doesNotMatch(text, /#06272d/);
});

test("dark basemap source errors install the real fallback style", async () => {
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
