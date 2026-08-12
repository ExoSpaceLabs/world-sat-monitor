import assert from "node:assert/strict";
import test from "node:test";

import {
  AUTO_ROTATION_MAX_ZOOM,
  CAMERA_LOCK_MIN_ZOOM,
  ROTATION_DEGREES_PER_SECOND,
  inertialCameraLongitude,
  shouldAutoRotate,
  shouldLockCameraToEarth,
  toOuterSphereRotation,
} from "../app/domain/scene.ts";

test("outer sphere uses the corrected horizontal axis", () => {
  const rotation = toOuterSphereRotation({inertialLongitude: 30, latitude: 12});
  assert.ok(rotation.y < 0);
  assert.ok(rotation.x < 0);
  assert.ok(Math.abs(rotation.y + Math.PI / 6) < 1e-12);
  assert.ok(Math.abs(rotation.x + 12 * Math.PI / 180) < 1e-12);
});

test("wide-view Earth rotation leaves the inertial background fixed", () => {
  const initialEarthLongitude = 13;
  const earthRotation = 15;
  const rotatedEarthLongitude = initialEarthLongitude - earthRotation;
  assert.equal(
    inertialCameraLongitude(rotatedEarthLongitude, earthRotation),
    initialEarthLongitude,
  );
});

test("close view locks the camera to Earth and rotates the background", () => {
  assert.equal(inertialCameraLongitude(13, 15), 28);
  assert.equal(shouldLockCameraToEarth({followSatellite: false, zoom: CAMERA_LOCK_MIN_ZOOM}), true);
  assert.equal(shouldLockCameraToEarth({followSatellite: true, zoom: 1}), true);
});

test("Earth uses a real 24-hour rotation rate", () => {
  assert.equal(ROTATION_DEGREES_PER_SECOND * 24 * 60 * 60, 360);
});

test("automatic map rotation stops when the camera locks to Earth", () => {
  const base = {followSatellite: false, isInteracting: false, isMoving: false};
  assert.equal(shouldAutoRotate({...base, zoom: AUTO_ROTATION_MAX_ZOOM - 0.01}), true);
  assert.equal(shouldAutoRotate({...base, zoom: AUTO_ROTATION_MAX_ZOOM}), false);
  assert.equal(shouldAutoRotate({...base, zoom: AUTO_ROTATION_MAX_ZOOM + 1}), false);
  assert.equal(shouldAutoRotate({...base, zoom: 1, followSatellite: true}), false);
  assert.equal(shouldAutoRotate({...base, zoom: 1, isInteracting: true}), false);
});
