// Single owner of the reporting rules: what counts as present/late/absent for a
// scheduled class, and how a date range becomes school days. Used by the Excel
// generator (electron/reports.ts) and the Reports page preview (pages/Reports.tsx)
// so the preview and the file can never disagree, and so the late-rule lives in
// exactly one place.
import type { AppData, Slot } from './types';
import { fmt12, LOGIN_EARLY_MIN, LOGIN_LATE_MIN, minutesOfDay, timeToMin, todayStr } from './constants';

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
 * Whether the school runs on this date. Weekdays count unless declared a
 * holiday; a Saturday/Sunday counts only when classes are actually scheduled
 * that day (make-up classes), so weekend logins are not silently dropped from
 * reports while ordinary weekends stay excluded.
 */
export function isSchoolDay(d: AppData, date: string): boolean {
  if (d.holiday.date === date || d.settings.holidayDates.includes(date)) return false;
  const dow = new Date(date + 'T00:00:00').getDay();
  if (dow >= 1 && dow <= 5) return true;
  return d.slots.some(s => s.days.includes(dow));
}

/**
 * School days in [from, to], using local calendar dates — the same clock the
 * app stores records with (todayStr). Never toISOString(): that shifts the
 * grid back a day in UTC+8 and silently drops the range's last day.
 */
export function schoolDaysBetween(d: AppData, from: string, to: string): string[] {
  const out: string[] = [];
  const cur = new Date(from + 'T00:00:00');
  const end = new Date(to + 'T00:00:00');
  while (cur <= end) {
    const iso = todayStr(cur);
    if (isSchoolDay(d, iso)) out.push(iso);
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
  // No weekday filter here: a Saturday make-up class is a real occurrence once
  // schoolDaysBetween has decided the date counts (see isSchoolDay).
  const slots = d.slots.filter(s => !teacherId || s.teacherId === teacherId);
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

/** "Grade 7 - Rizal · Science · 8:33 AM" for one period, without the class program's name separator. */
export function describeSlot(d: AppData, slot: Slot): string {
  const sec = d.sections.find(x => x.id === slot.sectionId);
  const name = sec ? sec.name.split(' - ')[0] : '';
  return `${name ? `${name} · ` : ''}${slot.subject} · ${fmt12(slot.start)}`;
}

/**
 * Every teacher login in a date range, with what it became. This is the audit
 * the dashboard grid cannot show: the grid is built from class periods, so a
 * login outside a period window — or on a day the teacher had no class — has no
 * cell to appear in. One row per scan, nothing dropped.
 */
export interface TeacherLoginRow {
  scanId: string;
  date: string;
  teacherId: string;
  teacherName: string;
  ts: number;
  kind: 'in' | 'out';
  /** Class the login was recorded for; 'Logged out' / '' when it was not one. */
  matched: string;
}

export function teacherLoginRows(
  d: AppData, from: string, to: string, teacherId?: string
): TeacherLoginRow[] {
  const rows: TeacherLoginRow[] = [];
  for (const sc of d.scans) {
    if (sc.role !== 'teacher') continue;
    if (teacherId && sc.personId !== teacherId) continue;
    const date = todayStr(new Date(sc.ts));
    if (date < from || date > to) continue;
    const t = d.teachers.find(x => x.id === sc.personId);
    if (!t) continue;
    let matched = '';
    if (sc.kind === 'out') {
      matched = 'Logged out';
    } else {
      const ev = d.classEvents.find(e => e.teacherId === t.id && e.date === date && e.ts === sc.ts);
      if (ev) {
        const slot = d.slots.find(s => s.id === ev.slotId);
        matched = slot ? describeSlot(d, slot) : '';
      } else {
        // A repeat login inside a class the teacher is already recorded for (or
        // one attached by hand) still belongs to that class.
        const at = minutesOfDay(sc.ts);
        const dow = new Date(date + 'T00:00:00').getDay();
        const slot = d.slots
          .filter(s => s.teacherId === t.id && s.days.includes(dow))
          .filter(s => d.classEvents.some(e => e.slotId === s.id && e.date === date))
          .filter(s => {
            const delta = at - timeToMin(s.start);
            return delta >= -LOGIN_EARLY_MIN && delta <= LOGIN_LATE_MIN;
          })
          .sort((a, b) => Math.abs(at - timeToMin(a.start)) - Math.abs(at - timeToMin(b.start)))[0];
        matched = slot ? `${describeSlot(d, slot)} · repeat login` : '';
      }
    }
    rows.push({
      scanId: sc.id, date, teacherId: t.id,
      teacherName: `${t.lastName}, ${t.firstName}`, ts: sc.ts, kind: sc.kind, matched
    });
  }
  return rows.sort((a, b) => a.ts - b.ts);
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
