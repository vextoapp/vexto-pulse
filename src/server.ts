// Long-running web server: GET / (status page), GET /api/status (JSON), /insights and the static files.
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { loadApps } from './config.ts';
import { openDb } from './db.ts';
import { getStatus } from './status.ts';
import { renderPage } from './render.ts';
import { getInsights } from './insights-model.ts';
import { renderInsights } from './render-insights.ts';
import { getStored, listWeeks } from './digest-model.ts';
import { digestSection } from './render-digest.ts';
import { STATIC } from './static-files.ts';

const PORT = Number(process.env.PORT ?? 3000);
const HOST = process.env.HOST ?? '127.0.0.1';

const apps = loadApps();
const db = openDb();
// The stored digest for ?week=YYYY-MM-DD, or the newest one.
function weeklySummary(asked: string | null): string {
  const weeks = listWeeks(db);
  const key = asked && /^\d{4}-\d{2}-\d{2}$/.test(asked) && weeks.some((w) => w.key === asked) ? asked : (weeks[0]?.key ?? null);
  const stored = key ? getStored(db, key) : null;
  return digestSection(stored?.digest ?? null, weeks, key, stored && !stored.emailed_at ? stored.email_error : null);
}

const files = new Map(Object.entries(STATIC).map(([path, s]) => [path, { type: s.type, body: readFileSync(new URL(`../public/${s.file}`, import.meta.url)) }]));

const server = createServer((req, res) => {
  const send = (code: number, type: string, body: string) => {
    res.writeHead(code, { 'content-type': type, 'cache-control': code === 200 ? 'public, max-age=60' : 'no-store' });
    res.end(req.method === 'HEAD' ? undefined : body);
  };

  if (req.method !== 'GET' && req.method !== 'HEAD') return send(405, 'text/plain', 'Method not allowed');
  let path: string;
  try {
    path = new URL(req.url ?? '/', 'http://localhost').pathname;
  } catch {
    return send(400, 'text/plain', 'Bad request');
  }
  try {
    if (path === '/') return send(200, 'text/html; charset=utf-8', renderPage(getStatus(db, apps)));
    const file = files.get(path);
    if (file) {
      res.writeHead(200, { 'content-type': file.type, 'cache-control': 'public, max-age=604800' });
      return res.end(req.method === 'HEAD' ? undefined : file.body);
    }
    if (path === '/api/status') return send(200, 'application/json', JSON.stringify(getStatus(db, apps)));
    // Private: Cloudflare Access guards this path at the edge. Never cache or index it. Match the raw
    // path, not the parsed one, so /x/%2e%2e/insights can't reach it past Access's path rule.
    if (path === '/insights' && (req.url ?? '').split('?')[0] === '/insights') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-robots-tag': 'noindex' });
      if (req.method === 'HEAD') return res.end();
      return res.end(renderInsights(getInsights(db, apps), weeklySummary(new URL(req.url ?? '/', 'http://localhost').searchParams.get('week'))));
    }
    send(404, 'text/plain', 'Not found');
  } catch (err) {
    console.error(err);
    send(500, 'text/plain', 'Internal error');
  }
});

server.listen(PORT, HOST, () => console.log(`Vexto Pulse on http://${HOST}:${PORT}`));
