export const INITIAL_VIEW = {
  center: [13, 18] as [number, number],
  zoom: 1.35,
  bearing: 0,
  pitch: 0,
};

export const ROTATION_DEGREES_PER_SECOND = 360 / (24 * 60 * 60);
export const CAMERA_LOCK_MIN_ZOOM = 2.35;
export const AUTO_ROTATION_MAX_ZOOM = CAMERA_LOCK_MIN_ZOOM;
export const INITIAL_UTC = new Date("2000-01-01T12:00:00.000Z");
export const MAPLIBRE_TILE_SIZE = 512;

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
  zoom: number;
};

export type Vector3 = {x: number; y: number; z: number};

export type CameraFrame = {
  /** Direction from Earth centre towards the camera. */
  outward: Vector3;
  /** Direction from the camera through Earth centre towards the far sky. */
  forward: Vector3;
  right: Vector3;
  up: Vector3;
};

export function normalizeLongitude(longitude: number) {
  return (((longitude % 360) + 540) % 360) - 180;
}

export function shouldLockCameraToEarth({followSatellite, zoom}: RotationDecision) {
  return followSatellite || zoom >= CAMERA_LOCK_MIN_ZOOM;
}

/**
 * Earth itself never pauses. This only decides whether an inertially fixed
 * camera should watch Earth move underneath it. Once zoomed in (or following
 * a satellite), the camera co-rotates with Earth instead.
 */
export function shouldAutoRotate(decision: RotationDecision) {
  return !shouldLockCameraToEarth(decision);
}

export function inertialCameraLongitude(earthLongitude: number, earthRotationDegrees: number) {
  return normalizeLongitude(earthLongitude + earthRotationDegrees);
}

export function directionFromCoordinates(longitude: number, latitude: number): Vector3 {
  const radians = Math.PI / 180;
  const longitudeRadians = longitude * radians;
  const latitudeRadians = latitude * radians;
  const latitudeRadius = Math.cos(latitudeRadians);
  return {
    x: Math.sin(longitudeRadians) * latitudeRadius,
    y: Math.sin(latitudeRadians),
    z: Math.cos(longitudeRadians) * latitudeRadius,
  };
}

export function createCameraFrame(
  orientation: Pick<SceneOrientation, "inertialLongitude" | "latitude"> &
    Partial<Pick<SceneOrientation, "bearing">>,
): CameraFrame {
  const outward = directionFromCoordinates(orientation.inertialLongitude, orientation.latitude);
  const longitudeRadians = orientation.inertialLongitude * Math.PI / 180;
  const east = {x: Math.cos(longitudeRadians), y: 0, z: -Math.sin(longitudeRadians)};
  const north = {
    x: -outward.y * Math.sin(longitudeRadians),
    y: Math.cos(orientation.latitude * Math.PI / 180),
    z: -outward.y * Math.cos(longitudeRadians),
  };
  const bearing = (orientation.bearing ?? 0) * Math.PI / 180;
  const right = {
    x: east.x * Math.cos(bearing) - north.x * Math.sin(bearing),
    y: east.y * Math.cos(bearing) - north.y * Math.sin(bearing),
    z: east.z * Math.cos(bearing) - north.z * Math.sin(bearing),
  };
  const up = {
    x: east.x * Math.sin(bearing) + north.x * Math.cos(bearing),
    y: east.y * Math.sin(bearing) + north.y * Math.cos(bearing),
    z: east.z * Math.sin(bearing) + north.z * Math.cos(bearing),
  };
  return {
    outward,
    forward: {x: -outward.x, y: -outward.y, z: -outward.z},
    right,
    up,
  };
}

/**
 * Legacy screen-space globe-radius helper retained for geometry tests and any
 * future diagnostics. Rendering the night side no longer depends on it.
 */
export function globeRadiusPixels(zoom: number, latitude = 0) {
  const worldSize = MAPLIBRE_TILE_SIZE * 2 ** zoom;
  const latitudeScale = Math.cos(latitude * Math.PI / 180);
  return worldSize / (2 * Math.PI * Math.max(0.08, latitudeScale));
}

export function dot(left: Vector3, right: Vector3) {
  return left.x * right.x + left.y * right.y + left.z * right.z;
}

export function toCameraSpace(direction: Vector3, frame: CameraFrame) {
  return {
    x: dot(direction, frame.right),
    y: dot(direction, frame.up),
    /** Positive when the direction points towards the visible Earth surface. */
    outward: dot(direction, frame.outward),
    /** Positive when the direction lies in front of the Earth-looking camera. */
    forward: dot(direction, frame.forward),
  };
}

export function cameraRayToInertial(
  ray: Vector3,
  frame: CameraFrame,
): Vector3 {
  const forwardScale = -ray.z;
  const x = frame.right.x * ray.x + frame.up.x * ray.y + frame.forward.x * forwardScale;
  const y = frame.right.y * ray.x + frame.up.y * ray.y + frame.forward.y * forwardScale;
  const z = frame.right.z * ray.x + frame.up.z * ray.y + frame.forward.z * forwardScale;
  const inverseLength = 1 / Math.hypot(x, y, z);
  return {x: x * inverseLength, y: y * inverseLength, z: z * inverseLength};
}
