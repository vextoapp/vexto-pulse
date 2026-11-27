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

function summary(d: Digest): string {
  const parts = [`Up ${pct1(d.uptime)} of the time`, d.outages ? `${d.outages} outage${d.outages === 1 ? '' : 's'}` : 'no outages'];
  if (d.errors != null) parts.push(`${d.errors} error${d.errors === 1 ? '' : 's'} in Sentry`);
  return `${d.verdict}. ${parts.join(', ')}.`;
}

// "16–22" from "16–22 Nov", and "26–1" from "26 Oct – 1 Nov".
const shortLabel = (label: string) => label.replace(/ [A-Z][a-z]{2}/g, '').replace(/ /g, '');

const band = (u: number | null) => (u == null ? 'none' : u >= 99.5 ? 'ok' : u >= 99 ? 'minor' : 'major');

// ---- Email ----
const C = { ink: '#141716', sub: '#5f6763', line: '#e8ebe9', ok: '#1f9d61', minor: '#a8680a', major: '#d4432f', none: '#e3e6e4' };
const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

export function digestEmail(d: Digest, insightsUrl: string): { subject: string; html: string; text: string } {
  const link = `${insightsUrl}?week=${d.week}`;
  const subject = `Pulse weekly, ${d.label}: ${d.verdict.toLowerCase()}, ${things(d.issues_count)}`;

  const text = [
    `Pulse weekly, ${d.label}`,
    '',
    summary(d),
    ...sections(d).flatMap((s) => ['', s.title, ...s.items]),
    '',
    `8-week uptime: ${d.trend.map((t) => `${t.label} ${pct1(t.uptime)}`).join(', ')}`,
    '',
    `See every week: ${link}`,
  ].join('\n');

  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="color-scheme" content="light"></head>
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
  <h2 style="margin:0 0 10px;font-size:14px;font-weight:600">Uptime, last 8 weeks</h2>
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
    `<td align="center" style="padding:0 2px;font-size:11px;color:${C.sub}">
      <div style="height:28px;border-radius:3px;background:${C[band(t.uptime)]}"></div>
      <div style="margin-top:4px">${esc(shortLabel(t.label))}</div></td>`;
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>${points.map(cell).join('')}</tr></table>
  <p style="margin:6px 0 0;font-size:12px;color:${C.sub}">Green: 99.5% or more. Amber: 99–99.5%. Red: under 99%.</p>`;
}

// ---- Page section on /insights ----
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
  const body = d
    ? `<p class="verdict">${esc(summary(d))}</p>
       ${sendError ? `<p class="unsent">Not sent: ${esc(sendError)}</p>` : ''}
       ${sections(d).map((s) => `<h3>${esc(s.title)}</h3><ul>${s.items.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>`).join('')}
       <h3>Uptime, last 8 weeks</h3>
       <div class="trend">${d.trend
         .map((t) => `<div title="${esc(t.label)}: ${pct1(t.uptime)}${t.errors != null ? `, ${t.errors} errors` : ''}"><i class="t-${band(t.uptime)}"></i><span>${esc(shortLabel(t.label))}</span></div>`)
         .join('')}</div>`
    : '<p class="muted">The first summary arrives Monday at 7 am.</p>';
  return `<section class="digest" aria-labelledby="dg-h">
    <div class="dg-head"><h2 id="dg-h">Weekly summaries</h2>${picker}</div>
    ${body}
  </section>`;
}

export const DIGEST_CSS = `
.digest{background:var(--surface);border:1px solid var(--rule);border-radius:14px;padding:1.1rem 1.2rem;margin-bottom:2rem}
.dg-head{display:flex;flex-wrap:wrap;justify-content:space-between;align-items:center;gap:.5rem 1rem;margin-bottom:.75rem}
.dg-head h2{margin:0}
.pick{display:flex;align-items:center;gap:.4rem;font-size:.9rem}
.pick select,.pick button{font:inherit;font-size:.9rem;padding:.25rem .5rem;border:1px solid var(--rule);border-radius:8px;background:var(--paper);color:var(--ink)}
.verdict{font-size:1.15rem;font-weight:600;margin:0 0 .5rem}
.unsent{color:var(--down);font-weight:600}
.digest h3{font-size:.95rem;margin:1rem 0 .35rem}
.digest ul{margin:0;padding-left:1.1rem}
.digest li{margin:.2rem 0}
.trend{display:grid;grid-template-columns:repeat(8,1fr);gap:4px;max-width:28rem}
.trend div{display:flex;flex-direction:column;align-items:center;gap:.2rem;font-size:.75rem;color:var(--muted)}
.trend i{display:block;width:100%;height:1.75rem;border-radius:3px}
.t-ok{background:var(--up)}.t-minor{background:var(--warn)}.t-major{background:var(--down)}.t-none{background:var(--rule)}
`;
