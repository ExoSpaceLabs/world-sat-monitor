import assert from "node:assert/strict";
import test from "node:test";

import {buildLayerGeometry} from "../app/components/satellite/OrbitTrackLayer.ts";
import {DEFAULT_APP_SETTINGS} from "../app/domain/settings.ts";

// Avoid a mocked *orbit renderer*. Supply only MapLibre's deterministic
// longitude/latitude -> Mercator coordinate conversion to the real geometry
// builder consumed by OrbitTrackLayer. Keep this independent of WebGL drivers.
const maplibre = {
  EXTENT: 8192,
  MercatorCoordinate: {
    fromLngLat({lng, lat}) {
      const radians = lat * Math.PI / 180;
      return {
        x: (lng + 180) / 360,
        y: (1 - Math.log(Math.tan(Math.PI / 4 + radians / 2)) / Math.PI) / 2,
      };
    },
  },
};

const satellite = {name: "TEST", norad: "999999999", lat: 10, lon: 8, altitude: 547, heading: 72};
const track = [
  {lat: 8, lon: 4, altitude: 530, segment: "history"},
  {lat: 9, lon: 6, altitude: 535, segment: "history"},
  {lat: 11, lon: 10, altitude: 555, segment: "prediction"},
  {lat: 12, lon: 12, altitude: 560, segment: "prediction"},
];

function geometry(mode) {
  return buildLayerGeometry(maplibre, {
    satellite,
    track,
    settings: {...DEFAULT_APP_SETTINGS.orbit, path: {...DEFAULT_APP_SETTINGS.orbit.path, mode}},
  });
}

function column(vertices, index) {
  return Array.from(vertices).filter((_, i) => i % 4 === index);
}

test("real orbit geometry keeps ground projection at zero metres and physical orbit elevation in metres", () => {
  const nadir = geometry("ground");
  const elevated = geometry("orbit");
  for (const key of ["history", "prediction", "heading"]) {
    assert.ok(nadir[key].ranges.length > 0, key + " must have renderable line strips");
    assert.ok(elevated[key].ranges.length > 0, key + " must have renderable orbit strips");
    assert.equal(nadir[key].vertices.length, elevated[key].vertices.length);
    assert.deepEqual(column(nadir[key].vertices, 0), column(elevated[key].vertices, 0));
    assert.deepEqual(column(nadir[key].vertices, 1), column(elevated[key].vertices, 1));
    assert.ok(column(nadir[key].vertices, 2).every(v => v === 0),
      key + " NADIR must never be raised above the surface");
    assert.ok(column(elevated[key].vertices, 2).every(v => v >= 530_000 && v <= 560_000),
      key + " ORBIT must use the source physical altitude in metres");
  }

  const history = column(elevated.history.vertices, 2);
  const prediction = column(elevated.prediction.vertices, 2);
  assert.ok(history.includes(547_000), "history must join the current object position");
  assert.ok(prediction.includes(547_000), "prediction must start at the current object position");
});

test("orbit geometry integrates longer physical along-track distances than the same nadir path", () => {
  const ground = geometry("ground");
  const orbit = geometry("orbit");
  for (const key of ["history", "prediction", "heading"]) {
    const groundDistance = column(ground[key].vertices, 3).at(-1);
    const orbitDistance = column(orbit[key].vertices, 3).at(-1);
    assert.ok(groundDistance > 0, key + " ground distance must be positive");
    assert.ok(orbitDistance > groundDistance * 1.07,
      key + " orbital distance must reflect a radius larger than Earth");
    assert.ok(orbitDistance < groundDistance * 1.12);
  }
});

test("dateline crossing never produces a rendered chord across the map", () => {
  const crossing = buildLayerGeometry(maplibre, {
    satellite: {...satellite, lon: -178, lat: 0},
    track: [
      {lat: 0, lon: 178, altitude: 547, segment: "history"},
      {lat: 0, lon: -179, altitude: 547, segment: "history"},
      {lat: 0, lon: -177, altitude: 547, segment: "prediction"},
    ],
    settings: {...DEFAULT_APP_SETTINGS.orbit, path: {...DEFAULT_APP_SETTINGS.orbit.path, mode: "orbit"}},
  });
  for (const key of ["history", "prediction", "heading"]) {
    const {vertices, ranges} = crossing[key];
    for (const {first, count} of ranges) {
      for (let i = first + 1; i < first + count; i += 1) {
        const priorX = vertices[(i - 1) * 4];
        const x = vertices[i * 4];
        assert.ok(Math.abs(x - priorX) < maplibre.EXTENT / 2,
          key + " must split large jumps at the antimeridian");
      }
    }
  }
});
