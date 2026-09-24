import type { AppData, ScanResult, Slot, Student, Teacher } from '../shared/types';
import { timeToMin, fmt12 } from '../shared/constants';
import { todayStr } from './timeutil';

export function isSchoolDay(d: AppData, date: string): boolean {
  if (d.holiday.date === date || d.settings.holidayDates.includes(date)) return false;
  const dow = new Date(date + 'T00:00:00').getDay();
  return dow >= 1 && dow <= 5;
}

export function slotsForDate(d: AppData, date: string): Slot[] {
  const dow = new Date(date + 'T00:00:00').getDay();
  return d.slots.filter(s => s.days.includes(dow));
}

export function minutesOfDay(ts: number): number {
  const dt = new Date(ts);
  return dt.getHours() * 60 + dt.getMinutes();
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
  const early = timeToMin(d.settings.earlyCutoff);
  const late = timeToMin(d.settings.lateAfter);
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

let scanSeq = 0;
function nextId(prefix: string): string {
  scanSeq += 1;
  return `${prefix}_${Date.now().toString(36)}_${scanSeq.toString(36)}`;
}

function findTeacherByQr(d: AppData, code: string): Teacher | undefined {
  return d.teachers.find(t => t.qr.toUpperCase() === code);
}

function findStudentByQr(d: AppData, code: string): Student | undefined {
  return d.students.find(s => s.qr.toUpperCase() === code);
}

function personName(p: Teacher | Student): string {
  return `${p.firstName} ${p.lastName}`;
}

/** Handles a QR scan. Returns display message plus side effects (records, SMS).
 *  nowMs overrides the clock (used by tests and seed demos). */
export function processScan(d: AppData, raw: string, nowMs?: number): ScanResult {
  const now = nowMs ?? Date.now();
  const date = todayStr(new Date(now));
  const code = raw.trim().toUpperCase();

  const teacher = findTeacherByQr(d, code);
  const student = findStudentByQr(d, code);

  if (!teacher && !student) {
    return { ok: false, kind: 'unknown', message: 'ID not recognized. Please see the admin.' };
  }

  // Duplicate suppression: same person within 60 seconds
  const pid = teacher ? teacher.id : (student as Student).id;
  const recent = d.scans.find(s => s.personId === pid && now - s.ts < 60_000);
  if (recent) {
    const p = (teacher || student) as Teacher | Student;
    return { ok: false, kind: 'duplicate', message: `Already scanned, ${p.firstName}. Please wait a moment.` };
  }
  d.scans.push({ id: nextId('scan'), personId: pid, role: teacher ? 'teacher' : 'student', ts: now, kind: 'in' });

  if (teacher) return teacherScan(d, teacher, now, date);
  return studentScan(d, student as Student, now, date);
}

function teacherScan(d: AppData, teacher: Teacher, now: number, date: string): ScanResult {
  const dow = new Date(date + 'T00:00:00').getDay();
  const nowMin = minutesOfDay(now);
  const candidates = d.slots.filter(s => s.teacherId === teacher.id && s.days.includes(dow));
  const dep = d.departments.find(x => x.id === teacher.departmentId);
  let best: Slot | null = null;
  let bestScore = Infinity;
  for (const s of candidates) {
    const start = timeToMin(s.start);
    const delta = nowMin - start;
    // Prefer a slot currently in progress or just about to start
    if (delta >= -15 && delta <= 50 && Math.abs(delta) < Math.abs(bestScore)) {
      best = s;
      bestScore = delta;
    }
  }
  if (!best) {
    // Scan outside any nearby class period: log arrival only.
    return {
      ok: true, kind: 'teacher', personId: teacher.id, name: personName(teacher),
      message: `Welcome, Ma'am/Sir ${personName(teacher)}. Have a great class!`,
      statusCategory: 'teacher',
      qr: teacher.qr,
      subDetail: dep ? `${dep.name} Department` : 'Faculty',
      detail: 'Checked in to school'
    };
  }
  // First scan for this slot wins; later scans within the slot are ignored as duplicates anyway.
  d.classEvents.push({ id: nextId('cev'), slotId: best.id, teacherId: teacher.id, date, ts: now });
  const sec = d.sections.find(x => x.id === best!.sectionId);
  const allSecSlots = d.slots.filter(s => s.sectionId === best!.sectionId).sort((a, b) => a.start.localeCompare(b.start));
  const pNum = allSecSlots.findIndex(s => s.id === best!.id) + 1;
  return {
    ok: true, kind: 'teacher', personId: teacher.id, name: personName(teacher),
    message: `Welcome, Ma'am/Sir ${personName(teacher)}. Have a great class!`,
    statusCategory: 'teacher',
    qr: teacher.qr,
    subDetail: dep ? `${dep.name} Department` : 'Faculty',
    detail: `Period ${pNum || 1} · ${sec ? sec.name.split(' - ')[0] : ''} · ${best.subject} · ${fmt12(best.start)}`
  };
}

function studentScan(d: AppData, student: Student, now: number, date: string): ScanResult {
  const evs = d.attendance.filter(e => e.studentId === student.id && e.date === date);
  const hasIn = evs.some(e => e.kind === 'in');
  const hasOut = evs.some(e => e.kind === 'out');
  const sec = d.sections.find(x => x.id === student.sectionId);
  const secName = sec ? sec.name.replace(' - ', ' • ') : 'Student';

  if (!hasIn) {
    d.attendance.push({ id: nextId('att'), studentId: student.id, date, ts: now, kind: 'in' });
    const mins = minutesOfDay(now);
    const early = timeToMin(d.settings.earlyCutoff);
    const late = timeToMin(d.settings.lateAfter);
    let msg: string;
    let cat: 'early' | 'on_time' | 'late';
    if (mins < early) {
      msg = 'Swiped in!\nHave an amazing day.';
      cat = 'early';
    } else if (mins <= late) {
      msg = 'Perfectly on time!\nHave an amazing day.';
      cat = 'on_time';
    } else {
      msg = 'Just-in-time.\nHave an amazing day.';
      cat = 'late';
    }
    return {
      ok: true, kind: 'student_in', personId: student.id, name: personName(student),
      message: msg,
      statusCategory: cat,
      qr: student.qr,
      subDetail: secName,
      detail: 'Your parent has been notified by text message'
    };
  }

  if (!hasOut) {
    d.attendance.push({ id: nextId('att'), studentId: student.id, date, ts: now, kind: 'out' });
    return {
      ok: true, kind: 'student_out', personId: student.id, name: personName(student),
      message: 'See you tomorrow!\nTravel safe.',
      statusCategory: 'departure',
      qr: student.qr,
      subDetail: secName,
      detail: 'Your parent has been notified that you left school'
    };
  }

  return {
    ok: false,
    kind: 'duplicate',
    personId: student.id,
    name: personName(student),
    message: `Done for today, ${student.firstName}. See you tomorrow!`,
    statusCategory: 'error',
    qr: student.qr,
    subDetail: secName
  };
}

export { isSchoolDay as isSchoolDayCheck };
