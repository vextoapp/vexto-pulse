// Server-rendered status page: one HTML response, inline CSS, no requests to other sites.
// Written for everyone: plain words, one heartbeat per app, details on tap.
import type { AppState, AppStatus, DayState, Incident, OfflineSpell, Status } from './status.ts';

const TLS_WARN_DAYS = 14;
const RUN_MS = 5 * 60_000;

const STATE_LABEL: Record<AppState, string> = {
  up: 'Working',
  degraded: 'Not responding',
  down: 'Down',
  unknown: 'Not checked yet',
};
const DAY_LABEL: Record<DayState, string> = {
  ok: 'No problems',
  minor: 'A short problem',
  major: 'Down for a while',
  none: 'Not tracked yet',
};

export function renderPage(s: Status): string {
  const lastCheck = Math.max(0, ...s.apps.map((a) => a.checked_at ?? 0));
  const groups = groupApps(s.apps);
  const uptimes = s.apps.map((a) => a.uptime.d30).filter((v): v is number => v != null);
  const avg = uptimes.length ? uptimes.reduce((x, y) => x + y, 0) / uptimes.length : null;
  const problems = s.apps.filter((a) => a.state === 'down' || a.state === 'degraded').length;
  const dates = dayNames(s.generated_at);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="theme-color" content="#ffffff" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#0f1110" media="(prefers-color-scheme: dark)">
<title>${esc(plainHeadline(s))} · Vexto Pulse</title>
<meta name="description" content="Live status of Mohammad Syed's apps and websites, checked every 5 minutes.">
<link rel="preload" href="/geist.woff2" as="font" type="font/woff2" crossorigin>
<style>${CSS}</style>
</head>
<body>
<main>
  <p class="brand"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12h4l2-5 4 10 2.5-5H22"/></svg>Vexto Pulse</p>
  <h1>${headline(s)}</h1>
  <p class="meta">${lastCheck ? `Checked every 5 minutes. Last check ${ago(s.generated_at - lastCheck)}.` : 'The first check runs within 5 minutes.'}</p>

  <div class="ecg-box">
    ${heartbeat(groups)}
    <div class="ecg-cap"><span>One beat per app, grouped as below. A flat red line means an app is down.</span><output id="beat" aria-live="polite"></output></div>
  </div>

  <div class="stats">
    <div><strong>${s.apps.length}</strong><span>products</span></div>
    <div><strong>${pct(avg)}</strong><span>up, last 30 days</span></div>
    <div><strong>${problems}</strong><span>with problems now</span></div>
  </div>

  <div class="key" aria-label="What the colours mean">
    ${(['ok', 'minor', 'major', 'none'] as DayState[]).map((d) => `<span><i class="d-${d}"></i>${DAY_LABEL[d]}</span>`).join('')}
  </div>
  <div class="filters" role="group" aria-label="Show one group" hidden>
    <button type="button" data-g="all" aria-pressed="true">All</button>${groups.map(([g], i) => `<button type="button" data-g="${i}" aria-pressed="false">${esc(g)}</button>`).join('')}
  </div>

  ${groups.map(([g, apps], i) => `
  <section class="group" data-g="${i}" aria-labelledby="g-${i}">
    <h2 id="g-${i}">${esc(g)}<span>${apps.length}</span></h2>
    <div class="card">${apps.map((a) => renderApp(a, dates)).join('')}</div>
  </section>`).join('')}

  <section class="plain" aria-labelledby="hist-h">
    <h2 id="hist-h">Recent problems</h2>
    ${renderHistory(s.incidents, s.pulse_offline, s.generated_at)}
    <p class="small">One failed check on its own doesn’t count. An outage starts after two failed checks in a row.</p>
  </section>

  <section class="plain" aria-labelledby="how-h">
    <h2 id="how-h">How this works</h2>
    <div class="how">
      <div><h3>What’s checked</h3><p>Each app’s home page, every 5 minutes, day and night.</p></div>
      <div><h3>What counts as down</h3><p>Two failed checks in a row. Single blips are ignored, and so are moments when Pulse’s own internet drops.</p></div>
      <div><h3>Where it runs</h3><p>A Raspberry Pi at home, using under 100 MB of memory.</p></div>
    </div>
  </section>

  <footer>Built and run by <a href="https://mohammadsyed.com">Mohammad Syed</a>. Data as JSON at <a href="/api/status">/api/status</a>.</footer>
</main>
<script>${SCRIPT}</script>
</body>
</html>`;
}

// Group apps by category, keeping apps.json order for both groups and apps.
function groupApps(apps: AppStatus[]): [string, AppStatus[]][] {
  const groups = new Map<string, AppStatus[]>();
  for (const a of apps) groups.set(a.category, [...(groups.get(a.category) ?? []), a]);
  return [...groups];
}

const names = (apps: AppStatus[]) => (apps.length <= 2 ? list(apps.map((a) => a.name)) : `${apps.length} apps`);

function headlineParts(s: Status): { lead: string; rest: string } {
  const down = s.apps.filter((a) => a.state === 'down');
  const shaky = s.apps.filter((a) => a.state === 'degraded');
  const up = s.apps.filter((a) => a.state === 'up').length;
  if (s.overall === 'unknown') return { lead: 'Waiting for the first check.', rest: '' };
  if (s.overall === 'major_outage') return { lead: 'All apps are down.', rest: '' };
  if (!down.length && !shaky.length) {
    return up === s.apps.length
      ? { lead: `All ${up} apps are working.`, rest: '' }
      : { lead: `${up} of ${s.apps.length} apps are working.`, rest: 'The rest haven’t been checked yet.' };
  }
  const lead = [
    down.length ? `${names(down)} ${down.length === 1 ? 'is' : 'are'} down.` : '',
    shaky.length ? `${names(shaky)} ${shaky.length === 1 ? 'isn’t' : 'aren’t'} responding.` : '',
  ].filter(Boolean).join(' ');
  return { lead, rest: up ? `The other ${up} ${up === 1 ? 'is' : 'are'} working.` : '' };
}

function headline(s: Status): string {
  const { lead, rest } = headlineParts(s);
  return esc(lead) + (rest ? ` <span class="rest">${esc(rest)}</span>` : '');
}

const plainHeadline = (s: Status) => Object.values(headlineParts(s)).filter(Boolean).join(' ');

// One heartbeat per app across a 1000×100 box, with a small gap between groups.
function heartbeat(groups: [string, AppStatus[]][]): string {
  const GAP = 0.6, W = 1000, BASE = 58;
  const count = groups.reduce((n, [, apps]) => n + apps.length, 0);
  const u = W / (count + GAP * (groups.length - 1));
  let x = 0;
  const parts: string[] = [];
  groups.forEach(([, apps], gi) => {
    if (gi) {
      parts.push(`<path class="link" d="M${f(x)} ${BASE} L${f(x + GAP * u)} ${BASE}"/>`);
      x += GAP * u;
    }
    for (const a of apps) {
      const p = (t: number) => f(x + t * u);
      const k = a.state === 'degraded' ? 0.45 : 1;
      const d =
        a.state === 'down' || a.state === 'unknown'
          ? `M${p(0)} ${BASE} L${p(1)} ${BASE}`
          : `M${p(0)} ${BASE} L${p(0.18)} ${BASE} L${p(0.26)} ${f(BASE - 6 * k)} L${p(0.34)} ${BASE} L${p(0.42)} ${BASE} ` +
            `L${p(0.48)} ${f(BASE + 8 * k)} L${p(0.55)} ${f(BASE - 48 * k)} L${p(0.62)} ${f(BASE + 16 * k)} L${p(0.68)} ${BASE} ` +
            `L${p(0.78)} ${f(BASE - 9 * k)} L${p(0.88)} ${BASE} L${p(1)} ${BASE}`;
      const label = esc(`${a.name}: ${STATE_LABEL[a.state]}`);
      parts.push(
        `<rect x="${p(0)}" y="0" width="${f(u)}" height="100" tabindex="0" aria-label="${label}"></rect>` +
          `<path class="beat ${BEAT[a.state]}" d="${d}"><title>${label}</title></path>`,
      );
      x += u;
    }
  });
  return `<svg class="ecg" viewBox="0 0 ${W} 100" preserveAspectRatio="none" role="group" aria-label="Heartbeat line, one beat per app">${parts.join('')}</svg>`;
}
const BEAT: Record<AppState, string> = { up: 'ok', degraded: 'warn', down: 'down', unknown: 'none' };
const f = (n: number) => n.toFixed(1);

function renderApp(a: AppStatus, dates: string[]): string {
  const host = new URL(a.url).host;
  return `
      <details class="row">
        <summary>
          <div class="who"><strong>${esc(a.name)}</strong><p>${esc(a.description)}</p></div>
          <div class="state s-${a.state}"><i></i>${STATE_LABEL[a.state]}</div>
          ${dayBar(a.days, dates)}
          <svg class="chev" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 6l4 4 4-4"/></svg>
        </summary>
        <dl class="facts">
          <div><dt>Response time</dt><dd>${responseText(a)}</dd></div>
          <div><dt>Up, last 30 days</dt><dd>${pct(a.uptime.d30)}</dd></div>
          <div><dt>Security certificate</dt><dd>${certText(a.tls_days)}</dd></div>
          <div><dt>Open</dt><dd><a href="${esc(a.url)}">${esc(host)}</a></dd></div>
        </dl>
      </details>`;
}

function responseText(a: AppStatus): string {
  if (a.state === 'up' && a.ms != null) return `${(a.ms / 1000).toFixed(1)} seconds`;
  if (a.state === 'unknown') return 'Not checked yet';
  return `No answer (${esc(plainError(a.error))})`;
}

function certText(tlsDays: number | null): string {
  if (tlsDays == null) return 'Unknown';
  if (tlsDays < TLS_WARN_DAYS) return `<span class="warn">Renews in ${tlsDays} day${tlsDays === 1 ? '' : 's'}</span>`;
  return 'Valid';
}

function dayBar(days: DayState[], dates: string[]): string {
  const count = (d: DayState) => days.filter((x) => x === d).length;
  const label = `Last 30 days: ${count('ok')} with no problems, ${count('minor')} with a short problem, ${count('major')} down for a while, ${count('none')} not tracked yet`;
  return `<div class="bar" role="img" aria-label="${label}">${days
    .map((d, i) => `<i class="d-${d}" title="${dates[i]}: ${DAY_LABEL[d]}"></i>`)
    .join('')}</div>`;
}

// "27 Nov" for each of the last n UTC days, oldest first. Plain string building: Intl formatting
// on every bar slot loaded enough locale data to add ~50 MB to the server.
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function dayNames(now: number, n = 30): string[] {
  const today = Math.floor(now / 86_400_000) * 86_400_000;
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(today - (n - 1 - i) * 86_400_000);
    return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
  });
}

type Event = { at: number; html: string };

function renderHistory(incidents: Incident[], offline: OfflineSpell[], now: number): string {
  const events: Event[] = [
    ...incidents.map((i) => ({
      at: i.started_at,
      html:
        i.ended_at == null
          ? `<strong>${esc(i.app)}</strong> is down. Pulse is checking it every 5 minutes.`
          : `<strong>${esc(i.app)}</strong> was down for ${longDuration(i.duration_s ?? 0)}.`,
    })),
    ...offline
      .filter((o) => now - o.started_at < 30 * 86_400_000)
      .map((o) => ({
        at: o.started_at,
        html: `Pulse lost its own internet connection for about ${longDuration((o.ended_at - o.started_at + RUN_MS) / 1000)}. Checks from that time aren’t counted against any app.`,
      })),
  ]
    .sort((a, b) => b.at - a.at)
    .slice(0, 8);
  if (!events.length) return '<p class="quiet">No problems recorded.</p>';
  return `<ul class="history">${events.map((e) => `<li>${time(e.at)}<p>${e.html}</p></li>`).join('')}</ul>`;
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

const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ESC[c]);

const list = (names: string[]) =>
  names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;

export const pct = (v: number | null) => (v == null ? '–' : Number.isInteger(v) ? `${v}%` : `${v.toFixed(2)}%`);

function ago(ms: number): string {
  const min = Math.round(ms / 60_000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} minute${min === 1 ? '' : 's'} ago`;
  const h = Math.round(min / 60);
  return `${h} hour${h === 1 ? '' : 's'} ago`;
}

function longDuration(s: number): string {
  const unit = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;
  const m = Math.max(1, Math.round(s / 60));
  if (m < 60) return unit(m, 'minute');
  const h = Math.floor(m / 60);
  if (h < 24) return m % 60 ? `${unit(h, 'hour')} ${unit(m % 60, 'minute')}` : unit(h, 'hour');
  const d = Math.floor(h / 24);
  return h % 24 ? `${unit(d, 'day')} ${unit(h % 24, 'hour')}` : unit(d, 'day');
}

export function time(ts: number): string {
  const d = new Date(ts);
  const text = d.toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' });
  return `<time datetime="${d.toISOString()}" data-local>${text} UTC</time>`;
}

// Local times, the group filter (hidden without JavaScript) and the heartbeat label.
const SCRIPT = `
for(const t of document.querySelectorAll('time[data-local]'))t.textContent=new Date(t.dateTime).toLocaleString([],{day:'numeric',month:'short',hour:'numeric',minute:'2-digit'});
const fl=document.querySelector('.filters');fl.hidden=false;
fl.addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return;
for(const x of fl.querySelectorAll('button'))x.setAttribute('aria-pressed',String(x===b));
for(const g of document.querySelectorAll('.group'))g.hidden=b.dataset.g!=='all'&&g.dataset.g!==b.dataset.g});
const out=document.getElementById('beat'),show=e=>{const r=e.target.closest&&e.target.closest('.ecg rect');if(r)out.textContent=r.getAttribute('aria-label')};
for(const ev of ['mouseover','focusin','click'])document.querySelector('.ecg').addEventListener(ev,show);`;

const CSS = `
@font-face{font-family:Geist;src:url(/geist.woff2) format("woff2");font-weight:100 900;font-display:swap}
:root{
  --bg:#fff;--card:#fff;--sunk:#f6f7f6;--ink:#141716;--sub:#5f6763;--faint:#737b77;--line:#e8ebe9;
  --ok:#1f9d61;--warn:#a8680a;--down:#d4432f;--empty:#e3e6e4;
  --font:Geist,ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;
}
@media (prefers-color-scheme:dark){:root{
  --bg:#0f1110;--card:#151817;--sunk:#1a1d1c;--ink:#eef1ef;--sub:#a1aaa5;--faint:#858e89;--line:#242927;
  --ok:#3fcf8e;--warn:#e8a33c;--down:#f06a55;--empty:#2a302d;
}}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.55 var(--font);font-variant-numeric:tabular-nums;-webkit-font-smoothing:antialiased}
a{color:inherit;text-underline-offset:2px}
:focus-visible{outline:2px solid var(--ok);outline-offset:3px;border-radius:6px}
h1,h2,h3{margin:0;font-weight:600;text-wrap:balance}
p{margin:0}
[hidden]{display:none!important}
main{max-width:46rem;margin:0 auto;padding:3.5rem max(20px,env(safe-area-inset-right)) 0 max(20px,env(safe-area-inset-left))}
.brand{display:flex;align-items:center;gap:.5rem;font-weight:500;font-size:.9rem;color:var(--sub);margin-bottom:2.25rem}
.brand svg{width:18px;height:18px;color:var(--ok)}
h1{font-size:clamp(1.9rem,5.4vw,2.6rem);letter-spacing:-.035em;line-height:1.1}
h1 .rest{color:var(--faint)}
.meta{color:var(--sub);margin-top:.5rem}
.ecg-box{margin-top:2.25rem}
.ecg{display:block;width:100%;height:84px;overflow:visible}
.ecg path{fill:none;stroke-width:1.75;stroke-linejoin:round;stroke-linecap:round;vector-effect:non-scaling-stroke}
.ecg .ok,.ecg .link{stroke:var(--ok)}.ecg .warn{stroke:var(--warn)}.ecg .down{stroke:var(--down);stroke-width:2.25}.ecg .none{stroke:var(--empty);stroke-width:2.25}
.ecg rect{fill:transparent;outline:none}
.ecg rect:hover+path,.ecg rect:focus-visible+path{stroke-width:3}
@media (prefers-reduced-motion:no-preference){.ecg{animation:draw 1.6s cubic-bezier(.3,.6,.3,1) .1s both}}
@keyframes draw{from{clip-path:inset(0 100% 0 0)}to{clip-path:inset(0 0 0 0)}}
.ecg-cap{display:flex;flex-wrap:wrap;justify-content:space-between;gap:.25rem 1rem;font-size:.8rem;color:var(--faint);margin-top:.5rem}
.ecg-cap output{color:var(--ink);font-weight:500}
.stats{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:1rem;margin-top:2rem;padding-block:1.25rem;border-block:1px solid var(--line)}
.stats strong{display:block;font-size:1.35rem;font-weight:600;letter-spacing:-.02em}
.stats span{font-size:.8rem;color:var(--sub)}
.key{display:flex;flex-wrap:wrap;gap:.4rem 1.25rem;font-size:.8rem;color:var(--sub);margin-top:2rem}
.key span{display:inline-flex;align-items:center;gap:.4rem}
.key i{width:8px;height:14px;border-radius:2px;display:inline-block}
.d-ok{background:var(--ok)}.d-minor{background:var(--warn)}.d-major{background:var(--down)}.d-none{background:var(--empty)}
.filters{display:flex;gap:.35rem;overflow-x:auto;margin-top:1rem;padding-bottom:.25rem;scrollbar-width:none}
.filters::-webkit-scrollbar{display:none}
.filters button{font:inherit;font-size:.82rem;white-space:nowrap;border:1px solid var(--line);background:var(--card);color:var(--sub);padding:.3rem .75rem;border-radius:999px;cursor:pointer;touch-action:manipulation}
.filters button:hover{color:var(--ink)}
.filters button[aria-pressed="true"]{background:var(--ink);border-color:var(--ink);color:var(--bg)}
.group{margin-top:2.25rem}
.group h2{font-size:.95rem;display:flex;align-items:baseline;gap:.5rem;margin-bottom:.7rem}
.group h2 span{font-weight:400;color:var(--faint);font-size:.85rem}
.card{background:var(--card);border:1px solid var(--line);border-radius:12px}
.row+.row{border-top:1px solid var(--line)}
.row summary{list-style:none;cursor:pointer;display:grid;grid-template-columns:minmax(0,1fr) 7.5rem minmax(0,10.5rem) 1rem;gap:.4rem 1.1rem;align-items:center;padding:.9rem 1rem .9rem 1.1rem;border-radius:12px;touch-action:manipulation}
.row summary::-webkit-details-marker{display:none}
.row summary:hover{background:var(--sunk)}
.who{min-width:0}
.who strong{font-weight:500}
.who p{font-size:.85rem;color:var(--sub);margin-top:.05rem}
.state{display:flex;align-items:center;gap:.45rem;font-size:.85rem;color:var(--sub);white-space:nowrap}
.state i{width:7px;height:7px;border-radius:50%;background:var(--ok);flex:none}
.s-degraded{color:var(--warn)}.s-degraded i{background:var(--warn)}
.s-down{color:var(--down);font-weight:500}.s-down i{background:var(--down)}
.s-unknown i{background:var(--empty)}
.bar{display:grid;grid-template-columns:repeat(30,1fr);gap:2px;height:22px;min-width:0}
.bar i{border-radius:2px}
.bar .d-ok{opacity:.85}
.chev{width:1rem;height:1rem;color:var(--faint);transition:transform .2s ease,color .2s ease}
.row summary:hover .chev{color:var(--ink)}
.row[open] .chev{transform:rotate(180deg);color:var(--ink)}
@media (prefers-reduced-motion:reduce){.chev{transition:none}}
.facts{display:grid;grid-template-columns:repeat(auto-fit,minmax(8.5rem,1fr));gap:.75rem 1.25rem;margin:0;padding:.25rem 1.1rem 1.1rem;font-size:.85rem}
.facts dt{color:var(--faint);font-size:.75rem}.facts dd{margin:0;overflow-wrap:anywhere}
.warn{color:var(--warn);font-weight:500}
@media (max-width:600px){
  .row summary{grid-template-columns:minmax(0,1fr) auto 1rem}
  .row summary .bar{grid-column:1/-1;order:4}
}
.plain{margin-top:3rem}
.plain>h2{font-size:.95rem;margin-bottom:.75rem}
.history{list-style:none;margin:0;padding:0}
.history li{padding:.8rem 0;border-top:1px solid var(--line);font-size:.92rem}
.history li:last-child{border-bottom:1px solid var(--line)}
.history time{display:block;font-size:.8rem;color:var(--faint)}
.quiet{color:var(--sub)}
.small{font-size:.82rem;color:var(--faint);margin-top:.75rem}
.how{display:grid;grid-template-columns:repeat(auto-fit,minmax(12rem,1fr));gap:1.25rem 2rem;font-size:.88rem}
.how h3{font-size:.88rem;font-weight:500;margin-bottom:.2rem}
.how p{color:var(--sub)}
footer{font-size:.82rem;color:var(--faint);padding-block:3rem}
footer a{color:var(--sub)}
`;
