import assert from "node:assert/strict";
import test from "node:test";

test("Sites uses SGP4 for synthetic position and bounded tracks", async () => {
  const {positionAt,sampleTrack,syntheticOmm} = await import("../edge/orbit.ts");
  const now = new Date("2026-10-23T12:00:00.000Z");
  const omm = syntheticOmm(now);
  const p = positionAt(omm,now);
  assert.ok(Number.isFinite(p.lat_deg) && Math.abs(p.lat_deg) <= 90);
  assert.ok(Number.isFinite(p.lon_deg) && Math.abs(p.lon_deg) <= 180);
  assert.ok(p.altitude_km > 100 && p.altitude_km < 3000);
  assert.ok(p.heading_deg >= 0 && p.heading_deg < 360);
  const track = sampleTrack(omm,now,new Date(now.getTime()+240000),60,now);
  assert.equal(track.length,5);
  assert.equal(track[0].segment,"history");
  assert.equal(track[1].segment,"prediction");
  assert.throws(() => sampleTrack(omm,now,new Date(now.getTime()+4*86400000),10,now),
    /per-request sampling limit/);
});

test("Sites returns an explicit configuration error without the D1 binding", async () => {
  const url = new URL("../dist/server/index.js",import.meta.url);
  url.searchParams.set("sites-edge",String(Date.now()));
  const {default:worker} = await import(url.href);
  const res = await worker.fetch(new Request("https://example.test/api/v1/health"),{
    ASSETS:{fetch:async()=>new Response("Not found",{status:404})}
  },{waitUntil(){},passThroughOnException(){}});
  assert.equal(res.status,503);
  assert.match(await res.text(),/Sites D1 binding unavailable/);
});

test("Sites map proxy rejects path traversal and cannot become an open proxy", async () => {
  const url = new URL("../dist/server/index.js",import.meta.url);
  url.searchParams.set("sites-map",String(Date.now()));
  const {default:worker} = await import(url.href);
  const res = await worker.fetch(
    new Request("https://example.test/map/openfreemap/%2E%2E/%2E%2E/evil"), {},
    {waitUntil(){},passThroughOnException(){}},
  );
  assert.equal(res.status,400);
});
