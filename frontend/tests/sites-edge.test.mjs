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
    new Request("https://example.test/map/openfreemap/%2F..%2Fsecret"), {},
    {waitUntil(){},passThroughOnException(){}},
  );
  assert.equal(res.status,400);
});

test("Sites initializes real D1, persists settings, and isolates guests", {timeout: 30000}, async () => {
  const {Miniflare} = await import("miniflare");
  const mf = new Miniflare({modules:true, script:"export default {fetch(){return new Response('ok')}}", d1Databases:["DB"]});
  try {
    const db = await mf.getD1Database("DB");
    const url = new URL("../dist/server/index.js", import.meta.url);
    url.searchParams.set("sites-d1", String(Date.now()));
    const {default:worker} = await import(url.href);
    const call = (path, cookie = "", method = "GET", body) => worker.fetch(new Request("https://example.test/api/v1/" + path, {
      method, headers:{Cookie:cookie, "Content-Type":"application/json"},
      body:body === undefined ? undefined : JSON.stringify(body),
    }), {DB:db}, {waitUntil(){},passThroughOnException(){}});
    const health = await call("health");
    assert.equal(health.status, 200, await health.clone().text());
    assert.equal((await health.json()).runtime, "sites-d1-sgp4");
    const cookie = health.headers.get("Set-Cookie").split(";")[0];
    const settings = await (await call("settings", cookie)).json();
    settings.map.qa_marker = "persisted";
    assert.equal((await call("settings", cookie, "PUT", settings)).status, 200);
    assert.equal((await (await call("settings", cookie)).json()).map.qa_marker, "persisted");
    const guest = await call("health");
    const guestCookie = guest.headers.get("Set-Cookie").split(";")[0];
    assert.notEqual(cookie, guestCookie);
    assert.equal((await (await call("settings", guestCookie)).json()).map.qa_marker, undefined);
    assert.equal((await call("satellites/999999999/position", cookie)).status, 200);
    assert.equal((await call("satellites/999999999/track?resolution_seconds=60", cookie)).status, 200);
  } finally { await mf.dispose(); }
});
