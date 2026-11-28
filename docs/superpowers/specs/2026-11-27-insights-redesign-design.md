# Insights redesign and web-app icons (short design)

Approved mockup (version 2): https://claude.ai/artifact/VhWkoTdrNRChjJ7ThgGRr7

## Why
`/insights` is Mo's private workspace. It should talk to him as the owner of 26 apps and tell him what to do next, with the numbers behind each suggestion. It is not a page for showing other people. Today it uses the old dark style and jargon (Perf, A11y, BP), and lists numbers without saying what to do about them. Both pages should also carry the pulse icon as a proper web app.

## Goals
- `/insights` uses the status page's design: the same tokens, Geist, light and dark.
- The page speaks to Mo ("you") and leads with the answer: this week's one focus, with concrete steps and what "done" means.
- Every app gets one next step, with the reason and its numbers one click away.
- A visible slot for retire, grow or keep updating, which says honestly that it needs usage data.
- The pulse icon appears as the favicon, the home-screen icon and the installed-app icon, on both pages.

## Non-goals
- No new data sources in this build. Visits (Cloudflare Web Analytics) and last commit (GitHub) are a separate follow-up project.
- No changes to the focus rules or the weekly email.
- No public version. The page stays behind Cloudflare Access.
- No changes to the status page beyond the icon tags.

## Anti-goals
- Advice Pulse can't back with a number. In particular, no retire or grow suggestions until usage data exists.
- Copy addressed to visitors ("how I decide"). Explanations sit next to the number they explain and are written to Mo.
- Any page-level horizontal scroll at 375 px.

## Constraints
- Same as the project: no runtime dependencies, under 100 MB, erasable TypeScript, `node:test`.
- `/insights` keeps `no-store`, `noindex` and its raw-path check.
- The icon files are public, because Access guards only `/insights`. They contain nothing private.

## Approaches
1. **Restyle in place (picked).** Rewrite `render-insights.ts` and the digest section's markup and CSS with the status page's tokens. Add a small pure function that gives each app its next step. Drop the old `BASE_CSS`.
2. **A shared layout module** for both pages. Cleaner on paper, but it touches the status page we just shipped for no visible gain. Rejected for now.
3. **Static HTML with client-side data.** It would need an API for private data and JavaScript to render. Rejected.

## The design (as in the mockup)
1. **Brand line** with the pulse icon and a "Private" pill.
2. **Headline that answers "what do I do?"** It reads "Your week, 23–29 Nov", then a heading with the week's outcome and the focus, for example "All 26 apps stayed up. This week, fix EclipSend's accessibility." A line under it explains why: it's a fire to put out, or a standing improvement.
3. **Do this first.** The digest's focus as a card:
   - the title, with the number and the bar (84 → 90);
   - why it matters to users;
   - 2–3 concrete steps for that problem type;
   - "Done when" (what next Monday will check);
   - the next apps with the same problem.
4. **How the week went.** The verdict pill, the week picker, the verdict line, last week's focus, what changed, and the 8-week trend with numbers. This is the existing digest section, restyled and reworded to "you".
5. **Every app, with your next step.** Groups in this order:
   - **Fix** (broke a rule; the focus app first);
   - **Set up error tracking** (no Sentry project);
   - **Healthy** (nothing to do).

   Each group has a count and one line on why. Each app is a `<details>` row: name, next step, and three quick numbers (uptime, speed, accessibility). Opening it shows all six numbers and short notes.
6. **Retire, grow or keep updating.** A dashed placeholder saying it needs visits and last-commit data, with "0 of 26 apps reporting visits".
7. **Reference,** folded: "What the numbers mean" (plain names and Google's bands), and "How Pulse picks your focus" (the six rules, tagged this week or standing).
8. **Footer:** when PageSpeed last ran and that errors update daily.

**Next step per app** (one new pure function, testable):
- An app that breaks a focus rule (1–6) gets that rule's step. The digest's focus app is marked as this week's focus.
- Otherwise, an app with no Sentry project gets "Connect Sentry".
- Otherwise it's healthy.

**Notes per app** are informational and never change the focus:
- uptime under 99.5% but above the 99% rule;
- speed under 80;
- best practices or SEO under 100;
- Sentry missing on an app whose step is something else;
- Sentry connected, with this week's and last week's errors.

## Web-app icons
- `/favicon.svg`: the pulse path in `#1f9d61` on a rounded light tile, readable at 16 px.
- `/apple-touch-icon.png` (180×180): generated once on the Mac from the SVG and committed, so the build needs no image tools.
- `/manifest.webmanifest`: the name "Vexto Pulse", `start_url: "/"`, `display: "standalone"`, theme and background colours from the light tokens, and the PNG plus an SVG icon.
- Both pages get the icon links, the manifest link and `theme-color` (light `#ffffff`, dark `#0f1110`).
- Served as static files cached for a week, with the same pattern as `/geist.woff2`.

## Left to the builder
- The exact step text for each rule type (outage, rising errors, low uptime, certificate, PageSpeed, slow response). Write it in the mockup's voice.
- The ordering inside a group: the focus first, then by rule order, then worst number.
- Whether to copy the pill and key styles from the status page or share them (copying is fine).

## Done when
- Tests cover:
  - the next-step function, for each group and for the focus app;
  - the notes thresholds;
  - the headline for a good week and for a week with an outage;
  - that every app appears exactly once;
  - the plain column names;
  - that the icon and manifest routes return the right content types;
  - that both pages link the icons.
- Screenshots are checked in light and dark, at desktop width and 375 px, with no horizontal scroll.
- The favicon shows in a tab, and the manifest is valid in the browser's Application panel.
- Code-simplifier, web-design-guidelines and /code-review have run.
- The work is on branch `insights-redesign`, cut after v3 merges.

## Follow-up (separate project)
Read daily visits per app from Cloudflare Web Analytics (a read-only API token) and the last commit date from GitHub. Then turn the placeholder into retire, grow or keep-updating calls once about 4 weeks of data exist.
