import assert from "node:assert/strict";
import test from "node:test";

import {
  createNightRegion,
  getSolarState,
  solarElevation,
} from "../app/solar.ts";

function antipodalLongitude(longitude) {
  return longitude >= 0 ? longitude - 180 : longitude + 180;
}

test("solar state places the Sun above the calculated subsolar point", () => {
  const dates = [
    new Date("2026-03-20T12:00:00.000Z"),
    new Date("2026-06-21T12:00:00.000Z"),
    new Date("2026-12-21T12:00:00.000Z"),
  ];

  for (const date of dates) {
    const sun = getSolarState(date);
    assert.ok(Math.abs(sun.latitude) <= 23.5);
    assert.ok(sun.longitude >= -180 && sun.longitude < 180);
    assert.ok(solarElevation(sun.latitude, sun.longitude, sun) > 89.9);
    assert.ok(
      solarElevation(-sun.latitude, antipodalLongitude(sun.longitude), sun) < -89.9,
    );
  }
});

test("night geometry is finite, closed, and split at the antimeridian", () => {
  const night = createNightRegion(new Date("2026-08-11T12:00:00.000Z"));

  assert.equal(night.geometry.type, "MultiPolygon");
  assert.equal(night.geometry.coordinates.length, 2);

  for (const polygon of night.geometry.coordinates) {
    const ring = polygon[0];
    assert.ok(ring.length > 90);
    assert.deepEqual(ring[0], ring.at(-1));
    for (const coordinate of ring) {
      assert.equal(coordinate.length, 2);
      assert.ok(coordinate.every(Number.isFinite));
      assert.ok(coordinate[0] >= -180 && coordinate[0] <= 180);
      assert.ok(coordinate[1] >= -90 && coordinate[1] <= 90);
    }
  }
});
