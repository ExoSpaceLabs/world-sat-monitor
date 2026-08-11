import assert from "node:assert/strict";
import test from "node:test";

import {
  AUTO_ROTATION_MAX_ZOOM,
  shouldAutoRotate,
  toOuterSphereRotation,
} from "../app/domain/scene.ts";

test("outer sky sphere consumes the same Earth orientation without inverse longitude", () => {
  const rotation = toOuterSphereRotation({longitude: 30, latitude: 12});
  assert.ok(rotation.y > 0);
  assert.ok(rotation.x < 0);
  assert.ok(Math.abs(rotation.y - Math.PI / 6) < 1e-12);
  assert.ok(Math.abs(rotation.x + 12 * Math.PI / 180) < 1e-12);
});

test("automatic rotation stops when Earth fills the viewport", () => {
  const base = {followSatellite: false, isInteracting: false, isMoving: false};
  assert.equal(shouldAutoRotate({...base, zoom: AUTO_ROTATION_MAX_ZOOM - 0.01}), true);
  assert.equal(shouldAutoRotate({...base, zoom: AUTO_ROTATION_MAX_ZOOM}), false);
  assert.equal(shouldAutoRotate({...base, zoom: AUTO_ROTATION_MAX_ZOOM + 1}), false);
  assert.equal(shouldAutoRotate({...base, zoom: 1, followSatellite: true}), false);
  assert.equal(shouldAutoRotate({...base, zoom: 1, isInteracting: true}), false);
});
