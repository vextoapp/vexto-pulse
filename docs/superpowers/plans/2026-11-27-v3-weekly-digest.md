# v3 Weekly Digest Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Monday 07:00 Sydney email with the week's verdict, one focus, last week's focus revisited, what changed, the needs-attention list and an 8-week trend. The same stored digest is shown on `/insights` with a week picker.

**Architecture:**
- A one-shot `dist/digest.js`, run by a systemd timer, works out the most recent completed Sydney week from SQLite using pure, tested model functions.
- It stores the result as JSON in `digests`, then sends it through Resend's REST API with `node:https`.
- `/insights?week=` renders stored digests. Nothing is recomputed once a week has been emailed.

**Tech Stack:** Node 26 (`node:sqlite`, `node:https`, `node:test`), erasable TypeScript, systemd.

**Spec:** `docs/superpowers/specs/2026-11-27-v3-weekly-digest-design.md`

## Global Constraints
- Under 100 MB total; no runtime dependencies; no `fetch()`; erasable TypeScript only; production runs `dist/`; timestamps are epoch ms; rollup days are UTC dates (CLAUDE.md).
- **Week:** Monday 00:00 to the next Monday 00:00, Sydney local time. The key is the Monday's `YYYY-MM-DD`; the label is like "16–22 Nov" or "30 Nov – 6 Dec".
- **Sentry errors for a week:** the 7 UTC days starting the Sunday before the week's Monday.
- **Focus rules,** most severe first:
  1. outage of 30 minutes or more
  2. errors this week ≥ 5 and (last week = 0 or this week ≥ 2× last week)
  3. uptime below 99%
  4. certificate expiring in under 14 days
  5. PageSpeed performance below 50, accessibility below 90, or any category down 10+ points
  6. average response ≥ 2× last week and ≥ 2000 ms
- **Verdict:** 0 issues "A good week", 1–2 "A mixed week", 3 or more "A rough week". Subject: `Pulse weekly, <label>: <verdict lower-cased>, <N thing(s) to fix | nothing urgent>`.
- **No-issue focus:** "Nothing urgent. A good week to ship something." plus the lowest accessibility score at 95 or below, if any.
- **What changed:** at most 6 items. **Also worth a look:** at most 2. **Trend:** 8 weeks.
- **A digest with `emailed_at` set is frozen.** Retries re-send the stored copy.
- **Env:** `RESEND_API_KEY`, `DIGEST_TO`, `DIGEST_FROM` (default `Vexto Pulse <pulse@vexto.app>`), `PULSE_DIGEST_DRY=1`, `PULSE_DIGEST_WEEK=YYYY-MM-DD`.
- Every sentence cites its numbers. Plain, sentence case.

## Review Focus
1. **Daylight saving weeks:** the Sydney week containing 5 Apr 2026, when DST ends, is 169 hours long. Its window and uptime must still be right (Task 1 test).
2. **An app with no checks in a week** (added mid-week, or Pi down): uptime is null, and no rule fires from missing data (Task 3 test).
3. **An app not linked to Sentry:** never triggers rule 2, and never shows a "+0 errors" change (Task 3 test).
4. **A first digest with no previous week:** no revisit line, and no "changed" items that need a previous value (Task 5 test).
5. **A failed Resend send:** the digest is stored with `email_error`, the job exits 0, and the next run re-sends the same stored copy (Task 7 test with a local HTTP stub).

---

### Task 1: Week maths
**Files:** Create `src/week.ts`, `test/week.test.ts`
**Produces:**
- `type Week = { key: string; start: number; end: number; label: string }`
- `lastCompletedWeek(now: number): Week`
- `weekOf(key: string): Week`
- `previousWeek(w: Week): Week`
- `sentryDays(w: Week): string[]` (7 UTC dates)

Use local-time `Date` construction (`new Date(y, m, d)`), not `Intl`.

- [ ] Write the tests, with `process.env.TZ = 'Australia/Sydney'` set before the imports:
  - `lastCompletedWeek(Date.parse('2026-11-27T01:00:00Z')).key === '2026-11-16'` and its label is `'16–22 Nov'`
  - Monday 07:00 Sydney on 30 Nov gives key `2026-11-23`. A catch-up run on Wednesday 2 Dec gives the same key.
  - `weekOf('2026-11-30').label === '30 Nov – 6 Dec'`
  - `weekOf('2026-03-30').end - weekOf('2026-03-30').start === 169 * 3600_000` (DST ends 5 Apr)
  - `sentryDays(weekOf('2026-11-16'))[0] === '2026-11-15'`, with length 7
- [ ] Run `node --test test/week.test.ts` and confirm it fails (the module is missing).
- [ ] Implement.
- [ ] Run again and confirm it passes. Commit: "Add Sydney week maths for the weekly digest".

### Task 2: Weekly numbers per app
**Files:** Create `src/digest-model.ts` (the first part); test `test/digest-model.test.ts`
**Consumes:** `Week`, `sentryDays`
**Produces:**
- `type AppWeek = { name; uptime: number|null; outage_ms: number; outages: {started_at:number; ms:number}[]; avg_ms: number|null; errors: number|null /* null = not linked */; tls_days: number|null; scores: Scores|null; prev_scores: Scores|null }`
- `appWeeks(db, apps: App[], w: Week): AppWeek[]`

**Sources:**
- uptime and avg_ms from `checks` between `start` and `end` (only ok checks count toward avg_ms)
- outages from `incidents`, clipped to the window, with ongoing ones clipped at `end`
- errors from `sentry_daily` over `sentryDays`, null when the app has no `sentry_daily` rows at all
- tls_days from the last check before `end`
- scores: the latest successful `pagespeed` row before `end`; prev_scores: the successful row before that

- [ ] Write failing tests with an in-memory database (`openDb(':memory:')`):
  - uptime counts only checks inside the window
  - an incident that starts before the window is clipped
  - avg_ms ignores failed checks
  - an unlinked app has errors null; a linked app with no rows that week has 0
  - **Review Focus 2:** an app with no checks has uptime null
- [ ] Implement with aggregate SQL, one query per measure per app. Confirm the tests pass. Commit.

### Task 3: Rules: issues, focus, revisit, changes, verdict
**Files:** Modify `src/digest-model.ts`; test `test/digest-model.test.ts`
**Produces:**
- `type Issue = { rule: 1|2|3|4|5|6; app: string; size: number; text: string }`
- `findIssues(cur: AppWeek[], prev: AppWeek[]|null): Issue[]`, sorted by rule, then size descending
- `quickWin(cur): string|null`
- `type Revisit = { app: string; rule: number; done: boolean; text: string }`
- `revisit(lastFocus: Issue|null, cur, prev): Revisit|null`
- `changes(cur, prev): string[]` (at most 6)
- `verdict(n: number): 'A good week'|'A mixed week'|'A rough week'`

**Example texts:**
- rule 1: `Kata was down for 1 hour 20 minutes.`
- rule 2: `EclipSend had 12 errors, up from 3.`
- rule 3: `Basil was up 98.2% of the time.`
- rule 4: `FamilySync's certificate renews in 9 days.`
- rule 5: `Kata's accessibility score is 89.` or `Stackmark's performance fell from 74 to 61.`
- rule 6: `Switchboard got slower: 4.1 s, up from 1.9 s.`
- done revisit: `Done: EclipSend errors 12 → 0.`
- still-open revisit: `Still open: Kata accessibility 89.`
- change: `Cashew got 5× faster (1.6 s → 0.3 s).`

- [ ] Write a failing test for each rule's threshold boundary:
  - 29 vs 30 minutes
  - errors 4 vs 5, and 5 vs 3 → no, 6 vs 3 → yes
  - 99.0 vs 98.9
  - 14 vs 13 days
  - accessibility 90 vs 89, a drop of 9 vs 10
  - 1.9 s vs 2 s, and ×1.9 vs ×2
- [ ] Write a failing test for ordering (rule 1 beats rule 2; a larger size wins within a rule).
- [ ] Write failing tests for revisit "Done" and "Still open", and null when `lastFocus` is null.
- [ ] Write failing tests for `changes`: faster/slower by ×2 when either side is ≥ 1 s; capped at 6.
- [ ] Write failing tests for `verdict(0|1|3)`.
- [ ] Write failing tests for **Review Focus 3:** an unlinked app never gets rule 2 or an errors change.
- [ ] Implement. Confirm the tests pass. Commit.

### Task 4: 8-week trend
**Files:** Modify `src/digest-model.ts`, test
**Produces:** `type TrendPoint = { key: string; label: string; uptime: number|null; errors: number|null }` and `trend(db, apps, w: Week, n = 8): TrendPoint[]`, oldest first, ending with `w`. Portfolio uptime = ok checks ÷ all checks across apps; errors = the sum over linked apps (null when none are linked).
- [ ] Write a failing test: 8 points, the last one's key is `w.key`, and a week with no checks gives null uptime. Implement and commit.

### Task 5: Build and store a digest
**Files:** Modify `src/db.ts` (add the `digests` table, exact schema from the spec); modify `src/digest-model.ts`; test
**Produces:**
- `type Digest = { week: string; label: string; verdict: string; issues_count: number; uptime: number|null; outages: number; errors: number|null; revisit: Revisit|null; focus: Issue|null; also: Issue[]; quick_win: string|null; changes: string[]; attention: Issue[]; trend: TrendPoint[] }`
- `buildDigest(db, apps, w: Week): Digest` (reads the previous week's stored digest for `revisit`)
- `getStored(db, key): {digest: Digest; emailed_at: number|null; email_error: string|null} | null`
- `storeDigest(db, d: Digest): void` (refuses to overwrite when `emailed_at` is set)
- `markSent(db, key, error: string|null): void`
- `listWeeks(db): {key: string; label: string}[]`, newest first

- [ ] Write failing tests:
  - **Review Focus 4:** a first digest has revisit null
  - the second week's revisit reads the first week's focus
  - `storeDigest` on an emailed week leaves the stored data unchanged
  - `listWeeks` returns newest first
- [ ] Implement. Confirm the tests pass. Commit.

### Task 6: Render email and page section
**Files:** Create `src/render-digest.ts`; test `test/render-digest.test.ts`
**Consumes:** `Digest`, `esc`, `pct`
**Produces:**
- `digestEmail(d: Digest, insightsUrl: string): { subject: string; html: string; text: string }`
- `digestSection(d: Digest | null, weeks: {key,label}[], selected: string|null, sendError: string|null): string`

**Email:** inline styles, a centred 560 px table, system font stack, the verdict as a heading, sections in this order:
1. Last week (the revisit)
2. Focus this week
3. What changed
4. Needs attention
5. 8-week trend (table-cell bars)

Then the footer link.

**Page section:** uses the public page's tokens, scoped under `.digest`, so the rest of `/insights` is unchanged. The `<select name="week">` sits in a `<form method="get" action="/insights">` with a Show button, and auto-submits on change.

- [ ] Write failing tests:
  - the subject for 0 issues is `Pulse weekly, 16–22 Nov: a good week, nothing urgent`
  - for 1 issue it ends `1 thing to fix`, for 3 issues `3 things to fix`
  - the text version contains the focus text
  - the HTML escapes app names
  - the page section with null shows `The first summary arrives Monday at 7 am.`
  - the selected week's option is marked `selected`
  - the send error shows `Not sent:`
- [ ] Implement. Confirm the tests pass. Commit.

### Task 7: Sending and the job
**Files:** Modify `src/http.ts` (add `postJson`); create `src/digest.ts` (the entry point), `deploy/vexto-pulse-digest.service`, `deploy/vexto-pulse-digest.timer`; modify `package.json` (add a `"digest"` script); tests `test/http.test.ts`, `test/digest-job.test.ts`
**Produces:**
- `postJson(url, body: unknown, headers?, timeoutMs?): Promise<unknown>`, with the same error rules as `getJson`
- `runDigest(db, apps, now, env): Promise<string>`, which returns its log line. It's exported for tests, and `digest.ts` calls it with the real database.

**Flow:**
1. Pick the week: `PULSE_DIGEST_WEEK`, or `lastCompletedWeek(now)`.
2. If the stored copy is emailed, log `Digest <key>: already sent` and stop.
3. If there's no stored copy, or it isn't emailed, build and store it.
4. If `PULSE_DIGEST_DRY=1`, print the text and stop.
5. If `RESEND_API_KEY` or `DIGEST_TO` is missing, log `Digest <key>: stored, not emailed (no RESEND_API_KEY/DIGEST_TO)`.
6. Otherwise send with 3 attempts (on network errors or 5xx), then call `markSent`.

The Resend base URL comes from `process.env.RESEND_BASE ?? 'https://api.resend.com'`, read at call time. The body is `{from, to:[DIGEST_TO], subject, html, text}`.

**Units:** a copy of the insights service with `ExecStart=… dist/digest.js` and `TimeoutStartSec=5min`; the timer uses `OnCalendar=Mon *-*-* 07:00` and `Persistent=true`.

- [ ] Write failing tests:
  - `postJson` sends JSON and parses the reply (local `node:http` server, the same pattern as `test/http.test.ts`)
  - **Review Focus 5:** with a stub server returning 500 three times, the digest is stored with `email_error` and the log says it wasn't sent. The next run against a stub returning 200 sends the same stored subject and sets `emailed_at`. A third run logs `already sent` and makes no request.
- [ ] Implement. Confirm the tests pass.
- [ ] Run `npx tsc --noEmit` and `npm run build`.
- [ ] Commit.

### Task 8: Show digests on /insights
**Files:** Modify `src/server.ts` (the `/insights` route reads `?week=` matching `/^\d{4}-\d{2}-\d{2}$/`, else the newest week); modify `src/render-insights.ts` (`renderInsights(i, digestHtml: string)` inserts the section above "Needs attention"); test `test/render-insights.test.ts`
- [ ] Write a failing test: `renderInsights` output contains the digest section's HTML before `Needs attention`.
- [ ] Implement.
- [ ] Verify by hand with a database copy and a stored digest: the week picker switches weeks, and a bad `?week=` falls back to the newest. Commit.

### Task 9: Docs and verification
- [ ] Update the README: a v3 section (what the email contains, the env vars, the timer, the manual commands); mark the roadmap's v3 line done.
- [ ] Run a dry run on the live database copy: `PULSE_DB=<copy> PULSE_DIGEST_DRY=1 PULSE_DIGEST_WEEK=2026-11-23 node dist/digest.js`. Read the output for sense.
- [ ] Measure memory with `/usr/bin/time -l` on that run. It must be well under 100 MB.
- [ ] Run the full suite, `tsc` and the build.
- [ ] Commit.
