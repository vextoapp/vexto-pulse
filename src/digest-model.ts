// The weekly digest's numbers and rules. Pure functions over the database, so every rule is testable.
import type { DatabaseSync } from 'node:sqlite';
import type { App } from './config.ts';
import type { Scores } from './pagespeed.ts';
import { sentryDays, type Week } from './week.ts';

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
