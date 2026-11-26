// Private /insights page (behind Cloudflare Access): same look as the status page, plus a table.
import type { InsightRow, Insights } from './insights-model.ts';
import type { Scores } from './pagespeed.ts';
import { CSS, esc, pct, time } from './render.ts';

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
<style>${CSS}${INSIGHTS_CSS}</style>
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
