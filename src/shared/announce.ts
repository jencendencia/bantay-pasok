import type { Announcement } from './types';

/** Enabled announcements whose from/until window includes `today` (YYYY-MM-DD). */
export function visibleAnnouncements(all: Announcement[], today: string): Announcement[] {
  return all.filter(a => {
    if (!a.enabled) return false;
    if (a.from && a.from > today) return false;
    if (a.to && a.to < today) return false;
    return true;
  });
}

/**
 * Picks the announcement of one type that should be on screen at `nowMs`.
 * Each type's slot rotates independently through its items, synced to the
 * wall clock so the admin preview and the scanner display agree.
 */
export function pickRotating<T extends Announcement>(items: T[], rotateSeconds: number, nowMs: number): T | null {
  if (items.length === 0) return null;
  const slot = Math.floor(nowMs / (Math.max(3, rotateSeconds) * 1000));
  return items[slot % items.length] ?? null;
}
