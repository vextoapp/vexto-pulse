// Weekly digest: run every Monday at 07:00 by deploy/vexto-pulse-digest.timer. Secrets come from env.
import { loadApps } from './config.ts';
import { openDb } from './db.ts';
import { runDigest } from './digest-job.ts';

const db = openDb();
try {
  console.log(await runDigest(db, loadApps(), Date.now(), process.env));
} finally {
  db.close();
}
