import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadApps } from '../src/config.ts';

const write = (apps: unknown) => {
  const path = join(mkdtempSync(join(tmpdir(), 'pulse-')), 'apps.json');
  writeFileSync(path, JSON.stringify(apps));
  return path;
};

test('loadApps reads name, url, category and description', () => {
  const app = { name: 'A', url: 'https://a.vexto.app', category: 'Family', description: 'Does A' };
  assert.deepEqual(loadApps(write([app])), [app]);
});

test('loadApps rejects an app without a description', () => {
  assert.throws(() => loadApps(write([{ name: 'A', url: 'https://a.vexto.app', category: 'Family' }])), /description/);
});

test('the real apps.json loads', () => {
  assert.ok(loadApps('apps.json').length > 0);
});
