export const INITIAL_VIEW = {
  center: [13, 18] as [number, number],
  zoom: 1.35,
  bearing: 0,
  pitch: 0,
};

export const ROTATION_DEGREES_PER_SECOND = 0.6;
export const ROTATION_RESUME_DELAY_MS = 4_000;
export const AUTO_ROTATION_MAX_ZOOM = 2.35;
export const INITIAL_UTC = new Date("2000-01-01T12:00:00.000Z");

export type SceneOrientation = {
  longitude: number;
  latitude: number;
  zoom: number;
  bearing: number;
  pitch: number;
};

export type RotationDecision = {
  followSatellite: boolean;
  isInteracting: boolean;
  isMoving: boolean;
  zoom: number;
};

export function shouldAutoRotate({
  followSatellite,
  isInteracting,
  isMoving,
  zoom,
}: RotationDecision) {
  return !followSatellite && !isInteracting && !isMoving && zoom < AUTO_ROTATION_MAX_ZOOM;
}

export function toOuterSphereRotation(orientation: Pick<SceneOrientation, "longitude" | "latitude">) {
  const radians = Math.PI / 180;
  return {
    x: -orientation.latitude * radians,
    y: orientation.longitude * radians,
    z: 0,
  };
}
