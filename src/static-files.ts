// Files served as-is from public/, read once at startup. Cached for a week.
export const STATIC: Record<string, { file: string; type: string }> = {
  '/geist.woff2': { file: 'Geist-Variable.woff2', type: 'font/woff2' }, // 69 KB, Geist (SIL OFL)
  '/favicon.svg': { file: 'favicon.svg', type: 'image/svg+xml' },
  '/apple-touch-icon.png': { file: 'apple-touch-icon.png', type: 'image/png' },
  '/manifest.webmanifest': { file: 'manifest.webmanifest', type: 'application/manifest+json' },
};
