import type {
  CatalogSearchResult,
  ManagedSatellite,
  Satellite,
  SatelliteCreateRequest,
  SatelliteTrackPoint,
} from "../domain/satellite";
import type {AppSettings} from "../domain/settings";

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

export function getAppSettings(): Promise<AppSettings> {
  return requestJson<AppSettings>("/api/v1/settings");
}

export function saveAppSettings(settings: AppSettings): Promise<AppSettings> {
  return requestJson<AppSettings>("/api/v1/settings", {
    method: "PUT",
    body: JSON.stringify(settings),
  });
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
