// One digest run: pick the week, build and store it (unless already emailed), then email it through Resend.
// Kept apart from the entry script so tests can run it against a stub server.
import type { DatabaseSync } from 'node:sqlite';
import type { App } from './config.ts';
import { buildDigest, getStored, markSent, storeDigest } from './digest-model.ts';
import { postJson } from './http.ts';
import { digestEmail } from './render-digest.ts';
import { keyOf, lastCompletedWeek, weekOf } from './week.ts';

const INSIGHTS_URL = 'https://status.vexto.app/insights';
const ATTEMPTS = 3;
type Env = Record<string, string | undefined>;

export async function runDigest(db: DatabaseSync, apps: App[], now: number, env: Env, retryMs = 5000): Promise<string> {
  const pinned = env.PULSE_DIGEST_WEEK;
  const week = pinned ? weekOf(pinned) : lastCompletedWeek(now);
  // A pinned week must be a real Monday (2026-02-30 rolls over, so the key wouldn't match) whose week
  // has ended, or it would be sent half-done and frozen.
  if (pinned && !(/^\d{4}-\d{2}-\d{2}$/.test(pinned) && new Date(week.start).getDay() === 1 && keyOf(new Date(week.start)) === pinned && week.end <= now)) {
    throw new Error('PULSE_DIGEST_WEEK must be a Monday (YYYY-MM-DD) of a week that has ended, like 2026-11-16');
  }
  const tag = `Digest ${week.key}`;

  const existing = getStored(db, week.key);
  if (existing?.emailed_at) return `${tag}: already sent`;
  // A failed send is retried with the stored copy; only a pinned (manual) run recomputes an unsent week.
  // A dry run only previews: it never stores, so a mid-run preview can't become the copy Monday sends.
  if (env.PULSE_DIGEST_DRY === '1') return digestEmail(existing && !pinned ? existing.digest : buildDigest(db, apps, week), INSIGHTS_URL).text;
  if (!existing || pinned) storeDigest(db, buildDigest(db, apps, week), now);
  const email = digestEmail(getStored(db, week.key)!.digest, INSIGHTS_URL);

  if (!env.RESEND_API_KEY || !env.DIGEST_TO) return `${tag}: stored, not emailed (no RESEND_API_KEY/DIGEST_TO)`;

  const body = {
    from: env.DIGEST_FROM || 'Vexto Pulse <pulse@vexto.app>',
    to: [env.DIGEST_TO],
    subject: email.subject,
    html: email.html,
    text: email.text,
  };
  let error = '';
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    try {
      if (attempt) await new Promise((r) => setTimeout(r, retryMs * attempt));
      // The same key for every attempt at this week: Resend sends at most once per key within 24 hours.
      await postJson(
        `${env.RESEND_BASE ?? 'https://api.resend.com'}/emails`,
        body,
        { authorization: `Bearer ${env.RESEND_API_KEY}`, 'idempotency-key': `pulse-digest-${week.key}` },
        30_000,
      );
      markSent(db, week.key, null);
      return `${tag}: sent`;
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
      if (/^HTTP 4/.test(error)) break; // a bad key or address won't fix itself on retry
    }
  }
  markSent(db, week.key, error);
  return `${tag}: stored, not sent: ${error}`;
}
