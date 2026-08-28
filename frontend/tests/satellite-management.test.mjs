import assert from "node:assert/strict";
import test from "node:test";

import {
  activateManagedSatellite,
  createManagedSatellite,
  deactivateManagedSatellite,
  deleteManagedSatellite,
  listManagedSatellites,
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
      satellites: [
        {
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
        },
      ],
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
