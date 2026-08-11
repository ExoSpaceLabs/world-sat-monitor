import assert from "node:assert/strict";
import test from "node:test";

import {
  getSolarState,
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

test("night texture is transparent under the Sun and opaque at the anti-solar point", () => {
  assert.equal(nightShadowOpacity(10), 0);
  assert.equal(nightShadowOpacity(3), 0);
  assert.ok(nightShadowOpacity(-6) > 0.3);
  assert.ok(nightShadowOpacity(-30) > 0.7);
  assert.ok(nightShadowOpacity(-90) > nightShadowOpacity(-6));
});
