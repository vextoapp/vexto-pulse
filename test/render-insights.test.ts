import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderInsights } from '../src/render-insights.ts';
import type { InsightRow } from '../src/insights-model.ts';

const NOW = Date.parse('2026-11-26T12:00:00Z');
const row = (over: Partial<InsightRow>): InsightRow => ({
  name: 'A', url: 'https://a.vexto.app', uptime_30d: 100, tls_days: 60,
  scores: null, previous: null, pagespeed_at: null, pagespeed_error: null,
  errors_7d: null, errors_prev_7d: null, reasons: [], ...over,
});

test('renderInsights escapes app names', () => {
  const html = renderInsights({ generated_at: NOW, rows: [row({ name: "Lenny's <b>" })] });
  assert.match(html, /Lenny&#39;s &lt;b&gt;/);
  assert.doesNotMatch(html, /<b>/);
});

test('renderInsights shows not set up and arrows', () => {
  const scores = { performance: 38, accessibility: 95, best_practices: 100, seo: 92 };
  const html = renderInsights({
    generated_at: NOW,
    rows: [row({ scores, previous: { ...scores, performance: 44 }, pagespeed_at: NOW })],
  });
  assert.match(html, /not set up/);
  assert.match(html, /▼6/);
});

test('renderInsights says nothing needs attention when no reasons', () => {
  const html = renderInsights({ generated_at: NOW, rows: [row({})] });
  assert.match(html, /Nothing needs attention\./);
});
