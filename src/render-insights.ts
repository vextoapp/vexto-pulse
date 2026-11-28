// Private /insights page (behind Cloudflare Access): Mo's owner view. It leads with this week's focus,
// gives every app one next step, and keeps the weekly summary and the reference below.
import type { Digest } from './digest-model.ts';
import type { Insights } from './insights-model.ts';
import { type AppStep, type Group, focusGuide, nextSteps } from './next-step.ts';
import { DIGEST_CSS, digestSection } from './render-digest.ts';
import { HEAD_ICONS, TOKENS_CSS, esc, pct, time } from './render.ts';

// latest: the newest digest, which drives the headline, focus and next steps.
// shown: the week picked in "How the week went" (the newest unless ?week= says otherwise).
export type WeekView = {
  latest: Digest | null;
  shown: Digest | null;
  weeks: { key: string; label: string }[];
  selected: string | null;
  sendError: string | null;
};

const PULSE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12h4l2-5 4 10 2.5-5H22"/></svg>';
const ARROW = '<svg class="arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>';

export function renderInsights(i: Insights, w: WeekView): string {
  const d = w.latest;
  const focusRow = d?.focus ? i.rows.find((r) => r.name === d.focus!.app) : undefined;
  const guide = d?.focus && focusRow ? focusGuide(d.focus, focusRow.url) : null;
  const steps = nextSteps(i.rows, d);
  const lastRun = Math.max(0, ...i.rows.map((r) => r.pagespeed_at ?? 0));
  const n = i.rows.length;

  let h1: string;
  let meta: string;
  if (!d) {
    h1 = 'Your first weekly summary arrives Monday at 7 am.';
    meta = 'Until then, here is where every app stands today.';
  } else {
    const up = d.outages === 0 ? `All ${n} app${n === 1 ? '' : 's'} stayed up.` : `${d.outages} outage${d.outages === 1 ? '' : 's'} this week.`;
    h1 = `${up} ${guide ? `This week, ${guide.title[0].toLowerCase()}${guide.title.slice(1)}.` : 'Nothing to fix this week.'}`;
    meta = !d.focus
      ? 'Nothing needs you this week. A good week to ship something.'
      : d.focus.rule === 4 || d.focus.rule === 5
        ? "Nothing broke, so there's no fire to put out. Use the week on your weakest standing score, then work down the list below."
        : 'Something broke this week. Fix it first, then work down the list below.';
  }

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="robots" content="noindex">
${HEAD_ICONS}
<title>Insights · Vexto Pulse</title>
<link rel="preload" href="/geist.woff2" as="font" type="font/woff2" crossorigin>
<style>${TOKENS_CSS}${INSIGHTS_CSS}${DIGEST_CSS}</style>
</head>
<body>
<main>
  <p class="brand"><a href="/">${PULSE}Vexto Pulse</a><span class="lock">Private</span></p>
  ${d ? `<p class="hello">Your week, ${esc(d.label)}</p>` : ''}
  <h1>${esc(h1)}</h1>
  <p class="meta">${esc(meta)}</p>

  ${guide ? `<section aria-labelledby="first-h">
    <h2 id="first-h">Do this first</h2>
    <div class="card first">
      <p class="label">Focus this week</p>
      <h3>${esc(guide.title)}</h3>
      <p class="why">${esc(guide.why)}</p>
      <ol class="todo">${guide.todo.map((t) => `<li>${esc(t)}</li>`).join('')}</ol>
      <p class="done"><b>Done when</b> ${esc(guide.done)}. Monday's summary will check and tell you.</p>
      ${d!.also.length ? `<p class="next">After that: ${esc(d!.also.map((a) => a.text).join(' '))}</p>` : ''}
    </div>
  </section>` : ''}

  ${digestSection(w.shown, w.weeks, w.selected, w.sendError)}

  <section aria-labelledby="all-h">
    <h2 id="all-h">Every app, with your next step <span>${n}</span></h2>
    <p class="lede">Most important first. Open any app to see its numbers and why Pulse suggests that step.</p>
    ${GROUPS.map((g) => group(g, steps.filter((s) => s.group === g.id))).join('')}
  </section>

  <section aria-labelledby="soon-h">
    <h2 id="soon-h">Retire, grow or keep updating</h2>
    <div class="card soon">
      <h3>Not enough data to call this yet</h3>
      <p>To tell you which apps to retire, which to grow and which have gone stale, Pulse needs to know how many people use each app and when you last shipped to it. Add Cloudflare Web Analytics to each app; Pulse will read visits from Cloudflare and your last commit from GitHub.</p>
      <div class="meter" role="img" aria-label="0 of ${n} apps reporting visits"></div>
      <p class="small">0 of ${n} apps reporting visits. Calls start after about 4 weeks of data.</p>
    </div>
  </section>

  <section aria-labelledby="ref-h">
    <h2 id="ref-h">Reference</h2>
    <div class="card ref">${REFERENCE}</div>
  </section>

  <footer><span>${lastRun ? `PageSpeed last ran ${time(lastRun)}` : 'PageSpeed runs on the next weekly job'} · errors update daily</span><a href="/">Public page</a></footer>
</main>
<script>for(const t of document.querySelectorAll('time[data-local]'))t.textContent=new Date(t.dateTime).toLocaleString([],{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'})</script>
</body>
</html>`;
}

const GROUPS: { id: Group; colour: string; title: string; blurb: string }[] = [
  { id: 'fix', colour: 'var(--warn)', title: 'Fix', blurb: "These break one of your rules. Start with this week's focus, then work down." },
  {
    id: 'sentry',
    colour: 'var(--faint)',
    title: 'Set up error tracking',
    blurb: 'Pulse can\'t see crashes on these apps. Connecting Sentry is a one-time job per app, and it makes the "errors rising" rule work for them.',
  },
  { id: 'ok', colour: 'var(--ok)', title: 'Healthy', blurb: 'Up, scoring well, and Sentry is connected. Nothing to do.' },
];

function group(g: (typeof GROUPS)[number], steps: AppStep[]): string {
  if (!steps.length) return '';
  return `<div class="group"><h3><i style="background:${g.colour}"></i>${esc(g.title)} <span>${steps.length}</span></h3><p>${esc(g.blurb)}</p>
    <div class="card">${steps.map(appRow).join('')}</div></div>`;
}

const band = (s: number | null | undefined) => (s == null ? 'n' : s >= 90 ? 'g' : s >= 50 ? 'a' : 'r');
const upBand = (u: number | null) => (u == null ? 'n' : u >= 99.5 ? 'g' : u >= 99 ? 'a' : 'r');
const num = (v: number | null | undefined) => (v == null ? '–' : String(v));

function appRow({ row: r, step, focus, notes }: AppStep): string {
  const s = r.scores;
  const nums: [string, string][] = [
    ['Uptime 30 days', `<span class="${upBand(r.uptime_30d)}">${pct(r.uptime_30d)}</span>`],
    ['Speed', `<span class="${band(s?.performance)}">${num(s?.performance)}</span>`],
    ['Accessibility', `<span class="${band(s?.accessibility)}">${num(s?.accessibility)}</span>`],
    ['Best practices', `<span class="${band(s?.best_practices)}">${num(s?.best_practices)}</span>`],
    ['SEO', `<span class="${band(s?.seo)}">${num(s?.seo)}</span>`],
    ['Errors 7 days', r.errors_7d == null ? '<span class="n">not connected</span>' : `${r.errors_7d} <span class="n">(${r.errors_prev_7d ?? 0})</span>`],
  ];
  return `<details><summary><span class="nm">${esc(r.name)}<small>${focus ? 'Your focus this week: ' : ''}${esc(step)}</small></span>
    <span class="chips"><span>Up <b class="${upBand(r.uptime_30d)}">${pct(r.uptime_30d)}</b></span><span>Speed <b class="${band(s?.performance)}">${num(s?.performance)}</b></span><span>Access <b class="${band(s?.accessibility)}">${num(s?.accessibility)}</b></span></span>${ARROW}</summary>
    <div class="more"><dl class="nums">${nums.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('')}</dl>
    <ul class="notes">${notes.map((t) => `<li>${esc(t)}</li>`).join('')}</ul></div></details>`;
}

const REFERENCE = `<details>
  <summary>What the numbers mean${ARROW}</summary>
  <div class="more"><dl class="key">
    <div><dt>Uptime (30 days)</dt><dd>Share of 5-minute checks that got a working page. 99.5% allows about 3.5 hours down a month.</dd></div>
    <div><dt>Speed</dt><dd>Google PageSpeed's performance score on a phone: how fast the page loads and becomes usable.</dd></div>
    <div><dt>Accessibility</dt><dd>How well it works with screen readers, keyboards and zoom. Your bar is 90.</dd></div>
    <div><dt>Best practices</dt><dd>Security and modern web standards: HTTPS, no browser errors, safe libraries.</dd></div>
    <div><dt>SEO</dt><dd>How easily search engines can read and list the page.</dd></div>
    <div><dt>Errors (7 days)</dt><dd>Crashes and bugs Sentry caught, with the week before in brackets.</dd></div>
    <p class="bands"><span><i class="bg-g"></i>90–100 good</span><span><i class="bg-a"></i>50–89 needs work</span><span><i class="bg-r"></i>under 50 poor</span><span>Google's bands</span></p>
  </dl></div>
</details>
<details>
  <summary>How Pulse picks your focus${ARROW}</summary>
  <div class="more">
    <p class="lede">Every Monday Pulse checks these in order. The first one any app breaks becomes your focus; within a rule, the worst number wins.</p>
    <ol class="rules">
      <li><div><strong>An app was down 30 minutes or more</strong><span class="tag">this week</span><p>Nothing matters more than the app working.</p></div></li>
      <li><div><strong>Errors are rising</strong><span class="tag">this week</span><p>5 or more errors, and at least double the week before.</p></div></li>
      <li><div><strong>Uptime below 99%</strong><span class="tag">this week</span><p>Lots of short failures add up even without one long outage.</p></div></li>
      <li><div><strong>A certificate expires within 14 days</strong><span class="tag">standing</span><p>If it lapses, browsers block the site.</p></div></li>
      <li><div><strong>Weak or falling PageSpeed</strong><span class="tag">standing</span><p>Speed under 50, accessibility under 90, or any score down 10 points.</p></div></li>
      <li><div><strong>Much slower than last week</strong><span class="tag">this week</span><p>Average response at least twice as slow and over 2 seconds.</p></div></li>
    </ol>
    <p class="small">"This week" problems decide whether the week was good, mixed or rough. "Standing" ones become your focus when nothing broke.</p>
  </div>
</details>`;

const INSIGHTS_CSS = `
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.55 var(--font);font-variant-numeric:tabular-nums;-webkit-font-smoothing:antialiased}
h1,h2,h3{margin:0;font-weight:600;text-wrap:balance}
p{margin:0}
ul,ol{margin:0;padding:0;list-style:none}
a{color:inherit}
:focus-visible{outline:2px solid var(--ok);outline-offset:3px;border-radius:6px}
main{max-width:46rem;margin:0 auto;padding-block:3rem 4rem;padding-left:max(16px,env(safe-area-inset-left,0px));padding-right:max(16px,env(safe-area-inset-right,0px))}
.brand{display:flex;align-items:center;gap:.5rem;font-weight:500;font-size:.9rem;color:var(--sub);margin-bottom:2.25rem}
.brand a{display:flex;align-items:center;gap:.5rem;text-decoration:none}
.brand svg{width:18px;height:18px;color:var(--ok)}
.lock{margin-left:auto;font-size:.75rem;color:var(--faint);border:1px solid var(--line);border-radius:999px;padding:.1rem .6rem}
.hello{color:var(--sub);font-size:.95rem;margin-bottom:.5rem}
h1{font-size:clamp(1.8rem,5.2vw,2.5rem);letter-spacing:-.035em;line-height:1.12}
.meta{color:var(--sub);margin-top:.7rem;max-width:38rem}
section{margin-top:3rem}
section>h2{font-size:.95rem;display:flex;align-items:baseline;gap:.5rem;margin-bottom:.8rem}
section>h2 span{font-weight:400;color:var(--faint);font-size:.85rem}
.lede{color:var(--sub);font-size:.9rem;margin:-.35rem 0 1rem;max-width:38rem}
.more .lede{margin:0 0 .9rem}
.card{background:var(--card);border:1px solid var(--line);border-radius:12px}
.small{font-size:.8rem;color:var(--faint);margin-top:.6rem}
.first{padding:1.25rem;border-color:color-mix(in srgb,var(--warn) 45%,var(--line))}
.first .label{font-size:.8rem;font-weight:500;color:var(--warn)}
.first h3{font-size:1.25rem;letter-spacing:-.02em;margin-top:.3rem}
.first .why{color:var(--sub);margin-top:.5rem}
.todo{margin-top:1rem;display:grid;gap:.5rem;counter-reset:s}
.todo li{display:grid;grid-template-columns:1.4rem minmax(0,1fr);gap:.5rem;font-size:.92rem}
.todo li::before{counter-increment:s;content:counter(s);font-size:.75rem;font-weight:600;color:var(--warn);padding-top:.15rem}
.done{margin-top:1rem;padding-top:.9rem;border-top:1px solid var(--line);font-size:.88rem;color:var(--sub)}
.done b{color:var(--ink);font-weight:500}
.next{margin-top:.75rem;font-size:.88rem;color:var(--sub)}
.group+.group{margin-top:1.25rem}
.group h3{font-size:.9rem;font-weight:500;display:flex;align-items:center;gap:.5rem}
.group h3 i{width:8px;height:8px;border-radius:50%}
.group h3 span{color:var(--faint);font-weight:400}
.group>p{font-size:.85rem;color:var(--sub);margin:.25rem 0 .6rem;max-width:38rem}
details+details{border-top:1px solid var(--line)}
summary{list-style:none;cursor:pointer;display:grid;grid-template-columns:minmax(0,1fr) auto auto;align-items:center;gap:.25rem .9rem;padding:.75rem 1rem}
summary::-webkit-details-marker{display:none}
summary:hover{background:var(--sunk)}
details:first-child summary{border-radius:12px 12px 0 0}
details:last-child:not([open]) summary{border-radius:0 0 12px 12px}
.nm{font-weight:500;overflow-wrap:anywhere}
.nm small{display:block;font-weight:400;font-size:.82rem;color:var(--sub)}
.chips{display:flex;gap:.6rem;font-size:.8rem;color:var(--faint);white-space:nowrap}
.chips b{font-weight:500}
.arrow{width:16px;height:16px;color:var(--faint);transition:transform .15s}
details[open]>summary .arrow{transform:rotate(180deg)}
@media (prefers-reduced-motion:reduce){.arrow{transition:none}}
.more{padding:.25rem 1rem 1rem}
.nums{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:.6rem 1rem;padding:.8rem;margin:0;background:var(--sunk);border-radius:8px}
.nums dt{font-size:.72rem;color:var(--faint)}
.nums dd{margin:0;font-weight:500}
.notes{margin-top:.75rem;display:grid;gap:.35rem;font-size:.87rem;color:var(--sub)}
.notes li{padding-left:1rem;position:relative}
.notes li::before{content:"";position:absolute;left:0;top:.6em;width:5px;height:5px;border-radius:50%;background:var(--faint)}
.g{color:var(--ok)}.a{color:var(--warn)}.r{color:var(--down)}.n{color:var(--faint);font-weight:400}
.bg-g{background:var(--ok)}.bg-a{background:var(--warn)}.bg-r{background:var(--down)}
@media (max-width:560px){
  summary{grid-template-columns:minmax(0,1fr) auto}
  .chips{grid-column:1;grid-row:2}
  .arrow{grid-row:1/3;grid-column:2}
}
.soon{padding:1.1rem 1.2rem;border-style:dashed}
.soon h3{font-size:.95rem;font-weight:500}
.soon p{font-size:.88rem;color:var(--sub);margin-top:.35rem}
.meter{margin-top:.8rem;height:6px;border-radius:999px;background:var(--empty)}
.soon .small{margin-top:.4rem}
.ref summary{grid-template-columns:minmax(0,1fr) auto;font-weight:500;font-size:.92rem}
.key{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:.9rem 1.5rem;margin:0}
.key dt{font-weight:500;font-size:.88rem}
.key dd{margin:.1rem 0 0;font-size:.83rem;color:var(--sub)}
.bands{grid-column:1/-1;display:flex;flex-wrap:wrap;gap:.4rem 1.25rem;font-size:.8rem;color:var(--sub);padding-top:.8rem;border-top:1px solid var(--line)}
.bands span{display:inline-flex;align-items:center;gap:.4rem}
.bands i{width:8px;height:8px;border-radius:50%}
@media (max-width:560px){.key{grid-template-columns:1fr}.nums{grid-template-columns:repeat(2,minmax(0,1fr))}}
.rules{counter-reset:r;display:grid;gap:.7rem}
.rules li{display:grid;grid-template-columns:1.4rem minmax(0,1fr);gap:.5rem}
.rules li::before{counter-increment:r;content:counter(r);font-size:.8rem;color:var(--faint);font-weight:500;padding-top:.1rem}
.rules strong{font-weight:500;font-size:.9rem}
.rules p{font-size:.84rem;color:var(--sub)}
.tag{font-size:.7rem;color:var(--faint);border:1px solid var(--line);border-radius:999px;padding:0 .45rem;margin-left:.35rem;white-space:nowrap}
footer{margin-top:3.5rem;padding-top:1.25rem;border-top:1px solid var(--line);font-size:.8rem;color:var(--faint);display:flex;flex-wrap:wrap;justify-content:space-between;gap:.5rem}
`;
