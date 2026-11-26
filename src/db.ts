import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

// All timestamps are Unix epoch milliseconds. Days in daily_rollups are UTC dates.
export function openDb(path = process.env.PULSE_DB ?? 'data/pulse.db'): DatabaseSync {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA busy_timeout = 5000;

    CREATE TABLE IF NOT EXISTS checks (
      id       INTEGER PRIMARY KEY,
      app      TEXT NOT NULL,
      ts       INTEGER NOT NULL,
      ok       INTEGER NOT NULL,
      status   INTEGER,
      ms       INTEGER,
      tls_days INTEGER,
      error    TEXT
    ) STRICT;
    CREATE INDEX IF NOT EXISTS checks_app_ts ON checks (app, ts);

    CREATE TABLE IF NOT EXISTS incidents (
      id         INTEGER PRIMARY KEY,
      app        TEXT NOT NULL,
      started_at INTEGER NOT NULL,
      ended_at   INTEGER,
      duration_s INTEGER
    ) STRICT;

    CREATE TABLE IF NOT EXISTS daily_rollups (
      app       TEXT NOT NULL,
      day       TEXT NOT NULL,
      checks    INTEGER NOT NULL,
      ok_checks INTEGER NOT NULL,
      avg_ms    REAL,
      PRIMARY KEY (app, day)
    ) STRICT;

    -- v2 insights. Scores are 0–100, null when a category failed or the whole run failed (error set).
    CREATE TABLE IF NOT EXISTS pagespeed (
      app            TEXT NOT NULL,
      ts             INTEGER NOT NULL,
      performance    INTEGER,
      accessibility  INTEGER,
      best_practices INTEGER,
      seo            INTEGER,
      error          TEXT
    ) STRICT;
    CREATE INDEX IF NOT EXISTS pagespeed_app_ts ON pagespeed (app, ts);

    -- Accepted Sentry error events per app per UTC day. No rows for an app = no Sentry project.
    CREATE TABLE IF NOT EXISTS sentry_daily (
      app    TEXT NOT NULL,
      day    TEXT NOT NULL,
      errors INTEGER NOT NULL,
      PRIMARY KEY (app, day)
    ) STRICT;
  `);
  return db;
}
