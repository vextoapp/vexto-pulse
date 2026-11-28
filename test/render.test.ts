import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderPage } from '../src/render.ts';
import type { AppStatus, Status } from '../src/status.ts';

const NOW = Date.parse('2026-11-27T10:00:00Z');
const app = (name: string, category: string, over: Partial<AppStatus> = {}): AppStatus => ({
  name, url: `https://${name.toLowerCase()}.vexto.app`, category, description: `${name} does things`,
  state: 'up', checked_at: NOW - 60_000, http_status: 200, ms: 900, tls_days: 60, error: null,
  uptime: { h24: 100, d7: 100, d30: 100 }, response_24h: [], days: Array(30).fill('ok'), ...over,
});
const status = (apps: AppStatus[], over: Partial<Status> = {}): Status => ({
  generated_at: NOW, overall: apps.every((a) => a.state === 'up') ? 'operational' : 'partial_outage',
  apps, incidents: [], pulse_offline: [], ...over,
});

test('all working says so', () => {
  const html = renderPage(status([app('A', 'Family'), app('B', 'Money')]));
  assert.match(html, /<h1>All 2 apps are working\.<\/h1>/);
});

test('headline names a down app and counts the rest', () => {
  const html = renderPage(status([app('Kata', 'Family', { state: 'down' }), app('B', 'Family'), app('C', 'Money')]));
  assert.match(html, /<h1>Kata is down\. <span class="rest">The other 2 are working\.<\/span><\/h1>/);
});

test('one heartbeat per app, flat for a down app', () => {
  const html = renderPage(status([app('A', 'Family'), app('Kata', 'Family', { state: 'down' }), app('C', 'Money')]));
  const beats = html.match(/<path class="beat [a-z]+"/g) ?? [];
  assert.equal(beats.length, 3);
  assert.match(html, /<path class="beat down" d="M[\d.]+ 58 L[\d.]+ 58">/);
});

test('colour key comes before the filters, groups keep apps.json order', () => {
  const html = renderPage(status([app('A', 'Flagship products'), app('B', 'Family'), app('C', 'Flagship products')]));
  assert.ok(html.indexOf('class="key"') < html.indexOf('class="filters"'));
  const groups = [...html.matchAll(/<h2 id="g-\d+">([^<]+)/g)].map((m) => m[1]);
  assert.deepEqual(groups, ['Flagship products', 'Family']);
});

test('escapes names and descriptions', () => {
  const html = renderPage(status([app('<b>X', 'Family', { url: 'https://x.vexto.app', description: 'a & <i>b</i>' })]));
  assert.doesNotMatch(html, /<b>X|<i>b<\/i>/);
  assert.match(html, /&lt;b&gt;X/);
  assert.match(html, /a &amp; &lt;i&gt;b/);
});

test('loads nothing from other sites', () => {
  const html = renderPage(status([app('A', 'Family')]));
  const external = [...html.matchAll(/(?:src|href)="(https?:[^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(external.filter((u) => !/vexto\.app|mohammadsyed\.com/.test(u)), []);
  assert.doesNotMatch(html, /<link[^>]+https?:|@import|url\(https?:/);
});

test('mentions when Pulse itself was offline', () => {
  const t = NOW - 3_600_000;
  const html = renderPage(status([app('A', 'Family')], { pulse_offline: [{ started_at: t, ended_at: t + 600_000 }] }));
  assert.match(html, /Pulse lost its own internet connection/);
});

test('heartbeat is one image for screen readers, with no keyboard stops', () => {
  const html = renderPage(status([app('A', 'Family'), app('Kata', 'Family', { state: 'down' })]));
  assert.match(html, /<svg class="ecg"[^>]*role="img" aria-label="Heartbeat line: 1 of 2 apps working"/);
  assert.doesNotMatch(html, /tabindex|aria-live/);
});

test('the status page links the icons and manifest', () => {
  const html = renderPage(status([app('A', 'Family')]));
  assert.match(html, /<link rel="icon" href="\/favicon.svg" type="image\/svg\+xml">/);
  assert.match(html, /<link rel="apple-touch-icon" href="\/apple-touch-icon.png">/);
  assert.match(html, /<link rel="manifest" href="\/manifest.webmanifest">/);
  assert.equal(html.match(/content="#ffffff"/g)?.length, 1);
  assert.equal(html.match(/content="#0f1110"/g)?.length, 1);
});
