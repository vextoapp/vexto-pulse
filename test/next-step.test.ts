import { test } from 'node:test';
import assert from 'node:assert/strict';
import { focusGuide, nextSteps } from '../src/next-step.ts';
import type { InsightRow } from '../src/insights-model.ts';
import type { Digest, Issue } from '../src/digest-model.ts';

const good = { performance: 95, accessibility: 95, best_practices: 100, seo: 100 };
const row = (over: Partial<InsightRow>): InsightRow => ({
  name: 'A', url: 'https://a.vexto.app', uptime_30d: 100, tls_days: 60,
  scores: good, previous: null, pagespeed_at: 1, pagespeed_error: null,
  errors_7d: 0, errors_prev_7d: 0, reasons: [], ...over,
});
const issue = (app: string, rule: Issue['rule'], metric: string, value: number, text: string): Issue =>
  ({ rule, app, metric, value, size: 1, text });
const digest = (attention: Issue[], focus: Issue | null = attention[0] ?? null): Digest => ({
  week: '2026-11-23', label: '23–29 Nov', verdict: 'A good week', issues_count: 0, uptime: 99.7, outages: 0, errors: 0,
  revisit: null, focus, also: [], quick_win: null, changes: [], attention, trend: [],
});
const a11y = (app: string, v: number) => issue(app, 5, 'accessibility', v, `${app}'s accessibility score is ${v}.`);

test('an app with an issue is in Fix with the issue as its step; the focus app comes first', () => {
  const rows = [row({ name: 'Forked' }), row({ name: 'EclipSend' })];
  const steps = nextSteps(rows, digest([a11y('Forked', 87), a11y('EclipSend', 84)], a11y('EclipSend', 84)));
  assert.equal(steps[0].row.name, 'EclipSend');
  assert.equal(steps[0].focus, true);
  assert.equal(steps[0].group, 'fix');
  assert.equal(steps[0].step, "EclipSend's accessibility score is 84.");
  assert.equal(steps[1].row.name, 'Forked');
  assert.equal(steps[1].focus, false);
});

test('no Sentry → sentry group; Sentry and no issue → ok; each sorted A to Z', () => {
  const rows = [row({ name: 'Zed' }), row({ name: 'Bee', errors_7d: null }), row({ name: 'Ant' }), row({ name: 'Ace', errors_7d: null })];
  const steps = nextSteps(rows, digest([]));
  assert.deepEqual(steps.map((s) => [s.row.name, s.group]), [['Ace', 'sentry'], ['Bee', 'sentry'], ['Ant', 'ok'], ['Zed', 'ok']]);
  assert.equal(steps[0].step, 'Connect Sentry so you see crashes');
  assert.equal(steps[2].step, 'Healthy. Leave it and ship something new.');
});

test('every app appears exactly once and unknown apps in the digest are ignored', () => {
  const rows = [row({ name: 'A' }), row({ name: 'B' })];
  const steps = nextSteps(rows, digest([a11y('Gone', 80), a11y('A', 85)]));
  assert.equal(steps.length, 2);
  assert.deepEqual(new Set(steps.map((s) => s.row.name)), new Set(['A', 'B']));
});

test('two issues for one app: the lowest rule is the step, the other is a note', () => {
  const out = issue('A', 1, 'outage', 3_600_000, 'A was down for 1 hour.');
  const steps = nextSteps([row({})], digest([out, a11y('A', 85)]));
  assert.equal(steps.length, 1);
  assert.equal(steps[0].step, 'A was down for 1 hour.');
  assert.ok(steps[0].notes.includes("A's accessibility score is 85."));
});

test('without a digest, apps with reasons go to Fix', () => {
  const steps = nextSteps([row({ reasons: ['Accessibility 84'] })], null);
  assert.equal(steps[0].group, 'fix');
  assert.equal(steps[0].step, 'Accessibility 84');
  assert.equal(steps[0].focus, false);
});

test('notes: uptime watch, speed, best practices, SEO, Sentry', () => {
  const r = row({ uptime_30d: 99.3, scores: { performance: 67, accessibility: 95, best_practices: 96, seo: 92 }, errors_7d: 3, errors_prev_7d: 1 });
  const notes = nextSteps([r], digest([]))[0].notes.join('\n');
  assert.match(notes, /Uptime 99\.30% is under your 99\.5% target/);
  assert.match(notes, /Speed 67 is the weakest score here/);
  assert.match(notes, /Best practices 96: usually/);
  assert.match(notes, /SEO 92: often a missing meta description/);
  assert.match(notes, /Sentry is connected: 3 errors this week, 1 the week before\./);
});

test('notes: a speed in the 70s could be better', () => {
  const notes = nextSteps([row({ scores: { ...good, performance: 75 } })], digest([]))[0].notes;
  assert.ok(notes.includes('Speed 75 could be better. Not urgent.'));
});

test('notes: missing or failed PageSpeed', () => {
  assert.ok(nextSteps([row({ scores: null, pagespeed_error: 'HTTP 429' })], null)[0].notes.includes('PageSpeed failed: HTTP 429'));
  assert.ok(nextSteps([row({ scores: null })], null)[0].notes.includes("PageSpeed hasn't run yet"));
});

test('notes: a Fix app without Sentry is told to connect it afterwards', () => {
  const notes = nextSteps([row({ errors_7d: null })], digest([a11y('A', 85)]))[0].notes;
  assert.ok(notes.some((n) => n.startsWith("Sentry isn't connected")));
});

test('a healthy app with nothing to say gets the all-good note', () => {
  const r = row({ errors_7d: null });
  const steps = nextSteps([r], digest([]));
  assert.deepEqual(steps[0].notes, ["Every score is in Google's good band. Nothing to do."]);
});

test('focusGuide for accessibility uses the host and the bar', () => {
  const g = focusGuide(a11y('EclipSend', 84), 'https://eclipsend.vexto.app');
  assert.equal(g.title, "Raise EclipSend's accessibility from 84 to 90");
  assert.match(g.todo[0], /^Open eclipsend\.vexto\.app in Chrome/);
  assert.match(g.done, /90 or more/);
});

test('focusGuide has a guide for every metric the rules produce', () => {
  for (const m of ['outage', 'errors', 'uptime', 'certificate', 'performance', 'accessibility', 'response', 'best practices']) {
    const g = focusGuide(issue('A', 5, m, 40, `A's ${m} fell from 60 to 40.`), 'https://a.vexto.app');
    assert.ok(g.title && g.why && g.done, m);
    assert.ok(g.todo.length >= 2 && g.todo.length <= 3, m);
  }
});

test('focusGuide for a score that fell but is still above the bar uses the fall guide', () => {
  const speed = focusGuide(issue('A', 5, 'performance', 85, "A's performance fell from 100 to 85."), 'https://a.vexto.app');
  assert.equal(speed.title, "Win back A's performance score");
  assert.match(speed.todo[0], /Lighthouse → Performance →/);
  const access = focusGuide(issue('A', 5, 'accessibility', 91, "A's accessibility fell from 100 to 91."), 'https://a.vexto.app');
  assert.equal(access.title, "Win back A's accessibility score");
  assert.match(access.todo[0], /Lighthouse → Accessibility →/);
});

test('if the focus app is gone from apps.json, the next issue on a current app is the focus', () => {
  const steps = nextSteps([row({ name: 'Forked' })], digest([a11y('Gone', 80), a11y('Forked', 87)], a11y('Gone', 80)));
  assert.equal(steps[0].row.name, 'Forked');
  assert.equal(steps[0].focus, true);
});

test('a healthy-looking app with weak accessibility is not told everything is good', () => {
  const notes = nextSteps([row({ scores: { ...good, accessibility: 80 } })], digest([]))[0].notes;
  assert.ok(notes.includes('Accessibility 80 is under your bar of 90. It will be a focus on Monday if nothing bigger comes up.'));
  assert.ok(!notes.some((n) => n.startsWith('Every score')));
});

test('one Sentry error is singular', () => {
  const notes = nextSteps([row({ errors_7d: 1, errors_prev_7d: 1 })], digest([]))[0].notes;
  assert.ok(notes.includes('Sentry is connected: 1 error this week, 1 the week before.'));
});
