import { test } from 'node:test';
import assert from 'node:assert/strict';
import { digestEmail, digestSection } from '../src/render-digest.ts';
import type { Digest, Issue } from '../src/digest-model.ts';

const issue = (app: string, text: string): Issue => ({ rule: 2, app, metric: 'errors', value: 12, size: 9, text });
const digest = (over: Partial<Digest> = {}): Digest => ({
  week: '2026-11-16', label: '16–22 Nov', verdict: 'A good week', issues_count: 0, uptime: 99.8, outages: 0, errors: 3,
  revisit: null, focus: null, also: [], quick_win: null, changes: [], attention: [],
  trend: [{ key: '2026-11-16', label: '16–22 Nov', uptime: 99.8, errors: 3 }], ...over,
});
const URL_ = 'https://status.vexto.app/insights';

test('subjects', () => {
  assert.equal(digestEmail(digest(), URL_).subject, 'Pulse weekly, 16–22 Nov: a good week, nothing urgent');
  const one = digest({ verdict: 'A mixed week', issues_count: 1, focus: issue('A', 'A had 12 errors, up from 3.'), attention: [issue('A', 'x')] });
  assert.match(digestEmail(one, URL_).subject, /: a mixed week, 1 thing to fix$/);
  assert.match(digestEmail(digest({ verdict: 'A rough week', issues_count: 3 }), URL_).subject, /3 things to fix$/);
});

test('the text version carries the focus and the link', () => {
  const { text } = digestEmail(digest({ issues_count: 1, focus: issue('EclipSend', 'EclipSend had 12 errors, up from 3.') }), URL_);
  assert.match(text, /Focus this week\nEclipSend had 12 errors, up from 3\./);
  assert.match(text, /https:\/\/status\.vexto\.app\/insights\?week=2026-11-16/);
});

test('html escapes app text', () => {
  const { html } = digestEmail(digest({ issues_count: 1, focus: issue('<b>X', '<b>X had 12 errors.') }), URL_);
  assert.doesNotMatch(html, /<b>X/);
  assert.match(html, /&lt;b&gt;X had 12 errors\./);
});

test('page section: empty state, selected week, send error', () => {
  assert.match(digestSection(null, [], null, null), /The first summary arrives Monday at 7 am\./);
  const weeks = [{ key: '2026-11-23', label: '23–29 Nov' }, { key: '2026-11-16', label: '16–22 Nov' }];
  const html = digestSection(digest(), weeks, '2026-11-16', 'HTTP 500');
  assert.match(html, /<option value="2026-11-16" selected>16–22 Nov<\/option>/);
  assert.match(html, /Not sent: HTTP 500/);
});

test('trend labels are short day ranges, also across months', () => {
  const d = digest({ trend: [{ key: '2026-10-26', label: '26 Oct – 1 Nov', uptime: null, errors: null }] });
  assert.match(digestSection(d, [], null, null), /<span>26–1<\/span>/);
  assert.match(digestEmail(d, URL_).html, />26–1</);
});

test('no-data weeks say so in the subject and summary', () => {
  const e = digestEmail(digest({ verdict: 'Not enough data yet', uptime: null, errors: null }), URL_);
  assert.equal(e.subject, 'Pulse weekly, 16–22 Nov: not enough data yet');
  assert.match(e.text, /Not enough data yet\. Pulse has no checks for this week\./);
});

test('the 8-week trend shows errors too', () => {
  const d = digest({ trend: [{ key: '2026-11-16', label: '16–22 Nov', uptime: 99.8, errors: 7 }] });
  assert.match(digestEmail(d, URL_).html, /errors in Sentry/i);
  assert.match(digestEmail(d, URL_).html, />7</);
  assert.match(digestSection(d, [], null, null), /errors in Sentry/i);
});

test('the trend shows each week\'s uptime as a number, not just a colour', () => {
  const d = digest({ trend: [{ key: '2026-11-16', label: '16–22 Nov', uptime: 98.4, errors: 3 }, { key: '2026-11-23', label: '23–29 Nov', uptime: null, errors: null }] });
  for (const html of [digestEmail(d, URL_).html, digestSection(d, [], null, null)]) {
    assert.match(html, />98\.4%</);
    assert.match(html, />no data</);
  }
});

test('the trend never rounds a week with downtime up to 100%', () => {
  const d = digest({ trend: [{ key: '2026-11-16', label: '16–22 Nov', uptime: 99.97, errors: 0 }] });
  assert.match(digestSection(d, [], null, null), /<b>99\.9%<\/b>/);
});

test('page section: the week card with a verdict pill, no focus or attention lists', () => {
  const html = digestSection(digest({ verdict: 'A mixed week', focus: issue('A', 'A had 12 errors.'), attention: [issue('A', 'A had 12 errors.')] }), [], null, null);
  assert.match(html, /<h2 id="wk-h">How the week went<\/h2>/);
  assert.match(html, /<span class="pill pill-warn"><i><\/i>A mixed week<\/span>/);
  assert.match(html, /<p class="verdict">Up 99\.8% of the time, no outages, 3 errors in Sentry\.<\/p>/);
  assert.match(html, /Last week&#39;s focus/);
  assert.doesNotMatch(html, /Focus this week|Needs attention/);
});
