import type {
  CatalogSearchResult,
  GroupPosition,
  ManagedSatellite,
  Satellite,
  SatelliteCreateRequest,
  SatelliteGroup,
  SatelliteGroupCreateRequest,
  SatelliteGroupMember,
  SatelliteTrackPoint,
} from "../domain/satellite";
import type {AppSettings, GroupOrbitDisplaySettings} from "../domain/settings";

const DEFAULT_APP_SETTINGS: AppSettings = {
  version: 6,
  map: {
    basemap: "dark",
    themed_base_color: "#041018",
    themed_contrast: 0.18,
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

type PositionResponse = {
  satellite: {id: number; norad_id: string | null; name: string; active: boolean};
  at: string;
  position: {lat_deg: number; lon_deg: number; altitude_km: number; heading_deg: number};
  interpolated: boolean;
  source: {is_mock: boolean; step_seconds: number; source_element_set_id: number | null};
};

type TrackResponse = {
  resolution_seconds: number;
  source: {is_mock: boolean; source_element_set_id: number | null};
  points: Array<{time: string; lat_deg: number; lon_deg: number; altitude_km: number; segment: "history" | "prediction"}>;
};

type SatelliteListResponse = {satellites: ManagedSatellite[]};
type CatalogSearchResponse = {query: string; provider: string; results: CatalogSearchResult[]};
type GroupListResponse = {groups: SatelliteGroup[]};
type GroupMembersResponse = {members: SatelliteGroupMember[]};
type GroupPositionsResponse = {group: SatelliteGroup; generated_at: string; positions: GroupPosition[]};
type GroupDisplayResponse = {
  group: SatelliteGroup;
  display: {requested_until: string; prediction_hours: number; step_seconds: number};
};

type AppSettingsWire = {
  version?: number;
  map?: Partial<AppSettings["map"]> & {themed_water_color?: string; themed_land_color?: string};
  orbit?: Partial<Omit<AppSettings["orbit"], "path">> & {path?: Partial<AppSettings["orbit"]["path"]>};
  group_orbit?: Partial<AppSettings["group_orbit"]>;
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
  const groupOrbit = payload.group_orbit ?? {};
  const baseColorCandidate = map.themed_base_color ?? map.themed_water_color;
  const baseColor = typeof baseColorCandidate === "string" && /^#[0-9a-f]{6}$/i.test(baseColorCandidate)
    ? baseColorCandidate
    : DEFAULT_APP_SETTINGS.map.themed_base_color;
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
    group_orbit: {
      position_update_ms: typeof groupOrbit.position_update_ms === "number" && Number.isFinite(groupOrbit.position_update_ms) ? groupOrbit.position_update_ms : DEFAULT_APP_SETTINGS.group_orbit.position_update_ms,
      prediction_hours: typeof groupOrbit.prediction_hours === "number" && Number.isFinite(groupOrbit.prediction_hours) ? groupOrbit.prediction_hours : DEFAULT_APP_SETTINGS.group_orbit.prediction_hours,
      step_seconds: typeof groupOrbit.step_seconds === "number" && Number.isFinite(groupOrbit.step_seconds) ? groupOrbit.step_seconds : DEFAULT_APP_SETTINGS.group_orbit.step_seconds,
      refresh_seconds: typeof groupOrbit.refresh_seconds === "number" && Number.isFinite(groupOrbit.refresh_seconds) ? groupOrbit.refresh_seconds : DEFAULT_APP_SETTINGS.group_orbit.refresh_seconds,
    },
  };
}

export async function getAppSettings(): Promise<AppSettings> {
  return normalizeAppSettings(await requestJson<AppSettingsWire>("/api/v1/settings"));
}

export async function saveAppSettings(settings: AppSettings): Promise<AppSettings> {
  const payload = await requestJson<AppSettingsWire>("/api/v1/settings", {method: "PUT", body: JSON.stringify(settings)});
  return normalizeAppSettings(payload);
}

export async function listManagedSatellites(active?: boolean): Promise<ManagedSatellite[]> {
  const suffix = active === undefined ? "" : `?active=${active}`;
  return (await requestJson<SatelliteListResponse>(`/api/v1/satellites${suffix}`)).satellites;
}

export async function searchSatelliteCatalog(query: string, provider = "celestrak"): Promise<CatalogSearchResult[]> {
  const params = new URLSearchParams({q: query, provider});
  return (await requestJson<CatalogSearchResponse>(`/api/v1/catalog/search?${params.toString()}`)).results;
}

export function createManagedSatellite(value: SatelliteCreateRequest): Promise<ManagedSatellite> {
  return requestJson<ManagedSatellite>("/api/v1/satellites", {method: "POST", body: JSON.stringify(value)});
}

export function updateManagedSatellite(satelliteId: number, value: Partial<Omit<SatelliteCreateRequest, "active">>): Promise<ManagedSatellite> {
  return requestJson<ManagedSatellite>(`/api/v1/satellites/${satelliteId}`, {method: "PATCH", body: JSON.stringify(value)});
}

export function activateManagedSatellite(satelliteId: number): Promise<ManagedSatellite> {
  return requestJson<ManagedSatellite>(`/api/v1/satellites/${satelliteId}/activate`, {method: "POST"});
}

export function deactivateManagedSatellite(satelliteId: number): Promise<ManagedSatellite> {
  return requestJson<ManagedSatellite>(`/api/v1/satellites/${satelliteId}/deactivate`, {method: "POST"});
}

export function deleteManagedSatellite(satelliteId: number): Promise<void> {
  return requestJson<void>(`/api/v1/satellites/${satelliteId}`, {method: "DELETE"});
}

export async function listSatelliteGroups(): Promise<SatelliteGroup[]> {
  return (await requestJson<GroupListResponse>("/api/v1/groups")).groups;
}

export function createSatelliteGroup(value: SatelliteGroupCreateRequest): Promise<SatelliteGroup> {
  return requestJson<SatelliteGroup>("/api/v1/groups", {method: "POST", body: JSON.stringify(value)});
}

export function updateSatelliteGroup(groupId: number, value: Partial<SatelliteGroupCreateRequest>): Promise<SatelliteGroup> {
  return requestJson<SatelliteGroup>(`/api/v1/groups/${groupId}`, {method: "PATCH", body: JSON.stringify(value)});
}

export function deleteSatelliteGroup(groupId: number): Promise<void> {
  return requestJson<void>(`/api/v1/groups/${groupId}`, {method: "DELETE"});
}

export async function listSatelliteGroupMembers(groupId: number): Promise<SatelliteGroupMember[]> {
  return (await requestJson<GroupMembersResponse>(`/api/v1/groups/${groupId}/members`)).members;
}

export function addSatelliteGroupMember(groupId: number, satelliteId: number): Promise<SatelliteGroupMember> {
  return requestJson<SatelliteGroupMember>(`/api/v1/groups/${groupId}/members`, {method: "POST", body: JSON.stringify({satellite_id: satelliteId})});
}

export function removeSatelliteGroupMember(groupId: number, satelliteId: number): Promise<void> {
  return requestJson<void>(`/api/v1/groups/${groupId}/members/${satelliteId}`, {method: "DELETE"});
}

export async function getSatelliteGroupPositions(groupId: number, at: Date): Promise<GroupPosition[]> {
  const params = new URLSearchParams({active_only: "false", at: at.toISOString()});
  return (await requestJson<GroupPositionsResponse>(`/api/v1/groups/${groupId}/positions?${params.toString()}`)).positions;
}

export function requestSatelliteGroupDisplay(groupId: number, settings: GroupOrbitDisplaySettings): Promise<GroupDisplayResponse> {
  return requestJson<GroupDisplayResponse>(`/api/v1/groups/${groupId}/display`, {
    method: "POST",
    body: JSON.stringify({
      prediction_hours: settings.prediction_hours,
      step_seconds: settings.step_seconds,
      lease_seconds: 1800,
    }),
  });
}

export function releaseSatelliteGroupDisplay(groupId: number): Promise<void> {
  return requestJson<void>(`/api/v1/groups/${groupId}/display`, {method: "DELETE"});
}

export async function getSatellitePosition(noradId: number | string, at: Date): Promise<{satellite: Satellite; isMock: boolean; interpolated: boolean}> {
  const payload = await requestJson<PositionResponse>(`/api/v1/satellites/${encodeURIComponent(String(noradId))}/position?at=${encodeURIComponent(at.toISOString())}`);
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
  const params = new URLSearchParams({start: start.toISOString(), end: end.toISOString(), resolution_seconds: String(resolutionSeconds)});
  const payload = await requestJson<TrackResponse>(`/api/v1/satellites/${encodeURIComponent(String(noradId))}/track?${params.toString()}`);
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
