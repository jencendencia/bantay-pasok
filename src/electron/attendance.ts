import type { AppData, Slot } from '../shared/types';
import { timeToMin, minutesOfDay, studentWindows } from '../shared/constants';

// The scan engine lives in src/shared/scan.ts so the Electron IPC handler and
// the browser fallback (src/api.ts) run exactly one implementation — re-exported
// here for existing callers (electron/main.ts, scripts/smoke-test.cjs).
export { processScan } from '../shared/scan';

// Kept for compatibility with older imports of this module.
export { minutesOfDay, studentWindows };

export function isSchoolDay(d: AppData, date: string): boolean {
  if (d.holiday.date === date || d.settings.holidayDates.includes(date)) return false;
  const dow = new Date(date + 'T00:00:00').getDay();
  return dow >= 1 && dow <= 5;
}

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
  const evs = d.attendance.filter(e => e.studentId === studentId && e.date === date);
  const inEv = evs.filter(e => e.kind === 'in').sort((a, b) => a.ts - b.ts)[0];
  const outEv = evs.filter(e => e.kind === 'out').sort((a, b) => b.ts - a.ts)[0];
  if (!inEv) return { status: 'absent' };
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
