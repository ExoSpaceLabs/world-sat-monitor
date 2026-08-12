import assert from "node:assert/strict";
import test from "node:test";

import {
  AUTO_ROTATION_MAX_ZOOM,
  CAMERA_LOCK_MIN_ZOOM,
  ROTATION_DEGREES_PER_SECOND,
  cameraRayToInertial,
  createCameraFrame,
  directionFromCoordinates,
  globeRadiusPixels,
  inertialCameraLongitude,
  shouldAutoRotate,
  shouldLockCameraToEarth,
  toCameraSpace,
} from "../app/domain/scene.ts";

test("camera movement samples a fixed outer sphere on both axes", () => {
  const frame = createCameraFrame({inertialLongitude: 30, latitude: 20});
  const centerRay = cameraRayToInertial({x: 0, y: 0, z: -1}, frame);
  assert.ok(Math.abs(centerRay.x + frame.outward.x) < 1e-12);
  assert.ok(Math.abs(centerRay.y + frame.outward.y) < 1e-12);
  assert.ok(Math.abs(centerRay.z + frame.outward.z) < 1e-12);
  assert.ok(centerRay.y < 0);
});

test("Sun and shadow hemispheres are opposite in the camera frame", () => {
  const frame = createCameraFrame({inertialLongitude: 0, latitude: 0});
  const nearSideSun = toCameraSpace(directionFromCoordinates(0, 0), frame);
  const farSideSun = toCameraSpace(directionFromCoordinates(180, 0), frame);
  assert.ok(nearSideSun.outward > 0.999);
  assert.ok(farSideSun.outward < -0.999);
  assert.ok(nearSideSun.forward < 0);
  assert.ok(farSideSun.forward > 0);
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

test("shadow sphere radius follows MapLibre latitude scaling", () => {
  const equator = globeRadiusPixels(0, 0);
  assert.ok(Math.abs(equator - 512 / (2 * Math.PI)) < 1e-12);
  assert.equal(globeRadiusPixels(2, 0), equator * 4);
  assert.ok(Math.abs(globeRadiusPixels(0, 60) - equator * 2) < 1e-12);
  assert.equal(globeRadiusPixels(0, -60), globeRadiusPixels(0, 60));
  assert.ok(Number.isFinite(globeRadiusPixels(0, 90)));
});

test("camera bearing rotates its screen axes without changing its outward direction", () => {
  const northUp = createCameraFrame({inertialLongitude: 30, latitude: 20, bearing: 0});
  const eastUp = createCameraFrame({inertialLongitude: 30, latitude: 20, bearing: 90});
  assert.deepEqual(eastUp.outward, northUp.outward);
  assert.ok(Math.abs(eastUp.right.x + northUp.up.x) < 1e-12);
  assert.ok(Math.abs(eastUp.right.y + northUp.up.y) < 1e-12);
  assert.ok(Math.abs(eastUp.right.z + northUp.up.z) < 1e-12);
});

test("automatic map rotation stops when the camera locks to Earth", () => {
  const base = {followSatellite: false, isInteracting: false, isMoving: false};
  assert.equal(shouldAutoRotate({...base, zoom: AUTO_ROTATION_MAX_ZOOM - 0.01}), true);
  assert.equal(shouldAutoRotate({...base, zoom: AUTO_ROTATION_MAX_ZOOM}), false);
  assert.equal(shouldAutoRotate({...base, zoom: AUTO_ROTATION_MAX_ZOOM + 1}), false);
  assert.equal(shouldAutoRotate({...base, zoom: 1, followSatellite: true}), false);
  assert.equal(shouldAutoRotate({...base, zoom: 1, isInteracting: true}), false);
});
