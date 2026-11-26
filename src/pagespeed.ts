// Google PageSpeed Insights: Lighthouse scores (0–100) for one URL, mobile strategy.
import type { DatabaseSync } from 'node:sqlite';
import { getJson } from './http.ts';

export type Scores = {
  performance: number | null;
  accessibility: number | null;
  best_practices: number | null;
  seo: number | null;
};

const API = 'https://pagespeedonline.googleapis.com/pagespeedonline/v5/runPagespeed';

export function parseScores(json: unknown): Scores {
  const cats = (json as { lighthouseResult?: { categories?: Record<string, { score?: number | null }> } })
    ?.lighthouseResult?.categories ?? {};
  const score = (id: string) => {
    const s = cats[id]?.score;
    return typeof s === 'number' ? Math.round(s * 100) : null;
  };
  return {
    performance: score('performance'),
    accessibility: score('accessibility'),
    best_practices: score('best-practices'),
    seo: score('seo'),
  };
}

export async function runPagespeed(url: string, key: string): Promise<Scores & { error: string | null }> {
  const q = new URLSearchParams({ url, strategy: 'mobile', key });
  for (const c of ['performance', 'accessibility', 'best-practices', 'seo']) q.append('category', c);
  const endpoint = `${process.env.PAGESPEED_BASE ?? API}?${q}`;

  let error = '';
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return { ...parseScores(await getJson(endpoint, {}, 60_000)), error: null };
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }
  }
  return { performance: null, accessibility: null, best_practices: null, seo: null, error };
}

const RUN_EVERY_MS = 6 * 86_400_000;

// PageSpeed is due when no successful run happened in the last 6 days. Failed runs don't count,
// so a bad key or quota error is retried the next day instead of blocking scores for a week.
export function pagespeedDue(db: DatabaseSync, now = Date.now()): boolean {
  const last = db.prepare('SELECT max(ts) AS ts FROM pagespeed WHERE error IS NULL').get()?.ts as number | null;
  return last == null || now - last >= RUN_EVERY_MS;
}

// Apps whose most recent run failed. They're retried daily between weekly runs.
export function failedApps(db: DatabaseSync): Set<string> {
  const rows = db
    .prepare('SELECT app FROM pagespeed p WHERE ts = (SELECT max(ts) FROM pagespeed WHERE app = p.app) AND error IS NOT NULL')
    .all();
  return new Set(rows.map((r) => r.app as string));
}
