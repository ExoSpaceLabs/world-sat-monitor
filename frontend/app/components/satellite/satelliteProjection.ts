import type {Map as MapLibreMap} from "maplibre-gl";
import {
  satelliteGlobePosition,
  type Satellite,
} from "../../domain/satellite";
import type {MapLibreModule} from "../../domain/types";

type ClipPoint = readonly [number, number, number, number];

export type SatelliteScreenPoint = {
  x: number;
  y: number;
};

function transformPoint(
  matrix: ArrayLike<number>,
  x: number,
  y: number,
  z: number,
): ClipPoint {
  return [
    matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12],
    matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13],
    matrix[2] * x + matrix[6] * y + matrix[10] * z + matrix[14],
    matrix[3] * x + matrix[7] * y + matrix[11] * z + matrix[15],
  ];
}

/**
 * Projects the satellite itself, including altitude, through MapLibre's active
 * camera transform. The DOM marker is otherwise anchored by Marker at the
 * nadir point, so SatelliteLayer applies the returned screen-space delta to
 * the marker visual.
 *
 * Globe rendering uses the same unit-sphere coordinates and globe MVP matrix
 * as MapLibre's `projectTileFor3D` path. Once MapLibre switches to its flat
 * Mercator transform, x/y are world pixels and z remains physical metres, as
 * expected by MercatorTransform.modelViewProjectionMatrix.
 */
export function projectSatelliteScreenPosition(
  map: MapLibreMap,
  maplibre: MapLibreModule,
  satellite: Satellite,
): SatelliteScreenPoint | null {
  const transform = map._camera.transform;
  const matrix = transform.modelViewProjectionMatrix;
  let clip: ClipPoint;

  if (transform.getClippingPlane()) {
    const [x, y, z] = satelliteGlobePosition(satellite);
    clip = transformPoint(matrix, x, y, z);
  } else {
    const coordinate = maplibre.MercatorCoordinate.fromLngLat({
      lng: satellite.lon,
      lat: satellite.lat,
    });
    clip = transformPoint(
      matrix,
      coordinate.x * transform.worldSize,
      coordinate.y * transform.worldSize,
      Math.max(0, satellite.altitude) * 1000,
    );
  }

  const w = clip[3];
  if (!Number.isFinite(w) || Math.abs(w) < 1e-9) return null;

  const normalizedX = clip[0] / w;
  const normalizedY = clip[1] / w;
  if (!Number.isFinite(normalizedX) || !Number.isFinite(normalizedY)) return null;

  return {
    x: (normalizedX * 0.5 + 0.5) * transform.width,
    y: (-normalizedY * 0.5 + 0.5) * transform.height,
  };
}
