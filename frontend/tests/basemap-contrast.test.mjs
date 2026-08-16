import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import test from "node:test";

const mapStyleUrl = new URL("../app/maps/styles.ts", import.meta.url);
const themeUrl = new URL("../app/maps/theme.ts", import.meta.url);
const orbitRendererUrl = new URL("../app/components/satellite/OrbitTrackLayer.ts", import.meta.url);
const satelliteLayerUrl = new URL("../app/components/satellite/SatelliteLayer.tsx", import.meta.url);
const satelliteProjectionUrl = new URL("../app/components/satellite/satelliteProjection.ts", import.meta.url);
const satelliteStylesUrl = new URL("../app/components/satellite/styles.css", import.meta.url);

async function source(url) {
  return readFile(url, "utf8");
}

test("dark basemap remains the unmodified CARTO dark raster", async () => {
  const text = await source(mapStyleUrl);

  assert.match(text, /dark_all\/\{z\}\/\{x\}\/\{y\}\.png/);
  assert.match(text, /rasterStyle\("carto-dark", CARTO_DARK_TILES, 20/);
  assert.doesNotMatch(text, /raster-hue-rotate/);
  assert.doesNotMatch(text, /worldsat-dark-tint/);
  assert.doesNotMatch(text, /applyWorldSatVectorDarkTheme/);
  assert.doesNotMatch(text, /VECTOR_DARK/);
  assert.doesNotMatch(text, /raster-brightness-max/);
  assert.doesNotMatch(text, /raster-contrast/);
  assert.doesNotMatch(text, /raster-saturation/);
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
