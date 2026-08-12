export type Satellite = {
  name: string;
  norad: string;
  lat: number;
  lon: number;
  altitude: number;
  heading: number;
};

export const MOCK_SATELLITE: Satellite = {
  name: "WORLDSAT-01",
  norad: "99001",
  lat: 18.4,
  lon: 32.7,
  altitude: 547,
  heading: 74,
};

export const EARTH_RADIUS_KM = 6371;

function coordinatesDot(
  leftLongitude: number,
  leftLatitude: number,
  rightLongitude: number,
  rightLatitude: number,
) {
  const radians = Math.PI / 180;
  const leftLat = leftLatitude * radians;
  const rightLat = rightLatitude * radians;
  const longitudeDelta = (leftLongitude - rightLongitude) * radians;
  return Math.sin(leftLat) * Math.sin(rightLat) +
    Math.cos(leftLat) * Math.cos(rightLat) * Math.cos(longitudeDelta);
}

/**
 * Determines whether Earth blocks a satellite, including the extra visibility
 * provided by altitude above the limb.
 */
export function isSatelliteOccluded(
  satellite: Pick<Satellite, "altitude" | "lat" | "lon">,
  camera: {latitude: number; longitude: number},
) {
  const cameraDot = coordinatesDot(
    satellite.lon,
    satellite.lat,
    camera.longitude,
    camera.latitude,
  );
  const orbitalRadius = EARTH_RADIUS_KM + Math.max(0, satellite.altitude);
  const earthRatio = EARTH_RADIUS_KM / orbitalRadius;
  const farSideLimb = -Math.sqrt(Math.max(0, 1 - earthRatio * earthRatio));
  return cameraDot < farSideLimb;
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
