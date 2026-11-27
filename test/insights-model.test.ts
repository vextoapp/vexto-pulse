import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.ts';
import { getInsights } from '../src/insights-model.ts';

const DAY = 86_400_000;
const NOW = Date.parse('2026-11-26T12:00:00Z');
const day = (offset: number) => new Date(NOW - offset * DAY).toISOString().slice(0, 10);
const app = (name: string) => ({ name, url: `https://${name.toLowerCase()}.vexto.app`, category: 'Test', description: 'Test app' });

function setup() {
  const db = openDb(':memory:');
  const check = db.prepare('INSERT INTO checks (app, ts, ok, status, ms, tls_days) VALUES (?, ?, 1, 200, 100, ?)');
  const ps = db.prepare(
    'INSERT INTO pagespeed (app, ts, performance, accessibility, best_practices, seo) VALUES (?, ?, ?, ?, ?, ?)',
  );
  const sentry = db.prepare('INSERT INTO sentry_daily (app, day, errors) VALUES (?, ?, ?)');
  return { db, check, ps, sentry };
}

test('app with no Sentry rows is "not set up"', () => {
  const { db } = setup();
  const [row] = getInsights(db, [app('A')], NOW).rows;
  assert.equal(row.errors_7d, null);
  assert.deepEqual(row.reasons, []);
});

test('Sentry project with zero errors shows 0', () => {
  const { db, sentry } = setup();
  for (let i = 0; i < 14; i++) sentry.run('A', day(i), 0);
  const [row] = getInsights(db, [app('A')], NOW).rows;
  assert.equal(row.errors_7d, 0);
  assert.equal(row.errors_prev_7d, 0);
  assert.deepEqual(row.reasons, []);
});

test('errors split into this week and last week', () => {
  const { db, sentry } = setup();
  sentry.run('A', day(0), 2);
  sentry.run('A', day(10), 5);
  const [row] = getInsights(db, [app('A')], NOW).rows;
  assert.equal(row.errors_7d, 2);
  assert.equal(row.errors_prev_7d, 5);
  assert.deepEqual(row.reasons, ['2 errors this week']);
});

test('first PageSpeed run has no previous', () => {
  const { db, ps } = setup();
  ps.run('A', NOW - DAY, 80, 95, 100, 92);
  const [row] = getInsights(db, [app('A')], NOW).rows;
  assert.deepEqual(row.scores, { performance: 80, accessibility: 95, best_practices: 100, seo: 92 });
  assert.equal(row.previous, null);
  assert.equal(row.pagespeed_at, NOW - DAY);
});

test('previous is the run before the latest', () => {
  const { db, ps } = setup();
  ps.run('A', NOW - 8 * DAY, 44, 95, 100, 92);
  ps.run('A', NOW - DAY, 38, 95, 100, 92);
  const [row] = getInsights(db, [app('A')], NOW).rows;
  assert.equal(row.scores?.performance, 38);
  assert.equal(row.previous?.performance, 44);
});

test('low scores and expiring certificate add reasons, apps needing attention sort first', () => {
  const { db, check, ps } = setup();
  check.run('A', NOW - 60_000, 80);
  check.run('B', NOW - 60_000, 12);
  ps.run('A', NOW - DAY, 90, 95, 100, 92);
  ps.run('B', NOW - DAY, 38, 85, 100, 92);
  const rows = getInsights(db, [app('A'), app('B')], NOW).rows;
  assert.deepEqual(rows.map((r) => r.name), ['B', 'A']);
  assert.deepEqual(rows[0].reasons, ['Performance 38', 'Accessibility 85', 'Certificate expires in 12 days']);
  assert.equal(rows[1].uptime_30d, 100);
});

test('uptime under 99% adds a reason', () => {
  const { db } = setup();
  const ins = db.prepare('INSERT INTO checks (app, ts, ok) VALUES (?, ?, ?)');
  for (let i = 0; i < 50; i++) ins.run('A', NOW - i * 60_000, i === 0 ? 0 : 1); // 49/50 = 98%
  const [row] = getInsights(db, [app('A')], NOW).rows;
  assert.deepEqual(row.reasons, ['Uptime 98.0%']);
});

test('failed latest PageSpeed run shows as failed and keeps a reason', () => {
  const { db } = setup();
  const ins = db.prepare(
    'INSERT INTO pagespeed (app, ts, performance, accessibility, best_practices, seo, error) VALUES (?, ?, ?, ?, ?, ?, ?)',
  );
  ins.run('A', NOW - 8 * DAY, 38, 80, 100, 92, null);
  ins.run('A', NOW - DAY, null, null, null, null, 'HTTP 429');
  const [row] = getInsights(db, [app('A')], NOW).rows;
  assert.equal(row.scores, null);
  assert.equal(row.pagespeed_error, 'HTTP 429');
  assert.deepEqual(row.reasons, ['PageSpeed failed: HTTP 429']);
});

test('previous skips failed runs', () => {
  const { db } = setup();
  const ins = db.prepare(
    'INSERT INTO pagespeed (app, ts, performance, accessibility, best_practices, seo, error) VALUES (?, ?, ?, ?, ?, ?, ?)',
  );
  ins.run('A', NOW - 15 * DAY, 44, 95, 100, 92, null);
  ins.run('A', NOW - 8 * DAY, null, null, null, null, 'HTTP 429');
  ins.run('A', NOW - DAY, 38, 95, 100, 92, null);
  const [row] = getInsights(db, [app('A')], NOW).rows;
  assert.equal(row.previous?.performance, 44);
});
