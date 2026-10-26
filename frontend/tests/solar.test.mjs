import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_SHADOW_OPACITY,
  getSolarState,
  shadowAlpha,
  solarElevation,
  solarIllumination,
} from "../app/domain/solar.ts";

function normalizeLongitude(longitude) {
  return (((longitude % 360) + 540) % 360) - 180;
}

function antipodalLongitude(longitude) {
  return longitude >= 0 ? longitude - 180 : longitude + 180;
}

function angularDelta(from, to) {
  return normalizeLongitude(to - from);
}

test("solar state places the Sun above the calculated subsolar point", () => {
  const dates = [
    new Date("2026-03-20T12:00:00.000Z"),
    new Date("2026-06-21T12:00:00.000Z"),
    new Date("2026-12-21T12:00:00.000Z"),
  ];

  for (const date of dates) {
    const sun = getSolarState(date);
    const antiLongitude = antipodalLongitude(sun.longitude);
    assert.ok(Math.abs(sun.latitude) <= 23.5);
    assert.ok(sun.longitude >= -180 && sun.longitude < 180);
    assert.ok(sun.rightAscension >= -180 && sun.rightAscension < 180);
    assert.ok(sun.siderealAngle >= -180 && sun.siderealAngle < 180);
    assert.ok(solarIllumination(sun.latitude, sun.longitude, sun) > 0.999999);
    assert.ok(solarIllumination(-sun.latitude, antiLongitude, sun) < -0.999999);
    assert.ok(solarElevation(sun.latitude, sun.longitude, sun) > 89.9);
    assert.ok(solarElevation(-sun.latitude, antiLongitude, sun) < -89.9);
  }
});

test("Earth-fixed subsolar longitude moves while inertial right ascension stays nearly fixed", () => {
  const start = getSolarState(new Date("2026-08-12T12:00:00.000Z"));
  const later = getSolarState(new Date("2026-08-12T13:00:00.000Z"));

  const subsolarMotion = angularDelta(start.longitude, later.longitude);
  const inertialMotion = angularDelta(start.rightAscension, later.rightAscension);
  const siderealMotion = angularDelta(start.siderealAngle, later.siderealAngle);

  assert.ok(subsolarMotion < -14.9 && subsolarMotion > -15.2);
  assert.ok(inertialMotion > 0 && inertialMotion < 0.1);
  assert.ok(siderealMotion > 15 && siderealMotion < 15.1);
});

test("sidereal rotation maps the Earth-fixed subsolar longitude onto solar right ascension", () => {
  const sun = getSolarState(new Date("2026-08-15T00:04:00.000Z"));
  assert.ok(
    Math.abs(normalizeLongitude(sun.longitude + sun.siderealAngle - sun.rightAscension))
      < 1e-10,
  );

  // Any Earth-fixed camera longitude must preserve its angular separation from
  // the Sun after both directions are expressed in the inertial frame.
  const cameraLongitude = 3.519;
  const cameraInertial = normalizeLongitude(cameraLongitude + sun.siderealAngle);
  const earthFixedSeparation = angularDelta(cameraLongitude, sun.longitude);
  const inertialSeparation = angularDelta(cameraInertial, sun.rightAscension);
  assert.ok(Math.abs(earthFixedSeparation - inertialSeparation) < 1e-10);
});

test("shadow opacity is derived only from geographic solar illumination", () => {
  assert.equal(shadowAlpha(1), 0);
  assert.equal(shadowAlpha(0), 0);
  assert.equal(shadowAlpha(-1), DEFAULT_SHADOW_OPACITY);
  assert.equal(DEFAULT_SHADOW_OPACITY, 0.7);
  assert.equal(shadowAlpha(-1, 0.35), 0.35);
  assert.ok(shadowAlpha(-0.01) > 0 && shadowAlpha(-0.01) < DEFAULT_SHADOW_OPACITY);
});

test("independent equinox reference: Greenwich-facing Africa is day at noon and night at midnight", () => {
  // Astronomical reference: near the March equinox, declination is almost
  // zero and the subsolar meridian is near Greenwich at 12:00 UTC.
  // This is independent of the model's returned right ascension / sidereal
  // angle identity, which could agree even if both values were wrong.
  const noon = getSolarState(new Date("2026-03-20T12:00:00.000Z"));
  const midnight = getSolarState(new Date("2026-03-20T00:00:00.000Z"));
  assert.ok(Math.abs(noon.latitude) < 1, "equinox declination must be near zero");
  assert.ok(Math.abs(noon.longitude) < 6, "noon Sun must be near Greenwich");
  assert.ok(Math.abs(midnight.latitude) < 1);
  assert.ok(Math.abs(Math.abs(midnight.longitude) - 180) < 6);
  assert.ok(solarElevation(18, 13, noon) > 65,
    "Africa-facing initial camera centre must be in daylight at noon");
  assert.ok(solarElevation(18, 13, midnight) < -65,
    "the same location must be in night at midnight");
  assert.equal(shadowAlpha(solarIllumination(18, 13, noon), 1), 0);
  assert.ok(shadowAlpha(solarIllumination(18, 13, midnight), 1) > 0.99);
});

test("solstice anchor: polar seasons follow terrestrial axial tilt", () => {
  const june = getSolarState(new Date("2026-06-21T12:00:00.000Z"));
  const december = getSolarState(new Date("2026-12-21T12:00:00.000Z"));
  assert.ok(june.latitude > 23.2 && june.latitude < 23.5,
    "June solstice must have northern positive declination");
  assert.ok(december.latitude < -23.2 && december.latitude > -23.5,
    "December solstice must have southern negative declination");
  assert.ok(solarIllumination(90, 0, june) > 0);
  assert.ok(solarIllumination(90, 0, december) < 0);
  assert.ok(solarIllumination(-90, 0, june) < 0);
  assert.ok(solarIllumination(-90, 0, december) > 0);
});
