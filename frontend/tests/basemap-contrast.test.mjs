import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import test from "node:test";

const mapStyleUrl = new URL("../app/maps/styles.ts", import.meta.url);
const themeUrl = new URL("../app/maps/theme.ts", import.meta.url);
const orbitRendererUrl = new URL("../app/components/satellite/OrbitTrackLayer.ts", import.meta.url);
const satelliteLayerUrl = new URL("../app/components/satellite/SatelliteLayer.tsx", import.meta.url);
const satelliteProjectionUrl = new URL("../app/components/satellite/satelliteProjection.ts", import.meta.url);
const satelliteStylesUrl = new URL("../app/components/satellite/styles.css", import.meta.url);
const gatewayConfigUrl = new URL("../../gateway/nginx.conf", import.meta.url);

async function source(url) {
  return readFile(url, "utf8");
}

test("dark basemap loads OpenFreeMap through the same-origin gateway", async () => {
  const text = await source(mapStyleUrl);
  const gateway = await source(gatewayConfigUrl);

  assert.match(text, /\/map\/openfreemap\/styles\/dark/);
  assert.match(text, /mode === "dark"\) return loadOpenFreeMapDarkStyle\(\)/);
  assert.doesNotMatch(text, /https:\/\/tiles\.openfreemap\.org\/styles\/dark/);
  assert.doesNotMatch(text, /cartocdn/i);
  assert.doesNotMatch(text, /dark_all/);
  assert.doesNotMatch(text, /API_KEY/);

  assert.match(gateway, /location \/map\/openfreemap\//);
  assert.match(gateway, /proxy_pass https:\/\/tiles\.openfreemap\.org\//);
  assert.match(gateway, /proxy_set_header Origin ""/);
  assert.match(gateway, /proxy_set_header Referer ""/);
  assert.match(gateway, /sub_filter_once off/);
  assert.match(gateway, /sub_filter 'https:\/\/tiles\.openfreemap\.org' '\/map\/openfreemap'/);
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
