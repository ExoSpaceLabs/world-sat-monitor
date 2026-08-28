export type Satellite = {
  name: string;
  norad: string;
  lat: number;
  lon: number;
  altitude: number;
  heading: number;
};

export type ManagedSatellite = {
  id: number;
  name: string;
  active: boolean;
  object_type: string;
  provider_preference: string | null;
  metadata: Record<string, unknown>;
  identifiers: Record<string, string>;
  norad_id: string | null;
  created_at: string;
  updated_at: string;
};

export type SatelliteCreateRequest = {
  name: string;
  active?: boolean;
  object_type?: string;
  provider_preference?: string | null;
  metadata?: Record<string, unknown>;
  identifiers?: Array<{namespace: string; value: string}>;
};

export type SatelliteTrackPoint = {
  time: string;
  lat: number;
  lon: number;
  altitude: number;
  segment: "history" | "prediction";
};

export type GlobeVector = readonly [number, number, number];

export const MOCK_SATELLITE: Satellite = {
  name: "WORLDSAT-01",
  norad: "999999999",
  lat: 18.4,
  lon: 32.7,
  altitude: 547,
  heading: 74,
};

export const EARTH_RADIUS_KM = 6371;
const RAY_EPSILON = 1e-7;

function dot(left: GlobeVector, right: GlobeVector) {
  return left[0] * right[0] + left[1] * right[1] + left[2] * right[2];
}

/**
 * Converts geodetic longitude/latitude and altitude into MapLibre globe space.
 * MapLibre's unit sphere uses X toward +90° longitude, Y toward the north pole,
 * and Z toward 0° longitude.
 */
export function satelliteGlobePosition(
  satellite: Pick<Satellite, "altitude" | "lat" | "lon">,
): GlobeVector {
  const longitude = satellite.lon * Math.PI / 180;
  const latitude = satellite.lat * Math.PI / 180;
  const radius = 1 + Math.max(0, satellite.altitude) / EARTH_RADIUS_KM;
  const latitudeRadius = Math.cos(latitude) * radius;
  return [
    Math.sin(longitude) * latitudeRadius,
    Math.sin(latitude) * radius,
    Math.cos(longitude) * latitudeRadius,
  ];
}

/**
 * Returns true when the finite camera-to-satellite segment intersects Earth.
 */
export function isSatelliteOccluded(
  satellite: Pick<Satellite, "altitude" | "lat" | "lon">,
  cameraPosition: GlobeVector,
) {
  const satellitePosition = satelliteGlobePosition(satellite);
  const direction: GlobeVector = [
    satellitePosition[0] - cameraPosition[0],
    satellitePosition[1] - cameraPosition[1],
    satellitePosition[2] - cameraPosition[2],
  ];
  const a = dot(direction, direction);
  if (a <= RAY_EPSILON) return false;

  const b = 2 * dot(cameraPosition, direction);
  const c = dot(cameraPosition, cameraPosition) - 1;
  const discriminant = b * b - 4 * a * c;
  if (discriminant <= 0) return false;

  const root = Math.sqrt(discriminant);
  const inverseDenominator = 1 / (2 * a);
  const near = (-b - root) * inverseDenominator;
  const far = (-b + root) * inverseDenominator;
  return (near > RAY_EPSILON && near < 1 - RAY_EPSILON)
    || (far > RAY_EPSILON && far < 1 - RAY_EPSILON);
}

export function headingEndpoint(
  lon: number,
  lat: number,
  heading: number,
  distanceKm: number,
): [number, number] {
  const angularDistance = distanceKm / EARTH_RADIUS_KM;
  const bearing = heading * Math.PI / 180;
  const lat1 = lat * Math.PI / 180;
  const lon1 = lon * Math.PI / 180;
  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(angularDistance) +
    Math.cos(lat1) * Math.sin(angularDistance) * Math.cos(bearing),
  );
  const lon2 = lon1 + Math.atan2(
    Math.sin(bearing) * Math.sin(angularDistance) * Math.cos(lat1),
    Math.cos(angularDistance) - Math.sin(lat1) * Math.sin(lat2),
  );
  return [lon2 * 180 / Math.PI, lat2 * 180 / Math.PI];
}
