import type {Map as MapLibreMap} from "maplibre-gl";

const DEG = Math.PI / 180;
const SAMPLE_DISTANCE_DEGREES = 70;
const SAMPLE_BEARINGS = [0, 45, 90, 135, 180, 225, 270, 315] as const;

export function destination(
  longitude: number,
  latitude: number,
  bearingDegrees: number,
  distanceDegrees: number,
): [number, number] {
  const latitude1 = latitude * DEG;
  const longitude1 = longitude * DEG;
  const bearing = bearingDegrees * DEG;
  const distance = distanceDegrees * DEG;
  const latitude2 = Math.asin(
    Math.sin(latitude1) * Math.cos(distance)
      + Math.cos(latitude1) * Math.sin(distance) * Math.cos(bearing),
  );
  const longitude2 = longitude1 + Math.atan2(
    Math.sin(bearing) * Math.sin(distance) * Math.cos(latitude1),
    Math.cos(distance) - Math.sin(latitude1) * Math.sin(latitude2),
  );
  return [longitude2 / DEG, latitude2 / DEG];
}

/**
 * Estimates the actual rendered globe radius from MapLibre's own projection.
 * Sampling great-circle points avoids duplicating MapLibre's zoom/latitude
 * globe math, which is exactly what caused the oversized shadow regression.
 */
export function estimateRenderedGlobeRadius(map: MapLibreMap) {
  const center = map.getCenter();
  const centerPoint = map.project(center);
  const divisor = Math.sin(SAMPLE_DISTANCE_DEGREES * DEG);
  const canvas = map.getCanvas();
  const sanityLimit = Math.max(canvas.clientWidth, canvas.clientHeight) * 8;

  const samples = SAMPLE_BEARINGS
    .map((bearing) => map.project(destination(
      center.lng,
      center.lat,
      bearing,
      SAMPLE_DISTANCE_DEGREES,
    )))
    .map((point) => Math.hypot(point.x - centerPoint.x, point.y - centerPoint.y) / divisor)
    .filter((radius) => Number.isFinite(radius) && radius > 0 && radius < sanityLimit)
    .sort((left, right) => left - right);

  if (samples.length === 0) {
    return Math.min(canvas.clientWidth, canvas.clientHeight) / 2;
  }
  return samples[Math.floor(samples.length / 2)];
}
