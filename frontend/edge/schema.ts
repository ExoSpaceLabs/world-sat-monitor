/**
 * The Sites backend is self-initializing because its D1 database is provisioned
 * when the Site is created. Schema initialization is idempotent across workers.
 *
 * Every user-owned record is scoped to an unguessable server-issued visitor ID.
 * This is a PUBLIC DEMONSTRATION, not an authenticated multi-user account store.
 */
export const schemaSql = `
CREATE TABLE IF NOT EXISTS sites_visitors (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  requests_today INTEGER NOT NULL DEFAULT 0,
  request_day TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sites_settings (
  visitor_id TEXT PRIMARY KEY REFERENCES sites_visitors(id) ON DELETE CASCADE,
  data TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sites_satellites (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  visitor_id TEXT NOT NULL REFERENCES sites_visitors(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  norad_id TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  object_type TEXT NOT NULL DEFAULT 'payload',
  source TEXT NOT NULL DEFAULT 'celestrak',
  omm TEXT,
  fetched_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(visitor_id, norad_id)
);
CREATE INDEX IF NOT EXISTS sites_satellites_owner ON sites_satellites(visitor_id);
CREATE TABLE IF NOT EXISTS sites_groups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  visitor_id TEXT NOT NULL REFERENCES sites_visitors(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  group_type TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'user',
  source_key TEXT,
  metadata TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS sites_groups_owner ON sites_groups(visitor_id);
CREATE TABLE IF NOT EXISTS sites_group_members (
  group_id INTEGER NOT NULL REFERENCES sites_groups(id) ON DELETE CASCADE,
  satellite_id INTEGER NOT NULL REFERENCES sites_satellites(id) ON DELETE CASCADE,
  added_at TEXT NOT NULL,
  PRIMARY KEY(group_id,satellite_id)
);
CREATE TABLE IF NOT EXISTS sites_rate_windows (
  key TEXT PRIMARY KEY,
  hits INTEGER NOT NULL,
  window INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sites_cache (
  key TEXT PRIMARY KEY,
  body TEXT NOT NULL,
  fetched_at TEXT NOT NULL
);
`;
