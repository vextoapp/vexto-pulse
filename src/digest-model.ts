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
  const errorsQ = db.prepare(WEEK_ERRORS_SQL);
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
      errors: weekErrors(errorsQ.get(app.name, days)!),
      tls_days: (tlsQ.get(app.name, w.end)?.tls_days as number | null) ?? null,
      scores: latest ?? null,
      prev_scores: before ?? null,
    };
  });
}

// A week's error count needs all 7 Sentry days stored; fewer means not linked yet (or not backfilled).
const WEEK_ERRORS_SQL = `SELECT count(*) AS days, coalesce(sum(errors), 0) AS n FROM sentry_daily
  WHERE app = ? AND day IN (SELECT value FROM json_each(?))`;
const weekErrors = (r: Record<string, unknown>) => ((r.days as number) === 7 ? (r.n as number) : null);

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

  if (a.uptime != null && a.uptime < 99 && !out.length) add(3, 'uptime', a.uptime, 100 - a.uptime, `${a.name} was up ${a.uptime.toFixed(1)}% of the time.`);

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

function show(metric: string, v: number): string {
  switch (metric) {
    case 'outage':
      return v ? longDuration(v / 1000) : 'none';
    case 'uptime':
      return `${v.toFixed(1)}%`;
    case 'response':
      return secs(v);
    case 'certificate':
      return `${v} days`;
    default:
      return String(v);
  }
}

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
  if (now == null) return { app: a.name, rule: last.rule, done: false, text: `Not checked: no data this week for ${a.name}.` };
  const nowText = show(last.metric, now);
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

const sumKnown = (xs: (number | null)[]) => (xs.some((x) => x != null) ? xs.reduce<number>((s, x) => s + (x ?? 0), 0) : null);

export function trend(db: DatabaseSync, apps: App[], w: Week, n = 8): TrendPoint[] {
  const names = JSON.stringify(apps.map((a) => a.name));
  const checksQ = db.prepare(
    'SELECT count(*) AS n, sum(ok) AS ok FROM checks WHERE ts >= ? AND ts < ? AND app IN (SELECT value FROM json_each(?))',
  );
  // Per app, so an app with only part of a week stored doesn't count; null when no app has a full week.
  const errorsQ = db.prepare(WEEK_ERRORS_SQL);
  const weeks = [w];
  while (weeks.length < n) weeks.unshift(previousWeek(weeks[0]));
  return weeks.map((x) => {
    const c = checksQ.get(x.start, x.end, names)!;
    const days = JSON.stringify(sentryDays(x));
    return {
      key: x.key,
      label: x.label,
      uptime: (c.n as number) ? ((c.ok as number) / (c.n as number)) * 100 : null,
      errors: sumKnown(apps.map((a) => weekErrors(errorsQ.get(a.name, days)!))),
    };
  });
}

// ---- The digest: worked out once, stored, then emailed and shown on /insights from the stored copy ----
export type Digest = {
  week: string;
  label: string;
  verdict: string;
  issues_count: number;
  uptime: number | null;
  outages: number;
  errors: number | null;
  revisit: Revisit | null;
  focus: Issue | null;
  also: Issue[];
  quick_win: string | null;
  changes: string[];
  attention: Issue[];
  trend: TrendPoint[];
};

export type Stored = { digest: Digest; emailed_at: number | null; email_error: string | null };

export function buildDigest(db: DatabaseSync, apps: App[], w: Week): Digest {
  const prevWeek = previousWeek(w);
  const cur = appWeeks(db, apps, w);
  const prev = appWeeks(db, apps, prevWeek);
  const issues = findIssues(cur, prev);
  const points = trend(db, apps, w);
  const thisWeek = points.at(-1)!;
  // Only what went wrong this week counts toward the verdict. Standing issues (certificates, PageSpeed)
  // still show in the focus and attention lists.
  const weekly = issues.filter((i) => i.rule !== 4 && i.rule !== 5).length;
  return {
    week: w.key,
    label: w.label,
    verdict: thisWeek.uptime == null ? 'Not enough data yet' : verdict(weekly),
    issues_count: weekly,
    uptime: thisWeek.uptime,
    outages: cur.reduce((n, a) => n + a.outages.length, 0),
    errors: thisWeek.errors,
    revisit: revisit(getStored(db, prevWeek.key)?.digest.focus ?? null, cur, prev),
    focus: issues[0] ?? null,
    also: issues.slice(1, 3),
    quick_win: issues.length ? null : quickWin(cur),
    changes: changes(cur, prev),
    attention: issues,
    trend: points,
  };
}

export function getStored(db: DatabaseSync, week: string): Stored | null {
  const r = db.prepare('SELECT data, emailed_at, email_error FROM digests WHERE week = ?').get(week);
  return r
    ? { digest: JSON.parse(r.data as string), emailed_at: (r.emailed_at as number | null) ?? null, email_error: (r.email_error as string | null) ?? null }
    : null;
}

// Saves a digest, but never over one that has already been emailed.
export function storeDigest(db: DatabaseSync, d: Digest, now = Date.now()): void {
  db.prepare(
    `INSERT INTO digests (week, created_at, data) VALUES (?, ?, ?)
     ON CONFLICT (week) DO UPDATE SET created_at = excluded.created_at, data = excluded.data WHERE digests.emailed_at IS NULL`,
  ).run(d.week, now, JSON.stringify(d));
}

export function markSent(db: DatabaseSync, week: string, error: string | null, now = Date.now()): void {
  db.prepare('UPDATE digests SET emailed_at = ?, email_error = ? WHERE week = ?').run(error ? null : now, error, week);
}

export function listWeeks(db: DatabaseSync): { key: string; label: string }[] {
  return db
    .prepare("SELECT week, data ->> '$.label' AS label FROM digests ORDER BY week DESC")
    .all()
    .map((r) => ({ key: r.week as string, label: r.label as string }));
}
