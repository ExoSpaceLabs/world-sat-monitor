import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import test from "node:test";

import {
  activateManagedSatellite,
  addSatelliteGroupMember,
  createManagedSatellite,
  createSatelliteGroup,
  deactivateManagedSatellite,
  deleteManagedSatellite,
  deleteSatelliteGroup,
  getSatelliteGroupPositions,
  listManagedSatellites,
  listSatelliteGroupMembers,
  listSatelliteGroups,
  releaseSatelliteGroupDisplay,
  removeSatelliteGroupMember,
  requestSatelliteGroupDisplay,
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
    return response(200, {satellites: [{id: 7, name: "SAVED-SAT", active: false, object_type: "payload", provider_preference: null, metadata: {}, identifiers: {NORAD_CAT_ID: "100001"}, norad_id: "100001", created_at: "2026-08-28T00:00:00Z", updated_at: "2026-08-28T00:00:00Z"}]});
  };
  try {
    const satellites = await listManagedSatellites();
    assert.equal(satellites.length, 1);
    assert.equal(satellites[0].active, false);
  } finally { globalThis.fetch = originalFetch; }
});

test("catalog search stays behind the WorldSat API", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    assert.equal(url, "/api/v1/catalog/search?q=ISS+ZARYA&provider=celestrak");
    return response(200, {query: "ISS ZARYA", provider: "celestrak", results: [{provider: "celestrak", provider_object_id: "25544", name: "ISS (ZARYA)", object_type: "payload", identifiers: {NORAD_CAT_ID: "25544", COSPAR: "1998-067A"}, metadata: {}, local: {present: false, satellite_id: null, active: false, name: null}}]});
  };
  try { assert.equal((await searchSatelliteCatalog("ISS ZARYA"))[0].local.present, false); }
  finally { globalThis.fetch = originalFetch; }
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
    await createManagedSatellite({name: "TEST-SAT", identifiers: [{namespace: "NORAD_CAT_ID", value: "100002"}]});
    await activateManagedSatellite(9); await deactivateManagedSatellite(9); await deleteManagedSatellite(9);
  } finally { globalThis.fetch = originalFetch; }
  assert.deepEqual(calls.map((call) => [call.method, call.url]), [["POST", "/api/v1/satellites"], ["POST", "/api/v1/satellites/9/activate"], ["POST", "/api/v1/satellites/9/deactivate"], ["DELETE", "/api/v1/satellites/9"]]);
});

test("group CRUD, display lease and batched simulated positions use group endpoints", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({url: String(url), method: init?.method ?? "GET", body: init?.body});
    if (url === "/api/v1/groups" && !init?.method) return response(200, {groups: []});
    if (String(url).endsWith("/members") && !init?.method) return response(200, {members: []});
    if (String(url).includes("/positions?")) return response(200, {group: {}, generated_at: "2026-08-28T00:00:00Z", positions: []});
    if (String(url).endsWith("/display") && init?.method === "POST") return response(200, {group: {}, display: {requested_until: "2026-08-28T01:00:00Z", prediction_hours: 3, step_seconds: 120}});
    if (init?.method === "DELETE") return response(204);
    return response(201, {id: 4, name: "ION", group_type: "constellation", source: "user", member_count: 0, active_member_count: 0});
  };
  const at = new Date("2026-08-28T00:00:00Z");
  const groupSettings = {marker_placement: "orbit", show_satellite_names: false, direction_vector_enabled: false, position_update_ms: 2000, prediction_hours: 3, step_seconds: 120, refresh_seconds: 60};
  try {
    await listSatelliteGroups();
    await createSatelliteGroup({name: "ION", group_type: "constellation"});
    await listSatelliteGroupMembers(4);
    await addSatelliteGroupMember(4, 7);
    await requestSatelliteGroupDisplay(4, groupSettings);
    await getSatelliteGroupPositions(4, at);
    await releaseSatelliteGroupDisplay(4);
    await removeSatelliteGroupMember(4, 7);
    await deleteSatelliteGroup(4);
  } finally { globalThis.fetch = originalFetch; }

  assert.equal(calls[4].method, "POST");
  assert.equal(calls[4].url, "/api/v1/groups/4/display");
  assert.match(calls[5].url, /^\/api\/v1\/groups\/4\/positions\?/);
  assert.match(calls[5].url, /active_only=false/);
  assert.match(calls[5].url, /at=2026-08-28T00%3A00%3A00.000Z/);
  assert.equal(calls[6].method, "DELETE");
  assert.equal(calls[6].url, "/api/v1/groups/4/display");
});

test("single and group display are mutually exclusive in the monitor", async () => {
  const monitor = await readFile(new URL("../app/components/world-sat-monitor/WorldSatMonitor.tsx", import.meta.url), "utf8");
  const panel = await readFile(new URL("../app/components/groups/GroupPanel.tsx", import.meta.url), "utf8");

  assert.match(monitor, /type DisplayTarget = \{kind: "satellite"/);
  assert.match(monitor, /\| \{kind: "group"; groupId: number\}/);
  assert.match(monitor, /setDisplayTarget\(\{kind: "group", groupId\}\)/);
  assert.match(monitor, /displayTarget\.kind === "satellite" && positionReady/);
  assert.match(monitor, /displayTarget\.kind === "group" \? groupPositions : \[\]/);
  assert.match(monitor, /requestSatelliteGroupDisplay/);
  assert.match(monitor, /releaseSatelliteGroupDisplay/);
  assert.doesNotMatch(monitor, /visibleGroupIds/);
  assert.match(panel, /DISPLAYING/);
  assert.match(panel, /onDisplayGroup/);
});

test("object and group display policies are separate and coherent", async () => {
  const settings = await readFile(new URL("../app/domain/settings.ts", import.meta.url), "utf8");
  const panel = await readFile(new URL("../app/components/satellite/OrbitSettingsPanel.tsx", import.meta.url), "utf8");
  const satelliteLayer = await readFile(new URL("../app/components/satellite/SatelliteLayer.tsx", import.meta.url), "utf8");
  const groupLayer = await readFile(new URL("../app/components/groups/GroupSatelliteLayer.tsx", import.meta.url), "utf8");
  assert.match(settings, /group_orbit: GroupOrbitDisplaySettings/);
  assert.match(settings, /marker_placement: "orbit"/);
  assert.match(settings, /show_satellite_names: false/);
  assert.match(settings, /direction_vector_enabled: false/);
  assert.match(settings, /prediction_hours: 3/);
  assert.match(settings, /step_seconds: 120/);
  assert.match(panel, /OBJECT \+ TRACK PLACEMENT/);
  assert.match(panel, /MARKER PLACEMENT/);
  assert.match(panel, /SHOW SATELLITE NAMES/);
  assert.match(panel, /DRAW DIRECTION VECTORS/);
  assert.match(satelliteLayer, /settings\.path\.mode === "ground"/);
  assert.match(satelliteLayer, /\.\.\.satellite, altitude: 0/);
  assert.match(groupLayer, /placement === "orbit" \? point\.altitude : 0/);
});

test("displayed objects are selectable and satellite manager lives in top controls", async () => {
  const panel = await readFile(new URL("../app/components/satellite/SatellitePanel.tsx", import.meta.url), "utf8");
  const monitor = await readFile(new URL("../app/components/world-sat-monitor/WorldSatMonitor.tsx", import.meta.url), "utf8");
  assert.match(panel, /DISPLAYED OBJECTS/);
  assert.match(panel, /onSelect\(noradId\)/);
  assert.match(monitor, />OBJECTS</);
  assert.match(monitor, />SATELLITES</);
  assert.match(monitor, /GROUP SETTINGS/);
  assert.match(monitor, /OBJECT SETTINGS/);
  assert.match(monitor, /<SatelliteManager/);
});
