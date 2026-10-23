import {DEFAULT_APP_SETTINGS} from "../app/domain/settings";
import {positionAt, sampleTrack, sourceAge, syntheticOmm, type Omm} from "./orbit";
import {schemaSql} from "./schema";

type Row = Record<string, unknown>;
type DB = D1Database;

const COOKIE = "worldsat_demo";
const TTL_MS = 7 * 86_400_000;
const REFRESH_MS = 2 * 3_600_000;
const MAX_SATELLITES = 200;
const MAX_GROUP_SIZE = 200;
const MAX_GROUPS = 20;
let initialized: Promise<void> | null = null;

class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
const error = (status: number, message: string): never => { throw new ApiError(status, message); };
const iso = () => new Date().toISOString();
const asString = (value: unknown) => String(value ?? "");
const parse = (v: unknown): Record<string, unknown> => {
  try { return JSON.parse(asString(v || "{}")) as Record<string, unknown>; } catch { return {}; }
};
const arr = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
const response = (payload: unknown, status = 200, extra: HeadersInit = {}) =>
  new Response(JSON.stringify(payload), {status, headers: {"Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...extra}});
const empty = () => new Response(null, {status: 204, headers: {"Cache-Control": "no-store"}});

async function init(db: DB) {
  initialized ??= db.exec(schemaSql).then(() => undefined).catch((reason: unknown) => {
    initialized = null;
    throw reason;
  });
  await initialized;
}

async function one(db: DB, query: string, ...values: unknown[]): Promise<Row | null> {
  return await db.prepare(query).bind(...values).first<Row>();
}
async function rows(db: DB, query: string, ...values: unknown[]): Promise<Row[]> {
  return (await db.prepare(query).bind(...values).all<Row>()).results;
}
async function run(db: DB, query: string, ...values: unknown[]) {
  return db.prepare(query).bind(...values).run();
}

type Context = {db: DB; visitor: string; setCookie: string | null; request: Request};
async function createContext(request: Request, db: DB): Promise<Context> {
  await init(db);
  const found = request.headers.get("Cookie")?.match(/(?:^|;\s*)worldsat_demo=([0-9a-f-]{36})(?:;|$)/i)?.[1];
  let visitor = found ?? "";
  const current = found ? await one(db, "SELECT id, created_at FROM sites_visitors WHERE id=?", found) : null;
  const now = iso(), today = now.slice(0, 10);
  const expired = current && Date.now() - Date.parse(asString(current.created_at)) > TTL_MS;
  let setCookie: string | null = null;
  if (!current || expired) {
    visitor = crypto.randomUUID();
    // Expired guest state is disposable and must not accumulate indefinitely.
    await run(db, "DELETE FROM sites_visitors WHERE last_seen_at < ?", new Date(Date.now()-TTL_MS).toISOString());
    await run(db, "INSERT INTO sites_visitors(id,created_at,last_seen_at,request_day) VALUES(?,?,?,?)",
      visitor, now, now, today);
    await run(db, "INSERT INTO sites_satellites(visitor_id,name,norad_id,active,source,omm,fetched_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)",
      visitor, "WORLDSAT-01", "999999999", 1, "mock", JSON.stringify(syntheticOmm()), now, now, now);
    const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
    setCookie = `${COOKIE}=${visitor}; Path=/; HttpOnly; SameSite=Lax${secure}; Max-Age=604800`;
  }
  const update = await run(db, `UPDATE sites_visitors SET last_seen_at=?,
    requests_today=CASE WHEN request_day=? THEN requests_today + 1 ELSE 1 END,
    request_day=? WHERE id=?`, now, today, today, visitor);
  void update;
  const meter = await one(db, "SELECT requests_today FROM sites_visitors WHERE id=?", visitor);
  if (Number(meter?.requests_today ?? 0) > 5000) error(429, "Daily demo request limit reached");
  return {db, visitor, setCookie, request};
}

function checkWrite(ctx: Context) {
  const origin = ctx.request.headers.get("Origin");
  if (origin && origin !== new URL(ctx.request.url).origin) error(403, "Cross-origin modification denied");
  if (ctx.request.headers.get("Content-Type")?.split(";")[0] !== "application/json"
    && ctx.request.method !== "DELETE") error(415, "JSON request required");
}
async function body(ctx: Context) {
  checkWrite(ctx);
  if (Number(ctx.request.headers.get("Content-Length") || 0) > 32768) error(413, "Demo payload too large");
  const raw = await ctx.request.text();
  if (raw.length > 32768) error(413, "Demo payload too large");
  try { return JSON.parse(raw) as Record<string, unknown>; }
  catch { return error(400, "Invalid JSON request"); }
}
function validateName(value: unknown) {
  const name = asString(value).trim();
  if (name.length < 1 || name.length > 128) error(422, "Name must contain 1-128 characters");
  return name;
}
function satellite(row: Row) {
  const norad = row.norad_id === null ? null : asString(row.norad_id);
  return {
    id: Number(row.id), name: asString(row.name), active: Boolean(row.active),
    object_type: asString(row.object_type), provider_preference: asString(row.source),
    provider_priority: [asString(row.source)], metadata: {},
    identifiers: norad ? {NORAD_CAT_ID: norad} : {},
    norad_id: norad, created_at: row.created_at, updated_at: row.updated_at,
  };
}
async function getSatellite(ctx: Context, idOrNorad: string) {
  const row = await one(ctx.db, "SELECT * FROM sites_satellites WHERE visitor_id=? AND (id=? OR norad_id=?)",
    ctx.visitor, idOrNorad, idOrNorad);
  if (!row) error(404, "Satellite not found");
  return row!;
}
function oom(row: Row): Omm | null {
  return row.omm ? JSON.parse(asString(row.omm)) as Omm : null;
}
function coordinate(row: Row, at: Date) {
  const elements = oom(row);
  if (!elements) error(503, "Orbital elements unavailable; provider may be offline");
  try { return positionAt(elements!, at); }
  catch { return error(422, "SGP4 could not propagate this orbit at the requested time"); }
}
function atParam(value: string | null, fallback = new Date()): Date {
  const result = value ? new Date(value) : fallback;
  if (!Number.isFinite(result.getTime())) error(422, "Invalid UTC timestamp");
  return result;
}
function source(row: Row) {
  return {run_id: "sites-on-demand", generated_at: iso(), step_seconds: 60,
    sampling_policy: "on-demand-sgp4", is_mock: row.source === "mock", source_element_set_id: row.omm ? Number(row.id) : null};
}
function positionPayload(row: Row, at: Date) {
  const p = coordinate(row, at);
  return {
    satellite: {id: Number(row.id), norad_id: row.norad_id, name: row.name, active: Boolean(row.active)},
    at: at.toISOString(), segment: at.getTime() > Date.now() ? "prediction" : "history",
    position: p, interpolated: false, source: source(row),
  };
}
function groupPosition(row: Row, at: Date) {
  let position = null;
  try { position = coordinate(row, at); } catch { /* missing orbit is surfaced as null */ }
  return {
    satellite: {id: Number(row.id), name: row.name, active: Boolean(row.active),
      norad_id: row.norad_id, identifiers: row.norad_id ? {NORAD_CAT_ID: row.norad_id} : {}},
    state_time: position ? at.toISOString() : null,
    position, source: position ? source(row) : null,
  };
}

async function providerJson(ctx: Context, key: string, url: string, maxAge = REFRESH_MS): Promise<unknown> {
  const cached = await one(ctx.db, "SELECT * FROM sites_cache WHERE key=?", key);
  if (cached && Date.now() - Date.parse(asString(cached.fetched_at)) < maxAge)
    return JSON.parse(asString(cached.body));
  // All visitors share one upstream throttle so public traffic does not
  // overwhelm CelesTrak when a new query misses the shared two-hour cache.
  const window = Math.floor(Date.now() / 3_600_000);
  await run(ctx.db, `INSERT INTO sites_rate_windows(key,hits,window) VALUES('celestrak',1,?)
    ON CONFLICT(key) DO UPDATE SET hits=CASE WHEN window=excluded.window THEN hits+1 ELSE 1 END,
      window=excluded.window`, window);
  const rate = await one(ctx.db, "SELECT hits FROM sites_rate_windows WHERE key='celestrak'");
  if (Number(rate?.hits ?? 0) > 60) {
    if (cached) return JSON.parse(asString(cached.body));
    error(429, "Provider query quota reached; retry when the cache refreshes");
  }
  try {
    const res = await fetch(url, {headers: {"Accept": "application/json", "User-Agent": "WorldSatMonitor/1.1 Sites demo"}});
    if (!res.ok) throw new Error("CelesTrak returned " + res.status);
    const text = await res.text();
    if (text.length > 2_000_000) error(413, "Provider response exceeds Sites limit");
    const json = JSON.parse(text) as unknown;
    await run(ctx.db, `INSERT INTO sites_cache(key,body,fetched_at) VALUES(?,?,?)
      ON CONFLICT(key) DO UPDATE SET body=excluded.body, fetched_at=excluded.fetched_at`,
      key, text, iso());
    return json;
  } catch (ex) {
    if (cached) return JSON.parse(asString(cached.body)); // stale-if-error
    error(503, "CelesTrak data unavailable: " + (ex instanceof Error ? ex.message : "provider error"));
  }
}
async function refresh(ctx: Context, row: Row) {
  if (row.source !== "celestrak" || !row.norad_id || !row.active) return row;
  if (row.omm && Date.now() - Date.parse(asString(row.fetched_at)) < REFRESH_MS) return row;
  const id = asString(row.norad_id);
  if (!/^\d{1,9}$/.test(id)) return row;
  try {
    const value = await providerJson(ctx, "gp:" + id,
      `https://celestrak.org/NORAD/elements/gp.php?CATNR=${id}&FORMAT=JSON`);
    const omm = arr(value)[0];
    if (!omm || typeof omm !== "object") return row;
    await run(ctx.db, "UPDATE sites_satellites SET omm=?,fetched_at=?,updated_at=? WHERE id=? AND visitor_id=?",
      JSON.stringify(omm), iso(), iso(), row.id, ctx.visitor);
    return {...row, omm: JSON.stringify(omm), fetched_at: iso()};
  } catch { return row; }
}
async function count(ctx: Context, table: "sites_satellites" | "sites_groups") {
  return Number((await one(ctx.db, `SELECT count(*) AS n FROM ${table} WHERE visitor_id=?`, ctx.visitor))?.n ?? 0);
}
async function createSat(ctx: Context, data: Record<string, unknown>) {
  if (await count(ctx, "sites_satellites") >= MAX_SATELLITES) error(429, "Demo satellite limit reached");
  const id = arr(data.identifiers).find((v) =>
    v && typeof v === "object" && (v as Row).namespace === "NORAD_CAT_ID") as Row | undefined;
  const norad = id ? asString(id.value).trim() : null;
  if (norad && !/^\d{1,9}$/.test(norad)) error(422, "Invalid NORAD catalog number");
  const name = validateName(data.name), now = iso();
  const row = await run(ctx.db,
    "INSERT INTO sites_satellites(visitor_id,name,norad_id,active,source,omm,fetched_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)",
    ctx.visitor, name, norad, data.active ? 1 : 0, norad === "999999999" ? "mock" : "celestrak",
    norad === "999999999" ? JSON.stringify(syntheticOmm()) : null, null, now, now);
  return getSatellite(ctx, String(row.meta.last_row_id));
}

async function group(ctx: Context, id: string) {
  const row = await one(ctx.db, "SELECT * FROM sites_groups WHERE id=? AND visitor_id=?", id, ctx.visitor);
  if (!row) error(404, "Group not found");
  return row!;
}
async function groupPayload(ctx: Context, row: Row) {
  const stats = await one(ctx.db, `SELECT count(*) n,coalesce(sum(s.active),0) active
    FROM sites_group_members m JOIN sites_satellites s ON s.id=m.satellite_id
    WHERE m.group_id=? AND s.visitor_id=?`, row.id, ctx.visitor);
  return {
    id: Number(row.id), name: row.name, group_type: row.group_type, source: row.source,
    source_key: row.source_key, metadata: parse(row.metadata),
    member_count: Number(stats?.n ?? 0), active_member_count: Number(stats?.active ?? 0),
    created_at: row.created_at, updated_at: row.updated_at,
  };
}
async function members(ctx: Context, groupId: string) {
  await group(ctx, groupId);
  return rows(ctx.db, `SELECT s.*,m.added_at FROM sites_satellites s
    JOIN sites_group_members m ON m.satellite_id=s.id
    WHERE m.group_id=? AND s.visitor_id=? ORDER BY s.name`, groupId, ctx.visitor);
}
function status(row: Row) {
  const elements = oom(row);
  const age = elements ? sourceAge(elements) : null;
  const name = asString(row.source);
  const have = !!elements;
  const candidate = {name,index:0,selected:true,health: have ? "healthy" : "unknown",
    last_attempt_at:row.fetched_at,last_success_at:row.fetched_at,last_error_at:null,last_error:null,
    consecutive_failures:0,next_retry_at:null};
  return {
    satellite:{id:Number(row.id),name:row.name,active:Boolean(row.active)},
    provider:{name,priority:[name],selected_index:0,fallback_active:false,candidates:[candidate],
      health:candidate.health,refresh_interval_seconds:7200,last_attempt_at:row.fetched_at,
      last_success_at:row.fetched_at,last_error_at:null,last_error:null,consecutive_failures:0,next_retry_at:null},
    element_set:elements ? {id:Number(row.id),source:name,source_format:"OMM/JSON",
      epoch:age?.epoch,fetched_at:row.fetched_at,age_seconds:age?.age_seconds,freshness:age?.freshness} : null,
    propagation:elements ? {run_id:"sites-on-demand",generated_at:iso(),
      start_time:null,end_time:null,status:"ready",is_mock:name==="mock"} : null,
    current_state:elements ? {state_time:iso(),updated_at:row.fetched_at,
      source_run_id:"sites-on-demand",source_element_set_id:Number(row.id)} : null,
  };
}
const DEFINITIONS = [
  ["stations","Space Stations"],["visual","Brightest Satellites"],
  ["weather","Weather Satellites"],["resource","Earth Resources"],["science","Space Science"],
  ["starlink","Starlink"],["oneweb","OneWeb"],["iridium-NEXT","Iridium NEXT"],["gnss","GNSS"],
] as const;
async function definitions(ctx: Context, query = "") {
  const result = [];
  for (const [key,name] of DEFINITIONS) {
    if (query && !name.toLowerCase().includes(query.toLowerCase()) && !key.includes(query.toLowerCase())) continue;
    const existing = await one(ctx.db, "SELECT id FROM sites_groups WHERE visitor_id=? AND source='celestrak' AND source_key=?", ctx.visitor, key);
    result.push({provider:"celestrak",key,name,group_type:"constellation",available:true,
      local:{present:!!existing,group_id:existing ? Number(existing.id) : null,
        member_count:0,active_member_count:0}});
  }
  return result;
}

async function catalogSearch(ctx: Context, query: string) {
  if (query.length < 2 || query.length > 64) error(422, "Catalog query must contain 2-64 characters");
  // SATCAT is purpose-built for searchable names; GP/OMM is fetched only for
  // selected objects. Results cached for 2h across visitors.
  const numeric = /^\d{1,9}$/.test(query);
  const u = new URL("https://celestrak.org/satcat/records.php");
  u.searchParams.set(numeric ? "CATNR" : "NAME", query);
  u.searchParams.set("FORMAT", "JSON");
  u.searchParams.set("MAX", "20");
  const records = arr(await providerJson(ctx, "cat:" + query.toLowerCase(), u.href));
  const results = [];
  for (const raw of records.slice(0,20)) {
    if (!raw || typeof raw !== "object") continue;
    const item = raw as Row;
    const id = asString(item.NORAD_CAT_ID || item.NORAD_CAT_ID);
    const local = await one(ctx.db, "SELECT id,active,name FROM sites_satellites WHERE visitor_id=? AND norad_id=?",ctx.visitor,id);
    results.push({provider:"celestrak",provider_object_id:id,name:asString(item.OBJECT_NAME ?? item.SATNAME ?? id),
      object_type:"payload",identifiers:{NORAD_CAT_ID:id},metadata:{},
      local:{present:!!local,satellite_id:local ? Number(local.id) : null,
        active: Boolean(local?.active), name:local?.name ?? null}});
  }
  return results;
}

async function handle(ctx: Context): Promise<Response> {
  const {db,visitor,request} = ctx, url = new URL(request.url), method = request.method;
  const pathname = url.pathname;
  const parts = pathname.split("/").filter(Boolean);
  if (parts[0] !== "api" || parts[1] !== "v1") error(404, "Unknown API endpoint");
  const action = parts.slice(2);
  const a = action[0], id = action[1], op = action[2], sub = action[3];

  if (pathname === "/api/v1/health" && method === "GET")
    return response({status:"ok",runtime:"sites-d1-sgp4",time:iso()});
  if (a === "providers" && method === "GET") return response({providers:[
    {name:"mock",enabled:true,kind:"synthetic",supports_single_fetch:true,supports_group_fetch:false,supports_catalog:false},
    {name:"celestrak",enabled:true,kind:"external",supports_single_fetch:true,supports_group_fetch:true,supports_catalog:true},
  ]});

  if (a === "settings") {
    if (method === "GET") {
      const saved = await one(db,"SELECT data FROM sites_settings WHERE visitor_id=?", visitor);
      return response(saved ? JSON.parse(asString(saved.data)) : DEFAULT_APP_SETTINGS);
    }
    if (method === "PUT" || (method === "POST" && id === "reset")) {
      const value = id === "reset" ? DEFAULT_APP_SETTINGS : await body(ctx);
      if (!value || typeof value.map !== "object" || typeof value.orbit !== "object") error(422,"Invalid settings");
      await run(db,`INSERT INTO sites_settings(visitor_id,data) VALUES(?,?)
        ON CONFLICT(visitor_id) DO UPDATE SET data=excluded.data`,visitor,JSON.stringify(value));
      return response(value);
    }
  }

  if (a === "catalog") {
    if (id === "search" && method === "GET")
      return response({query:url.searchParams.get("q") ?? "",provider:"celestrak",
        results:await catalogSearch(ctx,(url.searchParams.get("q") ?? "").trim())});
    if (id === "groups") {
      if (op === undefined && method === "GET") return response({provider:"celestrak",groups:await definitions(ctx)});
      if (op === "search" && method === "GET")
        return response({provider:"celestrak",query:url.searchParams.get("q") ?? "",
          groups:await definitions(ctx,url.searchParams.get("q") ?? "")});
      if (sub === "import" && method === "POST") {
        checkWrite(ctx);
        const def = DEFINITIONS.find(([k]) => k === op);
        if (!def) error(404,"Unknown catalog group");
        if (await count(ctx,"sites_groups") >= MAX_GROUPS) error(429,"Demo group limit reached");
        const omms = arr(await providerJson(ctx,"group:"+op,
          "https://celestrak.org/NORAD/elements/gp.php?GROUP="+encodeURIComponent(op!)+"&FORMAT=JSON"));
        if (omms.length > MAX_GROUP_SIZE) error(422,
          "This group exceeds the 200-satellite public Sites demo limit; select a smaller constellation");
        const now = iso();
        const existed = await one(db,"SELECT id FROM sites_groups WHERE visitor_id=? AND source_key=?",visitor,op);
        if (existed) error(409,"Group already imported");
        const inserted = await run(db,`INSERT INTO sites_groups(visitor_id,name,group_type,source,source_key,created_at,updated_at)
          VALUES(?,?,'constellation','celestrak',?,?,?)`, visitor, def![1],op,now,now);
        const gid = Number(inserted.meta.last_row_id);
        let created = 0;
        for (const raw of omms) {
          if (!raw || typeof raw !== "object") continue;
          const omm = raw as Row,id = asString(omm.NORAD_CAT_ID);
          if (!/^\d{1,9}$/.test(id)) continue;
          let sat = await one(db,"SELECT id FROM sites_satellites WHERE visitor_id=? AND norad_id=?",visitor,id);
          if (!sat) {
            if (await count(ctx,"sites_satellites") >= MAX_SATELLITES) break;
            const made = await run(db,`INSERT INTO sites_satellites(visitor_id,name,norad_id,active,source,omm,fetched_at,created_at,updated_at)
              VALUES(?,?,?,1,'celestrak',?,?,?,?)`,visitor,asString(omm.OBJECT_NAME || id),id,JSON.stringify(omm),now,now,now);
            sat = {id:made.meta.last_row_id}; created++;
          }
          await run(db,"INSERT OR IGNORE INTO sites_group_members(group_id,satellite_id,added_at) VALUES(?,?,?)",gid,sat.id,now);
        }
        const payload = await groupPayload(ctx,await group(ctx,String(gid)));
        return response({provider:"celestrak",key:op,
          group:{id:gid,name:payload.name,member_count:payload.member_count,active_member_count:payload.active_member_count},
          catalog_members:omms.length,created_satellites:created,removed_memberships:0},201);
      }
    }
  }

  if (a === "satellites") {
    if (!id) {
      if (method === "GET") {
        const active = url.searchParams.get("active");
        const sat = await rows(db,"SELECT * FROM sites_satellites WHERE visitor_id=? ORDER BY id",visitor);
        return response({satellites:sat.filter(s => active === null || Boolean(s.active)===(active==="true")).map(satellite)});
      }
      if (method === "POST") {
        const data = await body(ctx);
        try { return response(satellite(await createSat(ctx,data)),201); }
        catch(e) { if (asString(e).includes("UNIQUE")) error(409,"Satellite already exists"); throw e; }
      }
    }
    const sat = await getSatellite(ctx,id!);
    if (!op) {
      if (method === "GET") return response(satellite(sat));
      if (method === "PATCH") {
        const b = await body(ctx), name = b.name === undefined ? sat.name : validateName(b.name);
        await run(db,"UPDATE sites_satellites SET name=?,updated_at=? WHERE id=? AND visitor_id=?",name,iso(),sat.id,visitor);
        return response(satellite({...sat,name}));
      }
      if (method === "DELETE") {
        checkWrite(ctx);
        if (sat.active) error(409,"Deactivate satellite before removal");
        await run(db,"DELETE FROM sites_satellites WHERE id=? AND visitor_id=?",sat.id,visitor);
        return empty();
      }
    }
    if ((op === "activate" || op === "deactivate") && method === "POST") {
      checkWrite(ctx);
      const active = op === "activate" ? 1 : 0;
      await run(db,"UPDATE sites_satellites SET active=?,updated_at=? WHERE id=? AND visitor_id=?",active,iso(),sat.id,visitor);
      return response(satellite({...sat,active}));
    }
    if (op === "orbital-status" && method === "GET") return response(status(await refresh(ctx,sat)));
    if (op === "position" && method === "GET")
      return response(positionPayload(await refresh(ctx,sat),atParam(url.searchParams.get("at"))));
    if (op === "track" && method === "GET") {
      const satRow = await refresh(ctx,sat), omm = oom(satRow);
      if (!omm) error(503,"No orbital elements available");
      const center = new Date();
      const start=atParam(url.searchParams.get("start"),new Date(center.getTime()-5400000));
      const end=atParam(url.searchParams.get("end"),new Date(center.getTime()+5400000));
      const step=Number(url.searchParams.get("resolution_seconds") || 60);
      if (!Number.isFinite(step)) error(422,"Invalid resolution");
      return response({resolution_seconds:Math.max(10,Math.min(3600,Math.floor(step))),source:source(satRow),
        points:sampleTrack(omm!,start,end,step,center)});
    }
  }

  if (a === "groups") {
    if (!id) {
      if (method === "GET") {
        const all = await rows(db,"SELECT * FROM sites_groups WHERE visitor_id=? ORDER BY name",visitor);
        return response({groups:await Promise.all(all.map(row => groupPayload(ctx,row)))});
      }
      if (method === "POST") {
        const b = await body(ctx);
        if (await count(ctx,"sites_groups") >= MAX_GROUPS) error(429,"Demo group limit reached");
        const name=validateName(b.name),type=["mission","custom"].includes(asString(b.group_type))?asString(b.group_type):"custom";
        const now=iso();
        const made=await run(db,`INSERT INTO sites_groups(visitor_id,name,group_type,source,metadata,created_at,updated_at)
          VALUES(?,?,?,'user',?,?,?)`,visitor,name,type,JSON.stringify(b.metadata ?? {}),now,now);
        return response(await groupPayload(ctx,await group(ctx,String(made.meta.last_row_id))),201);
      }
    }
    const g = await group(ctx,id!);
    if (!op) {
      if (method === "GET") return response(await groupPayload(ctx,g));
      if (method === "PATCH") {
        if (g.source !== "user") error(409,"Provider-managed group");
        const b=await body(ctx),name=b.name===undefined?g.name:validateName(b.name);
        await run(db,"UPDATE sites_groups SET name=?,updated_at=? WHERE id=? AND visitor_id=?",name,iso(),id,visitor);
        return response(await groupPayload(ctx,{...g,name}));
      }
      if (method === "DELETE") {
        checkWrite(ctx);
        if (g.source !== "user") error(409,"Provider-managed group");
        await run(db,"DELETE FROM sites_groups WHERE id=? AND visitor_id=?",id,visitor);return empty();
      }
    }
    if (op === "members") {
      if (!sub && method === "GET") {
        return response({members:(await members(ctx,id!)).map(s => ({...satellite(s),membership_metadata:{},added_at:s.added_at}))});
      }
      if (!sub && method === "POST") {
        const b=await body(ctx);
        if (g.source !== "user") error(409,"Provider-managed group");
        const sat=await getSatellite(ctx,asString(b.satellite_id));
        if ((await members(ctx,id!)).length >= MAX_GROUP_SIZE) error(429,"Demo group limit reached");
        await run(db,"INSERT OR IGNORE INTO sites_group_members(group_id,satellite_id,added_at) VALUES(?,?,?)",id,sat.id,iso());
        return response({...satellite(sat),membership_metadata:{},added_at:iso()},201);
      }
      if (sub && method === "DELETE") {
        checkWrite(ctx);
        if (g.source !== "user") error(409,"Provider-managed group");
        await run(db,"DELETE FROM sites_group_members WHERE group_id=? AND satellite_id=?",id,sub);return empty();
      }
    }
    if (op === "display" && method === "POST") {
      const b=await body(ctx);
      return response({group:await groupPayload(ctx,g),display:{requested_until:new Date(Date.now()+1800000).toISOString(),
        prediction_hours:Number(b.prediction_hours||3),step_seconds:Number(b.step_seconds||120)}});
    }
    if (op === "display" && method === "DELETE") { checkWrite(ctx); return empty(); }
    if (op === "positions" && method === "GET") {
      const at=atParam(url.searchParams.get("at"));
      const sat=(await members(ctx,id!)).filter(r => url.searchParams.get("active_only")!=="true" || r.active);
      return response({group:await groupPayload(ctx,g),generated_at:iso(),
        positions:sat.map(s => groupPosition(s,at))});
    }
    if (op === "orbital-status" && method === "GET") {
      const sat=await members(ctx,id!);
      const total=sat.length,available=sat.filter(s=>!!s.omm).length;
      const ages=sat.map(s=>oom(s)).filter((o):o is Omm=>o!==null).map(o=>sourceAge(o));
      const freshness={fresh:ages.filter(a=>a.freshness==="fresh").length,
        aging:ages.filter(a=>a.freshness==="aging").length,
        stale:ages.filter(a=>a.freshness==="stale").length,unknown:total-ages.length,
        oldest_epoch:ages.length?ages.map(a=>a.epoch).sort()[0]:null,
        newest_epoch:ages.length?ages.map(a=>a.epoch).sort().at(-1):null};
      const pct = (n:number)=>({count:n,percent:total?Math.round(1000*n/total)/10:0});
      const grp=await groupPayload(ctx,g);
      return response({group:grp,generated_at:iso(),refresh_interval_seconds:7200,group_provider:null,
        members:{total,active:grp.active_member_count},
        coverage:{element_sets:pct(available),current_state:pct(available),current_on_latest_elements:pct(available)},
        freshness,provider_health:{healthy:available,degraded:0,backoff:0,unknown:total-available,
          providers:{celestrak:sat.filter(s=>s.source==="celestrak").length},
          oldest_success_at:null,newest_success_at:null},
        attention:{total:total-available,members:[]},
      });
    }
    if (op === "satellites" && method === "DELETE") {
      checkWrite(ctx);
      const sat=await members(ctx,id!);
      if (sat.some(s=>Boolean(s.active))) error(409,"Deactivate members before purging");
      for (const s of sat) await run(db,"DELETE FROM sites_satellites WHERE id=? AND visitor_id=?",s.id,visitor);
      await run(db,"DELETE FROM sites_groups WHERE id=? AND visitor_id=?",id,visitor);
      return response({deleted_satellites:sat.length});
    }
  }
  if (a === "positions" && id === "current" && method === "POST") {
    const b=await body(ctx), ids=arr(b.satellite_ids).map(Number),
      norads=arr(b.norad_ids).map(String);
    if (ids.length + norads.length > MAX_SATELLITES) error(422,"Selection exceeds demo limit");
    const all=await rows(db,"SELECT * FROM sites_satellites WHERE visitor_id=?",visitor);
    const at=new Date();
    const selected=all.filter(s=>(ids.includes(Number(s.id))||norads.includes(asString(s.norad_id)))
      && (b.active_only===false || Boolean(s.active)));
    return response({generated_at:iso(),requested:ids.length+norads.length,returned:selected.length,
      positions:selected.map(s=>groupPosition(s,at))});
  }
  return error(404,"Unknown API endpoint");
}

export async function handleSitesApi(request: Request, db: DB): Promise<Response> {
  let ctx: Context | undefined;
  try {
    ctx=await createContext(request,db);
    const res=await handle(ctx);
    if (ctx.setCookie) res.headers.append("Set-Cookie",ctx.setCookie);
    res.headers.set("X-Content-Type-Options","nosniff");
    return res;
  } catch(e) {
    const err=e instanceof ApiError ? e : new ApiError(500,"Sites API error");
    const res=response({detail:err.message},err.status);
    if (ctx?.setCookie) res.headers.append("Set-Cookie",ctx.setCookie);
    return res;
  }
}
