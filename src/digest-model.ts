// The weekly digest's numbers and rules. Pure functions over the database, so every rule is testable.
import type { DatabaseSync } from 'node:sqlite';
import type { App } from './config.ts';
import type { Scores } from './pagespeed.ts';
import { longDuration } from './render.ts';
import { previousWeek, sentryDays, type Week } from './week.ts';

export type AppWeek = {
  name: string;
  uptime: number | null; // percent of checks that passed this week; null = no checks
  outage_ms: number;
  outages: { started_at: number; ms: number }[];
  avg_ms: number | null; // average response time of passed checks
  errors: number | null; // Sentry errors this week; null = no Sentry project linked
  tls_days: number | null;
  scores: Scores | null; // latest successful PageSpeed run before the week ended
  prev_scores: Scores | null; // the successful run before that
};

export function appWeeks(db: DatabaseSync, apps: App[], w: Week): AppWeek[] {
  const checksQ = db.prepare(
    `SELECT count(*) AS n, sum(ok) AS ok, avg(CASE WHEN ok = 1 THEN ms END) AS avg_ms
     FROM checks WHERE app = ? AND ts >= ? AND ts < ?`,
  );
  const tlsQ = db.prepare('SELECT tls_days FROM checks WHERE app = ? AND ts < ? ORDER BY ts DESC LIMIT 1');
  const outagesQ = db.prepare(
    `SELECT started_at, ended_at FROM incidents
     WHERE app = ? AND started_at < ? AND (ended_at IS NULL OR ended_at > ?) ORDER BY started_at`,
  );
  const linkedQ = db.prepare('SELECT 1 FROM sentry_daily WHERE app = ? LIMIT 1');
  const errorsQ = db.prepare(
    'SELECT coalesce(sum(errors), 0) AS n FROM sentry_daily WHERE app = ? AND day IN (SELECT value FROM json_each(?))',
  );
  const scoresQ = db.prepare(
    `SELECT performance, accessibility, best_practices, seo FROM pagespeed
     WHERE app = ? AND ts < ? AND error IS NULL ORDER BY ts DESC LIMIT 2`,
  );
  const days = JSON.stringify(sentryDays(w));

  return apps.map((app): AppWeek => {
    const c = checksQ.get(app.name, w.start, w.end)!;
    const n = c.n as number;
    const outages = outagesQ.all(app.name, w.end, w.start).map((o) => {
      const started = Math.max(o.started_at as number, w.start);
      const ended = Math.min((o.ended_at as number | null) ?? w.end, w.end);
      return { started_at: started, ms: ended - started };
    });
    const [latest, before] = scoresQ.all(app.name, w.end).map(toScores);
    return {
      name: app.name,
      uptime: n ? ((c.ok as number) / n) * 100 : null,
      outage_ms: outages.reduce((sum, o) => sum + o.ms, 0),
      outages,
      avg_ms: (c.avg_ms as number | null) ?? null,
      errors: linkedQ.get(app.name) ? (errorsQ.get(app.name, days)!.n as number) : null,
      tls_days: (tlsQ.get(app.name, w.end)?.tls_days as number | null) ?? null,
      scores: latest ?? null,
      prev_scores: before ?? null,
    };
  });
}

const toScores = (r: Record<string, unknown>): Scores => ({
  performance: r.performance as number | null,
  accessibility: r.accessibility as number | null,
  best_practices: r.best_practices as number | null,
  seo: r.seo as number | null,
});

// ---- Rules: what needs attention this week, most severe first ----
// 1 outage ≥ 30 min · 2 errors rising · 3 uptime < 99% · 4 certificate < 14 days
// 5 weak or falling PageSpeed · 6 much slower than last week
export type Issue = { rule: 1 | 2 | 3 | 4 | 5 | 6; app: string; metric: string; value: number; size: number; text: string };

const MIN_MS = 60_000;
const secs = (ms: number) => `${(ms / 1000).toFixed(1)} s`;
const CATEGORY: Record<keyof Scores, string> = {
  performance: 'performance',
  accessibility: 'accessibility',
  best_practices: 'best practices',
  seo: 'SEO',
};

function issuesFor(a: AppWeek, p: AppWeek | undefined): Issue[] {
  const out: Issue[] = [];
  const add = (rule: Issue['rule'], metric: string, value: number, size: number, text: string) =>
    out.push({ rule, app: a.name, metric, value, size, text });

  if (a.outage_ms >= 30 * MIN_MS) add(1, 'outage', a.outage_ms, a.outage_ms, `${a.name} was down for ${longDuration(a.outage_ms / 1000)}.`);

  const before = p?.errors ?? 0;
  if (a.errors != null && a.errors >= 5 && (before === 0 || a.errors >= 2 * before)) {
    add(2, 'errors', a.errors, a.errors - before, `${a.name} had ${a.errors} errors, up from ${before}.`);
  }

  if (a.uptime != null && a.uptime < 99) add(3, 'uptime', a.uptime, 100 - a.uptime, `${a.name} was up ${a.uptime.toFixed(1)}% of the time.`);

  if (a.tls_days != null && a.tls_days < 14) {
    add(4, 'certificate', a.tls_days, 14 - a.tls_days, `${a.name}'s certificate renews in ${a.tls_days} days.`);
  }

  // Rule 5: at most one issue per app, the biggest problem.
  const ps: Issue[] = [];
  const s = a.scores;
  if (s?.performance != null && s.performance < 50) {
    ps.push({ rule: 5, app: a.name, metric: 'performance', value: s.performance, size: 50 - s.performance, text: `${a.name}'s performance score is ${s.performance}.` });
  }
  if (s?.accessibility != null && s.accessibility < 90) {
    ps.push({ rule: 5, app: a.name, metric: 'accessibility', value: s.accessibility, size: 90 - s.accessibility, text: `${a.name}'s accessibility score is ${s.accessibility}.` });
  }
  for (const k of Object.keys(CATEGORY) as (keyof Scores)[]) {
    const now = s?.[k], was = a.prev_scores?.[k];
    if (now != null && was != null && was - now >= 10) {
      ps.push({ rule: 5, app: a.name, metric: CATEGORY[k], value: now, size: was - now, text: `${a.name}'s ${CATEGORY[k]} fell from ${was} to ${now}.` });
    }
  }
  if (ps.length) out.push(ps.sort((x, y) => y.size - x.size)[0]);

  if (a.avg_ms != null && p?.avg_ms != null && a.avg_ms >= 2000 && a.avg_ms >= 2 * p.avg_ms) {
    add(6, 'response', a.avg_ms, a.avg_ms / p.avg_ms, `${a.name} got slower: ${secs(a.avg_ms)}, up from ${secs(p.avg_ms)}.`);
  }
  return out;
}

const byName = (prev: AppWeek[] | null) => new Map((prev ?? []).map((p) => [p.name, p]));

export function findIssues(cur: AppWeek[], prev: AppWeek[] | null): Issue[] {
  const before = byName(prev);
  return cur.flatMap((a) => issuesFor(a, before.get(a.name))).sort((x, y) => x.rule - y.rule || y.size - x.size);
}

export function quickWin(cur: AppWeek[]): string | null {
  const best = cur
    .filter((a) => a.scores?.accessibility != null && a.scores.accessibility <= 95)
    .sort((x, y) => x.scores!.accessibility! - y.scores!.accessibility!)[0];
  return best ? `${best.name}'s accessibility score is ${best.scores!.accessibility}, an easy one to raise.` : null;
}

export type Revisit = { app: string; rule: number; done: boolean; text: string };

const show = (metric: string, v: number) =>
  metric === 'outage' ? longDuration(v / 1000) : metric === 'uptime' ? `${v.toFixed(1)}%` : metric === 'response' ? secs(v) : metric === 'certificate' ? `${v} days` : String(v);

function currentValue(metric: string, a: AppWeek): number | null {
  if (metric === 'outage') return a.outage_ms;
  if (metric === 'errors') return a.errors;
  if (metric === 'uptime') return a.uptime;
  if (metric === 'certificate') return a.tls_days;
  if (metric === 'response') return a.avg_ms;
  const key = (Object.keys(CATEGORY) as (keyof Scores)[]).find((k) => CATEGORY[k] === metric);
  return key ? (a.scores?.[key] ?? null) : null;
}

// Last week's focus, checked against this week: is the same rule still firing for the same app?
export function revisit(last: Issue | null, cur: AppWeek[], prev: AppWeek[] | null): Revisit | null {
  if (!last) return null;
  const a = cur.find((x) => x.name === last.app);
  if (!a) return null;
  const still = issuesFor(a, byName(prev).get(a.name)).find((i) => i.rule === last.rule);
  const now = currentValue(last.metric, a);
  const nowText = now == null ? 'no data' : show(last.metric, now);
  return still
    ? { app: a.name, rule: last.rule, done: false, text: `Still open: ${a.name} ${last.metric} ${nowText}.` }
    : { app: a.name, rule: last.rule, done: true, text: `Done: ${a.name} ${last.metric} ${show(last.metric, last.value)} → ${nowText}.` };
}

const DAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// What moved since last week, in this order: outages, speed, PageSpeed, errors, Sentry links. At most 6.
export function changes(cur: AppWeek[], prev: AppWeek[] | null): string[] {
  const before = byName(prev);
  const outages: string[] = [], speed: string[] = [], scores: string[] = [], errors: string[] = [], linked: string[] = [];
  for (const a of cur) {
    for (const o of a.outages) outages.push(`${a.name} was down for ${longDuration(o.ms / 1000)} on ${DAY[new Date(o.started_at).getDay()]}.`);
    const p = before.get(a.name);
    if (!p) continue;
    if (a.avg_ms != null && p.avg_ms != null && Math.max(a.avg_ms, p.avg_ms) >= 1000) {
      const r = Math.max(a.avg_ms, p.avg_ms) / Math.min(a.avg_ms, p.avg_ms);
      if (r >= 2) speed.push(`${a.name} got ${Math.round(r)}× ${a.avg_ms < p.avg_ms ? 'faster' : 'slower'} (${secs(p.avg_ms)} → ${secs(a.avg_ms)}).`);
    }
    for (const k of Object.keys(CATEGORY) as (keyof Scores)[]) {
      const now = a.scores?.[k], was = p.scores?.[k];
      if (now != null && was != null && Math.abs(now - was) >= 10) scores.push(`${a.name} ${CATEGORY[k]} ${was} → ${now}.`);
    }
    if (a.errors != null && p.errors != null && Math.abs(a.errors - p.errors) >= 5) errors.push(`${a.name} errors ${p.errors} → ${a.errors}.`);
    if (a.errors != null && p.errors == null) linked.push(`${a.name} is now linked to Sentry.`);
  }
  return [...outages.slice(0, 3), ...speed, ...scores, ...errors, ...linked].slice(0, 6);
}

export const verdict = (issues: number) => (issues === 0 ? 'A good week' : issues <= 2 ? 'A mixed week' : 'A rough week');

// ---- 8-week trend for the whole portfolio ----
export type TrendPoint = { key: string; label: string; uptime: number | null; errors: number | null };

export function trend(db: DatabaseSync, apps: App[], w: Week, n = 8): TrendPoint[] {
  const names = JSON.stringify(apps.map((a) => a.name));
  const checksQ = db.prepare(
    'SELECT count(*) AS n, sum(ok) AS ok FROM checks WHERE ts >= ? AND ts < ? AND app IN (SELECT value FROM json_each(?))',
  );
  const linked = db.prepare('SELECT 1 FROM sentry_daily WHERE app IN (SELECT value FROM json_each(?)) LIMIT 1').get(names);
  const errorsQ = db.prepare(
    `SELECT coalesce(sum(errors), 0) AS n FROM sentry_daily
     WHERE app IN (SELECT value FROM json_each(?)) AND day IN (SELECT value FROM json_each(?))`,
  );
  const weeks = [w];
  while (weeks.length < n) weeks.unshift(previousWeek(weeks[0]));
  return weeks.map((x) => {
    const c = checksQ.get(x.start, x.end, names)!;
    return {
      key: x.key,
      label: x.label,
      uptime: (c.n as number) ? ((c.ok as number) / (c.n as number)) * 100 : null,
      errors: linked ? (errorsQ.get(names, JSON.stringify(sentryDays(x)))!.n as number) : null,
    };
  });
}
