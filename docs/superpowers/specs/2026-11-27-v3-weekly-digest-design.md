# Vexto Pulse v3, "what should I do": weekly digest

## Intent
Mo runs about 26 apps and websites alone. Pulse already collects uptime and incidents (v1), and PageSpeed scores and Sentry error counts (v2). That data only helps if it turns into a decision.

v3 sends **one email every Monday morning** saying how the portfolio did last week, **what to focus on**, and what changed. Every weekly digest is also kept on the private `/insights` page with a week picker, so there are exactly two places to look, and they always agree.

It's also a portfolio piece. Hiring managers should see the product thinking in it: one clear priority, closing the loop on last week's priority, and plain language.

## Goals
- An email every Monday at 07:00 Sydney time (the Pi's time zone is Australia/Sydney), covering the last 7 full days.
- One focus, picked by fixed rules, written as one plain sentence with the numbers behind it. Up to 2 "also worth a look" items.
- **Last week's focus, revisited:** each digest opens by saying whether last week's focus was resolved ("Done: 12 → 0 errors"), is still open, or there was none.
- **What changed since the week before:** outages, big speed changes, PageSpeed score changes, error changes.
- A "needs attention" list for the week: every item that meets a focus rule (below), worked out from the week's own numbers. It's the same list the focus is picked from, so the email never contradicts itself. (My call: the live `/insights` reasons mix in 30-day and "now" numbers that don't match a past week.)
- An 8-week trend of portfolio uptime and total errors, as a small chart in both the email and the page.
- Each digest is computed once, **stored as it was sent**, and both the email and the page render from that stored copy.
- A "Weekly summaries" section at the top of `/insights`, with a week picker that defaults to the newest week.

## Non-goals
- AI-written text. That's a possible later addition, once there are a few weeks of digests to judge.
- Marking items done from the page. It would make the private page writable; the automatic "last week's focus" check covers the need.
- Usage or visitor numbers. They come later, after the hosting moves, via Cloudflare Web Analytics.
- Emails to anyone except Mo.

## Anti-goals
These would be a failure even if everything technically works:
- An email that's a data dump. If it takes more than 30 seconds to read, or has no clear single priority, it has failed.
- The page and the email disagreeing about the same week.
- Advice the numbers don't support. Every sentence must cite its numbers.
- Blaming apps for Pulse's own downtime. Pulse-offline runs are already excluded from checks, so this holds automatically.

## Constraints
- From `CLAUDE.md`: Raspberry Pi 3B+, the whole system under 100 MB; no runtime dependencies; `node:https` only, no `fetch()`; erasable TypeScript only; production runs from `dist/`; timestamps in epoch ms; rollup days are UTC dates.
- **Week window (my call):** Monday 00:00 to the next Monday 00:00, **Sydney time**. That's the week as Mo lives it.
  - The key is the Monday's date (`YYYY-MM-DD`) and the label is "16–22 Nov".
  - Every run, including a late catch-up run, snaps to the most recent *completed* Sydney week, so windows never shift or overlap.
  - Uptime, outages and response times come from `checks` and `incidents` by exact timestamps.
  - Sentry is stored by UTC day, so a week's errors are the 7 UTC days starting on the Sunday before. That's the closest complete match, because Sydney Monday 00:00 is Sunday 13:00 UTC.
  - Date maths uses the Pi's local time zone (Australia/Sydney). Tests set `TZ=Australia/Sydney`.
- **Secrets** go in `/etc/vexto-pulse/env`, which is root-owned with mode 600:
  - `RESEND_API_KEY`: a sending-only key, restricted to the vexto.app domain, which is already verified in Resend
  - `DIGEST_TO`: Mo's address
  - `DIGEST_FROM` defaults to `Vexto Pulse <pulse@vexto.app>`
- The email is sent with the Resend REST API (`POST https://api.resend.com/emails`) through a small `postJson` beside `getJson` in `src/http.ts`. Errors never include the key.
- Emails need inline styles, `table` layout where needed, a plain-text alternative, and must read well in Gmail and Apple Mail, light and dark.
- The page lives behind Cloudflare Access. Week selection uses `/insights?week=YYYY-MM-DD`. The raw-path check in `src/server.ts` already strips the query, so Access still protects it.

## Approaches
- **A separate weekly job that computes, stores, then emails (chosen).** A new one-shot script `dist/digest.js`, run by `vexto-pulse-digest.timer` (`OnCalendar=Mon *-*-* 07:00`, `Persistent=true`). It computes the digest from the database, saves it in a `digests` table, then sends the email. The page reads stored digests.
- *Compute on the fly when the page loads.* Rejected: past weeks would change as data moves, and the page could disagree with the email that was sent.
- *Fold it into the daily insights job.* Rejected: it couples two schedules, and a slow PageSpeed run would delay the email.
- **Rules versus AI for the focus:** Mo chose rules.

## Design decisions

### Data model
Table `digests (week TEXT PRIMARY KEY, created_at INTEGER, data TEXT /* JSON */, emailed_at INTEGER NULL, email_error TEXT NULL)`, STRICT.

`data` holds:
- the window
- portfolio uptime and total errors this week and last week
- the 8-week trend points
- per-app weekly numbers
- the focus, its "also" items, last week's focus outcome, the changes and the needs-attention list

It stores both the numbers and the sentences, so it can be re-rendered later exactly as sent.

### Focus rules
The most severe category wins, and within a category the biggest number wins:
1. **Outage:** the longest total outage of 30 minutes or more this week (from `incidents`). "Fix Kata first: down 1 hour 20 minutes this week."
2. **Errors rising:** this week ≥ 5 and either last week was 0 or this week ≥ 2× last week (from `sentry_daily`).
3. **Uptime below 99%** this week.
4. **Certificate expiring** within 14 days.
5. **PageSpeed:** performance below 50, accessibility below 90, or any category down 10 or more since the previous run (from `pagespeed`).
6. **Much slower:** average response time this week at least 2× last week and at least 2 seconds (from `daily_rollups.avg_ms`).

If nothing qualifies: "Nothing urgent. A good week to ship something." plus the easiest quick win, the lowest accessibility score at 95 or below, if there is one.

The focus records its rule and app, so next week can check it.

### Last week's focus, revisited
Re-evaluate the same rule for the same app this week:
- If it no longer qualifies: "Done" with before → after numbers.
- If it still qualifies: "Still open".
- If last week had no focus, or there's no previous digest, leave the line out.
- "Last week" means the stored digest for the previous week key.

### What changed
These items, sorted by size of change, at most 6:
- outages this week, one line each, at most 3
- response time ×2 faster or slower, where at least one side is 1 second or more
- PageSpeed category changes of 10 or more points
- errors up or down by 5 or more
- apps newly linked to Sentry

### The 8-week trend
For each of the last 8 week windows:
- uptime, computed from stored `checks` (90-day retention, so 8 weeks is available)
- total Sentry errors

Shown as two small inline SVG bar or line charts on the page. The email gets a simple bar row built from table cells, since many email clients block SVG. Weeks with no data show as empty.

### The verdict line (my call)
An "issue" here is an item that meets one of this week's rules: 1 (outage), 2 (errors rising), 3 (uptime below 99%) or 6 (much slower). Standing issues, 4 (certificate) and 5 (PageSpeed), still appear in the focus and "Needs attention" but don't count toward the verdict (Mo's call, after real data rated a 99.7%, no-outage week "rough" only because of accessibility scores).
- **0 issues:** "A good week"
- **1–2 issues:** "A mixed week"
- **3 or more issues:** "A rough week"

It ends with the headline numbers (uptime, outages, errors). The subject's "N things to fix" is the same count, so the subject and the body always agree.

### Subject
"Pulse weekly, 16–22 Nov: <verdict>, <N thing(s) to fix | nothing urgent>".

### The page
A "Weekly summaries" section above "Needs attention" on `/insights`:
- a `<select>` of weeks, newest first, which switches to `?week=` (JavaScript on change, with a plain "Show" submit button as fallback)
- the stored digest rendered with the new design tokens: verdict, last week's focus, focus, changes, trend and needs-attention list
- "Not sent: <error>" when the email failed
- with no digests yet: "The first summary arrives Monday at 7 am."

Visually this section uses the same tokens and type as the redesigned public page. The rest of `/insights` keeps its current look; restyling it is a separate task.

### Failure handling
- **The email fails:** the digest is still stored, with `email_error`. The job exits 0 and logs the error. The page shows the error. Two retries on network errors or HTTP 5xx.
- **A digest is frozen once emailed (my call).** A stored digest with `emailed_at` set is never recomputed or overwritten.
- **The job runs twice for the same week:** if `emailed_at` is set, it does nothing. If the earlier send failed, it re-sends the stored copy without recomputing.
- **Manual run:** `npm run digest` computes and stores the digest. `PULSE_DIGEST_DRY=1` prints the email's text to the terminal instead of sending. `PULSE_DIGEST_WEEK=YYYY-MM-DD` computes a given week. It recomputes only a week that hasn't been emailed; an emailed week is never touched.

### Memory
One-shot, and it reads at most about 90 days of checks per app with aggregate SQL. It should stay well under the insights job's 75 MB peak. Measure it with `/usr/bin/time -l` before shipping.

## Left to the builder
- Exact copy wording, within the voice above: plain, sentence case, numbers cited.
- Email HTML structure and dark-mode handling.
- Chart styling, within the redesigned page's tokens.
- File split, for example `src/digest-model.ts` (pure rules and computation), `src/digest.ts` (entry), `src/render-digest.ts` (email HTML and text, and the page section).

## Rollout
1. Build on branch `v3-digest` with tests first.
2. Run the post-feature reviews: code-simplifier, web-design-guidelines, /code-review, /security-review.
3. Ask Mo to:
   - create a sending-only Resend key restricted to vexto.app (he creates it in the Resend dashboard; it goes to the Pi through the clipboard)
   - give his `DIGEST_TO` address, which also goes into the env file
4. Merge, push and deploy. Copy and enable `vexto-pulse-digest.timer`.
5. Send the first digest by hand (for the week 16–22 Nov (key `2026-11-16`). Pulse's tracking started on 26 Nov, so the first digest is thin and the second has real comparisons. It's sent anyway, to prove the pipeline end to end), check it in Mo's inbox and on `/insights`, then let Monday's timer take over.
