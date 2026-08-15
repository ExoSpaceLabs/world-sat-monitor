import type {Basemap} from "./types";

export type PersistentMapSettings = {
  basemap: Basemap;
  space_environment: boolean;
  shadow_opacity: number;
  debug: boolean;
  time_scale: number;
};

export type SatellitePathSettings = {
  enabled: boolean;
  history_minutes: number;
  prediction_hours: number;
  resolution_seconds: number;
  refresh_seconds: number;
};

export type PersistentSatelliteSettings = {
  selected_norad_id: number;
  position_update_ms: number;
  path: SatellitePathSettings;
};

export type AppSettings = {
  version: number;
  map: PersistentMapSettings;
  satellite: PersistentSatelliteSettings;
};

export const DEFAULT_APP_SETTINGS: AppSettings = {
  version: 1,
  map: {
    basemap: "dark",
    space_environment: true,
    shadow_opacity: 0.7,
    debug: false,
    time_scale: 1,
  },
  satellite: {
    selected_norad_id: 99001,
    position_update_ms: 1000,
    path: {
      enabled: true,
      history_minutes: 90,
      prediction_hours: 6,
      resolution_seconds: 60,
      refresh_seconds: 30,
    },
  },
};
