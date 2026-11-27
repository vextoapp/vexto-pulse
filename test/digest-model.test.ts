process.env.TZ = 'Australia/Sydney';
import { test } from 'node:test';
import assert from 'node:assert/strict';
const { openDb } = await import('../src/db.ts');
const { weekOf } = await import('../src/week.ts');
const m = await import('../src/digest-model.ts');

const W = weekOf('2026-11-16'); // Mon 16 Nov 00:00 AEDT = 2026-11-15T13:00Z
const H = 3_600_000, MIN = 60_000;
const app = (name: string) => ({ name, url: `https://${name.toLowerCase()}.vexto.app`, category: 'Test', description: 'x' });

function setup() {
  const db = openDb(':memory:');
  const check = db.prepare('INSERT INTO checks (app, ts, ok, ms, tls_days) VALUES (?, ?, ?, ?, ?)');
  const incident = db.prepare('INSERT INTO incidents (app, started_at, ended_at, duration_s) VALUES (?, ?, ?, ?)');
  const sentry = db.prepare('INSERT INTO sentry_daily (app, day, errors) VALUES (?, ?, ?)');
  const ps = db.prepare('INSERT INTO pagespeed (app, ts, performance, accessibility, best_practices, seo, error) VALUES (?, ?, ?, ?, ?, ?, ?)');
  return { db, check, incident, sentry, ps };
}

test('uptime and average response use only checks inside the week', () => {
  const { db, check } = setup();
  check.run('A', W.start - H, 0, null, 60); // before: ignored
  check.run('A', W.start + H, 1, 1000, 60);
  check.run('A', W.start + 2 * H, 1, 3000, 60);
  check.run('A', W.start + 3 * H, 0, null, 55);
  check.run('A', W.end + H, 0, null, 50); // after: ignored
  const [a] = m.appWeeks(db, [app('A')], W);
  assert.equal(a.uptime, (2 / 3) * 100);
  assert.equal(a.avg_ms, 2000);
  assert.equal(a.tls_days, 55);
});

test('outages are clipped to the week', () => {
  const { db, incident } = setup();
  incident.run('A', W.start - 30 * MIN, W.start + 30 * MIN, 3600);
  incident.run('A', W.end - 10 * MIN, null, null); // ongoing past the end
  const [a] = m.appWeeks(db, [app('A')], W);
  assert.equal(a.outage_ms, 40 * MIN);
  assert.deepEqual(a.outages.map((o: { ms: number }) => o.ms), [30 * MIN, 10 * MIN]);
});

test('errors: null when not linked to Sentry, 0 when linked but quiet', () => {
  const { db, sentry } = setup();
  sentry.run('B', '2026-11-01', 4); // linked, but nothing this week
  sentry.run('C', '2026-11-15', 2);
  sentry.run('C', '2026-11-21', 3);
  sentry.run('C', '2026-11-22', 9); // the day after the week's UTC range
  const [a, b, c] = m.appWeeks(db, [app('A'), app('B'), app('C')], W);
  assert.equal(a.errors, null);
  assert.equal(b.errors, 0);
  assert.equal(c.errors, 5);
});

test('scores are the latest successful run before the week ends, with the one before it', () => {
  const { db, ps } = setup();
  ps.run('A', W.start - 10 * 24 * H, 60, 85, 100, 100, null);
  ps.run('A', W.start - 3 * 24 * H, null, null, null, null, 'HTTP 500');
  ps.run('A', W.start + 24 * H, 70, 92, 100, 100, null);
  ps.run('A', W.end + H, 99, 99, 99, 99, null); // after the week: ignored
  const [a] = m.appWeeks(db, [app('A')], W);
  assert.equal(a.scores?.performance, 70);
  assert.equal(a.prev_scores?.performance, 60);
});

test('an app with no checks that week has no uptime', () => {
  const { db } = setup();
  const [a] = m.appWeeks(db, [app('A')], W);
  assert.equal(a.uptime, null);
  assert.equal(a.avg_ms, null);
});
