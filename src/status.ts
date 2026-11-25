// Builds the status model shared by the HTML page and /api/status.
import type { DatabaseSync } from 'node:sqlite';
import type { App } from './config.ts';

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

export type AppState = 'up' | 'degraded' | 'down' | 'unknown';

export type AppStatus = {
  name: string;
  url: string;
  category: string;
  state: AppState; // degraded = latest check failed but not yet an incident
  checked_at: number | null;
  http_status: number | null;
  ms: number | null;
  tls_days: number | null;
  error: string | null;
  uptime: { h24: number | null; d7: number | null; d30: number | null }; // percent
  response_24h: (number | null)[]; // ms per check, oldest first; null = failed check
};

export type Incident = { app: string; started_at: number; ended_at: number | null; duration_s: number | null };

export type Status = {
  generated_at: number;
  overall: 'operational' | 'partial_outage' | 'major_outage' | 'unknown';
  apps: AppStatus[];
  incidents: Incident[];
};

export function getStatus(db: DatabaseSync, apps: App[], now = Date.now()): Status {
  const latestQ = db.prepare(
    'SELECT ts, ok, status, ms, tls_days, error FROM checks WHERE app = ? ORDER BY ts DESC LIMIT 1',
  );
  const uptimeQ = db.prepare(`
    SELECT
      sum(CASE WHEN ts >= :h24 THEN ok END) * 100.0 / nullif(sum(ts >= :h24), 0) AS h24,
      sum(CASE WHEN ts >= :d7  THEN ok END) * 100.0 / nullif(sum(ts >= :d7), 0)  AS d7,
      sum(ok) * 100.0 / nullif(count(*), 0) AS d30
    FROM checks WHERE app = :app AND ts >= :d30
  `);
  const responseQ = db.prepare('SELECT ok, ms FROM checks WHERE app = ? AND ts >= ? ORDER BY ts');
  const openQ = db.prepare('SELECT 1 FROM incidents WHERE app = ? AND ended_at IS NULL');

  const appStatuses = apps.map((app): AppStatus => {
    const latest = latestQ.get(app.name);
    const up = uptimeQ.get({ app: app.name, h24: now - DAY_MS, d7: now - 7 * DAY_MS, d30: now - 30 * DAY_MS })!;
    const state: AppState = !latest ? 'unknown' : latest.ok === 1 ? 'up' : openQ.get(app.name) ? 'down' : 'degraded';
    return {
      ...app,
      state,
      checked_at: (latest?.ts as number) ?? null,
      http_status: (latest?.status as number) ?? null,
      ms: (latest?.ms as number) ?? null,
      tls_days: (latest?.tls_days as number) ?? null,
      error: (latest?.error as string) ?? null,
      uptime: { h24: up.h24 as number | null, d7: up.d7 as number | null, d30: up.d30 as number | null },
      response_24h: responseQ.all(app.name, now - DAY_MS).map((r) => (r.ok === 1 ? (r.ms as number) : null)),
    };
  });

  const incidents = db
    .prepare('SELECT app, started_at, ended_at, duration_s FROM incidents ORDER BY started_at DESC LIMIT 10')
    .all() as Incident[];

  return { generated_at: now, overall: overallOf(appStatuses), apps: appStatuses, incidents };
}

function overallOf(apps: AppStatus[]): Status['overall'] {
  const known = apps.filter((a) => a.state !== 'unknown');
  if (known.length === 0) return 'unknown';
  if (known.every((a) => a.state === 'down')) return 'major_outage';
  if (known.some((a) => a.state !== 'up')) return 'partial_outage';
  return 'operational';
}
