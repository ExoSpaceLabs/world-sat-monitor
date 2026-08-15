import assert from "node:assert/strict";
import test from "node:test";

import {
  EARTH_RADIUS_KM,
  isSatelliteOccluded,
  satelliteGlobePosition,
} from "../app/domain/satellite.ts";

test("satellite position uses MapLibre globe axes and orbital radius", () => {
  const position = satelliteGlobePosition({lon: 0, lat: 0, altitude: 547});
  const expectedRadius = (EARTH_RADIUS_KM + 547) / EARTH_RADIUS_KM;
  assert.ok(Math.abs(position[0]) < 1e-12);
  assert.ok(Math.abs(position[1]) < 1e-12);
  assert.ok(Math.abs(position[2] - expectedRadius) < 1e-12);
});

test("Earth blocks the finite camera-to-satellite segment", () => {
  const camera = [0, 0, 10];
  assert.equal(
    isSatelliteOccluded({lon: 0, lat: 0, altitude: 547}, camera),
    false,
  );
  assert.equal(
    isSatelliteOccluded({lon: 180, lat: 0, altitude: 547}, camera),
    true,
  );
});

test("orbital altitude remains visible beyond the surface horizon", () => {
  const camera = [0, 0, 10];
  assert.equal(
    isSatelliteOccluded({lon: 100, lat: 0, altitude: 0}, camera),
    true,
  );
  assert.equal(
    isSatelliteOccluded({lon: 100, lat: 0, altitude: 547}, camera),
    false,
  );
});

test("closer camera occludes a LEO satellite earlier than a distant camera", () => {
  const satellite = {lon: 100, lat: 0, altitude: 547};
  assert.equal(isSatelliteOccluded(satellite, [0, 0, 10]), false);
  assert.equal(isSatelliteOccluded(satellite, [0, 0, 2]), true);
});

test("tangent and intersections beyond the satellite do not occlude", () => {
  assert.equal(
    isSatelliteOccluded({lon: 0, lat: 0, altitude: 547}, [0, 0, 1.5]),
    false,
  );
  assert.equal(
    isSatelliteOccluded({lon: 90, lat: 0, altitude: 547}, [0, 0, 10]),
    false,
  );
});
