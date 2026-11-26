# Vexto Pulse v2: insights ("is it good")

Status: approved scope, 26 November 2026.

## Why

v1 answers "is it up?". With 25+ apps, Mo needs to decide **where his next hour goes**. Each app should eventually land in one of four boxes:

| | Healthy | Broken or slow |
| --- | --- | --- |
| **Used** | Invest | Fix first |
| **Not used** | Leave alone | Retire or rethink |

v2 adds the "healthy?" half (quality and errors). The "used?" half (Cloudflare Web Analytics visitors) comes after the apps move off Lovable, because that is when analytics can be switched on per site. v3's Monday email will read from the same data.

## Goals

- A weekly **PageSpeed** score (mobile) for every tracked app: performance, accessibility, best practices, SEO, with the change since the previous run.
- A daily **Sentry error count** per app: errors in the last 7 days and the 7 days before. Apps without a Sentry project show "not set up".
- A **private page** at `status.vexto.app/insights` with one row per app and a short "needs attention" list at the top.
- Add **Kata** (`https://kata.vexto.app`) to the tracked apps.

## Non-goals

- Usage numbers (after the Lovable migration, as v2.1).
- A single blended "health score". It hides why an app is in trouble.
- Alerts, emails (v3), login code of our own.

## Anti-goals

- Any change to the public status page or `/api/status`.
- Error counts or scores visible to the public.
- Breaking the Pi's memory budget: no new long-running process, no `fetch()`, no runtime dependencies.

## Constraints

From CLAUDE.md: Pi 3B+, under 100 MB per process, `node:https` only, built-ins only, compiled `dist/`, erasable TypeScript, epoch ms, UTC days, app `name` is the storage key.

## Approaches considered

1. **One daily "insights" job (chosen).** A new oneshot `dist/insights.js`, started once a day by a systemd timer. Every run pulls Sentry; PageSpeed runs only if the last PageSpeed run is 6+ days old. One timer, one entry point, same pattern as the checker.
2. Two timers (weekly PageSpeed, daily Sentry). Same result with twice the unit files.
3. Run insights inside the checker. Rejected: PageSpeed calls take 10–30 s each, which would blow the checker's 90 s budget every 5 minutes.

Privacy of `/insights`: **Cloudflare Access** (Zero Trust free plan) on `status.vexto.app/insights`, allowing only Mo's email via one-time PIN. No auth code in Pulse. Requests can only reach the Pi through the tunnel, which passes Cloudflare's edge, where Access is enforced.

## Design

### Config

- No `apps.json` change for Sentry. An app matches the Sentry project whose slug equals its name lower-cased, with runs of non-letters/digits turned into `-` (`PageTurn` → `pageturn`, `Lenny's Product Brain` → `lenny-s-product-brain`). No match = "not set up". Mo names new Sentry projects this way.
- Secrets in `/etc/vexto-pulse/env` (root-owned, mode 600), loaded by the insights unit's `EnvironmentFile=`:
  - `PAGESPEED_KEY`: Google API key, restricted to the PageSpeed Insights API.
  - `SENTRY_TOKEN`: Sentry auth token, scopes `org:read` and `project:read` only.
  - `SENTRY_ORG=vexto-apps`, `SENTRY_HOST=de.sentry.io`.
- Missing key or token: that source is skipped with a log line, the job still succeeds.

### Storage (new tables in `db.ts`)

- `pagespeed(app, ts, performance, accessibility, best_practices, seo, error)`: scores 0–100 integers (null when a category fails), one row per app per run. Kept forever (about 52 rows per app per year).
- `sentry_daily(app, day, errors)`, primary key `(app, day)`: accepted error events per UTC day, upserted for the last 14 days on every run. Kept forever.

### Sources

- **PageSpeed**: `GET https://pagespeedonline.googleapis.com/pagespeedonline/v5/runPagespeed?url=…&strategy=mobile&category=performance&category=accessibility&category=best-practices&category=seo&key=…`. Score = `lighthouseResult.categories.<id>.score × 100`, rounded. One app at a time (responses are about 1 MB; sequential keeps memory flat), 60 s timeout, one retry on failure. 26 calls a week against a free quota of 25,000 a day.
- **Sentry**: `GET https://de.sentry.io/api/0/organizations/vexto-apps/stats_v2/?field=sum(quantity)&category=error&outcome=accepted&groupBy=project&statsPeriod=14d&interval=1d`, plus `/organizations/vexto-apps/projects/` to map project ids to slugs. Two calls a day.
- A small shared `getJson(url, headers, timeoutMs)` helper on `node:https`.

### `/insights` page

Server-rendered like `/`, same styles, `cache-control: no-store`, `x-robots-tag: noindex`. Contents:

1. **Needs attention** list (my default thresholds, easy to change): errors in the last 7 days > 0; performance < 50; accessibility < 90; 30-day uptime < 99%; TLS < 14 days.
2. **Table**, one row per app: 30-day uptime, the four PageSpeed scores with ▲/▼ change vs previous run, errors 7d (with the prior 7d), last PageSpeed date. Sorted by "needs attention" first, then name.
3. A note that usage arrives after the migration.

```
Needs attention (3)
  Switchboard  performance 38 ▼6
  Luna         4 errors this week (0 last week)
  EclipSend    TLS expires in 12 days

App          Uptime 30d  Perf  A11y  BP   SEO  Errors 7d
Switchboard  100%        38▼6  92    96   91   –  not set up
Luna         99.9%       71    95    100  92   4  (0)
…
```

### Deployment

- `deploy/vexto-pulse-insights.service` (oneshot, `User=pi`, `MemoryMax=100M`, `TimeoutStartSec=20min`, `EnvironmentFile=/etc/vexto-pulse/env`) and `.timer` (`OnCalendar=*-*-* 04:30`, `Persistent=true`).
- README: insights section, token setup, Cloudflare Access steps; also fix the two known README issues (tunnel steps now match the dashboard method; MemoryMax is not enforced on this Pi because the kernel has `cgroup_disable=memory`).

## Verification

- Unit tests (node:test): score parsing from a saved PageSpeed response, Sentry stats parsing and slug mapping, "needs attention" rules.
- Run the job locally with real keys; check rows and the page; measure the job's peak RSS (target under 100 MB).
- On the Pi: run once by hand, then check `/insights` is blocked without login and works after the email PIN.

## Left to the builder

File and function names, exact table/page markup, retry details.

## Calls made by Claude (check these)

- Mobile strategy only (most visitors are on phones; halves the calls).
- Once a day at 04:30 local; PageSpeed weekly within that.
- Needs-attention thresholds above.
- Kata's category: "Productivity and creativity" until Mo says otherwise.
