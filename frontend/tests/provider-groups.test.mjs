import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import test from "node:test";

import {
  importProviderCatalogGroup,
  listProviderCatalogGroups,
  searchProviderCatalogGroups,
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


test("provider group catalog and search stay behind the application gateway", async () => {
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
    if (url === "/api/v1/catalog/groups/search?q=galileo") {
      return response(200, {
        query: "galileo",
        provider: "celestrak",
        groups: [{
          provider: "celestrak",
          key: "galileo",
          name: "Galileo",
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
    const found = await searchProviderCatalogGroups("galileo");
    const imported = await importProviderCatalogGroup(groups[0].key);
    assert.equal(found[0].key, "galileo");
    assert.equal(imported.group.member_count, 210);
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.deepEqual(calls, [
    {url: "/api/v1/catalog/groups", method: "GET"},
    {url: "/api/v1/catalog/groups/search?q=galileo", method: "GET"},
    {url: "/api/v1/catalog/groups/kuiper/import", method: "POST"},
  ]);
});


test("group panel keeps quick imports and exposes searchable provider groups", async () => {
  const panel = await readFile(new URL("../app/components/groups/GroupPanel.tsx", import.meta.url), "utf8");

  assert.match(panel, /QUICK IMPORT/);
  assert.match(panel, /SEARCH CELESTRAK GROUP CATALOG/);
  assert.match(panel, /searchProviderCatalogGroups/);
  assert.match(panel, /IMPORTS CREATE MISSING MEMBERS INACTIVE/);
  assert.match(panel, /importProviderCatalogGroup\(group\.key\)/);
  assert.match(panel, /group\.local\.present \? "SYNC" : "IMPORT"/);
  assert.doesNotMatch(panel, /activateManagedSatellite/);
});
