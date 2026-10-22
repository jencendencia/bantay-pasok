import type { AppData, Slot } from '../shared/types';
import { timeToMin, minutesOfDay, studentWindows } from '../shared/constants';
import { isSchoolDay as sharedIsSchoolDay } from '../shared/reportStats';

// The scan engine lives in src/shared/scan.ts so the Electron IPC handler and
// the browser fallback (src/api.ts) run exactly one implementation — re-exported
// here for existing callers (electron/main.ts, scripts/smoke-test.cjs).
export { processScan } from '../shared/scan';

// Kept for compatibility with older imports of this module.
export { minutesOfDay, studentWindows };

// One definition, shared with the scan engine and the reports so a login can
// never be counted on a day the report refuses to list.
export const isSchoolDay = sharedIsSchoolDay;

export function slotsForDate(d: AppData, date: string): Slot[] {
  const dow = new Date(date + 'T00:00:00').getDay();
  return d.slots.filter(s => s.days.includes(dow));
}

export function fmtTime12(ts: number): string {
  const dt = new Date(ts);
  let h = dt.getHours();
  const m = String(dt.getMinutes()).padStart(2, '0');
  const ampm = h >= 12 ? 'PM' : 'AM';
  if (h === 0) h = 12; else if (h > 12) h -= 12;
  return `${h}:${m} ${ampm}`;
}

export type StudentStatus = 'early' | 'on_time' | 'late' | 'absent' | 'left';

export function studentStatusForDate(d: AppData, studentId: string, date: string): {
  status: StudentStatus; arrivalTs?: number; departureTs?: number;
} {
  const evs = d.attendance
    .filter(e => e.studentId === studentId && e.date === date)
    .sort((a, b) => a.ts - b.ts);
  const inEv = evs.find(e => e.kind === 'in');
  const last = evs[evs.length - 1];
  if (!inEv) return { status: 'absent' };
  // A student may come back after leaving; only the LAST event says whether
  // they are still in school now (a morning departure alone does not).
  const outEv = last && last.kind === 'out' ? last : undefined;
  const mins = minutesOfDay(inEv.ts);
  const w = studentWindows(d, studentId);
  const early = timeToMin(w.amIn);
  const late = timeToMin(w.pmIn);
  const arrived: 'early' | 'on_time' | 'late' = mins < early ? 'early' : mins <= late ? 'on_time' : 'late';
  return { status: outEv ? 'left' : arrived, arrivalTs: inEv.ts, departureTs: outEv?.ts };
}

export type SlotAttStatus = 'in' | 'late' | 'no_scan' | 'excused';

export function slotAttendance(d: AppData, slot: Slot, date: string): {
  status: SlotAttStatus; ts?: number; reason?: string; minutesLate?: number;
} {
  const ev = d.classEvents.find(e => e.slotId === slot.id && e.date === date);
  const st = d.slotStatuses.find(s => s.id === `${slot.id}|${date}`);
  const startMin = timeToMin(slot.start);
  if (ev) {
    const mLate = minutesOfDay(ev.ts) - startMin;
    if (mLate > d.settings.graceMinutes) {
      return { status: 'late', ts: ev.ts, minutesLate: mLate };
    }
    return { status: 'in', ts: ev.ts };
  }
  if (st && st.reason) return { status: 'excused', reason: st.reason, ts: undefined };
  return { status: 'no_scan' };
}

export { isSchoolDay as isSchoolDayCheck };
