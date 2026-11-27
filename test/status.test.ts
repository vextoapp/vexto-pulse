import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dayStates } from '../src/status.ts';

const NOW = Date.parse('2026-11-27T10:00:00Z');
const MIN = 60_000;
const day = (iso: string) => iso.slice(0, 10);
const tracked = (...days: string[]) => new Set(days);

test('days without checks are not tracked, oldest first, 30 entries', () => {
  const s = dayStates(tracked('2026-11-27'), [], NOW);
  assert.equal(s.length, 30);
  assert.equal(s[0], 'none');
  assert.equal(s[29], 'ok');
});

test('a tracked day with no incident is ok (single blips never count)', () => {
  assert.equal(dayStates(tracked('2026-11-26'), [], NOW)[28], 'ok');
});

test('under 30 minutes of outage is minor', () => {
  const start = Date.parse('2026-11-26T05:00:00Z');
  const s = dayStates(tracked('2026-11-26'), [{ started_at: start, ended_at: start + 20 * MIN }], NOW);
  assert.equal(s[28], 'minor');
});

test('an outage across midnight UTC counts on both days', () => {
  const start = Date.parse('2026-11-25T23:00:00Z');
  const s = dayStates(tracked('2026-11-25', '2026-11-26'), [{ started_at: start, ended_at: start + 120 * MIN }], NOW);
  assert.deepEqual([s[27], s[28]], ['major', 'major']);
});

test('an ongoing outage counts up to now', () => {
  const s = dayStates(tracked(day('2026-11-27')), [{ started_at: NOW - 45 * MIN, ended_at: null }], NOW);
  assert.equal(s[29], 'major');
});

test('consecutive offline runs merge into one spell', async () => {
  const { offlineSpells } = await import('../src/status.ts');
  const t = Date.parse('2026-11-26T19:55:00Z'), RUN = 5 * MIN;
  assert.deepEqual(offlineSpells([t, t + RUN, t + 2 * RUN, t + 30 * RUN]), [
    { started_at: t + 30 * RUN, ended_at: t + 30 * RUN },
    { started_at: t, ended_at: t + 2 * RUN },
  ]);
});

test('recent problems only include incidents from the last 30 days', async () => {
  const { openDb } = await import('../src/db.ts');
  const { getStatus } = await import('../src/status.ts');
  const db = openDb(':memory:');
  const ins = db.prepare('INSERT INTO incidents (app, started_at, ended_at, duration_s) VALUES (?, ?, ?, ?)');
  const DAY = 86_400_000;
  ins.run('A', NOW - 90 * DAY, NOW - 90 * DAY + 600_000, 600);
  ins.run('A', NOW - 2 * DAY, NOW - 2 * DAY + 600_000, 600);
  const s = getStatus(db, [{ name: 'A', url: 'https://a.vexto.app', category: 'Family', description: 'A' }], NOW);
  assert.deepEqual(s.incidents.map((i) => i.started_at), [NOW - 2 * DAY]);
});
