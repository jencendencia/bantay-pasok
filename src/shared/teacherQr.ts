import type { Teacher } from './types';

/**
 * Teacher QR codes (`T-0031`, `T-0032`, …).
 *
 * The pre-1.0.16 generator was `T-${teachers.length + 31}` — a *count*, not a
 * free number — so deleting any teacher made the next enrolment reissue a
 * code that was already taken (it happened twice in real data: T-0041 and
 * T-0065 each ended up on two people, and scanning always resolved to the
 * first holder). These helpers are the single source of truth used by the
 * enrolment form and by the startup repair in the store.
 */

/** First unused T-#### code, starting just past the highest number ever used
 *  so a deleted teacher's code is never recycled onto a new person. */
export function nextTeacherQr(teachers: ReadonlyArray<Pick<Teacher, 'qr'>>): string {
  const used = new Set(teachers.map(t => (t.qr || '').trim().toUpperCase()));
  let n = 31; // the seed teachers start at T-0031
  for (const t of teachers) {
    const m = /^T-0*(\d+)$/.exec((t.qr || '').trim());
    if (m) n = Math.max(n, Number(m[1]) + 1);
  }
  let candidate = `T-${String(n).padStart(4, '0')}`;
  while (used.has(candidate.toUpperCase())) {
    n += 1;
    candidate = `T-${String(n).padStart(4, '0')}`;
  }
  return candidate;
}

/**
 * Keeps the first holder of each code and reassigns later duplicates to fresh
 * free codes. Returns true when anything changed.
 */
export function dedupeTeacherQr(teachers: Array<Pick<Teacher, 'qr'>>): boolean {
  const seen = new Set<string>();
  let changed = false;
  for (const t of teachers) {
    const key = (t.qr || '').trim().toUpperCase();
    if (!key) continue;
    if (seen.has(key)) {
      t.qr = nextTeacherQr(teachers);
      seen.add(t.qr.toUpperCase());
      changed = true;
    } else {
      seen.add(key);
    }
  }
  return changed;
}
