import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { STATIC } from '../src/static-files.ts';

const read = (f: string) => readFileSync(new URL(`../public/${f}`, import.meta.url));

test('every static file exists and has the right type', () => {
  assert.deepEqual(
    Object.fromEntries(Object.entries(STATIC).map(([path, s]) => [path, s.type])),
    {
      '/geist.woff2': 'font/woff2',
      '/favicon.svg': 'image/svg+xml',
      '/apple-touch-icon.png': 'image/png',
      '/manifest.webmanifest': 'application/manifest+json',
    },
  );
  for (const s of Object.values(STATIC)) assert.ok(read(s.file).length > 0, s.file);
});

test('the manifest is valid JSON that starts at / and lists both icons', () => {
  const m = JSON.parse(read(STATIC['/manifest.webmanifest'].file).toString());
  assert.equal(m.name, 'Vexto Pulse');
  assert.equal(m.start_url, '/');
  assert.equal(m.display, 'standalone');
  assert.deepEqual(m.icons.map((i: { src: string }) => i.src), ['/favicon.svg', '/apple-touch-icon.png']);
});

test('the touch icon is a 180×180 PNG', () => {
  const b = read(STATIC['/apple-touch-icon.png'].file);
  assert.deepEqual([...b.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  assert.equal(b.readUInt32BE(16), 180);
  assert.equal(b.readUInt32BE(20), 180);
});
