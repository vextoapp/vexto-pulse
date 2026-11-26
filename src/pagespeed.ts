// Google PageSpeed Insights: Lighthouse scores (0–100) for one URL, mobile strategy.
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
