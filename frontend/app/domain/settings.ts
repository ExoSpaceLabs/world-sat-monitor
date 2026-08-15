import type {Basemap} from "./types";

export type PersistentMapSettings = {
  basemap: Basemap;
  space_environment: boolean;
  shadow_opacity: number;
  debug: boolean;
  time_scale: number;
};

export type OrbitTrackMode = "ground" | "orbit";

export type OrbitPathSettings = {
  enabled: boolean;
  mode: OrbitTrackMode;
  history_minutes: number;
  prediction_hours: number;
  resolution_seconds: number;
  refresh_seconds: number;
};

export type OrbitDisplaySettings = {
  direction_vector_enabled: boolean;
  position_update_ms: number;
  path: OrbitPathSettings;
};

export type AppSettings = {
  version: number;
  map: PersistentMapSettings;
  orbit: OrbitDisplaySettings;
};

export const DEFAULT_APP_SETTINGS: AppSettings = {
  version: 3,
  map: {
    basemap: "dark",
    space_environment: true,
    shadow_opacity: 0.7,
    debug: false,
    time_scale: 1,
  },
  orbit: {
    direction_vector_enabled: true,
    position_update_ms: 1000,
    path: {
      enabled: true,
      mode: "ground",
      history_minutes: 90,
      prediction_hours: 6,
      resolution_seconds: 60,
      refresh_seconds: 30,
    },
  },
};
