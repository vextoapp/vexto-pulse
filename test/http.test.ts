import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type RequestListener } from 'node:http';
import type { AddressInfo } from 'node:net';
import { getJson } from '../src/http.ts';

async function serve(handler: RequestListener): Promise<{ url: string; close: () => void }> {
  const server = createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return { url: `http://127.0.0.1:${port}/`, close: () => { server.closeAllConnections(); server.close(); } };
}

test('getJson returns parsed JSON on 200', async () => {
  const s = await serve((_req, res) => res.end('{"ok":1}'));
  try {
    assert.deepEqual(await getJson(s.url), { ok: 1 });
  } finally {
    s.close();
  }
});

test('getJson rejects on 500 without leaking the URL', async () => {
  const s = await serve((_req, res) => {
    res.statusCode = 500;
    res.end('{}');
  });
  try {
    await assert.rejects(getJson(`${s.url}?key=secret`), (e: Error) => e.message === 'HTTP 500');
  } finally {
    s.close();
  }
});

test('getJson times out', async () => {
  const s = await serve(() => {}); // never responds
  try {
    await assert.rejects(getJson(s.url, {}, 100), /Timed out/);
  } finally {
    s.close();
  }
});
