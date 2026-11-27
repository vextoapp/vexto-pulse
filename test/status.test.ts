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
