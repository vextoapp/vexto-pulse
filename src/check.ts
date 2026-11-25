import tls from 'node:tls';

export type CheckResult = {
  ok: boolean;
  status: number | null;
  ms: number | null;
  tls_days: number | null;
  error: string | null;
};

const TIMEOUT_MS = 10_000;
const DAY_MS = 86_400_000;

export async function checkApp(url: string): Promise<CheckResult> {
  const [http, tls_days] = await Promise.all([httpCheck(url), tlsDaysLeft(url)]);
  return { ...http, tls_days };
}

async function httpCheck(url: string) {
  const start = performance.now();
  try {
    const res = await fetch(url, {
      redirect: 'follow',
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { 'user-agent': 'VextoPulse/1.0 (+https://status.vexto.app)' },
    });
    const ms = Math.round(performance.now() - start); // time to response headers
    await res.body?.cancel();
    const ok = res.status < 400;
    return { ok, status: res.status, ms, error: ok ? null : `HTTP ${res.status}` };
  } catch (err) {
    return { ok: false, status: null, ms: null, error: describe(err) };
  }
}

function tlsDaysLeft(url: string): Promise<number | null> {
  const { protocol, hostname, port } = new URL(url);
  if (protocol !== 'https:') return Promise.resolve(null);

  return new Promise((resolve) => {
    const socket = tls.connect(
      { host: hostname, port: Number(port) || 443, servername: hostname, timeout: TIMEOUT_MS },
      () => {
        const { valid_to } = socket.getPeerCertificate();
        socket.end();
        resolve(valid_to ? Math.floor((Date.parse(valid_to) - Date.now()) / DAY_MS) : null);
      },
    );
    socket.on('error', () => resolve(null));
    socket.on('timeout', () => {
      socket.destroy();
      resolve(null);
    });
  });
}

// fetch() wraps network errors as "fetch failed"; the useful code (ENOTFOUND, ECONNREFUSED…) is in `cause`.
function describe(err: unknown): string {
  if (err instanceof Error) {
    if (err.name === 'TimeoutError') return `Timed out after ${TIMEOUT_MS / 1000}s`;
    const cause = err.cause as { code?: string; message?: string } | undefined;
    return cause?.code ?? cause?.message ?? err.message;
  }
  return String(err);
}
