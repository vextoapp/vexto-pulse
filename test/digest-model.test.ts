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
  for (const d of ['15', '16', '17', '18', '19', '20', '21']) sentry.run('B', `2026-11-${d}`, 0); // linked, quiet week
  for (const d of ['15', '16', '17', '18', '19', '20', '21']) sentry.run('C', `2026-11-${d}`, d === '15' ? 2 : d === '21' ? 3 : 0);
  sentry.run('C', '2026-11-22', 9); // the day after the week's UTC range
  sentry.run('D', '2026-11-20', 4); // only part of the week stored: not enough to count
  const [a, b, c, d] = m.appWeeks(db, [app('A'), app('B'), app('C'), app('D')], W);
  assert.equal(a.errors, null);
  assert.equal(b.errors, 0);
  assert.equal(c.errors, 5);
  assert.equal(d.errors, null);
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

// ---- Task 3: rules ----
const aw = (name: string, over: Partial<import('../src/digest-model.ts').AppWeek> = {}) => ({
  name, uptime: 100, outage_ms: 0, outages: [], avg_ms: 1000, errors: null, tls_days: 60,
  scores: null, prev_scores: null, ...over,
});
const sc = (performance: number, accessibility: number) => ({ performance, accessibility, best_practices: 100, seo: 100 });
const rules = (cur: object[], prev: object[] | null = null) => m.findIssues(cur as never, prev as never).map((i: { rule: number }) => i.rule);

test('rule 1: outages of 30 minutes or more', () => {
  assert.deepEqual(rules([aw('A', { outage_ms: 29 * MIN })]), []);
  const [i] = m.findIssues([aw('Kata', { outage_ms: 80 * MIN })] as never, null);
  assert.equal(i.rule, 1);
  assert.equal(i.text, 'Kata was down for 1 hour 20 minutes.');
});

test('rule 2: errors rising', () => {
  assert.deepEqual(rules([aw('A', { errors: 4 })], [aw('A', { errors: 0 })]), []);
  assert.deepEqual(rules([aw('A', { errors: 5 })], [aw('A', { errors: 3 })]), []);
  const [i] = m.findIssues([aw('EclipSend', { errors: 12 })] as never, [aw('EclipSend', { errors: 3 })] as never);
  assert.equal(i.text, 'EclipSend had 12 errors, up from 3.');
  assert.deepEqual(rules([aw('A', { errors: 6 })], [aw('A', { errors: 3 })]), [2]);
  assert.deepEqual(rules([aw('A', { errors: 5 })], [aw('A', { errors: 0 })]), [2]);
});

test('rule 3: uptime under 99%', () => {
  assert.deepEqual(rules([aw('A', { uptime: 99 })]), []);
  const [i] = m.findIssues([aw('Basil', { uptime: 98.2 })] as never, null);
  assert.equal(i.text, 'Basil was up 98.2% of the time.');
});

test('rule 4: certificate under 14 days', () => {
  assert.deepEqual(rules([aw('A', { tls_days: 14 })]), []);
  assert.equal(m.findIssues([aw('FamilySync', { tls_days: 9 })] as never, null)[0].text, "FamilySync's certificate renews in 9 days.");
});

test('rule 5: weak or falling PageSpeed', () => {
  assert.deepEqual(rules([aw('A', { scores: sc(50, 90) })]), []);
  assert.equal(m.findIssues([aw('Kata', { scores: sc(80, 89) })] as never, null)[0].text, "Kata's accessibility score is 89.");
  assert.deepEqual(rules([aw('A', { scores: sc(71, 95), prev_scores: sc(80, 95) })]), []);
  assert.equal(
    m.findIssues([aw('Stackmark', { scores: sc(61, 95), prev_scores: sc(74, 95) })] as never, null)[0].text,
    "Stackmark's performance fell from 74 to 61.",
  );
});

test('rule 6: much slower', () => {
  assert.deepEqual(rules([aw('A', { avg_ms: 1900 })], [aw('A', { avg_ms: 900 })]), []);
  assert.deepEqual(rules([aw('A', { avg_ms: 3800 })], [aw('A', { avg_ms: 2000 })]), []);
  const [i] = m.findIssues([aw('Switchboard', { avg_ms: 4100 })] as never, [aw('Switchboard', { avg_ms: 1900 })] as never);
  assert.equal(i.text, 'Switchboard got slower: 4.1 s, up from 1.9 s.');
});

test('issues sort by rule, then size', () => {
  const issues = m.findIssues(
    [aw('A', { errors: 9 }), aw('B', { outage_ms: 40 * MIN }), aw('C', { outage_ms: 90 * MIN })] as never,
    [aw('A', { errors: 0 }), aw('B'), aw('C')] as never,
  );
  assert.deepEqual(issues.map((i: { app: string }) => i.app), ['C', 'B', 'A']);
});

test('an app not linked to Sentry never raises error issues or changes', () => {
  assert.deepEqual(rules([aw('A', { errors: null })], [aw('A', { errors: null })]), []);
  assert.deepEqual(m.changes([aw('A', { errors: null })] as never, [aw('A', { errors: null })] as never), []);
});

test('revisit: done, still open, or nothing', () => {
  const last = m.findIssues([aw('EclipSend', { errors: 12 })] as never, [aw('EclipSend', { errors: 3 })] as never)[0];
  const done = m.revisit(last, [aw('EclipSend', { errors: 0 })] as never, [aw('EclipSend', { errors: 12 })] as never);
  assert.deepEqual([done?.done, done?.text], [true, 'Done: EclipSend errors 12 → 0.']);
  const a11y = m.findIssues([aw('Kata', { scores: sc(80, 89) })] as never, null)[0];
  const open = m.revisit(a11y, [aw('Kata', { scores: sc(80, 89) })] as never, null);
  assert.deepEqual([open?.done, open?.text], [false, 'Still open: Kata accessibility 89.']);
  assert.equal(m.revisit(null, [] as never, null), null);
});

test('changes: big speed changes, capped at 6', () => {
  const ch = m.changes([aw('Cashew', { avg_ms: 300 })] as never, [aw('Cashew', { avg_ms: 1600 })] as never);
  assert.deepEqual(ch, ['Cashew got 5× faster (1.6 s → 0.3 s).']);
  const many = Array.from({ length: 8 }, (_, i) => `App${i}`);
  assert.equal(m.changes(many.map((n) => aw(n, { avg_ms: 300 })) as never, many.map((n) => aw(n, { avg_ms: 3000 })) as never).length, 6);
});

test('verdict by number of issues', () => {
  assert.deepEqual([m.verdict(0), m.verdict(1), m.verdict(2), m.verdict(3)], ['A good week', 'A mixed week', 'A mixed week', 'A rough week']);
});

test('quick win: lowest accessibility at 95 or below', () => {
  assert.equal(m.quickWin([aw('A', { scores: sc(90, 93) }), aw('B', { scores: sc(90, 91) })] as never), "B's accessibility score is 91, an easy one to raise.");
  assert.equal(m.quickWin([aw('A', { scores: sc(90, 96) })] as never), null);
});

// ---- Task 4: trend ----
test('8-week trend ends with this week; empty weeks have no uptime', () => {
  const { db, check, sentry } = setup();
  check.run('A', W.start + H, 1, 500, 60);
  check.run('A', W.start + 2 * H, 0, null, 60);
  for (const d of ['15', '16', '17', '18', '19', '20', '21']) sentry.run('A', `2026-11-${d}`, d === '16' ? 4 : 0);
  const t = m.trend(db, [app('A'), app('B')], W);
  assert.equal(t.length, 8);
  assert.equal(t[7].key, '2026-11-16');
  assert.equal(t[7].label, '16–22 Nov');
  assert.equal(t[7].uptime, 50);
  assert.equal(t[7].errors, 4);
  assert.equal(t[0].key, '2026-09-28');
  assert.equal(t[0].uptime, null);
  assert.equal(t[0].errors, null); // no Sentry days stored that far back
});

// ---- Task 5: build and store ----
test('a first digest has no revisit; the next week revisits its focus', () => {
  const { db, sentry, check } = setup();
  check.run('A', W.start + H, 1, 500, 60);
  check.run('A', weekOf('2026-11-23').start + H, 1, 500, 60);
  for (const d of ['15', '16', '17', '18', '19', '20', '21']) sentry.run('A', `2026-11-${d}`, ['15', '16', '17'].includes(d) ? 4 : 0); // 12 errors in week 16 Nov
  for (const d of ['22', '23', '24', '25', '26', '27', '28']) sentry.run('A', `2026-11-${d}`, 0);
  const first = m.buildDigest(db, [app('A')], W);
  assert.equal(first.revisit, null);
  assert.equal(first.focus?.text, 'A had 12 errors, up from 0.');
  assert.equal(first.verdict, 'A mixed week');
  assert.equal(first.issues_count, 1);
  m.storeDigest(db, first);
  const next = m.buildDigest(db, [app('A')], weekOf('2026-11-23'));
  assert.equal(next.revisit?.text, 'Done: A errors 12 → 0.');
  assert.equal(next.quick_win, null);
});

test('an emailed digest is frozen', () => {
  const { db, check } = setup();
  check.run('A', W.start + H, 1, 500, 60);
  const d = m.buildDigest(db, [app('A')], W);
  m.storeDigest(db, d);
  m.markSent(db, d.week, null);
  m.storeDigest(db, { ...d, verdict: 'changed' });
  const stored = m.getStored(db, d.week);
  assert.equal(stored?.digest.verdict, 'A good week');
  assert.ok(stored?.emailed_at);
  assert.equal(stored?.email_error, null);
});

test('a failed send is recorded, and weeks list newest first', () => {
  const { db } = setup();
  m.storeDigest(db, m.buildDigest(db, [app('A')], W));
  m.storeDigest(db, m.buildDigest(db, [app('A')], weekOf('2026-11-23')));
  m.markSent(db, '2026-11-23', 'HTTP 500');
  assert.deepEqual(m.getStored(db, '2026-11-23')?.email_error, 'HTTP 500');
  assert.equal(m.getStored(db, '2026-11-23')?.emailed_at, null);
  assert.deepEqual(m.listWeeks(db), [{ key: '2026-11-23', label: '23–29 Nov' }, { key: '2026-11-16', label: '16–22 Nov' }]);
});


// ---- Final review fixes ----
test('a long outage counts once, not also as low uptime', () => {
  assert.deepEqual(rules([aw('A', { outage_ms: 120 * MIN, uptime: 98.8 })]), [1]);
});

test('revisit with no data this week is not "Done"', () => {
  const last = m.findIssues([aw('Kata', { uptime: 95 })] as never, null)[0];
  const r = m.revisit(last, [aw('Kata', { uptime: null })] as never, null);
  assert.deepEqual([r?.done, r?.text], [false, 'Not checked: no data this week for Kata.']);
});

test('a fixed outage reads "none", not "1 minute"', () => {
  const last = m.findIssues([aw('Kata', { outage_ms: 80 * MIN })] as never, null)[0];
  assert.equal(m.revisit(last, [aw('Kata')] as never, null)?.text, 'Done: Kata outage 1 hour 20 minutes → none.');
});

test('a week with no checks is "Not enough data yet"', () => {
  const { db } = setup();
  const d = m.buildDigest(db, [app('A')], W);
  assert.equal(d.verdict, 'Not enough data yet');
});

test('newly linked Sentry projects show as a change', () => {
  assert.deepEqual(m.changes([aw('A', { errors: 2 })] as never, [aw('A', { errors: null })] as never), ['A is now linked to Sentry.']);
});
