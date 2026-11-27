import { readFileSync } from 'node:fs';

export type App = { name: string; url: string; category: string; description: string };

export function loadApps(path = process.env.PULSE_APPS ?? 'apps.json'): App[] {
  const apps: unknown = JSON.parse(readFileSync(path, 'utf8'));
  if (!Array.isArray(apps)) throw new Error(`${path}: expected an array of apps`);

  const names = new Set<string>();
  for (const app of apps) {
    const { name, url, category, description } = app ?? {};
    if ([name, url, category, description].some((v) => typeof v !== 'string')) {
      throw new Error(`${path}: each app needs string name, url, category and description: ${JSON.stringify(app)}`);
    }
    new URL(url); // throws on an invalid URL
    if (names.has(name)) throw new Error(`${path}: duplicate app name "${name}"`);
    names.add(name);
  }
  return apps as App[];
}
