import type {Satellite, SatelliteTrackPoint} from "../domain/satellite";
import type {AppSettings} from "../domain/settings";

type PositionResponse = {
  satellite: {norad_id: number; name: string};
  at: string;
  position: {
    lat_deg: number;
    lon_deg: number;
    altitude_km: number;
    heading_deg: number;
  };
  interpolated: boolean;
  source: {is_mock: boolean; step_seconds: number};
};

type TrackResponse = {
  resolution_seconds: number;
  source: {is_mock: boolean};
  points: Array<{
    time: string;
    lat_deg: number;
    lon_deg: number;
    altitude_km: number;
    segment: "history" | "prediction";
  }>;
};

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    cache: "no-store",
    ...init,
    headers: {"Content-Type": "application/json"},
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`${response.status} ${response.statusText}: ${detail}`);
  }
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

export async function getSatellitePosition(
  noradId: number,
  at: Date,
): Promise<{satellite: Satellite; isMock: boolean; interpolated: boolean}> {
  const payload = await requestJson<PositionResponse>(
    `/api/v1/satellites/${noradId}/position?at=${encodeURIComponent(at.toISOString())}`,
  );
  return {
    satellite: {
      name: payload.satellite.name,
      norad: String(payload.satellite.norad_id),
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
  noradId: number,
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
    `/api/v1/satellites/${noradId}/track?${params.toString()}`,
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
