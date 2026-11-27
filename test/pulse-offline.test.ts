import { test } from 'node:test';
import assert from 'node:assert/strict';
import { needsReferenceCheck, pulseOffline } from '../src/pulse-offline.ts';

test('a couple of failures never trigger the reference check', () => {
  assert.equal(needsReferenceCheck(2), false);
  assert.equal(pulseOffline(2, false), false);
});

test('many failures plus a failed reference means Pulse is offline', () => {
  assert.equal(needsReferenceCheck(9), true);
  assert.equal(pulseOffline(9, false), true);
});

test('many failures but the reference works means the apps really failed', () => {
  assert.equal(pulseOffline(9, true), false);
});
