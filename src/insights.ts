// One daily run: Sentry error counts every run, PageSpeed scores when the last run is 6+ days old.
// Run at 04:30 by the systemd timer (deploy/vexto-pulse-insights.timer). Secrets come from env.
import { loadApps } from './config.ts';
import { openDb } from './db.ts';
import { pagespeedDue, runPagespeed } from './pagespeed.ts';
import { fetchSentryDaily, sentrySlug } from './sentry.ts';

const apps = loadApps();
const db = openDb();
const ts = Date.now();
const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

try {
  // Sentry
  const token = process.env.SENTRY_TOKEN;
  if (!token) {
    console.log('Sentry: skipped (no SENTRY_TOKEN)');
  } else {
    try {
      const daily = await fetchSentryDaily(
        token,
        process.env.SENTRY_ORG ?? 'vexto-apps',
        process.env.SENTRY_HOST ?? 'de.sentry.io',
      );
      const upsert = db.prepare(
        'INSERT INTO sentry_daily (app, day, errors) VALUES (?, ?, ?) ON CONFLICT (app, day) DO UPDATE SET errors = excluded.errors',
      );
      let linked = 0;
      db.exec('BEGIN');
      for (const app of apps) {
        const days = daily.get(sentrySlug(app.name));
        if (!days) continue;
        linked++;
        for (const d of days) upsert.run(app.name, d.day, d.errors);
      }
      db.exec('COMMIT');
      console.log(`Sentry: ${linked} of ${apps.length} apps linked`);
    } catch (err) {
      if (db.isTransaction) db.exec('ROLLBACK');
      console.log(`Sentry: failed: ${message(err)}`);
    }
  }

  // PageSpeed
  const key = process.env.PAGESPEED_KEY;
  if (!key) {
    console.log('PageSpeed: skipped (no PAGESPEED_KEY)');
  } else if (!pagespeedDue(db, ts) && process.env.PULSE_FORCE_PAGESPEED !== '1') {
    console.log('PageSpeed: skipped (last successful run was under 6 days ago)');
  } else {
    const insert = db.prepare(
      'INSERT INTO pagespeed (app, ts, performance, accessibility, best_practices, seo, error) VALUES (?, ?, ?, ?, ?, ?, ?)',
    );
    for (const app of apps) {
      const r = await runPagespeed(app.url, key); // one at a time: responses are ~1 MB each
      insert.run(app.name, ts, r.performance, r.accessibility, r.best_practices, r.seo, r.error);
      console.log(
        r.error
          ? `${app.name}: failed: ${r.error}`
          : `${app.name}: perf ${r.performance ?? '-'} a11y ${r.accessibility ?? '-'} bp ${r.best_practices ?? '-'} seo ${r.seo ?? '-'}`,
      );
    }
  }
} finally {
  db.close();
}
