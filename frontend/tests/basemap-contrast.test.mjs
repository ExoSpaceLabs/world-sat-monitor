import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import test from "node:test";

const mapStyleUrl = new URL("../app/maps/styles.ts", import.meta.url);
const globeMapUrl = new URL("../app/components/globe/GlobeMap.tsx", import.meta.url);
const mapSettingsUrl = new URL("../app/components/settings/MapSettingsPanel.tsx", import.meta.url);
const appSettingsUrl = new URL("../app/domain/settings.ts", import.meta.url);
const worldsatApiUrl = new URL("../app/services/worldsat-api.ts", import.meta.url);
const themeUrl = new URL("../app/maps/theme.ts", import.meta.url);
const orbitRendererUrl = new URL("../app/components/satellite/OrbitTrackLayer.ts", import.meta.url);
const satelliteLayerUrl = new URL("../app/components/satellite/SatelliteLayer.tsx", import.meta.url);
const satelliteProjectionUrl = new URL("../app/components/satellite/satelliteProjection.ts", import.meta.url);
const satelliteStylesUrl = new URL("../app/components/satellite/styles.css", import.meta.url);

async function source(url) {
  return readFile(url, "utf8");
}

test("themed basemap blends detailed Esri grayscale over one tint color", async () => {
  const text = await source(mapStyleUrl);

  assert.match(text, /World_Dark_Gray_Base\/MapServer\/tile/);
  assert.match(text, /World_Dark_Gray_Reference\/MapServer\/tile/);
  assert.match(text, /mode === "dark"\) return themedRasterStyle\(themedStyle\)/);
  assert.match(text, /THEMED_DETAIL_OPACITY = 0\.42/);
  assert.match(text, /"background-color": theme\.baseColor/);
  assert.match(text, /"raster-opacity": THEMED_DETAIL_OPACITY/);
  assert.match(text, /"raster-saturation": -1/);
  assert.match(text, /"raster-contrast": contrast/);
  assert.match(text, /"raster-brightness-max": 0\.58/);
  assert.doesNotMatch(text, /LAND_MASK_GEOJSON/);
  assert.doesNotMatch(text, /type: "geojson"/);
  assert.doesNotMatch(text, /cartocdn/i);
  assert.doesNotMatch(text, /API_KEY/);
});

test("themed defaults retain the dark mission palette and moderate detail contrast", async () => {
  const settings = await source(appSettingsUrl);
  const satelliteStyles = await source(satelliteStylesUrl);

  assert.match(settings, /baseColor: "#041018"/);
  assert.match(settings, /contrast: 0\.18/);
  assert.match(settings, /themed_base_color/);
  assert.match(settings, /themed_contrast/);
  assert.match(settings, /version: 5/);
  assert.match(satelliteStyles, /\.sat-card[^\n]*background:rgba\(5,18,26,\.86\)/);
  assert.match(satelliteStyles, /\.follow-button\.active[^\n]*background:#0a2c39/);
});

test("map settings use one tint, contrast, and survive legacy theme payloads", async () => {
  const panel = await source(mapSettingsUrl);
  const globe = await source(globeMapUrl);
  const api = await source(worldsatApiUrl);

  assert.match(panel, /mode === "dark" \? "THEMED"/);
  assert.match(panel, />TINT COLOR</);
  assert.match(panel, />CONTRAST</);
  assert.match(panel, /safeBaseColor/);
  assert.match(panel, /DEFAULT_THEMED_MAP_STYLE\.baseColor/);
  assert.match(panel, /TINT IS BLENDED UNDER THE RASTER/);
  assert.match(globe, /THEMED_SURFACE_LAYER_ID/);
  assert.match(globe, /THEMED_BASE_LAYER_ID/);
  assert.match(globe, /map\.setPaintProperty\(THEMED_SURFACE_LAYER_ID, "background-color", themeBaseColor\)/);
  assert.match(globe, /map\.setPaintProperty\(THEMED_BASE_LAYER_ID, "raster-contrast", themeContrast\)/);
  assert.match(globe, /map\.triggerRepaint\(\)/);
  assert.match(api, /normalizeAppSettings/);
  assert.match(api, /themed_water_color\?: string/);
  assert.match(api, /map\.themed_base_color \?\? map\.themed_water_color/);
  assert.match(api, /version: DEFAULT_APP_SETTINGS\.version/);
});

test("MapLibre worker is configured before map construction", async () => {
  const globe = await source(globeMapUrl);

  assert.match(globe, /maplibre-gl-worker\.mjs\?worker&url/);
  assert.match(globe, /maplibre\.setWorkerUrl\(maplibreWorkerUrl\)/);
  assert.ok(
    globe.indexOf("maplibre.setWorkerUrl(maplibreWorkerUrl)") < globe.indexOf("new maplibre.Map"),
    "worker URL must be configured before constructing MapLibre",
  );
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
