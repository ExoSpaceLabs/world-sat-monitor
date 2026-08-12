import assert from "node:assert/strict";
import test from "node:test";

import {
  createNightShadowCells,
  getSolarState,
  inertialSolarLongitude,
  nightShadowOpacity,
  solarElevation,
} from "../app/domain/solar.ts";

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

test("Sun remains fixed in the inertial frame while Earth rotates", () => {
  const start = getSolarState(new Date("2026-08-12T12:00:00.000Z"));
  const oneHourLater = getSolarState(new Date("2026-08-12T13:00:00.000Z"));
  const startInertial = inertialSolarLongitude(start, 0);
  const laterInertial = inertialSolarLongitude(oneHourLater, 15);
  assert.ok(Math.abs(startInertial - laterInertial) < 0.05);
});

test("night shadow is transparent under the Sun and opaque at the anti-solar point", () => {
  assert.equal(nightShadowOpacity(10), 0);
  assert.equal(nightShadowOpacity(2), 0);
  assert.ok(nightShadowOpacity(-6) > 0.3);
  assert.ok(nightShadowOpacity(-30) > 0.75);
  assert.ok(nightShadowOpacity(-90) > nightShadowOpacity(-6));
});

test("shadow mesh covers the anti-solar hemisphere without covering the subsolar point", () => {
  const sun = {latitude: 0, longitude: 0};
  const cells = createNightShadowCells(sun, 4);
  const contains = (latitude, longitude) => cells.find((cell) => (
    longitude >= cell.west && longitude <= cell.east
    && latitude >= cell.south && latitude <= cell.north
  ));
  assert.equal(contains(0, 0), undefined);
  assert.ok(contains(0, 180)?.opacity > 0.8);
  assert.ok(cells.length > 1_500);
});
