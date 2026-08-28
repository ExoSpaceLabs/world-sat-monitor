import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import test from "node:test";

import {
  importProviderCatalogGroup,
  listProviderCatalogGroups,
} from "../app/services/catalog-groups-api.ts";


function response(status, payload) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "ERROR",
    json: async () => payload,
    text: async () => JSON.stringify(payload),
  };
}


test("provider constellation catalog stays behind the application gateway", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({url, method: init?.method ?? "GET"});
    if (url === "/api/v1/catalog/groups") {
      return response(200, {
        provider: "celestrak",
        groups: [{
          provider: "celestrak",
          key: "kuiper",
          name: "Kuiper",
          group_type: "constellation",
          available: true,
          local: {present: false, group_id: null, member_count: 0, active_member_count: 0},
        }],
      });
    }
    return response(200, {
      provider: "celestrak",
      key: "kuiper",
      group: {id: 9, name: "Kuiper", member_count: 210, active_member_count: 0},
      catalog_members: 210,
      created_satellites: 210,
      removed_memberships: 0,
    });
  };

  try {
    const groups = await listProviderCatalogGroups();
    const imported = await importProviderCatalogGroup(groups[0].key);
    assert.equal(imported.group.member_count, 210);
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.deepEqual(calls, [
    {url: "/api/v1/catalog/groups", method: "GET"},
    {url: "/api/v1/catalog/groups/kuiper/import", method: "POST"},
  ]);
});


test("group panel exposes explicit provider import without changing monitoring state", async () => {
  const panel = await readFile(new URL("../app/components/groups/GroupPanel.tsx", import.meta.url), "utf8");

  assert.match(panel, /CELESTRAK CONSTELLATIONS/);
  assert.match(panel, /IMPORTS CREATE MISSING MEMBERS INACTIVE/);
  assert.match(panel, /importProviderCatalogGroup\(group\.key\)/);
  assert.match(panel, /group\.local\.present \? "SYNC" : "IMPORT"/);
  assert.doesNotMatch(panel, /activateManagedSatellite/);
});
