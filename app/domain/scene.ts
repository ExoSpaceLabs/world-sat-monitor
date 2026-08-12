export const INITIAL_VIEW = {
  center: [13, 18] as [number, number],
  zoom: 1.35,
  bearing: 0,
  pitch: 0,
};

export const ROTATION_DEGREES_PER_SECOND = 360 / (24 * 60 * 60);
export const ROTATION_RESUME_DELAY_MS = 4_000;
export const CAMERA_LOCK_MIN_ZOOM = 2.35;
export const AUTO_ROTATION_MAX_ZOOM = CAMERA_LOCK_MIN_ZOOM;
export const INITIAL_UTC = new Date("2000-01-01T12:00:00.000Z");

export type SceneOrientation = {
  /** Earth-fixed longitude currently under the camera. */
  longitude: number;
  /** Inertial longitude observed by the camera on the outer sky sphere. */
  inertialLongitude: number;
  /** Accumulated eastward Earth rotation since this scene was opened. */
  earthRotationDegrees: number;
  /** True when the camera co-rotates with Earth instead of watching it turn. */
  cameraLockedToEarth: boolean;
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

export function normalizeLongitude(longitude: number) {
  return (((longitude % 360) + 540) % 360) - 180;
}

export function shouldLockCameraToEarth({followSatellite, zoom}: Pick<RotationDecision, "followSatellite" | "zoom">) {
  return followSatellite || zoom >= CAMERA_LOCK_MIN_ZOOM;
}

export function shouldAutoRotate({
  followSatellite,
  isInteracting,
  isMoving,
  zoom,
}: RotationDecision) {
  return !shouldLockCameraToEarth({followSatellite, zoom}) && !isInteracting && !isMoving;
}

export function inertialCameraLongitude(earthLongitude: number, earthRotationDegrees: number) {
  return normalizeLongitude(earthLongitude + earthRotationDegrees);
}

export function toOuterSphereRotation(
  orientation: Pick<SceneOrientation, "inertialLongitude" | "latitude">,
) {
  const radians = Math.PI / 180;
  return {
    x: -orientation.latitude * radians,
    // The viewer is inside the sky sphere, so its horizontal sampling axis is
    // the inverse of the Earth-facing camera longitude.
    y: -orientation.inertialLongitude * radians,
    z: 0,
  };
}
