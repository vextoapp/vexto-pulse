// Long-running web server: GET / (status page), GET /api/status (JSON), /insights and the font.
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { loadApps } from './config.ts';
import { openDb } from './db.ts';
import { getStatus } from './status.ts';
import { renderPage } from './render.ts';
import { getInsights } from './insights-model.ts';
import { renderInsights } from './render-insights.ts';

const PORT = Number(process.env.PORT ?? 3000);
const HOST = process.env.HOST ?? '127.0.0.1';

const apps = loadApps();
const db = openDb();
const font = readFileSync(new URL('../public/Geist-Variable.woff2', import.meta.url)); // 69 KB, Geist (SIL OFL)

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
    if (path === '/geist.woff2') {
      res.writeHead(200, { 'content-type': 'font/woff2', 'cache-control': 'public, max-age=31536000, immutable' });
      return res.end(req.method === 'HEAD' ? undefined : font);
    }
    if (path === '/api/status') return send(200, 'application/json', JSON.stringify(getStatus(db, apps)));
    // Private: Cloudflare Access guards this path at the edge. Never cache or index it. Match the raw
    // path, not the parsed one, so /x/%2e%2e/insights can't reach it past Access's path rule.
    if (path === '/insights' && (req.url ?? '').split('?')[0] === '/insights') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-robots-tag': 'noindex' });
      return res.end(req.method === 'HEAD' ? undefined : renderInsights(getInsights(db, apps)));
    }
    send(404, 'text/plain', 'Not found');
  } catch (err) {
    console.error(err);
    send(500, 'text/plain', 'Internal error');
  }
});

server.listen(PORT, HOST, () => console.log(`Vexto Pulse on http://${HOST}:${PORT}`));
