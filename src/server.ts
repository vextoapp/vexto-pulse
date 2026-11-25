// Long-running web server: GET / (status page) and GET /api/status (JSON).
import { createServer } from 'node:http';
import { loadApps } from './config.ts';
import { openDb } from './db.ts';
import { getStatus } from './status.ts';
import { renderPage } from './render.ts';

const PORT = Number(process.env.PORT ?? 3000);
const HOST = process.env.HOST ?? '127.0.0.1';

const apps = loadApps();
const db = openDb();

const server = createServer((req, res) => {
  const path = new URL(req.url ?? '/', 'http://localhost').pathname;
  const send = (code: number, type: string, body: string) => {
    res.writeHead(code, { 'content-type': type, 'cache-control': 'public, max-age=60' });
    res.end(req.method === 'HEAD' ? undefined : body);
  };

  if (req.method !== 'GET' && req.method !== 'HEAD') return send(405, 'text/plain', 'Method not allowed');
  try {
    if (path === '/') return send(200, 'text/html; charset=utf-8', renderPage(getStatus(db, apps)));
    if (path === '/api/status') return send(200, 'application/json', JSON.stringify(getStatus(db, apps)));
    send(404, 'text/plain', 'Not found');
  } catch (err) {
    console.error(err);
    send(500, 'text/plain', 'Internal error');
  }
});

server.listen(PORT, HOST, () => console.log(`Vexto Pulse on http://${HOST}:${PORT}`));
