// An incident is 2+ consecutive failed checks. It ends at the first successful check.

export type CheckPoint = { ts: number; ok: boolean };
export type OpenIncident = { id: number; started_at: number };

export type IncidentAction =
  | { type: 'none' }
  | { type: 'open'; started_at: number }
  | { type: 'close'; id: number; ended_at: number; duration_s: number };

/** `recent` holds an app's latest checks, oldest first (the last two are enough). */
export function decideIncident(recent: CheckPoint[], open: OpenIncident | null): IncidentAction {
  const last = recent.at(-1);
  if (!last) return { type: 'none' };

  if (open) {
    if (!last.ok) return { type: 'none' };
    return {
      type: 'close',
      id: open.id,
      ended_at: last.ts,
      duration_s: Math.round((last.ts - open.started_at) / 1000),
    };
  }

  const prev = recent.at(-2);
  if (!last.ok && prev && !prev.ok) return { type: 'open', started_at: prev.ts };
  return { type: 'none' };
}
