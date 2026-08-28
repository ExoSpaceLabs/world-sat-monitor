import type {Basemap} from "./types";

export const DEFAULT_THEMED_MAP_STYLE = {
  baseColor: "#041018",
  contrast: 0.18,
} as const;

export type PersistentMapSettings = {
  basemap: Basemap;
  themed_base_color: string;
  themed_contrast: number;
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

export type GroupOrbitDisplaySettings = {
  position_update_ms: number;
  prediction_hours: number;
  step_seconds: number;
  refresh_seconds: number;
};

export type AppSettings = {
  version: number;
  map: PersistentMapSettings;
  orbit: OrbitDisplaySettings;
  group_orbit: GroupOrbitDisplaySettings;
};

export const DEFAULT_APP_SETTINGS: AppSettings = {
  version: 6,
  map: {
    basemap: "dark",
    themed_base_color: DEFAULT_THEMED_MAP_STYLE.baseColor,
    themed_contrast: DEFAULT_THEMED_MAP_STYLE.contrast,
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
  group_orbit: {
    position_update_ms: 2000,
    prediction_hours: 3,
    step_seconds: 120,
    refresh_seconds: 60,
  },
};
