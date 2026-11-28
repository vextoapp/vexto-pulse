// The weekly digest as an email (HTML with inline styles, plus plain text) and as a section on /insights.
// Both are rendered from the same stored Digest, so they always say the same thing.
import type { Digest, TrendPoint } from './digest-model.ts';
import { esc } from './render.ts';

type Section = { title: string; items: string[] };

function sections(d: Digest): Section[] {
  const out: Section[] = [];
  if (d.revisit) out.push({ title: 'Last week', items: [d.revisit.text] });
  const focus = d.focus
    ? [d.focus.text, ...(d.also.length ? [`Also worth a look: ${d.also.map((i) => i.text).join(' ')}`] : [])]
    : ['Nothing urgent. A good week to ship something.', ...(d.quick_win ? [`Quick win: ${d.quick_win}`] : [])];
  out.push({ title: 'Focus this week', items: focus });
  out.push({ title: 'What changed', items: d.changes.length ? d.changes : ['Nothing big changed since last week.'] });
  if (d.attention.length) out.push({ title: `Needs attention (${d.attention.length})`, items: d.attention.map((i) => i.text) });
  return out;
}

const things = (n: number) => (n === 0 ? 'nothing urgent' : `${n} thing${n === 1 ? '' : 's'} to fix`);
const pct1 = (v: number | null) => (v == null ? 'no data' : `${v >= 99.995 ? '100' : v.toFixed(v >= 99.9 ? 2 : 1)}%`);

// The trend's per-week number: one decimal so eight fit across a phone. Rounded down, so 99.97 never shows as 100.
const pctShort = (v: number | null) => (v == null ? 'no data' : v >= 100 ? '100%' : `${(Math.floor(v * 10) / 10).toFixed(1)}%`);

const NO_DATA = 'Not enough data yet';

// The week's numbers in one sentence, without the verdict.
function facts(d: Digest): string {
  if (d.verdict === NO_DATA) return 'Pulse has no checks for this week.';
  const parts = [`Up ${pct1(d.uptime)} of the time`, d.outages ? `${d.outages} outage${d.outages === 1 ? '' : 's'}` : 'no outages'];
  if (d.errors != null) parts.push(`${d.errors} error${d.errors === 1 ? '' : 's'} in Sentry`);
  return `${parts.join(', ')}.`;
}

const summary = (d: Digest) => `${d.verdict}. ${facts(d)}`;

// "16–22" from "16–22 Nov", and "26–1" from "26 Oct – 1 Nov".
const shortLabel = (label: string) => label.replace(/ [A-Z][a-z]{2}/g, '').replace(/ /g, '');

const band = (u: number | null) => (u == null ? 'none' : u >= 99.5 ? 'ok' : u >= 99 ? 'minor' : 'major');

// ---- Email ----
const C = { ink: '#141716', sub: '#5f6763', line: '#e8ebe9', ok: '#1f9d61', minor: '#a8680a', major: '#d4432f', none: '#e3e6e4' };
const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

export function digestEmail(d: Digest, insightsUrl: string): { subject: string; html: string; text: string } {
  const link = `${insightsUrl}?week=${d.week}`;
  const subject =
    d.verdict === NO_DATA
      ? `Pulse weekly, ${d.label}: not enough data yet`
      : `Pulse weekly, ${d.label}: ${d.verdict.toLowerCase()}, ${things(d.issues_count)}`;

  const text = [
    `Pulse weekly, ${d.label}`,
    '',
    summary(d),
    ...sections(d).flatMap((s) => ['', s.title, ...s.items]),
    '',
    `8-week uptime: ${d.trend.map((t) => `${t.label} ${pct1(t.uptime)}`).join(', ')}`,
    `8-week errors in Sentry: ${d.trend.map((t) => `${t.label} ${t.errors ?? 'no data'}`).join(', ')}`,
    '',
    `See every week: ${link}`,
  ].join('\n');

  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"></head>
<body style="margin:0;padding:24px 12px;background:#f6f7f6;font-family:${FONT};color:${C.ink}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#fff;border:1px solid ${C.line};border-radius:12px">
<tr><td style="padding:28px 28px 8px">
  <p style="margin:0 0 16px;font-size:13px;color:${C.sub}">Vexto Pulse weekly, ${esc(d.label)}</p>
  <h1 style="margin:0;font-size:24px;line-height:1.25;font-weight:600">${esc(summary(d))}</h1>
</td></tr>
${sections(d)
  .map(
    (s) => `<tr><td style="padding:20px 28px 0">
  <h2 style="margin:0 0 8px;font-size:14px;font-weight:600">${esc(s.title)}</h2>
  ${s.items.map((i) => `<p style="margin:0 0 6px;font-size:15px;line-height:1.5;color:${C.ink}">${esc(i)}</p>`).join('')}
</td></tr>`,
  )
  .join('')}
<tr><td style="padding:20px 28px 0">
  <h2 style="margin:0 0 10px;font-size:14px;font-weight:600">Last 8 weeks</h2>
  ${emailTrend(d.trend)}
</td></tr>
<tr><td style="padding:24px 28px 28px">
  <a href="${esc(link)}" style="display:inline-block;padding:10px 16px;border-radius:8px;background:${C.ink};color:#fff;text-decoration:none;font-size:14px">See this week on Pulse</a>
</td></tr>
</table></td></tr></table></body></html>`;
  return { subject, html, text };
}

// Table cells, not SVG: many email apps block SVG.
function emailTrend(points: TrendPoint[]): string {
  const cell = (t: TrendPoint) =>
    `<td align="center" valign="top" style="padding:0 2px;font-size:11px;color:${C.sub}">
      <div style="height:28px;border-radius:3px;background:${C[band(t.uptime)]}"></div>
      <div style="margin-top:4px;color:${C.ink}">${pctShort(t.uptime)}</div>
      <div>${esc(shortLabel(t.label))}</div></td>`;
  const errorCell = (t: TrendPoint) => `<td align="center" style="padding:6px 2px 0;font-size:12px;color:${C.ink}">${t.errors ?? '–'}</td>`;
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>${points.map(cell).join('')}</tr>
  <tr>${points.map(errorCell).join('')}</tr></table>
  <p style="margin:6px 0 0;font-size:12px;color:${C.sub}">Bars: uptime (green 99.5% or more, amber 99–99.5%, red under 99%). Bottom row: errors in Sentry.</p>`;
}

// ---- "How the week went" card on /insights ----
const PILL: Record<string, string> = { 'A good week': 'ok', 'A mixed week': 'warn', 'A rough week': 'down' };

export function digestSection(
  d: Digest | null,
  weeks: { key: string; label: string }[],
  selected: string | null,
  sendError: string | null,
): string {
  const picker = weeks.length
    ? `<form class="pick" method="get" action="/insights">
        <label for="week">Week</label>
        <select id="week" name="week" onchange="this.form.submit()">${weeks
          .map((w) => `<option value="${esc(w.key)}"${w.key === selected ? ' selected' : ''}>${esc(w.label)}</option>`)
          .join('')}</select>
        <button type="submit">Show</button>
      </form>`
    : '';
  const block = (title: string, body: string) => `<div class="block"><h3>${esc(title)}</h3><div>${body}</div></div>`;
  const body = d
    ? `<div class="week-head"><span class="pill pill-${PILL[d.verdict] ?? 'none'}"><i></i>${esc(d.verdict)}</span>${picker}</div>
       <p class="verdict">${esc(facts(d))}</p>
       ${sendError ? `<p class="unsent">Not sent: ${esc(sendError)}</p>` : ''}
       <div class="blocks">
         ${block("Last week's focus", `<p>${esc(d.revisit?.text ?? 'Nothing to check yet.')}</p>`)}
         ${block('What changed', d.changes.length ? `<ul>${d.changes.map((c) => `<li>${esc(c)}</li>`).join('')}</ul>` : '<p>Nothing big changed since last week.</p>')}
         ${block('Last 8 weeks', `<div class="trend">${d.trend
           .map((t) => `<div title="${esc(t.label)}: ${pct1(t.uptime)}${t.errors != null ? `, ${t.errors} errors` : ''}"><i class="t-${band(t.uptime)}"></i><b>${pctShort(t.uptime)}</b><span>${esc(shortLabel(t.label))}</span></div>`)
           .join('')}</div>
           <div class="trend errs">${d.trend.map((t) => `<div><span>${t.errors ?? '–'}</span></div>`).join('')}</div>
           <p class="small">Bars: uptime. Bottom row: errors in Sentry.</p>`)}
       </div>`
    : `<div class="week-head"><p>The first summary arrives Monday at 7 am.</p>${picker}</div>`;
  return `<section aria-labelledby="wk-h">
    <h2 id="wk-h">How the week went</h2>
    <div class="card week">${body}</div>
  </section>`;
}

export const DIGEST_CSS = `
.week{padding:1.25rem 1.25rem 1.1rem}
.week-head{display:flex;flex-wrap:wrap;justify-content:space-between;align-items:center;gap:.5rem 1rem}
.pick{display:flex;align-items:center;gap:.45rem;font-size:.85rem;color:var(--sub)}
.pick select,.pick button{font:inherit;font-size:.85rem;padding:.3rem .6rem;border:1px solid var(--line);border-radius:8px;background:var(--card);color:var(--ink)}
.pick button:hover,.pick select:hover{border-color:var(--faint)}
.pill{display:inline-flex;align-items:center;gap:.4rem;font-size:.8rem;font-weight:500;padding:.2rem .65rem;border-radius:999px;--c:var(--faint);color:var(--c);background:color-mix(in srgb,var(--c) 14%,transparent)}
.pill i{width:7px;height:7px;border-radius:50%;background:currentColor}
.pill-ok{--c:var(--ok)}.pill-warn{--c:var(--warn)}.pill-down{--c:var(--down)}
.verdict{font-size:1.2rem;letter-spacing:-.015em;line-height:1.35;margin-top:.8rem}
.unsent{color:var(--down);font-weight:500;margin-top:.5rem}
.blocks{display:grid;gap:1rem;margin-top:1.1rem}
.block{display:grid;grid-template-columns:8.5rem minmax(0,1fr);gap:.25rem 1rem;padding-top:1rem;border-top:1px solid var(--line)}
.block h3{font-size:.8rem;font-weight:500;color:var(--faint);padding-top:.1rem}
.block p,.block li{font-size:.92rem}
.block ul{padding-left:1.1rem;list-style:disc}
@media (max-width:560px){.block{grid-template-columns:1fr}}
.trend{display:grid;grid-template-columns:repeat(8,minmax(0,1fr));gap:4px}
.trend div{display:flex;flex-direction:column;align-items:center;gap:.2rem;font-size:.72rem;color:var(--faint);text-align:center;line-height:1.2}
.trend i{display:block;width:100%;height:1.6rem;border-radius:3px}
.trend b{font-weight:500;color:var(--ink)}
.trend.errs{margin-top:.3rem}
.trend.errs span{color:var(--ink);font-size:.8rem}
.t-ok{background:var(--ok)}.t-minor{background:var(--warn)}.t-major{background:var(--down)}.t-none{background:var(--empty)}
`;
