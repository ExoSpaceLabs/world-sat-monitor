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

export function headingEndpoint(
  lon: number,
  lat: number,
  heading: number,
  distanceKm: number,
): [number, number] {
  const angularDistance = distanceKm / 6371;
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
