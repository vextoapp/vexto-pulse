process.env.TZ = 'Australia/Sydney';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
const { openDb } = await import('../src/db.ts');
const { getStored } = await import('../src/digest-model.ts');
const { runDigest } = await import('../src/digest-job.ts');

const apps = [{ name: 'A', url: 'https://a.vexto.app', category: 'Test', description: 'x' }];
const NOW = Date.parse('2026-11-29T20:00:00Z'); // Monday 30 Nov 07:00 Sydney → week 23 Nov

async function stub(status: number) {
  const bodies: string[] = [];
  const server = createServer((req, res) => {
    let b = '';
    req.on('data', (c) => (b += c));
    req.on('end', () => { bodies.push(b); res.statusCode = status; res.end('{"id":"x"}'); });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { base, bodies, close: () => { server.closeAllConnections(); server.close(); } };
}
const env = (base: string) => ({ RESEND_API_KEY: 'k', DIGEST_TO: 'me@example.com', RESEND_BASE: base });

test('a failed send is stored; the next run re-sends the same copy; then it stops', async () => {
  const db = openDb(':memory:');
  const bad = await stub(500);
  try {
    const log = await runDigest(db, apps, NOW, env(bad.base));
    assert.match(log, /Digest 2026-11-23: stored, not sent: HTTP 500/);
    assert.equal(bad.bodies.length, 3);
    assert.equal(getStored(db, '2026-11-23')?.email_error, 'HTTP 500');
  } finally { bad.close(); }

  const good = await stub(200);
  try {
    const log = await runDigest(db, apps, NOW, env(good.base));
    assert.match(log, /Digest 2026-11-23: sent/);
    assert.equal(JSON.parse(good.bodies[0]).subject, 'Pulse weekly, 23–29 Nov: a good week, nothing urgent');
    assert.deepEqual(JSON.parse(good.bodies[0]).to, ['me@example.com']);
    assert.ok(getStored(db, '2026-11-23')?.emailed_at);
    assert.match(await runDigest(db, apps, NOW, env(good.base)), /already sent/);
    assert.equal(good.bodies.length, 1);
  } finally { good.close(); }
});

test('without a key the digest is stored but not emailed', async () => {
  const db = openDb(':memory:');
  assert.match(await runDigest(db, apps, NOW, {}), /stored, not emailed \(no RESEND_API_KEY\/DIGEST_TO\)/);
  assert.ok(getStored(db, '2026-11-23'));
});

test('a dry run returns the text and sends nothing', async () => {
  const db = openDb(':memory:');
  const out = await runDigest(db, apps, NOW, { PULSE_DIGEST_DRY: '1', PULSE_DIGEST_WEEK: '2026-11-16' });
  assert.match(out, /^Pulse weekly, 16–22 Nov/);
});
