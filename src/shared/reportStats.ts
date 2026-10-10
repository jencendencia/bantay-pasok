// Single owner of the reporting rules: what counts as present/late/absent for a
// scheduled class, and how a date range becomes school days. Used by the Excel
// generator (electron/reports.ts) and the Reports page preview (pages/Reports.tsx)
// so the preview and the file can never disagree, and so the late-rule lives in
// exactly one place.
import type { AppData, Slot } from './types';
import { timeToMin, todayStr } from './constants';

export type SlotMark = 'P' | 'L' | 'A' | 'OL' | 'M';

/** Mark for one scheduled class occurrence (grace period from settings). */
export function markFor(d: AppData, slotId: string, date: string, slotStartMin: number): SlotMark {
  const e = d.classEvents.find(x => x.slotId === slotId && x.date === date);
  if (e) {
    const dt = new Date(e.ts);
    const mins = dt.getHours() * 60 + dt.getMinutes();
    return mins - slotStartMin > d.settings.graceMinutes ? 'L' : 'P';
  }
  const st = d.slotStatuses.find(s => s.id === `${slotId}|${date}`);
  if (st) {
    if (st.reason === 'on_leave') return 'OL';
    if (st.reason === 'in_meeting') return 'M';
    return 'A';
  }
  return 'A';
}

/**
 * Weekday school days in [from, to], using local calendar dates — the same
 * clock the app stores records with (todayStr). Never toISOString(): that
 * shifts the grid back a day in UTC+8 and silently drops the range's last day.
 */
export function schoolDaysBetween(d: AppData, from: string, to: string): string[] {
  const out: string[] = [];
  const cur = new Date(from + 'T00:00:00');
  const end = new Date(to + 'T00:00:00');
  while (cur <= end) {
    const iso = todayStr(cur);
    const dow = cur.getDay();
    if (dow >= 1 && dow <= 5 && !d.settings.holidayDates.includes(iso) && d.holiday.date !== iso) out.push(iso);
    cur.setDate(cur.getDate() + 1);
  }
  return out;
}

/** Monday-of-week key for grouping, on local dates. */
export function weekKey(dt: string): string {
  const d0 = new Date(dt + 'T00:00:00');
  d0.setDate(d0.getDate() - ((d0.getDay() + 6) % 7));
  return `Week of ${todayStr(d0)}`;
}

export interface Occurrence {
  date: string;
  slot: Slot;
  mark: SlotMark;
}

/**
 * Every scheduled class in [from, to] for one teacher (or all teachers when
 * teacherId is omitted), in chronological order, each with its mark.
 */
export function teacherOccurrences(d: AppData, from: string, to: string, teacherId?: string): Occurrence[] {
  const days = schoolDaysBetween(d, from, to);
  const slots = d.slots.filter(s => (!teacherId || s.teacherId === teacherId) && s.days.some(x => x >= 1 && x <= 5));
  const out: Occurrence[] = [];
  for (const date of days) {
    const dow = new Date(date + 'T00:00:00').getDay();
    for (const s of slots) {
      if (!s.days.includes(dow)) continue;
      out.push({ date, slot: s, mark: markFor(d, s.id, date, timeToMin(s.start)) });
    }
  }
  return out;
}

export interface MarkCounts {
  scheduled: number;
  attended: number; // P + L
  late: number;
  absent: number;
  excused: number;  // OL + M
}

export function countMarks(occs: Occurrence[]): MarkCounts {
  const c: MarkCounts = { scheduled: 0, attended: 0, late: 0, absent: 0, excused: 0 };
  for (const o of occs) {
    c.scheduled++;
    if (o.mark === 'P' || o.mark === 'L') c.attended++;
    if (o.mark === 'L') c.late++;
    if (o.mark === 'A') c.absent++;
    if (o.mark === 'OL' || o.mark === 'M') c.excused++;
  }
  return c;
}

/** Group occurrences by an arbitrary key, preserving first-seen order. */
export function bucketByKey(occs: Occurrence[], key: (o: Occurrence) => string): Map<string, MarkCounts> {
  const m = new Map<string, MarkCounts>();
  for (const o of occs) {
    const k = key(o);
    const c = m.get(k) ?? { scheduled: 0, attended: 0, late: 0, absent: 0, excused: 0 };
    if (o.mark === 'P' || o.mark === 'L') c.attended++;
    if (o.mark === 'L') c.late++;
    if (o.mark === 'A') c.absent++;
    if (o.mark === 'OL' || o.mark === 'M') c.excused++;
    c.scheduled++;
    m.set(k, c);
  }
  return m;
}

/**
 * Collapse the marks of one teacher-day into a single summary cell. A day with
 * several classes must not hide an absence behind the last slot scanned, so
 * the worst status wins: A > L > M > OL > P.
 */
export function dayMark(marks: string[]): string {
  if (marks.includes('A')) return 'A';
  if (marks.includes('L')) return 'L';
  if (marks.includes('M')) return 'M';
  if (marks.includes('OL')) return 'OL';
  if (marks.includes('P')) return 'P';
  return '';
}
