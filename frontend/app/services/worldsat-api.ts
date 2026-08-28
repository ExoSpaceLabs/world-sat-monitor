import type {
  CatalogSearchResult,
  ManagedSatellite,
  Satellite,
  SatelliteCreateRequest,
  SatelliteTrackPoint,
} from "../domain/satellite";
import {DEFAULT_APP_SETTINGS, type AppSettings} from "../domain/settings";

type PositionResponse = {
  satellite: {id: number; norad_id: string | null; name: string; active: boolean};
  at: string;
  position: {
    lat_deg: number;
    lon_deg: number;
    altitude_km: number;
    heading_deg: number;
  };
  interpolated: boolean;
  source: {is_mock: boolean; step_seconds: number; source_element_set_id: number | null};
};

type TrackResponse = {
  resolution_seconds: number;
  source: {is_mock: boolean; source_element_set_id: number | null};
  points: Array<{
    time: string;
    lat_deg: number;
    lon_deg: number;
    altitude_km: number;
    segment: "history" | "prediction";
  }>;
};

type SatelliteListResponse = {
  satellites: ManagedSatellite[];
};

type CatalogSearchResponse = {
  query: string;
  provider: string;
  results: CatalogSearchResult[];
};

type AppSettingsWire = {
  version?: number;
  map?: Partial<AppSettings["map"]> & {
    themed_water_color?: string;
    themed_land_color?: string;
  };
  orbit?: Partial<Omit<AppSettings["orbit"], "path">> & {
    path?: Partial<AppSettings["orbit"]["path"]>;
  };
};

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    cache: "no-store",
    ...init,
    headers: {"Content-Type": "application/json", ...(init?.headers ?? {})},
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`${response.status} ${response.statusText}: ${detail}`);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

function normalizeAppSettings(payload: AppSettingsWire): AppSettings {
  const map = payload.map ?? {};
  const orbit = payload.orbit ?? {};
  const path = orbit.path ?? {};
  const baseColorCandidate = map.themed_base_color ?? map.themed_water_color;
  const baseColor = typeof baseColorCandidate === "string" && /^#[0-9a-f]{6}$/i.test(baseColorCandidate)
    ? baseColorCandidate
    : DEFAULT_APP_SETTINGS.map.themed_base_color;
  // Contrast is intentionally no longer user-configurable. Keep the persisted
  // wire field for compatibility, but normalize rendering back to the stable default.
  const contrast = DEFAULT_APP_SETTINGS.map.themed_contrast;
  const basemap = map.basemap === "dark" || map.basemap === "street" || map.basemap === "satellite"
    ? map.basemap
    : DEFAULT_APP_SETTINGS.map.basemap;

  return {
    version: DEFAULT_APP_SETTINGS.version,
    map: {
      basemap,
      themed_base_color: baseColor,
      themed_contrast: contrast,
      space_environment: typeof map.space_environment === "boolean" ? map.space_environment : DEFAULT_APP_SETTINGS.map.space_environment,
      shadow_opacity: typeof map.shadow_opacity === "number" && Number.isFinite(map.shadow_opacity) ? map.shadow_opacity : DEFAULT_APP_SETTINGS.map.shadow_opacity,
      debug: typeof map.debug === "boolean" ? map.debug : DEFAULT_APP_SETTINGS.map.debug,
      time_scale: typeof map.time_scale === "number" && Number.isFinite(map.time_scale) ? map.time_scale : DEFAULT_APP_SETTINGS.map.time_scale,
    },
    orbit: {
      direction_vector_enabled: typeof orbit.direction_vector_enabled === "boolean" ? orbit.direction_vector_enabled : DEFAULT_APP_SETTINGS.orbit.direction_vector_enabled,
      position_update_ms: typeof orbit.position_update_ms === "number" && Number.isFinite(orbit.position_update_ms) ? orbit.position_update_ms : DEFAULT_APP_SETTINGS.orbit.position_update_ms,
      path: {
        enabled: typeof path.enabled === "boolean" ? path.enabled : DEFAULT_APP_SETTINGS.orbit.path.enabled,
        mode: path.mode === "ground" || path.mode === "orbit" ? path.mode : DEFAULT_APP_SETTINGS.orbit.path.mode,
        history_minutes: typeof path.history_minutes === "number" && Number.isFinite(path.history_minutes) ? path.history_minutes : DEFAULT_APP_SETTINGS.orbit.path.history_minutes,
        prediction_hours: typeof path.prediction_hours === "number" && Number.isFinite(path.prediction_hours) ? path.prediction_hours : DEFAULT_APP_SETTINGS.orbit.path.prediction_hours,
        resolution_seconds: typeof path.resolution_seconds === "number" && Number.isFinite(path.resolution_seconds) ? path.resolution_seconds : DEFAULT_APP_SETTINGS.orbit.path.resolution_seconds,
        refresh_seconds: typeof path.refresh_seconds === "number" && Number.isFinite(path.refresh_seconds) ? path.refresh_seconds : DEFAULT_APP_SETTINGS.orbit.path.refresh_seconds,
      },
    },
  };
}

export async function getAppSettings(): Promise<AppSettings> {
  return normalizeAppSettings(await requestJson<AppSettingsWire>("/api/v1/settings"));
}

export async function saveAppSettings(settings: AppSettings): Promise<AppSettings> {
  const payload = await requestJson<AppSettingsWire>("/api/v1/settings", {
    method: "PUT",
    body: JSON.stringify(settings),
  });
  return normalizeAppSettings(payload);
}

export async function listManagedSatellites(active?: boolean): Promise<ManagedSatellite[]> {
  const suffix = active === undefined ? "" : `?active=${active}`;
  const payload = await requestJson<SatelliteListResponse>(`/api/v1/satellites${suffix}`);
  return payload.satellites;
}

export async function searchSatelliteCatalog(
  query: string,
  provider = "celestrak",
): Promise<CatalogSearchResult[]> {
  const params = new URLSearchParams({q: query, provider});
  const payload = await requestJson<CatalogSearchResponse>(`/api/v1/catalog/search?${params.toString()}`);
  return payload.results;
}

export function createManagedSatellite(value: SatelliteCreateRequest): Promise<ManagedSatellite> {
  return requestJson<ManagedSatellite>("/api/v1/satellites", {
    method: "POST",
    body: JSON.stringify(value),
  });
}

export function updateManagedSatellite(
  satelliteId: number,
  value: Partial<Omit<SatelliteCreateRequest, "active">>,
): Promise<ManagedSatellite> {
  return requestJson<ManagedSatellite>(`/api/v1/satellites/${satelliteId}`, {
    method: "PATCH",
    body: JSON.stringify(value),
  });
}

export function activateManagedSatellite(satelliteId: number): Promise<ManagedSatellite> {
  return requestJson<ManagedSatellite>(`/api/v1/satellites/${satelliteId}/activate`, {
    method: "POST",
  });
}

export function deactivateManagedSatellite(satelliteId: number): Promise<ManagedSatellite> {
  return requestJson<ManagedSatellite>(`/api/v1/satellites/${satelliteId}/deactivate`, {
    method: "POST",
  });
}

export function deleteManagedSatellite(satelliteId: number): Promise<void> {
  return requestJson<void>(`/api/v1/satellites/${satelliteId}`, {method: "DELETE"});
}

export async function getSatellitePosition(
  noradId: number | string,
  at: Date,
): Promise<{satellite: Satellite; isMock: boolean; interpolated: boolean}> {
  const payload = await requestJson<PositionResponse>(
    `/api/v1/satellites/${encodeURIComponent(String(noradId))}/position?at=${encodeURIComponent(at.toISOString())}`,
  );
  return {
    satellite: {
      name: payload.satellite.name,
      norad: payload.satellite.norad_id ?? "",
      lat: payload.position.lat_deg,
      lon: payload.position.lon_deg,
      altitude: payload.position.altitude_km,
      heading: payload.position.heading_deg,
    },
    isMock: payload.source.is_mock,
    interpolated: payload.interpolated,
  };
}

export async function getSatelliteTrack(
  noradId: number | string,
  start: Date,
  end: Date,
  resolutionSeconds: number,
  center: Date,
): Promise<{points: SatelliteTrackPoint[]; resolutionSeconds: number; isMock: boolean}> {
  const params = new URLSearchParams({
    start: start.toISOString(),
    end: end.toISOString(),
    resolution_seconds: String(resolutionSeconds),
  });
  const payload = await requestJson<TrackResponse>(
    `/api/v1/satellites/${encodeURIComponent(String(noradId))}/track?${params.toString()}`,
  );
  const centerMs = center.getTime();
  return {
    resolutionSeconds: payload.resolution_seconds,
    isMock: payload.source.is_mock,
    points: payload.points.map((point) => ({
      time: point.time,
      lat: point.lat_deg,
      lon: point.lon_deg,
      altitude: point.altitude_km,
      segment: new Date(point.time).getTime() <= centerMs ? "history" : "prediction",
    })),
  };
}
