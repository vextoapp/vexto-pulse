# Insights Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn `/insights` into Mo's private owner page. It should lead with this week's focus and its concrete steps, give every app one next step, and match the status page's design. Both pages also get the pulse icon as a proper web app.

**Architecture:**
- A new pure module, `src/next-step.ts`, turns the insights rows and the newest stored digest into grouped next steps, per-app notes, and a "how to fix it" guide for the focus.
- `render-insights.ts` is rewritten around that module and reuses the status page's design tokens, which get exported from `render.ts`.
- Icons and the manifest are static files in `public/`, served from a small route map.

**Tech Stack:** Node 26, TypeScript (erasable only), `node:sqlite`, `node:http`, `node:test`. No dependencies.

**Spec:** `docs/superpowers/specs/2026-11-27-insights-redesign-design.md`. The approved mockup is https://claude.ai/artifact/VhWkoTdrNRChjJ7ThgGRr7 (version 2). Copy its wording and CSS where this plan doesn't say otherwise.

## Global Constraints
- No runtime dependencies. No `fetch()` in production code. Erasable TypeScript only (no enums, namespaces or parameter properties).
- Production runs `dist/`. The whole service stays under 100 MB RSS.
- `/insights` keeps `cache-control: no-store`, `x-robots-tag: noindex` and the raw-path check in `src/server.ts`.
- Every string from data goes through `esc()`.
- The page speaks to Mo as "you". Never "I" or "how I decide".
- No retire or grow advice. That section is a placeholder that says it needs visits and last-commit data.
- No page-level horizontal scroll at 375 px, in light or dark.
- `theme-color`: light `#ffffff`, dark `#0f1110` (the status page's values) on both pages.
- Work on branch `insights-redesign`, cut from `main` after `v3-digest` is merged. Commit after each task. Ask Mo before pushing, merging or deploying.

## Review Focus
1. **No digest stored yet** (a fresh install, before the first Monday). The page renders with no focus card, says the first summary arrives Monday at 7 am, and still groups every app. Apps with `reasons` go under Fix. Test in Task 3.
2. **Looking at an older week in the picker.** Only "How the week went" changes. The headline, "Do this first" and "Every app" always use the newest digest, so an app fixed since then doesn't reappear. Test in Task 3.
3. **A digest issue for an app that's no longer in `apps.json`.** It's skipped; every current app appears exactly once. Test in Task 1.
4. **An app with no PageSpeed scores** (never ran, or the last run failed) **or no uptime yet.** The quick numbers show "–", and a note says why ("PageSpeed hasn't run yet" or "PageSpeed failed: …"). Test in Task 1.
5. **Several issues for one app** (for example an outage and low accessibility). The app appears once under Fix, with its most severe issue (lowest rule number) as the step. The others become notes. Test in Task 1.

---

### Task 1: Next steps and notes (`src/next-step.ts`)

**Files:**
- Create: `src/next-step.ts`
- Test: `test/next-step.test.ts`

**Interfaces:**
- Consumes:
  - `InsightRow` from `src/insights-model.ts`;
  - `Digest` and `Issue` from `src/digest-model.ts`.
- Produces:
  ```ts
  export type Group = 'fix' | 'sentry' | 'ok';
  export type AppStep = { row: InsightRow; group: Group; step: string; focus: boolean; notes: string[] };
  export function nextSteps(rows: InsightRow[], latest: Digest | null): AppStep[];
  export type Guide = { title: string; why: string; todo: string[]; done: string };
  export function focusGuide(issue: Issue, url: string): Guide;
  ```

**Rules `nextSteps` follows:**
- **Fix group.** It comes from `latest.attention`: an app's first issue (attention is already sorted by rule, then size) gives the step, which is `issue.text`. Its other issues become notes, using their `text`.
  - `focus` is true for the app named in `latest.focus`.
  - When `latest` is null, apps with `row.reasons.length` go to Fix with `step = row.reasons[0]` and the rest of the reasons as notes.
- **Sentry group.** Otherwise, `errors_7d === null` gives step `Connect Sentry so you see crashes`.
- **Healthy group.** Otherwise, step `Healthy. Leave it and ship something new.`
- **Order:**
  - Fix comes first, with the focus app first and then attention order.
  - Then Sentry, A to Z.
  - Then Healthy, A to Z.
  - Every row appears exactly once. Issues for unknown apps are ignored.
- **Notes**, after the extra-issue notes, in this order. Each wording matches the mockup.
  - `scores` null: `PageSpeed failed: <error>` if `pagespeed_error`, otherwise `PageSpeed hasn't run yet`.
  - `uptime_30d` from 99 up to (not including) 99.5: `Uptime 99.30% is under your 99.5% target but above the 99% rule. Watch it; if it slips under 99% it becomes a focus.` Use `pct()` from `render.ts` for the number.
  - Speed under 70: `Speed 67 is the weakest score here. Not urgent (the rule is under 50), but it's the next thing to improve.`
  - Speed 70–79: `Speed 75 could be better. Not urgent.`
  - Best practices under 100: `Best practices 96: usually a browser console error or an outdated library.`
  - SEO under 100: `SEO 92: often a missing meta description.`
  - An app in the Fix group with no Sentry: `Sentry isn't connected, so Pulse can't see crashes here. Connect it once this is fixed.`
  - Sentry connected: `Sentry is connected: 3 errors this week, 1 the week before.`
  - No notes at all: `Every score is in Google's good band. Nothing to do.`
- **`focusGuide`** is keyed by `issue.metric`. There is one entry each for:
  - `outage`, `errors`, `uptime`, `certificate`, `response`;
  - `accessibility` and `performance` (both below a bar);
  - any other metric, which falls back to the "fell 10 points" guide.

  It returns:
  - `title`: for accessibility, `Raise EclipSend's accessibility from 84 to 90`; for the others, the same shape, built from `issue.text`.
  - `why`: one sentence on what users feel.
  - `todo`: 2–3 concrete steps. The PageSpeed ones start with `Open <host> in Chrome, then DevTools → Lighthouse`.
  - `done`: what next Monday checks, for example `next week's PageSpeed run shows 90 or more`.

  The accessibility entry uses the mockup's exact copy.

- [ ] **Step 1: Write the failing tests** in `test/next-step.test.ts`. Use a `row()` helper like the one in `test/render-insights.test.ts`, and a `digest()` helper that builds a minimal `Digest` with the given `focus` and `attention`.
  ```ts
  test('an app with an issue is in Fix with the issue as its step; the focus app comes first', ...)
    // attention: [rule 5 accessibility for Forked (87), rule 5 accessibility for EclipSend (84)], focus = the EclipSend issue
    // → steps[0].row.name === 'EclipSend', steps[0].focus === true, steps[0].group === 'fix', steps[0].step === "EclipSend's accessibility score is 84."
  test('no Sentry → sentry group; Sentry and no issue → ok; each sorted A to Z', ...)
  test('every app appears exactly once and unknown apps in the digest are ignored', ...)
    // attention includes an issue for 'Gone'; result names deep-equal the input names as a set, length === rows.length
  test('two issues for one app: the lowest rule is the step, the other is a note', ...)
    // rule 1 outage + rule 5 accessibility for A → step is the outage text, notes include the accessibility text
  test('without a digest, apps with reasons go to Fix', ...)
    // latest = null, row reasons ['Accessibility 84'] → group 'fix', step 'Accessibility 84', focus false
  test('notes: uptime watch, speed, best practices, SEO, Sentry', ...)
    // uptime 99.3, performance 67, best_practices 96, seo 92, errors 3/1 → five notes containing
    // '99.30%', 'Speed 67 is the weakest', 'Best practices 96', 'SEO 92', '3 errors this week, 1 the week before'
  test('notes: missing or failed PageSpeed', ...)
    // scores null, pagespeed_error 'HTTP 429' → note 'PageSpeed failed: HTTP 429'; no error → "PageSpeed hasn't run yet"
  test('a healthy app with nothing to say gets the all-good note', ...)
  test('focusGuide for accessibility uses the host and the bar', ...)
    // focusGuide({rule:5, app:'EclipSend', metric:'accessibility', value:84, ...}, 'https://eclipsend.vexto.app')
    // → title "Raise EclipSend's accessibility from 84 to 90", todo[0] starts 'Open eclipsend.vexto.app in Chrome', done matches /90 or more/
  test('focusGuide has a guide for every metric the rules produce', ...)
    // for each of outage, errors, uptime, certificate, performance, accessibility, response, 'best practices':
    // title, why and done are non-empty, and todo.length is 2 or 3
  ```
- [ ] **Step 2:** Run `node --test test/next-step.test.ts`. Expected: FAIL, because the module isn't found.
- [ ] **Step 3:** Implement `src/next-step.ts` with the interfaces and rules above.
- [ ] **Step 4:** Run `node --test test/next-step.test.ts`, then `npm test`. Expected: all pass.
- [ ] **Step 5: Commit.** Message: `Insights: a next step and notes for every app`.

---

### Task 2: Icons, manifest and shared tokens

**Files:**
- Create:
  - `public/favicon.svg`
  - `public/apple-touch-icon.png`
  - `public/manifest.webmanifest`
  - `src/static-files.ts`
  - `test/static-files.test.ts`
- Modify:
  - `src/render.ts`: split out the tokens, add the icon tags in `<head>`.
  - `src/server.ts`: static routes.
  - `test/render.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // src/static-files.ts
  export const STATIC: Record<string, { file: string; type: string }>;
  // '/geist.woff2'           → Geist-Variable.woff2, font/woff2
  // '/favicon.svg'           → favicon.svg, image/svg+xml
  // '/apple-touch-icon.png'  → apple-touch-icon.png, image/png
  // '/manifest.webmanifest'  → manifest.webmanifest, application/manifest+json
  // src/render.ts
  export const TOKENS_CSS: string; // the @font-face, :root and dark :root blocks, moved out of CSS unchanged
  export const HEAD_ICONS: string; // favicon, apple-touch-icon, manifest links and both theme-color metas
  ```
- **Files:**
  - `favicon.svg`: a 24×24 viewBox, a rounded `#ffffff` tile (`rx="6"`, with a hairline `#e8ebe9` stroke), and the pulse path in `#1f9d61` with a stroke width of 2.5. It must stay readable at 16 px.
  - `apple-touch-icon.png`: 180×180. Generate it once from the SVG with `qlmanage -t -s 180 -o <scratch> public/favicon.svg`, or `sips`. Check it with `file`.
  - `manifest.webmanifest`:
    ```json
    {"name":"Vexto Pulse","short_name":"Pulse","start_url":"/","display":"standalone","background_color":"#ffffff","theme_color":"#ffffff","icons":[{"src":"/favicon.svg","sizes":"any","type":"image/svg+xml"},{"src":"/apple-touch-icon.png","sizes":"180x180","type":"image/png"}]}
    ```
- **Server:**
  - Replace the single `/geist.woff2` branch with a lookup in `STATIC`.
  - Read every file once at startup.
  - Send `cache-control: public, max-age=604800`.
  - Honour `HEAD`.

- [ ] **Step 1: Write the failing tests.**
  - `test/static-files.test.ts`:
    - `every static file exists and has the right type`: each `STATIC` entry's file is readable from `public/`, and its `type` matches the list above.
    - `the manifest is valid JSON that starts at / and lists both icons`.
    - `the touch icon is a 180×180 PNG`: bytes 0–7 are the PNG signature, and the IHDR width and height at offsets 16 and 20 are 180.
  - `test/render.test.ts`, new test `the status page links the icons and manifest`:
    - asserts `rel="icon" href="/favicon.svg"`, `rel="apple-touch-icon"` and `rel="manifest"`;
    - asserts that the `#ffffff` and `#0f1110` theme colours each appear once.
- [ ] **Step 2:** Run `node --test test/static-files.test.ts test/render.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Create the three public files and `src/static-files.ts`. Move the tokens into `TOKENS_CSS`, so `CSS` starts with `${TOKENS_CSS}`. Add `HEAD_ICONS` to the status page head, replacing its two theme-color metas. Switch the server to `STATIC`.
- [ ] **Step 4:** Run `npm test`, `npx tsc --noEmit` and `npm run build`. Expected: all pass, and the status page renders unchanged apart from the head tags.
- [ ] **Step 5: Commit.** Message: `Pulse icon as favicon, touch icon and web manifest`.

---

### Task 3: The owner page (`render-insights.ts`, `render-digest.ts`, server wiring)

**Files:**
- Modify:
  - `src/render-insights.ts`: full rewrite.
  - `src/render-digest.ts`: `digestSection` markup and `DIGEST_CSS` only. The email is untouched.
  - `src/server.ts`: what `/insights` passes to the renderer.
  - `test/render-insights.test.ts`: rewrite.
  - `test/render-digest.test.ts`: update only the selectors that changed.

**Interfaces:**
- Consumes:
  - `nextSteps` and `focusGuide` (Task 1);
  - `TOKENS_CSS` and `HEAD_ICONS` (Task 2);
  - `digestSection` and `DIGEST_CSS`.
- Produces:
  ```ts
  export type WeekView = { latest: Digest | null; shown: Digest | null; weeks: { key: string; label: string }[]; selected: string | null; sendError: string | null };
  export function renderInsights(i: Insights, w: WeekView): string;
  ```
- **Server:** `weeklySummary` becomes `weekView(asked)`. It returns `latest = getStored(db, weeks[0].key)?.digest ?? null` and `shown` = the asked week's digest (or `latest`). The `sendError` rule is unchanged.

**Page, top to bottom** (the mockup's markup and CSS, with the mock banner and inline script dropped):
1. **Head:**
   - `<title>Insights · Vexto Pulse</title>`
   - `noindex`
   - `color-scheme`
   - the Geist preload
   - `HEAD_ICONS`
   - `<style>${TOKENS_CSS}${INSIGHTS_CSS}${DIGEST_CSS}</style>`
2. **Brand line** with the pulse SVG and the "Private" pill. The brand links to `/`.
3. **`.hello`:** `Your week, <latest.label>`.
4. **`h1`:**
   - Uptime part:
     - `All N apps stayed up.` when `latest.outages === 0`;
     - otherwise `<N> outage(s) this week.`
   - Then the focus part:
     - `This week, <guide.title in lower-case first letter>.` when there's a focus;
     - otherwise `Nothing to fix this week.`
   - With no digest at all: `Your first weekly summary arrives Monday at 7 am.`
5. **`.meta` line:**
   - `Nothing broke, so there's no fire to put out. Use the week on your weakest standing score, then work down the list below.` when the focus rule is 4 or 5;
   - `Something broke this week. Fix it first, then work down the list below.` for rules 1–3 and 6;
   - `Nothing needs you this week. A good week to ship something.` when there's no focus.
6. **"Do this first"**, only when `latest.focus` is set. It shows the label `Focus this week`, `guide.title`, `guide.why`, `guide.todo` as an `<ol>`, `Done when` plus `guide.done`, and then `After that: <latest.also texts>` if there are any.
7. **"How the week went":** `digestSection(shown, weeks, selected, sendError)`, restyled to the mockup's `.week` card. Changes:
   - The `h2` becomes `How the week went`.
   - The verdict becomes a pill. Its class depends on the verdict: good is ok, mixed is warn, rough is down, and no data is faint.
   - The verdict line is `summary(d)`.
   - The blocks are: Last week's focus, What changed, Last 8 weeks.
   - Drop the old "Focus this week" and "Needs attention" sections from `sections()` for the page only. `digestEmail` still uses them.
8. **"Every app, with your next step N":** three groups. Each group's heading, colour dot and blurb come from the mockup, and an empty group is skipped. Each app is a `<details>` row with:
   - the name;
   - the step in `<small>`, prefixed `Your focus this week: ` when `focus` is true;
   - chips for Up, Speed and Access, banded with `.g`, `.a` and `.r`, showing `–` for null;
   - the arrow.

   Opening a row shows a `dl.nums` with the six numbers (errors as `3 (1)`, or `not connected`) and `ul.notes`.
9. **"Retire, grow or keep updating":** a dashed card with the mockup's copy. Show `0 of N apps reporting visits` with N = `rows.length`.
10. **"Reference":** two `<details>`, "What the numbers mean" and "How Pulse picks your focus", with the mockup's copy.
11. **Footer:** `PageSpeed last ran <time()>` (or `PageSpeed runs on the next weekly job`) `· errors update daily`, and a link to `/` reading `Public page`.
12. **The `time[data-local]` script**, kept from today's page.

- **Clean-up:** delete the old `BASE_CSS`, `INSIGHTS_CSS` table styles, `renderRow` and `score`. The new `INSIGHTS_CSS` holds the mockup's styles, which use the `TOKENS_CSS` variables (`--line`, `--sub`, `--faint`, `--ok`, `--warn`, `--down`, `--empty`, `--sunk`, `--card`).

- [ ] **Step 1: Write the failing tests.** Rewrite `test/render-insights.test.ts`, using the `row()` helper and a `digest()` helper.
  ```ts
  test('escapes app names and step text', ...)                          // name "Lenny's <b>" → &#39; and &lt;b&gt;, no raw <b>
  test('the headline names the focus on a clean week', ...)             // two rows, outages 0, focus a11y EclipSend 84 → h1 contains "All 2 apps stayed up. This week, raise EclipSend&#39;s accessibility from 84 to 90."
  test('the headline counts outages on a bad week', ...)                // outages 2, focus rule 1 → h1 contains "2 outages this week." and meta contains "Something broke"
  test('Do this first shows the guide steps and done line', ...)        // contains 'Do this first', 'Open eclipsend.vexto.app in Chrome', 'Done when'
  test('without a digest there is no focus card and apps are still grouped', ...) // latest null → no 'Do this first', h1 'first weekly summary arrives Monday', both rows present
  test('an older week changes only How the week went', ...)             // latest.focus = A, shown.focus = B → 'Do this first' names A; the digest card shows shown.label
  test('every app appears once, in group order', ...)                   // fix app before sentry app before ok app; each name appears in exactly one <details>
  test('missing scores show a dash and a note', ...)                    // scores null → chip shows '–' and note "PageSpeed hasn't run yet"
  test('retire and grow is a placeholder that counts apps', ...)        // contains '0 of 2 apps reporting visits'
  test('the page speaks to you, never as I', ...)                       // doesNotMatch /How I |I decide|I use this/
  test('links the icons and keeps the status page colours', ...)        // rel="icon", rel="manifest", #0f1110
  ```
  In `test/render-digest.test.ts`, change only the assertions about the page section's old heading or classes, and keep every email test as it is.
- [ ] **Step 2:** Run `node --test test/render-insights.test.ts`. Expected: FAIL, because the signature and markup have changed.
- [ ] **Step 3:** Implement the page, the `digestSection` restyle and the server's `weekView`.
- [ ] **Step 4:** Run `npm test`, `npx tsc --noEmit` and `npm run build`. Expected: all pass.
- [ ] **Step 5: Check it in the browser.**
  - Run the built server against a fresh copy of the Pi's database, using a temporary `.claude/launch.json` entry that you revert afterwards.
  - Open `/insights` at desktop width and at 375 px, in light and dark. Check that `document.documentElement.scrollWidth === innerWidth` at 375 px, that rows open, and that the week picker changes only the week card.
  - Check that the favicon shows in the tab and the manifest loads with no errors in the console.
  - Measure the web server's RSS with `ps -o rss= -p <pid>`. Expected: under 100 MB.
- [ ] **Step 6: Commit.** Message: `Insights: an owner page that says what to do next`.

---

### Task 4: README and finishing checks

**Files:**
- Modify: `README.md`, the `/insights` section only.

- [ ] **Step 1:** Rewrite the README's `/insights` description to match the new page:
  - the focus card;
  - the next step per app, with its three groups;
  - the notes;
  - the retire/grow placeholder and what will feed it;
  - the icons.

  Keep the Cloudflare Access instructions as they are.
- [ ] **Step 2:** Run code-simplifier on the changed files, then web-design-guidelines on `src/render-insights.ts` and `src/render-digest.ts`, then `/code-review`. Fix what matters, with a failing test first for any bug, and re-run `npm test`.
- [ ] **Step 3: Commit.** Message: `README: the new insights page`. Then stop and ask Mo before pushing, merging or deploying. The deploy is the usual one command and one Pi password.
