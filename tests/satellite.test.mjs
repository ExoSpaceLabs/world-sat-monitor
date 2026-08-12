import assert from "node:assert/strict";
import test from "node:test";

import {
  EARTH_RADIUS_KM,
  isSatelliteOccluded,
} from "../app/domain/satellite.ts";

test("surface objects disappear at the Earth limb", () => {
  const camera = {longitude: 0, latitude: 0};
  assert.equal(isSatelliteOccluded({lon: 89, lat: 0, altitude: 0}, camera), false);
  assert.equal(isSatelliteOccluded({lon: 91, lat: 0, altitude: 0}, camera), true);
});

test("orbital altitude extends visibility beyond the surface limb", () => {
  const camera = {longitude: 0, latitude: 0};
  const lowEarthOrbit = {lon: 110, lat: 0, altitude: 547};
  assert.equal(isSatelliteOccluded(lowEarthOrbit, camera), false);
  assert.equal(isSatelliteOccluded({...lowEarthOrbit, lon: 120}, camera), true);
  assert.ok(EARTH_RADIUS_KM + lowEarthOrbit.altitude > EARTH_RADIUS_KM);
});

test("a satellite remains occluded across the anti-camera hemisphere", () => {
  const camera = {longitude: 12, latitude: 18};
  for (const longitude of [150, 170, -170, -150]) {
    assert.equal(
      isSatelliteOccluded({lon: longitude, lat: -18, altitude: 547}, camera),
      true,
    );
  }
});
