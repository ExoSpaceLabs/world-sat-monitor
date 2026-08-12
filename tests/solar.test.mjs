import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_SHADOW_OPACITY,
  getSolarState,
  inertialSolarLongitude,
  shadowAlpha,
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

test("shadow sphere is clear on the solar half and defaults to 70 percent opacity opposite it", () => {
  assert.equal(shadowAlpha(1), 0);
  assert.equal(shadowAlpha(0), 0);
  assert.equal(shadowAlpha(-1), DEFAULT_SHADOW_OPACITY);
  assert.equal(DEFAULT_SHADOW_OPACITY, 0.7);
  assert.equal(shadowAlpha(-1, 0.35), 0.35);
  assert.ok(shadowAlpha(-0.01) > 0 && shadowAlpha(-0.01) < DEFAULT_SHADOW_OPACITY);
});
