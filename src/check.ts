// Uses node:http/https rather than fetch(): fetch loads undici, which roughly doubles the
// process's memory (~50 MB measured). The TLS certificate comes from the same connection.
import http from 'node:http';
import https from 'node:https';
import type { TLSSocket } from 'node:tls';

export type CheckResult = {
  ok: boolean;
  status: number | null;
  ms: number | null;
  tls_days: number | null;
  error: string | null;
};

const TIMEOUT_MS = 10_000;
const MAX_REDIRECTS = 5;
const DAY_MS = 86_400_000;

type Hop = { status: number; location?: string; tls_days: number | null };

export async function checkApp(url: string): Promise<CheckResult> {
  const start = performance.now();
  let tls_days: number | null = null;
  try {
    for (let hops = 0; hops <= MAX_REDIRECTS; hops++) {
      const hop = await request(url);
      if (hops === 0) tls_days = hop.tls_days; // the app's own certificate, not a redirect target's
      if (hop.status >= 300 && hop.status < 400 && hop.location) {
        url = new URL(hop.location, url).href;
        continue;
      }
      const ok = hop.status < 400;
      const ms = Math.round(performance.now() - start); // time to final response headers
      return { ok, status: hop.status, ms, tls_days, error: ok ? null : `HTTP ${hop.status}` };
    }
    return { ok: false, status: null, ms: null, tls_days, error: 'Too many redirects' };
  } catch (err) {
    return { ok: false, status: null, ms: null, tls_days, error: describe(err) };
  }
}

function request(url: string): Promise<Hop> {
  const client = url.startsWith('https:') ? https : http;
  return new Promise((resolve, reject) => {
    const req = client.get(
      url,
      { agent: false, timeout: TIMEOUT_MS, headers: { 'user-agent': 'VextoPulse/1.0 (+https://status.vexto.app)' } },
      (res) => {
        const cert = (res.socket as TLSSocket).getPeerCertificate?.();
        const tls_days = cert?.valid_to ? Math.floor((Date.parse(cert.valid_to) - Date.now()) / DAY_MS) : null;
        res.resume(); // discard the body
        resolve({ status: res.statusCode ?? 0, location: res.headers.location, tls_days });
      },
    );
    req.on('timeout', () => req.destroy(new Error(`Timed out after ${TIMEOUT_MS / 1000}s`)));
    req.on('error', reject);
  });
}

// Prefer the short system code (ENOTFOUND, ECONNREFUSED, CERT_HAS_EXPIRED…) over the long message.
function describe(err: unknown): string {
  if (err instanceof Error) return (err as NodeJS.ErrnoException).code ?? err.message;
  return String(err);
}
