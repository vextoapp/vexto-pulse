import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { parseScores, runPagespeed } from '../src/pagespeed.ts';

const allNull = { performance: null, accessibility: null, best_practices: null, seo: null };

test('parseScores reads the four categories', () => {
  const json = JSON.parse(readFileSync(new URL('./fixtures/pagespeed.json', import.meta.url), 'utf8'));
  assert.deepEqual(parseScores(json), { performance: 71, accessibility: 95, best_practices: 100, seo: null });
});

test('parseScores returns all null for an empty object', () => {
  assert.deepEqual(parseScores({}), allNull);
});

test('runPagespeed returns error and null scores when the API fails', async () => {
  let calls = 0;
  const server = createServer((_req, res) => {
    calls++;
    res.statusCode = 500;
    res.end('{}');
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  process.env.PAGESPEED_BASE = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
  try {
    assert.deepEqual(await runPagespeed('https://example.vexto.app', 'k'), { ...allNull, error: 'HTTP 500' });
    assert.equal(calls, 2); // one retry
  } finally {
    delete process.env.PAGESPEED_BASE;
    server.close();
  }
});
