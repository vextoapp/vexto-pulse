// Private /insights page (behind Cloudflare Access): same look as the status page, plus a table.
import type { InsightRow, Insights } from './insights-model.ts';
import type { Scores } from './pagespeed.ts';
import { esc, pct, time } from './render.ts';

const SCORE_KEYS: (keyof Scores)[] = ['performance', 'accessibility', 'best_practices', 'seo'];

export function renderInsights(i: Insights): string {
  const attention = i.rows.filter((r) => r.reasons.length);
  const lastRun = Math.max(0, ...i.rows.map((r) => r.pagespeed_at ?? 0));
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="robots" content="noindex">
<meta name="theme-color" content="#e9eeeb" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#111816" media="(prefers-color-scheme: dark)">
<title>Insights · Vexto Pulse</title>
<style>${BASE_CSS}${INSIGHTS_CSS}</style>
</head>
<body>
<main class="wide">
  <header class="top">
    <p class="brand"><a href="/">Vexto Pulse</a></p>
    <h1>Insights</h1>
    <p class="sub">${lastRun ? `PageSpeed last ran ${time(lastRun)}.` : 'PageSpeed runs on the next daily job.'} Errors update daily.</p>
  </header>

  <section aria-labelledby="att-h">
    <h2 id="att-h">Needs attention${attention.length ? ` (${attention.length})` : ''}</h2>
    ${attention.length
      ? `<ul class="attention">${attention.map((r) => `<li><span class="led led-degraded" aria-hidden="true"></span><span><strong>${esc(r.name)}</strong> <span class="muted">${r.reasons.map(esc).join('; ')}</span></span></li>`).join('')}</ul>`
      : '<p class="muted">Nothing needs attention.</p>'}
  </section>

  <section aria-labelledby="all-h">
    <h2 id="all-h">All apps</h2>
    <div class="table-wrap" tabindex="0" role="region" aria-labelledby="all-h">
      <table>
        <thead><tr>
          <th scope="col">App</th><th scope="col">Uptime 30d</th>
          <th scope="col"><abbr title="Performance">Perf</abbr></th><th scope="col"><abbr title="Accessibility">A11y</abbr></th>
          <th scope="col"><abbr title="Best practices">BP</abbr></th><th scope="col">SEO</th>
          <th scope="col">Errors 7d</th>
        </tr></thead>
        <tbody>${i.rows.map(renderRow).join('')}</tbody>
      </table>
    </div>
  </section>

  <footer class="muted">PageSpeed runs weekly (mobile). Errors come from Sentry, last 7 days with the week before in brackets. Usage arrives after the hosting move.</footer>
</main>
<script>for(const t of document.querySelectorAll('time[data-local]'))t.textContent=new Date(t.dateTime).toLocaleString([],{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'})</script>
</body>
</html>`;
}

function renderRow(r: InsightRow): string {
  const scores = r.scores
    ? SCORE_KEYS.map((k) => `<td>${score(r.scores![k], r.previous?.[k] ?? null)}</td>`).join('')
    : `<td colspan="4" class="muted">${r.pagespeed_error ? `Failed: ${esc(r.pagespeed_error)}` : 'Not run yet'}</td>`;
  const errors = r.errors_7d == null
    ? '<td class="muted">not set up</td>'
    : `<td><span class="${r.errors_7d > 0 ? 'bad' : ''}">${r.errors_7d}</span> <span class="muted">(${r.errors_prev_7d ?? 0})</span></td>`;
  return `<tr class="${r.reasons.length ? 'flag' : ''}"><th scope="row"><a href="${esc(r.url)}">${esc(r.name)}</a></th><td>${pct(r.uptime_30d)}</td>${scores}${errors}</tr>`;
}

// Lighthouse bands: 90+ good, 50–89 needs work, under 50 poor. Arrow shows change since last week.
function score(v: number | null, prev: number | null): string {
  if (v == null) return '<span class="muted">–</span>';
  const band = v >= 90 ? 'good' : v >= 50 ? 'ok' : 'bad';
  const d = prev == null ? 0 : v - prev;
  const delta = d
    ? ` <span class="delta"><span aria-hidden="true">${d > 0 ? '▲' : '▼'}</span><span class="vh">${d > 0 ? 'up' : 'down'} </span>${Math.abs(d)}</span>`
    : '';
  return `<span class="${band}">${v}</span>${delta}`;
}

const INSIGHTS_CSS = `
main.wide{max-width:52rem}
.brand a{text-decoration:none}
.attention{background:var(--surface);border:1px solid var(--rule);border-radius:14px}
.attention li{display:flex;align-items:baseline;gap:.75rem;padding:.8rem 1.1rem}
.attention li+li{border-top:1px solid var(--rule)}
.attention .led{position:relative;top:.05rem}
.table-wrap{overflow-x:auto;background:var(--surface);border:1px solid var(--rule);border-radius:14px}
.table-wrap:focus-visible{outline:2px solid var(--trace);outline-offset:3px}
table{width:100%;border-collapse:collapse;font-size:.9rem;white-space:nowrap}
th,td{padding:.6rem .8rem;text-align:right}
th:first-child{text-align:left;position:sticky;left:0;background:var(--surface)}
thead th{font-weight:600;color:var(--muted);border-bottom:1px solid var(--rule)}
tbody tr+tr>*{border-top:1px solid var(--rule)}
tbody th{font-weight:600}
tbody th a{text-decoration:none}
tbody th a:hover{text-decoration:underline}
tr.flag th{box-shadow:inset 3px 0 0 var(--warn)}
abbr{text-decoration:none}
.good{color:var(--up)}.ok{color:#8a5600}.bad{color:var(--down);font-weight:600}
@media (prefers-color-scheme:dark){.ok{color:var(--warn)}}
.vh{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}
.delta{font-size:.75rem;color:var(--muted)}
td[colspan]{text-align:left}
`;

// The original status-page styles; the insights page still uses them.
const BASE_CSS = `
:root{
  --paper:#e9eeeb;--surface:#f6f8f7;--ink:#17211d;--muted:#5b6862;--rule:#cdd6d1;
  --up:#1d8a57;--warn:#a86a10;--down:#c23b2a;--idle:#8a958f;--trace:#2b5d4a;
}
@media (prefers-color-scheme:dark){:root{
  --paper:#111816;--surface:#18211e;--ink:#e3ebe7;--muted:#93a29b;--rule:#2a3631;
  --up:#3ccf8a;--warn:#e2a740;--down:#ff6b57;--idle:#6b7872;--trace:#8fd3b4;
}}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--paper);color:var(--ink);font:16px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;font-variant-numeric:tabular-nums}
main{max-width:44rem;margin:0 auto;padding:2.5rem 1rem 3rem}
a{color:inherit;text-underline-offset:.2em;text-decoration-thickness:1px}
a:focus-visible{outline:2px solid var(--trace);outline-offset:3px;border-radius:2px}
.muted{color:var(--muted)}
.brand{display:flex;align-items:center;gap:.6rem;margin:0 0 2.5rem;font-weight:600;letter-spacing:-.01em}
h1{font-size:clamp(2rem,7vw,3.25rem);line-height:1.05;letter-spacing:-.035em;font-weight:700;margin:0 0 .75rem;text-wrap:balance}
.sub{margin:0 0 3rem;color:var(--muted)}
h2{font-size:1rem;font-weight:600;margin:0 0 .75rem;color:var(--muted)}
section{margin-bottom:2.75rem}
ul{list-style:none;margin:0;padding:0}

.led{flex:none;width:.7rem;height:.7rem;border-radius:50%;background:var(--idle)}
.led-up,.led-operational{background:var(--up);box-shadow:0 0 0 3px color-mix(in srgb,var(--up) 22%,transparent),0 0 12px var(--up)}
.led-degraded,.led-partial_outage{background:var(--warn);box-shadow:0 0 0 3px color-mix(in srgb,var(--warn) 22%,transparent),0 0 12px var(--warn)}
.led-down,.led-major_outage{background:var(--down);box-shadow:0 0 0 3px color-mix(in srgb,var(--down) 22%,transparent),0 0 12px var(--down)}
.brand .led{width:.85rem;height:.85rem;animation:beat 2.4s ease-in-out infinite}
@keyframes beat{0%,100%{opacity:1}50%{opacity:.45}}
@media (prefers-reduced-motion:reduce){.brand .led{animation:none}}

.apps{background:var(--surface);border:1px solid var(--rule);border-radius:14px}
.app{padding:1.1rem 1.1rem 1rem}
.app+.app{border-top:1px solid var(--rule)}
.app-head{display:flex;align-items:center;gap:.75rem}
.app-name{flex:1;min-width:0;display:flex;flex-direction:column}
.app-name a{font-weight:600;font-size:1.05rem;text-decoration:none}
.app-name a:hover{text-decoration:underline}
.app-name .muted,.app-now .muted{font-size:.875rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.app-now{display:flex;flex-direction:column;align-items:flex-end;text-align:right;min-width:0;max-width:45%}
.state{font-weight:600;font-size:.95rem}
.state-up .state{color:var(--up)}.state-degraded .state{color:var(--warn)}.state-down .state{color:var(--down)}
.state-down-text{color:var(--down);font-weight:600}

.spark{display:block;width:100%;height:2.5rem;margin:.9rem 0 0}
.spark-axis{display:flex;justify-content:space-between;font-size:.75rem;margin:.15rem 0 .6rem}
.spark polyline{fill:none;stroke:var(--trace);stroke-width:1.5;stroke-linejoin:round;vector-effect:non-scaling-stroke}
.spark circle{fill:var(--trace)}
.spark .base{stroke:var(--rule);stroke-width:1;vector-effect:non-scaling-stroke}
.spark .fail{fill:var(--down)}
.spark-empty{display:flex;align-items:center;font-size:.875rem;border-bottom:1px solid var(--rule)}

.app-foot{display:flex;flex-wrap:wrap;justify-content:space-between;align-items:baseline;gap:.25rem 1rem;font-size:.875rem;color:var(--muted)}
.uptime{display:flex;gap:1.25rem;margin:0}
.uptime div{display:flex;gap:.4rem}
.uptime dd{margin:0;color:var(--ink);font-weight:500}
.warn{color:var(--warn);font-weight:600}

.incidents li{display:grid;grid-template-columns:1fr auto;gap:0 1rem;padding:.7rem 0;border-bottom:1px solid var(--rule);font-size:.95rem}
.incidents li:first-child{border-top:1px solid var(--rule)}
.inc-app{font-weight:600}
.incidents li>span:nth-child(2){grid-column:1}
.incidents li>span:nth-child(3){grid-row:1;grid-column:2;text-align:right}
footer{font-size:.875rem;padding-top:1rem}
`;
