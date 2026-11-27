// One run: check every app, store results, update incidents, refresh rollups, prune old checks.
// Run every 5 minutes by the systemd timer (deploy/vexto-pulse-checker.timer).
import { loadApps } from './config.ts';
import { openDb } from './db.ts';
import { checkApp } from './check.ts';
import { decideIncident } from './incidents.ts';
import { REFERENCE_URL, needsReferenceCheck, pulseOffline } from './pulse-offline.ts';

const DAY_MS = 86_400_000;
const RETENTION_DAYS = 90;

const apps = loadApps();
const db = openDb();
const ts = Date.now();
const results = await Promise.all(apps.map((app) => checkApp(app.url)));
const failed = results.filter((r) => !r.ok).length;

if (needsReferenceCheck(failed) && pulseOffline(failed, (await checkApp(REFERENCE_URL)).ok)) {
  // Don't store this run: it says nothing about the apps, so it mustn't open incidents or lower uptime.
  db.prepare('INSERT INTO pulse_offline (ts, failed) VALUES (?, ?)').run(ts, failed);
  console.log(`Pulse offline: ${failed} of ${apps.length} apps failed and the reference failed too`);
  db.close();
  process.exit(0);
}

const insertCheck = db.prepare(
  'INSERT INTO checks (app, ts, ok, status, ms, tls_days, error) VALUES (?, ?, ?, ?, ?, ?, ?)',
);
const lastTwo = db.prepare('SELECT ts, ok FROM checks WHERE app = ? ORDER BY ts DESC LIMIT 2');
const openIncident = db.prepare(
  'SELECT id, started_at FROM incidents WHERE app = ? AND ended_at IS NULL',
);
const startIncident = db.prepare('INSERT INTO incidents (app, started_at) VALUES (?, ?)');
const endIncident = db.prepare('UPDATE incidents SET ended_at = ?, duration_s = ? WHERE id = ?');

db.exec('BEGIN');
try {
  apps.forEach((app, i) => {
    const r = results[i];
    insertCheck.run(app.name, ts, r.ok ? 1 : 0, r.status, r.ms, r.tls_days, r.error);

    const recent = lastTwo
      .all(app.name)
      .map((row) => ({ ts: Number(row.ts), ok: row.ok === 1 }))
      .reverse();
    const open = openIncident.get(app.name) as { id: number; started_at: number } | undefined;
    const action = decideIncident(recent, open ?? null);

    if (action.type === 'open') startIncident.run(app.name, action.started_at);
    if (action.type === 'close') endIncident.run(action.ended_at, action.duration_s, action.id);

    const state = r.ok ? `up ${r.status} ${r.ms}ms` : `DOWN ${r.error}`;
    console.log(`${app.name}: ${state}, tls ${r.tls_days ?? '-'}d${action.type === 'none' ? '' : `, incident ${action.type}`}`);
  });

  // Refresh today's and yesterday's rollups (yesterday catches checks just before midnight UTC).
  const since = Math.floor(ts / DAY_MS) * DAY_MS - DAY_MS;
  db.prepare(`
    INSERT INTO daily_rollups (app, day, checks, ok_checks, avg_ms)
    SELECT app, date(ts / 1000, 'unixepoch') AS day, count(*), sum(ok), avg(ms)
    FROM checks WHERE ts >= ? GROUP BY app, day
    ON CONFLICT (app, day) DO UPDATE SET
      checks = excluded.checks, ok_checks = excluded.ok_checks, avg_ms = excluded.avg_ms
  `).run(since);

  db.prepare('DELETE FROM checks WHERE ts < ?').run(ts - RETENTION_DAYS * DAY_MS);
  db.exec('COMMIT');
} catch (err) {
  db.exec('ROLLBACK');
  throw err;
} finally {
  db.close();
}
