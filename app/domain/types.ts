import type {Map as MapLibreMap} from "maplibre-gl";
import {DEFAULT_SHADOW_OPACITY} from "./solar";

export type Basemap = "dark" | "street" | "satellite";
export type MapState = "loading" | "ready" | "fallback";
export type SceneOptions = {
  debug: boolean;
  shadowOpacity: number;
  spaceEnvironment: boolean;
};

export const DEFAULT_BASEMAP: Basemap = "dark";
export const DEFAULT_SCENE_OPTIONS: SceneOptions = {
  debug: false,
  shadowOpacity: DEFAULT_SHADOW_OPACITY,
  spaceEnvironment: true,
};

export type MapLibreModule = typeof import("maplibre-gl");

export type MapSession = {
  map: MapLibreMap;
  maplibre: MapLibreModule;
  styleRevision: number;
};
