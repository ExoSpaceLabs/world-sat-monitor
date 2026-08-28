import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import test from "node:test";

import {
  activateManagedSatellite,
  createManagedSatellite,
  deactivateManagedSatellite,
  deleteManagedSatellite,
  listManagedSatellites,
  searchSatelliteCatalog,
} from "../app/services/worldsat-api.ts";

function response(status, payload) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 204 ? "No Content" : "OK",
    async json() { return payload; },
    async text() { return JSON.stringify(payload ?? {}); },
  };
}

test("managed satellite list preserves inactive objects", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    assert.equal(url, "/api/v1/satellites");
    assert.equal(init?.cache, "no-store");
    return response(200, {
      satellites: [{
        id: 7,
        name: "SAVED-SAT",
        active: false,
        object_type: "payload",
        provider_preference: null,
        metadata: {},
        identifiers: {NORAD_CAT_ID: "100001"},
        norad_id: "100001",
        created_at: "2026-08-28T00:00:00Z",
        updated_at: "2026-08-28T00:00:00Z",
      }],
    });
  };
  try {
    const satellites = await listManagedSatellites();
    assert.equal(satellites.length, 1);
    assert.equal(satellites[0].active, false);
    assert.equal(satellites[0].norad_id, "100001");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("catalog search stays behind the WorldSat API", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    assert.equal(url, "/api/v1/catalog/search?q=ISS+ZARYA&provider=celestrak");
    assert.equal(init?.cache, "no-store");
    return response(200, {
      query: "ISS ZARYA",
      provider: "celestrak",
      results: [{
        provider: "celestrak",
        provider_object_id: "25544",
        name: "ISS (ZARYA)",
        object_type: "payload",
        identifiers: {NORAD_CAT_ID: "25544", COSPAR: "1998-067A"},
        metadata: {owner: "ISS"},
        local: {present: false, satellite_id: null, active: false, name: null},
      }],
    });
  };
  try {
    const results = await searchSatelliteCatalog("ISS ZARYA");
    assert.equal(results[0].identifiers.NORAD_CAT_ID, "25544");
    assert.equal(results[0].local.present, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("catalog result supports inactive and monitor-now creation contracts", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({url, method: init?.method ?? "GET", body: init?.body});
    return response(201, {id: calls.length, active: JSON.parse(init.body).active});
  };
  try {
    const common = {
      name: "ISS (ZARYA)",
      provider_preference: "celestrak",
      identifiers: [
        {namespace: "NORAD_CAT_ID", value: "25544"},
        {namespace: "COSPAR", value: "1998-067A"},
      ],
    };
    await createManagedSatellite({...common, active: false});
    await createManagedSatellite({...common, active: true});
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.equal(JSON.parse(calls[0].body).active, false);
  assert.equal(JSON.parse(calls[1].body).active, true);
  assert.equal(JSON.parse(calls[1].body).provider_preference, "celestrak");
});

test("create and lifecycle calls use explicit API operations", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({url, method: init?.method ?? "GET", body: init?.body});
    if (String(url).endsWith("/activate")) return response(200, {id: 9, active: true});
    if (String(url).endsWith("/deactivate")) return response(200, {id: 9, active: false});
    if (init?.method === "DELETE") return response(204);
    return response(201, {id: 9, active: false});
  };
  try {
    await createManagedSatellite({
      name: "TEST-SAT",
      identifiers: [{namespace: "NORAD_CAT_ID", value: "100002"}],
    });
    await activateManagedSatellite(9);
    await deactivateManagedSatellite(9);
    await deleteManagedSatellite(9);
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.deepEqual(calls.map((call) => [call.method, call.url]), [
    ["POST", "/api/v1/satellites"],
    ["POST", "/api/v1/satellites/9/activate"],
    ["POST", "/api/v1/satellites/9/deactivate"],
    ["DELETE", "/api/v1/satellites/9"],
  ]);
  assert.match(calls[0].body, /NORAD_CAT_ID/);
});

test("selected monitored satellite drives position and track queries", async () => {
  const monitor = await readFile(new URL("../app/components/world-sat-monitor/WorldSatMonitor.tsx", import.meta.url), "utf8");

  assert.match(monitor, /selectedNoradId/);
  assert.match(monitor, /getSatellitePosition\(selectedNoradId/);
  assert.match(monitor, /getSatelliteTrack\(\s*selectedNoradId/);
  assert.match(monitor, /listManagedSatellites\(\)/);
  assert.doesNotMatch(monitor, /ACTIVE_NORAD_ID/);
});

test("displayed objects are selectable and satellite manager lives in top controls", async () => {
  const panel = await readFile(new URL("../app/components/satellite/SatellitePanel.tsx", import.meta.url), "utf8");
  const monitor = await readFile(new URL("../app/components/world-sat-monitor/WorldSatMonitor.tsx", import.meta.url), "utf8");

  assert.match(panel, /DISPLAYED OBJECTS/);
  assert.match(panel, /managedSatellites\.filter\(\(item\) => item\.active && item\.norad_id\)/);
  assert.match(panel, /onSelect\(noradId\)/);
  assert.match(panel, /aria-expanded=\{selected\}/);
  assert.match(monitor, />OBJECTS</);
  assert.match(monitor, />SATELLITES</);
  assert.match(monitor, /<SatelliteManager/);
});
