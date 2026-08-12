import type {Map as MapLibreMap} from "maplibre-gl";

export type Basemap = "dark" | "street" | "satellite";
export type MapState = "loading" | "ready" | "fallback";
export type SceneOptions = {spaceEnvironment: boolean};

export type MapLibreModule = typeof import("maplibre-gl");

export type MapSession = {
  map: MapLibreMap;
  maplibre: MapLibreModule;
  styleRevision: number;
};
