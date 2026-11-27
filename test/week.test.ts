process.env.TZ = 'Australia/Sydney';
import { test } from 'node:test';
import assert from 'node:assert/strict';
const { lastCompletedWeek, weekOf, previousWeek, sentryDays } = await import('../src/week.ts');

test('the last completed Sydney week on Friday 27 Nov is 16–22 Nov', () => {
  const w = lastCompletedWeek(Date.parse('2026-11-27T01:00:00Z'));
  assert.equal(w.key, '2026-11-16');
  assert.equal(w.label, '16–22 Nov');
  assert.equal(w.start, Date.parse('2026-11-15T13:00:00Z')); // Monday 00:00 AEDT
});

test('Monday 07:00 and a Wednesday catch-up pick the same week', () => {
  assert.equal(lastCompletedWeek(Date.parse('2026-11-29T20:00:00Z')).key, '2026-11-23');
  assert.equal(lastCompletedWeek(Date.parse('2026-12-01T22:00:00Z')).key, '2026-11-23');
});

test('labels across months', () => {
  assert.equal(weekOf('2026-11-30').label, '30 Nov – 6 Dec');
});

test('the week when daylight saving ends is 169 hours', () => {
  const w = weekOf('2026-03-30');
  assert.equal(w.end - w.start, 169 * 3_600_000);
});

test('previous week and Sentry days', () => {
  assert.equal(previousWeek(weekOf('2026-11-23')).key, '2026-11-16');
  const days = sentryDays(weekOf('2026-11-16'));
  assert.equal(days.length, 7);
  assert.equal(days[0], '2026-11-15');
  assert.equal(days[6], '2026-11-21');
});
