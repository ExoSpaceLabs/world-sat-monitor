import {degreesLat, degreesLong, eciToGeodetic, gstime, json2satrec, propagate} from "satellite.js";

/**
 * Edge-specific on-demand SGP4 adapter. The Docker deployment retains its
 * Python SGP4 workers; both implementations accept CCSDS OMM/GP elements.
 * Never label the synthetic fixture as an authoritative satellite.
 */
export type Omm = Record<string, string | number>;
export type Geo = {lat_deg: number; lon_deg: number; altitude_km: number; heading_deg: number};

const RAD = Math.PI / 180;
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

export function syntheticOmm(at = new Date()): Omm {
  return {
    OBJECT_NAME: "WORLDSAT-01",
    OBJECT_ID: "2026-001A",
    EPOCH: at.toISOString().replace(/Z$/, ""),
    MEAN_MOTION: 15.2,
    ECCENTRICITY: 0.001,
    INCLINATION: 52,
    RA_OF_ASC_NODE: 55,
    ARG_OF_PERICENTER: 14,
    MEAN_ANOMALY: 105,
    EPHEMERIS_TYPE: 0,
    CLASSIFICATION_TYPE: "U",
    NORAD_CAT_ID: 999999999,
    ELEMENT_SET_NO: 1,
    REV_AT_EPOCH: 1,
    BSTAR: 0,
    MEAN_MOTION_DOT: 0,
    MEAN_MOTION_DDOT: 0,
  };
}

function geodetic(omm: Omm, at: Date) {
  const record = json2satrec(omm as Parameters<typeof json2satrec>[0]);
  if (record.error !== 0) throw new Error("Invalid orbital elements");
  const propagated = propagate(record, at);
  if (!propagated) throw new Error("SGP4 propagation failed");
  const geo = eciToGeodetic(propagated.position, gstime(at));
  return {lat_deg: degreesLat(geo.latitude), lon_deg: degreesLong(geo.longitude), altitude_km: geo.height};
}

export function positionAt(omm: Omm, at: Date): Geo {
  if (!Number.isFinite(at.getTime())) throw new Error("Invalid position time");
  const p = geodetic(omm, at);
  const q = geodetic(omm, new Date(at.getTime() + 5000));
  const latA = p.lat_deg * RAD, latB = q.lat_deg * RAD;
  const lonDelta = (q.lon_deg - p.lon_deg) * RAD;
  const north = Math.sin(lonDelta) * Math.cos(latB);
  const east = Math.cos(latA) * Math.sin(latB) - Math.sin(latA) * Math.cos(latB) * Math.cos(lonDelta);
  return {...p, heading_deg: (Math.atan2(north, east) / RAD + 360) % 360};
}

export function sampleTrack(omm: Omm, start: Date, end: Date, resolutionSeconds: number, center: Date) {
  const duration = end.getTime() - start.getTime();
  if (!Number.isFinite(duration) || duration <= 0 || duration > 15 * 24 * HOUR)
    throw new Error("Invalid track time range");
  const step = Math.max(10, Math.min(3600, Math.floor(resolutionSeconds))) * 1000;
  if (Math.ceil(duration / step) > 1000) throw new Error("Track exceeds Sites per-request sampling limit");
  const points = [];
  for (let timestamp = start.getTime(); timestamp <= end.getTime(); timestamp += step) {
    const p = geodetic(omm, new Date(timestamp));
    points.push({
      time: new Date(timestamp).toISOString(),
      lat_deg: p.lat_deg, lon_deg: p.lon_deg, altitude_km: p.altitude_km,
      segment: timestamp <= center.getTime() ? "history" : "prediction",
    });
  }
  return points;
}

export function sourceAge(omm: Omm, now = new Date()) {
  const epoch = new Date(String(omm.EPOCH) + (String(omm.EPOCH).endsWith("Z") ? "" : "Z"));
  const seconds = Math.abs(now.getTime() - epoch.getTime()) / 1000;
  return {epoch: epoch.toISOString(), age_seconds: seconds,
    freshness: seconds < 7200 ? "fresh" : seconds < 86400 ? "aging" : "stale"};
}
