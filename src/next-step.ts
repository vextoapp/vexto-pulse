// The owner's view of /insights: one next step per app, the smaller notes worth knowing,
// and a how-to for this week's focus. Pure functions over the insights rows and the newest digest.
import type { Digest, Issue } from './digest-model.ts';
import type { InsightRow } from './insights-model.ts';
import { pct } from './render.ts';

export type Group = 'fix' | 'sentry' | 'ok';
export type AppStep = { row: InsightRow; group: Group; step: string; focus: boolean; notes: string[] };
export type Guide = { title: string; why: string; todo: string[]; done: string };

const ORDER: Record<Group, number> = { fix: 0, sentry: 1, ok: 2 };

export function nextSteps(rows: InsightRow[], latest: Digest | null): AppStep[] {
  // attention is sorted by rule, then size, so an app's first issue is its most severe.
  const issues = new Map<string, string[]>();
  for (const i of latest?.attention ?? []) issues.set(i.app, [...(issues.get(i.app) ?? []), i.text]);
  const rank = new Map([...issues.keys()].map((app, n) => [app, n]));
  const focusApp = latest?.focus?.app;

  const steps = rows.map((row): AppStep => {
    const problems = latest ? (issues.get(row.name) ?? []) : row.reasons;
    let group: Group = 'ok';
    let step = 'Healthy. Leave it and ship something new.';
    if (problems.length) {
      group = 'fix';
      step = problems[0];
    } else if (row.errors_7d == null) {
      group = 'sentry';
      step = 'Connect Sentry so you see crashes';
    }
    return { row, group, step, focus: group === 'fix' && row.name === focusApp, notes: [...problems.slice(1), ...notesFor(row, group)] };
  });

  const fixRank = (s: AppStep) => (s.focus ? -1 : (rank.get(s.row.name) ?? 0));
  return steps.sort(
    (a, b) => ORDER[a.group] - ORDER[b.group] || (a.group === 'fix' ? fixRank(a) - fixRank(b) : a.row.name.localeCompare(b.row.name)),
  );
}

function notesFor(r: InsightRow, group: Group): string[] {
  const out: string[] = [];
  const s = r.scores;
  if (!s) out.push(r.pagespeed_error ? `PageSpeed failed: ${r.pagespeed_error}` : "PageSpeed hasn't run yet");
  const u = r.uptime_30d;
  if (u != null && u >= 99 && u < 99.5) {
    out.push(`Uptime ${pct(u)} is under your 99.5% target but above the 99% rule. Watch it; if it slips under 99% it becomes a focus.`);
  }
  const p = s?.performance;
  if (p != null && p < 70) out.push(`Speed ${p} is the weakest score here. Not urgent (the rule is under 50), but it's the next thing to improve.`);
  else if (p != null && p < 80) out.push(`Speed ${p} could be better. Not urgent.`);
  if (s?.best_practices != null && s.best_practices < 100) out.push(`Best practices ${s.best_practices}: usually a browser console error or an outdated library.`);
  if (s?.seo != null && s.seo < 100) out.push(`SEO ${s.seo}: often a missing meta description.`);
  if (r.errors_7d == null && group === 'fix') out.push("Sentry isn't connected, so Pulse can't see crashes here. Connect it once this is fixed.");
  if (r.errors_7d != null) out.push(`Sentry is connected: ${r.errors_7d} errors this week, ${r.errors_prev_7d ?? 0} the week before.`);
  if (!out.length) out.push("Every score is in Google's good band. Nothing to do.");
  return out;
}

export function focusGuide(i: Issue, url: string): Guide {
  const host = new URL(url).host;
  const lighthouse = (category: string) => `Open ${host} in Chrome, then DevTools → Lighthouse → ${category} → Analyse (mobile).`;
  const v = i.value;
  switch (i.metric) {
    case 'outage':
      return {
        title: `Find out why ${i.app} went down`,
        why: `${i.text} Anyone who tried to open it got an error.`,
        todo: [`Open the hosting logs for ${host} around the time of the outage.`, 'Fix the cause, or redeploy if it was a one-off crash.', 'Check that the service restarts on its own if it fails again.'],
        done: 'next week has no outage of 30 minutes or more',
      };
    case 'errors':
      return {
        title: `Bring ${i.app}'s errors back down`,
        why: `${i.text} Each one is someone hitting a crash or a broken screen.`,
        todo: [`Open ${i.app} in Sentry and sort issues by events this week.`, 'Fix the top issue and deploy.', 'Resolve it in Sentry so a return shows up as new.'],
        done: 'next week has fewer errors than this week',
      };
    case 'uptime':
      return {
        title: `Get ${i.app}'s uptime back above 99%`,
        why: `${i.text} Lots of short failures mean people see errors now and then.`,
        todo: ['Open the status page and look at when the checks failed.', `Match those times against the hosting logs for ${host}.`, 'Fix the cause: often a sleeping service or a slow cold start.'],
        done: "next week's uptime is 99% or more",
      };
    case 'certificate':
      return {
        title: `Renew ${i.app}'s certificate`,
        why: `${i.text} If it lapses, browsers block the site with a security warning.`,
        todo: [`Open the custom domain settings for ${host} in your hosting dashboard.`, 'Check the DNS record still points there, then re-issue the certificate.'],
        done: 'the certificate has more than 14 days left',
      };
    case 'accessibility':
      return {
        title: `Raise ${i.app}'s accessibility from ${v} to 90`,
        why: "It's your lowest score across all your apps. People using a screen reader, a keyboard or zoom are likely hitting text they can't read or buttons they can't name.",
        todo: [lighthouse('Accessibility'), "Fix what it lists. For a score in the 80s it's usually colour contrast, and buttons or images without labels.", 'Run Lighthouse again until it reads 90 or more, then deploy.'],
        done: "next week's PageSpeed run shows 90 or more",
      };
    case 'performance':
      return {
        title: `Raise ${i.app}'s speed from ${v} to 50`,
        why: 'On a phone the page is slow to load and respond, and people leave before it does.',
        todo: [lighthouse('Performance'), 'Fix the biggest items first: usually large images, unused JavaScript or render-blocking fonts.', 'Run Lighthouse again until it reads 50 or more, then deploy.'],
        done: "next week's PageSpeed run shows 50 or more",
      };
    case 'response':
      return {
        title: `Find out why ${i.app} got slower`,
        why: `${i.text} Every page takes noticeably longer to open.`,
        todo: [`Check the hosting metrics for ${host}: CPU, memory and slow requests.`, 'Look at what changed in the last deploy.', 'Fix or roll back, then watch the response time on the status page.'],
        done: 'the average response is back under 2 seconds',
      };
    default:
      return {
        title: `Win back ${i.app}'s ${i.metric} score`,
        why: `${i.text} Something in a recent change made it worse.`,
        todo: [lighthouse(i.metric === 'SEO' ? 'SEO' : 'Best practices'), 'Compare what it lists with your last deploy and fix the new items.'],
        done: `next week's PageSpeed run is back up 10 points`,
      };
  }
}
