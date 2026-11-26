// GET a JSON API with node:http/https (not fetch(), which costs ~50 MB more memory).
// Error messages never include the URL, because API keys travel in the query string.
import http from 'node:http';
import https from 'node:https';

export function getJson(url: string, headers: Record<string, string> = {}, timeoutMs = 60_000): Promise<unknown> {
  const client = url.startsWith('https:') ? https : http;
  return new Promise((resolve, reject) => {
    const req = client.get(
      url,
      { agent: false, timeout: timeoutMs, headers: { 'user-agent': 'VextoPulse/2.0 (+https://status.vexto.app)', ...headers } },
      (res) => {
        const status = res.statusCode ?? 0;
        if (status < 200 || status >= 300) {
          res.resume();
          return reject(new Error(`HTTP ${status}`));
        }
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
          } catch {
            reject(new Error('Invalid JSON'));
          }
        });
        res.on('error', reject);
      },
    );
    req.on('timeout', () => req.destroy(new Error(`Timed out after ${timeoutMs / 1000}s`)));
    req.on('error', reject);
  });
}
