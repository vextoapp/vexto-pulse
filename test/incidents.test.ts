import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decideIncident } from '../src/incidents.ts';

const MIN = 60_000;
const up = (ts: number) => ({ ts, ok: true });
const down = (ts: number) => ({ ts, ok: false });

test('no checks yet: nothing happens', () => {
  assert.deepEqual(decideIncident([], null), { type: 'none' });
});

test('all good: nothing happens', () => {
  assert.deepEqual(decideIncident([up(0), up(5 * MIN)], null), { type: 'none' });
});

test('a single failed check is a blip, not an incident', () => {
  assert.deepEqual(decideIncident([up(0), down(5 * MIN)], null), { type: 'none' });
  assert.deepEqual(decideIncident([down(0)], null), { type: 'none' });
});

test('two failed checks in a row open an incident starting at the first failure', () => {
  assert.deepEqual(decideIncident([down(5 * MIN), down(10 * MIN)], null), {
    type: 'open',
    started_at: 5 * MIN,
  });
});

test('further failures keep the open incident open', () => {
  const open = { id: 1, started_at: 5 * MIN };
  assert.deepEqual(decideIncident([down(10 * MIN), down(15 * MIN)], open), { type: 'none' });
});

test('a successful check closes the open incident with its duration', () => {
  const open = { id: 7, started_at: 5 * MIN };
  assert.deepEqual(decideIncident([down(15 * MIN), up(20 * MIN)], open), {
    type: 'close',
    id: 7,
    ended_at: 20 * MIN,
    duration_s: 15 * 60,
  });
});

test('after recovery, one failure is a blip again; two open a new incident', () => {
  assert.deepEqual(decideIncident([up(20 * MIN), down(25 * MIN)], null), { type: 'none' });
  assert.deepEqual(decideIncident([down(25 * MIN), down(30 * MIN)], null), {
    type: 'open',
    started_at: 25 * MIN,
  });
});
