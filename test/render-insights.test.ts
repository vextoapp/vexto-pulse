import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderInsights, type WeekView } from '../src/render-insights.ts';
import type { InsightRow } from '../src/insights-model.ts';
import type { Digest, Issue } from '../src/digest-model.ts';

const NOW = Date.parse('2026-11-26T12:00:00Z');
const good = { performance: 95, accessibility: 95, best_practices: 100, seo: 100 };
const row = (over: Partial<InsightRow>): InsightRow => ({
  name: 'A', url: 'https://a.vexto.app', uptime_30d: 100, tls_days: 60,
  scores: good, previous: null, pagespeed_at: NOW, pagespeed_error: null,
  errors_7d: 0, errors_prev_7d: 0, reasons: [], ...over,
});
const a11y = (app: string, v: number): Issue => ({ rule: 5, app, metric: 'accessibility', value: v, size: 90 - v, text: `${app}'s accessibility score is ${v}.` });
const digest = (over: Partial<Digest> = {}): Digest => ({
  week: '2026-11-23', label: '23–29 Nov', verdict: 'A good week', issues_count: 0, uptime: 99.7, outages: 0, errors: 0,
  revisit: null, focus: null, also: [], quick_win: null, changes: [], attention: [],
  trend: [{ key: '2026-11-23', label: '23–29 Nov', uptime: 99.7, errors: 0 }], ...over,
});
const view = (latest: Digest | null, over: Partial<WeekView> = {}): WeekView => ({
  latest, shown: latest, weeks: latest ? [{ key: latest.week, label: latest.label }] : [], selected: latest?.week ?? null, sendError: null, ...over,
});
const page = (rows: InsightRow[], w: WeekView) => renderInsights({ generated_at: NOW, rows }, w);
const eclipsend = row({ name: 'EclipSend', url: 'https://eclipsend.vexto.app', scores: { ...good, accessibility: 84 } });
const focusWeek = digest({ focus: a11y('EclipSend', 84), attention: [a11y('EclipSend', 84)] });

test('escapes app names and step text', () => {
  const html = page([row({ name: "Lenny's <b>", reasons: ['<i>bad</i>'] })], view(null));
  assert.match(html, /Lenny&#39;s &lt;b&gt;/);
  assert.match(html, /&lt;i&gt;bad&lt;\/i&gt;/);
  assert.doesNotMatch(html, /<b>|<i>bad/);
});

test('the headline names the focus on a clean week', () => {
  const html = page([eclipsend, row({ name: 'B' })], view(focusWeek));
  assert.match(html, /<h1>All 2 apps stayed up\. This week, raise EclipSend&#39;s accessibility from 84 to 90\.<\/h1>/);
  assert.match(html, /Nothing broke, so there&#39;s no fire to put out\./);
  assert.match(html, /Your week, 23–29 Nov/);
});

test('the headline counts outages on a bad week', () => {
  const out: Issue = { rule: 1, app: 'EclipSend', metric: 'outage', value: 3_600_000, size: 3_600_000, text: 'EclipSend was down for 1 hour.' };
  const html = page([eclipsend], view(digest({ outages: 2, focus: out, attention: [out] })));
  assert.match(html, /<h1>2 outages this week\. This week, find out why EclipSend went down\.<\/h1>/);
  assert.match(html, /Something broke this week\./);
});

test('a week with nothing to fix says so', () => {
  const html = page([row({})], view(digest()));
  assert.match(html, /<h1>All 1 app stayed up\. Nothing to fix this week\.<\/h1>/);
  assert.match(html, /A good week to ship something\./);
  assert.doesNotMatch(html, /Do this first/);
});

test('Do this first shows the guide steps and done line', () => {
  const html = page([eclipsend], view({ ...focusWeek, also: [a11y('Forked', 87)] }));
  assert.match(html, /Do this first/);
  assert.match(html, /<li>Open eclipsend\.vexto\.app in Chrome/);
  assert.match(html, /<b>Done when<\/b> next week&#39;s PageSpeed run shows 90 or more/);
  assert.match(html, /After that: Forked&#39;s accessibility score is 87\./);
});

test('without a digest there is no focus card and apps are still grouped', () => {
  const html = page([row({ name: 'A', reasons: ['Accessibility 84'] }), row({ name: 'B' })], view(null));
  assert.doesNotMatch(html, /Do this first/);
  assert.match(html, /<h1>Your first weekly summary arrives Monday at 7 am\.<\/h1>/);
  assert.match(html, /class="nm">A<small>Accessibility 84/);
  assert.match(html, /class="nm">B<small>/);
});

test('an older week changes only How the week went', () => {
  const older = digest({ week: '2026-11-16', label: '16–22 Nov', focus: a11y('B', 80), attention: [a11y('B', 80)] });
  const html = page([eclipsend, row({ name: 'B' })], view(focusWeek, { shown: older, selected: '2026-11-16', weeks: [{ key: '2026-11-23', label: '23–29 Nov' }, { key: '2026-11-16', label: '16–22 Nov' }] }));
  assert.match(html, /<h3>Raise EclipSend&#39;s accessibility from 84 to 90<\/h3>/);
  assert.match(html, /Your week, 23–29 Nov/);
  assert.doesNotMatch(html, /class="nm">B<small>B&#39;s accessibility/);
  assert.match(html, /<option value="2026-11-16" selected>/);
});

test('every app appears once, in group order', () => {
  const html = page([row({ name: 'Ok' }), row({ name: 'NoSentry', errors_7d: null }), eclipsend], view(focusWeek));
  const at = (n: string) => html.indexOf(`class="nm">${n}<small>`);
  assert.ok(at('EclipSend') > 0 && at('EclipSend') < at('NoSentry') && at('NoSentry') < at('Ok'));
  for (const n of ['Ok', 'NoSentry', 'EclipSend']) assert.equal(html.split(`class="nm">${n}<small>`).length, 2, n);
  assert.match(html, /Your focus this week: EclipSend&#39;s accessibility score is 84\./);
});

test('missing scores show a dash and a note', () => {
  const html = page([row({ scores: null, uptime_30d: null })], view(null));
  assert.match(html, /Speed <b class="n">–<\/b>/);
  assert.match(html, /Up <b class="n">–<\/b>/);
  assert.match(html, /PageSpeed hasn&#39;t run yet/);
});

test('retire and grow is a placeholder that counts apps', () => {
  assert.match(page([row({ name: 'A' }), row({ name: 'B' })], view(null)), /0 of 2 apps reporting visits/);
});

test('the page speaks to you, never as I', () => {
  assert.doesNotMatch(page([eclipsend], view(focusWeek)), /How I |I decide|I use this/);
});

test('links the icons and keeps the status page colours', () => {
  const html = page([row({})], view(null));
  assert.match(html, /rel="icon" href="\/favicon.svg"/);
  assert.match(html, /rel="manifest"/);
  assert.match(html, /content="#0f1110"/);
  assert.match(html, /--line:#e8ebe9/);
});

test('a focus app missing from apps.json hands the focus to the next current app', () => {
  const html = page([eclipsend], view(digest({ focus: a11y('Gone', 70), attention: [a11y('Gone', 70), a11y('EclipSend', 84)] })));
  assert.match(html, /This week, raise EclipSend&#39;s accessibility from 84 to 90\./);
  assert.match(html, /Nothing broke, so there&#39;s no fire/);
});

test('with only a removed app in the digest, the page says nothing to fix consistently', () => {
  const html = page([row({})], view(digest({ focus: a11y('Gone', 70), attention: [a11y('Gone', 70)] })));
  assert.match(html, /Nothing to fix this week\./);
  assert.match(html, /Nothing needs you this week\./);
});
