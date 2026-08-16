import type {Map as MapLibreMap} from "maplibre-gl";

export type RgbaColor = readonly [number, number, number, number];

export const THEME_CYAN: RgbaColor = [0.345, 0.804, 0.867, 0.98];
export const THEME_GREEN: RgbaColor = [0.341, 0.894, 0.627, 0.98];
export const THEME_HEADING: RgbaColor = [0.541, 1.0, 0.776, 1.0];
export const STREET_SURFACE: RgbaColor = [0.025, 0.035, 0.039, 0.98];

export function usesStreetContrast(map: MapLibreMap) {
  return Boolean(map.getSource("osm-standard") || map.getSource("osm-fallback"));
}
