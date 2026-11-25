// Server-rendered status page: one HTML response, inline CSS, no external requests.
import type { AppStatus, Incident, Status } from './status.ts';

const TLS_WARN_DAYS = 14;
const SLOTS_24H = 288; // one check every 5 minutes

export function renderPage(s: Status): string {
  const lastCheck = Math.max(0, ...s.apps.map((a) => a.checked_at ?? 0));
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="theme-color" content="#e9eeeb" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#111816" media="(prefers-color-scheme: dark)">
<title>${esc(headline(s))} · Vexto Pulse</title>
<meta name="description" content="Live status of the apps in the vexto.app portfolio.">
<style>${CSS}</style>
</head>
<body>
<main>
  <header class="top">
    <p class="brand"><span class="led led-${s.overall}" aria-hidden="true"></span>Vexto Pulse</p>
    <h1>${esc(headline(s))}</h1>
    <p class="sub">${lastCheck ? `Checked every 5 minutes. Last check ${ago(s.generated_at - lastCheck)}.` : 'The first check runs within 5 minutes.'}</p>
  </header>

  <section aria-labelledby="apps-h">
    <h2 id="apps-h">Apps</h2>
    <ul class="apps">${s.apps.map(renderApp).join('')}</ul>
  </section>

  <section aria-labelledby="inc-h">
    <h2 id="inc-h">Recent incidents</h2>
    ${s.incidents.length ? `<ul class="incidents">${s.incidents.map(renderIncident).join('')}</ul>` : '<p class="muted">No incidents recorded. An incident starts after two failed checks in a row.</p>'}
  </section>

  <footer class="muted">Running on a Raspberry Pi. Data as JSON at <a href="/api/status">/api/status</a>.</footer>
</main>
<script>for(const t of document.querySelectorAll('time[data-local]'))t.textContent=new Date(t.dateTime).toLocaleString([],{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'})</script>
</body>
</html>`;
}

function headline(s: Status): string {
  const down = s.apps.filter((a) => a.state === 'down').map((a) => a.name);
  const shaky = s.apps.filter((a) => a.state === 'degraded').map((a) => a.name);
  if (s.overall === 'unknown') return 'Waiting for the first check';
  if (s.overall === 'major_outage') return 'All apps are down';
  if (down.length) return `${list(down)} ${down.length === 1 ? 'is' : 'are'} down`;
  if (shaky.length) return `${list(shaky)} failed the last check`;
  return s.apps.length === 1 ? 'The app is up' : `All ${s.apps.length} apps are up`;
}

const STATE_LABEL = { up: 'Up', degraded: 'Failed last check', down: 'Down', unknown: 'No data yet' };

function renderApp(a: AppStatus): string {
  const host = new URL(a.url).host;
  const tls =
    a.tls_days == null
      ? ''
      : `<span class="${a.tls_days < TLS_WARN_DAYS ? 'warn' : ''}">Certificate valid ${a.tls_days} more day${a.tls_days === 1 ? '' : 's'}</span>`;
  const now =
    a.state === 'unknown' ? '' : a.ms != null && a.state === 'up' ? `${a.ms}&nbsp;ms` : esc(plainError(a.error));
  return `
    <li class="app state-${a.state}">
      <div class="app-head">
        <span class="led led-${a.state}" aria-hidden="true"></span>
        <div class="app-name">
          <a href="${esc(a.url)}">${esc(a.name)}</a>
          <span class="muted">${esc(a.category)}, ${esc(host)}</span>
        </div>
        <div class="app-now">
          <span class="state">${STATE_LABEL[a.state]}</span>
          <span class="muted num">${now}</span>
        </div>
      </div>
      ${sparkline(a.response_24h)}
      <div class="app-foot">
        <dl class="uptime">
          <div><dt>24h</dt><dd>${pct(a.uptime.h24)}</dd></div>
          <div><dt>7d</dt><dd>${pct(a.uptime.d7)}</dd></div>
          <div><dt>30d</dt><dd>${pct(a.uptime.d30)}</dd></div>
        </dl>
        ${tls}
      </div>
    </li>`;
}

function renderIncident(i: Incident): string {
  const length = i.ended_at == null ? '<span class="state-down-text">Ongoing</span>' : `Lasted ${duration(i.duration_s ?? 0)}`;
  return `<li><span class="inc-app">${esc(i.app)}</span><span class="muted">Started ${time(i.started_at)}</span><span>${length}</span></li>`;
}

// 24h response-time trace. Points sit in fixed 5-minute slots, newest at the right edge,
// so a short history only fills the right-hand part. Failed checks show as red ticks.
function sparkline(values: (number | null)[]): string {
  const W = 288, H = 40, PAD = 3;
  const pts = values.slice(-SLOTS_24H);
  const ok = pts.filter((v): v is number => v != null);
  if (pts.length === 0) return '<div class="spark spark-empty muted">No checks in the last 24 hours</div>';

  const max = Math.max(...ok, 1);
  const x = (i: number) => (W - (pts.length - 1 - i) * (W / (SLOTS_24H - 1))).toFixed(1);
  const y = (v: number) => (H - PAD - (v / max) * (H - 2 * PAD)).toFixed(1);

  const lines: string[] = [];
  let seg: string[] = [];
  const ticks: string[] = [];
  pts.forEach((v, i) => {
    if (v == null) {
      ticks.push(`<rect x="${x(i)}" y="${H - 10}" width="1.5" height="10" class="fail"/>`);
      if (seg.length) lines.push(seg.join(' '));
      seg = [];
    } else seg.push(`${x(i)},${y(v)}`);
  });
  if (seg.length) lines.push(seg.join(' '));

  const sorted = [...ok].sort((a, b) => a - b);
  const median = sorted.length ? sorted[Math.floor(sorted.length / 2)] : null;
  const label = `Response time over the last 24 hours: ${median != null ? `median ${median} ms` : 'no successful checks'}, ${pts.length - ok.length} failed of ${pts.length}.`;

  return `<svg class="spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="${label}">
        <line x1="0" y1="${H - 0.5}" x2="${W}" y2="${H - 0.5}" class="base"/>
        ${lines.map((p) => (p.includes(' ') ? `<polyline points="${p}"/>` : `<circle cx="${p.split(',')[0]}" cy="${p.split(',')[1]}" r="1.2"/>`)).join('')}
        ${ticks.join('')}
      </svg>
      <div class="spark-axis muted" aria-hidden="true"><span>24 hours ago</span><span>now</span></div>`;
}

// Plain-language versions of common network errors; anything else is shown as-is.
const ERRORS: Record<string, string> = {
  ENOTFOUND: 'Domain not found',
  ECONNREFUSED: 'Connection refused',
  ECONNRESET: 'Connection dropped',
  CERT_HAS_EXPIRED: 'Certificate expired',
  ERR_TLS_CERT_ALTNAME_INVALID: 'Certificate does not match domain',
};
const plainError = (code: string | null) => (code ? (ERRORS[code] ?? code) : 'Failed');

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

const list = (names: string[]) =>
  names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;

const pct = (v: number | null) => (v == null ? '–' : Number.isInteger(v) ? `${v}%` : `${v.toFixed(2)}%`);

function ago(ms: number): string {
  const min = Math.round(ms / 60_000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} minute${min === 1 ? '' : 's'} ago`;
  const h = Math.round(min / 60);
  return `${h} hour${h === 1 ? '' : 's'} ago`;
}

function duration(s: number): string {
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))} min`;
  if (s < 86_400) return `${Math.floor(s / 3600)} h ${Math.round((s % 3600) / 60)} min`;
  return `${Math.floor(s / 86_400)} d ${Math.round((s % 86_400) / 3600)} h`;
}

function time(ts: number): string {
  const d = new Date(ts);
  const text = d.toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' });
  return `<time datetime="${d.toISOString()}" data-local>${text} UTC</time>`;
}

const CSS = `
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
