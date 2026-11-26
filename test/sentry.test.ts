import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseDaily, sentrySlug } from '../src/sentry.ts';

const fixture = (f: string) => JSON.parse(readFileSync(new URL(`./fixtures/${f}`, import.meta.url), 'utf8'));

test('sentrySlug lower-cases and hyphenates app names', () => {
  assert.equal(sentrySlug('PageTurn'), 'pageturn');
  assert.equal(sentrySlug("Lenny's Product Brain"), 'lennys-product-brain');
  assert.equal(sentrySlug('Lenny’s Product Brain'), 'lennys-product-brain');
  assert.equal(sentrySlug('Mohammad Syed'), 'mohammad-syed');
});

test('parseDaily maps project ids to slugs and days', () => {
  const map = parseDaily(fixture('sentry-stats.json'), fixture('sentry-projects.json'));
  assert.deepEqual(map.get('stackmark'), [
    { day: '2026-11-25', errors: 3 },
    { day: '2026-11-26', errors: 0 },
  ]);
});

test('parseDaily includes a project with no errors as zeros', () => {
  const map = parseDaily(fixture('sentry-stats.json'), fixture('sentry-projects.json'));
  assert.deepEqual(map.get('luna'), [
    { day: '2026-11-25', errors: 0 },
    { day: '2026-11-26', errors: 0 },
  ]);
});

test('parseDaily still links projects when Sentry returns no days (no errors anywhere)', () => {
  const now = Date.parse('2026-11-26T12:00:00Z');
  const map = parseDaily({ intervals: [], groups: [] }, fixture('sentry-projects.json'), now);
  assert.deepEqual(map.get('stackmark'), [{ day: '2026-11-26', errors: 0 }]);
});
