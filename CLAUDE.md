# Vexto Pulse

Uptime monitor and status page. It runs on a Raspberry Pi 3B+ (1 GB RAM), **not Railway**.

## Rules
- Memory budget: under 100 MB total. Measure RSS before adding anything heavy (`/usr/bin/time -l node dist/checker.js` on macOS).
- No runtime dependencies unless there's a strong reason. Use the built-ins: `node:http`, `node:https`, `node:sqlite`, `node:test`.
- Don't use `fetch()` in production code: it loads undici, which costs about 50 MB more than `node:https`.
- Production runs compiled JS from `dist/` (`npm run build`). Running `.ts` directly costs about 25 MB per process, so keep that to tests.
- TypeScript must be erasable-only (no enums, namespaces or parameter properties). `tsconfig` enforces it.
- Timestamps are epoch milliseconds. Rollup days are UTC dates.
- An app's `name` in `apps.json` is its storage key.

## Commands
`npm run build` · `npm run check` · `npm start` · `npm test`
