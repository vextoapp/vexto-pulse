// Sentry: accepted error events per project per UTC day, for the last 14 days.
import { getJson } from './http.ts';

export type Daily = { day: string; errors: number }[];

// An app links to the Sentry project whose slug is its name lower-cased and hyphenated.
export function sentrySlug(name: string): string {
  return name.toLowerCase().replace(/['’]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

type Stats = { intervals?: string[]; groups?: { by?: { project?: number }; series?: Record<string, number[]> }[] };
type Project = { id: string; slug: string };

export function parseDaily(stats: unknown, projects: unknown, now = Date.now()): Map<string, Daily> {
  const { intervals = [], groups = [] } = stats as Stats;
  // With no errors anywhere Sentry can send no days; record today as 0 so projects still count as linked.
  const days = intervals.length ? intervals.map((i) => i.slice(0, 10)) : [new Date(now).toISOString().slice(0, 10)];
  const series = new Map(groups.map((g) => [String(g.by?.project), g.series?.['sum(quantity)'] ?? []]));

  const out = new Map<string, Daily>();
  for (const p of projects as Project[]) {
    const counts = series.get(String(p.id)) ?? [];
    out.set(p.slug, days.map((day, i) => ({ day, errors: counts[i] ?? 0 })));
  }
  return out;
}

export async function fetchSentryDaily(token: string, org: string, host: string): Promise<Map<string, Daily>> {
  const base = `https://${host}/api/0/organizations/${encodeURIComponent(org)}`;
  const headers = { authorization: `Bearer ${token}` };
  const q = 'field=sum(quantity)&category=error&outcome=accepted&groupBy=project&statsPeriod=14d&interval=1d';
  const [projects, stats] = await Promise.all([
    getJson(`${base}/projects/`, headers),
    getJson(`${base}/stats_v2/?${q}`, headers),
  ]);
  return parseDaily(stats, projects);
}
