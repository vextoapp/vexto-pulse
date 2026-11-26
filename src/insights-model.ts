// Builds the private /insights view: quality (PageSpeed), errors (Sentry) and uptime per app,
// plus the reasons an app "needs attention".
import type { DatabaseSync } from 'node:sqlite';
import type { App } from './config.ts';
import type { Scores } from './pagespeed.ts';

const DAY_MS = 86_400_000;

export type InsightRow = {
  name: string;
  url: string;
  uptime_30d: number | null;
  tls_days: number | null;
  scores: Scores | null;
  previous: Scores | null;
  pagespeed_at: number | null;
  pagespeed_error: string | null;
  errors_7d: number | null; // null = no Sentry project linked
  errors_prev_7d: number | null;
  reasons: string[];
};

export type Insights = { generated_at: number; rows: InsightRow[] };

export function getInsights(db: DatabaseSync, apps: App[], now = Date.now()): Insights {
  const uptimeQ = db.prepare('SELECT sum(ok) * 100.0 / nullif(count(*), 0) AS u FROM checks WHERE app = ? AND ts >= ?');
  const tlsQ = db.prepare('SELECT tls_days FROM checks WHERE app = ? ORDER BY ts DESC LIMIT 1');
  const psQ = db.prepare(
    'SELECT ts, performance, accessibility, best_practices, seo, error FROM pagespeed WHERE app = ? ORDER BY ts DESC LIMIT 2',
  );
  const errQ = db.prepare(`
    SELECT count(*) AS n,
      sum(CASE WHEN day >= :week THEN errors ELSE 0 END) AS this_week,
      sum(CASE WHEN day >= :prev AND day < :week THEN errors ELSE 0 END) AS last_week
    FROM sentry_daily WHERE app = :app
  `);
  const today = Math.floor(now / DAY_MS) * DAY_MS;
  const utcDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);
  const week = utcDay(today - 6 * DAY_MS);
  const prev = utcDay(today - 13 * DAY_MS);

  const rows = apps.map((app): InsightRow => {
    const uptime = (uptimeQ.get(app.name, now - 30 * DAY_MS)?.u as number | null) ?? null;
    const tls = (tlsQ.get(app.name)?.tls_days as number | null) ?? null;
    const [latest, before] = psQ.all(app.name);
    const err = errQ.get({ app: app.name, week, prev })!;
    const linked = (err.n as number) > 0;
    const row: InsightRow = {
      name: app.name,
      url: app.url,
      uptime_30d: uptime,
      tls_days: tls,
      scores: latest ? toScores(latest) : null,
      previous: before ? toScores(before) : null,
      pagespeed_at: latest ? (latest.ts as number) : null,
      pagespeed_error: latest ? ((latest.error as string | null) ?? null) : null,
      errors_7d: linked ? ((err.this_week as number) ?? 0) : null,
      errors_prev_7d: linked ? ((err.last_week as number) ?? 0) : null,
      reasons: [],
    };
    row.reasons = reasonsFor(row);
    return row;
  });

  rows.sort((a, b) => Number(b.reasons.length > 0) - Number(a.reasons.length > 0) || a.name.localeCompare(b.name));
  return { generated_at: now, rows };
}

function toScores(r: Record<string, unknown>): Scores {
  return {
    performance: r.performance as number | null,
    accessibility: r.accessibility as number | null,
    best_practices: r.best_practices as number | null,
    seo: r.seo as number | null,
  };
}

// Thresholds from the v2 design. An app with any reason is listed under "Needs attention".
function reasonsFor(r: InsightRow): string[] {
  const out: string[] = [];
  if (r.errors_7d != null && r.errors_7d > 0) out.push(`${r.errors_7d} error${r.errors_7d === 1 ? '' : 's'} this week`);
  const p = r.scores?.performance;
  if (p != null && p < 50) out.push(`Performance ${p}`);
  const a = r.scores?.accessibility;
  if (a != null && a < 90) out.push(`Accessibility ${a}`);
  if (r.uptime_30d != null && r.uptime_30d < 99) out.push(`Uptime ${r.uptime_30d.toFixed(1)}%`);
  if (r.tls_days != null && r.tls_days < 14) out.push(`Certificate expires in ${r.tls_days} days`);
  return out;
}
