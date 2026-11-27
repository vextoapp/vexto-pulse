// Digest weeks: Monday 00:00 to the next Monday 00:00 in the Pi's local time zone (Australia/Sydney).
// Built from local Date parts, not Intl, so daylight-saving weeks come out 167 or 169 hours long.
export type Week = { key: string; start: number; end: number; label: string };

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad = (n: number) => String(n).padStart(2, '0');
export const keyOf = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

export function weekOf(key: string): Week {
  const [y, m, d] = key.split('-').map(Number);
  const start = new Date(y, m - 1, d);
  const last = new Date(y, m - 1, d + 6);
  const label =
    start.getMonth() === last.getMonth()
      ? `${start.getDate()}–${last.getDate()} ${MONTHS[last.getMonth()]}`
      : `${start.getDate()} ${MONTHS[start.getMonth()]} – ${last.getDate()} ${MONTHS[last.getMonth()]}`;
  return { key, start: start.getTime(), end: new Date(y, m - 1, d + 7).getTime(), label };
}

// The most recent week that has fully ended. Late runs snap to the same week, so windows never overlap.
export function lastCompletedWeek(now: number): Week {
  const today = new Date(now);
  const sinceMonday = (today.getDay() + 6) % 7;
  return weekOf(keyOf(new Date(today.getFullYear(), today.getMonth(), today.getDate() - sinceMonday - 7)));
}

export function previousWeek(w: Week): Week {
  const [y, m, d] = w.key.split('-').map(Number);
  return weekOf(keyOf(new Date(y, m - 1, d - 7)));
}

// Sentry counts are stored per UTC day. Sydney's Monday 00:00 falls on Sunday UTC, so a week's errors
// are the 7 UTC days starting the Sunday before.
export function sentryDays(w: Week): string[] {
  const [y, m, d] = w.key.split('-').map(Number);
  return Array.from({ length: 7 }, (_, i) => new Date(Date.UTC(y, m - 1, d - 1 + i)).toISOString().slice(0, 10));
}
