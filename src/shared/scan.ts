// The scan engine — ONE implementation for every surface that accepts a scan:
//   - Electron: src/electron/main.ts IPC 'scan' → processScan (records persist to data.json / SQLite)
//   - Browser:  src/api.ts browser fallback      → processScan (records persist to localStorage)
// Keep this module free of Node and DOM APIs so both runtimes can import it.
// Classification, duplicate gating, attendance/class-event records, and result
// assembly must never be re-implemented in a caller — that is what let the two
// copies drift apart (e.g. the browser copy stopped recording class events).
import type { AppData, ScanResult, Slot, Student, Teacher } from './types';
import {
  fmt12, LOGIN_EARLY_MIN, LOGIN_LATE_MIN, minutesOfDay, SCAN_DUPLICATE_MS,
  studentWindows, TEACHER_DEPART_AFTER_MS, teacherHonorific, timeToMin, todayStr
} from './constants';
import { isSchoolDay } from './reportStats';

// Re-exported for callers that imported the window bounds from here.
export { LOGIN_EARLY_MIN, LOGIN_LATE_MIN };

let scanSeq = 0;
function nextId(prefix: string): string {
  scanSeq += 1;
  return `${prefix}_${Date.now().toString(36)}_${scanSeq.toString(36)}`;
}

// Match on the printed QR code or the internal record id (handy when an admin
// pastes an id from the admin panel instead of scanning the card).
function findTeacher(d: AppData, code: string): Teacher | undefined {
  return d.teachers.find(t => t.qr.toUpperCase() === code || t.id.toUpperCase() === code);
}

function findStudent(d: AppData, code: string): Student | undefined {
  return d.students.find(s => s.qr.toUpperCase() === code || s.id.toUpperCase() === code);
}

// The scanner screen greets people by FIRST NAME ONLY (school kiosk style);
// surnames stay on the admin side. ScanResult.name follows the same rule;
// fullName feeds the left identity panel, which shows the complete name.
function personName(p: Teacher | Student): string {
  return `${p.firstName} ${p.lastName}`;
}

/** 12-hour clock for a timestamp, e.g. "8:04 AM". */
function clockOf(ts: number): string {
  const dt = new Date(ts);
  return fmt12(`${String(dt.getHours()).padStart(2, '0')}:${String(dt.getMinutes()).padStart(2, '0')}`);
}

function logScan(d: AppData, personId: string, role: 'teacher' | 'student', ts: number, kind: 'in' | 'out'): void {
  d.scans.push({ id: nextId('scan'), personId, role, ts, kind });
}

function sameDay(ts: number, date: string): boolean {
  return todayStr(new Date(ts)) === date;
}

/** Handles a QR scan. Returns display message plus side effects (records, SMS).
 *  nowMs overrides the clock (used by tests and seed demos). */
export function processScan(d: AppData, raw: string, nowMs?: number): ScanResult {
  const now = nowMs ?? Date.now();
  const date = todayStr(new Date(now));
  const code = raw.trim().toUpperCase();

  const teacher = findTeacher(d, code);
  const student = findStudent(d, code);

  if (!teacher && !student) {
    return { ok: false, kind: 'unknown', message: 'ID not recognized. Please see the admin.', statusCategory: 'error' };
  }

  // Duplicate suppression: same person within 60 seconds
  const pid = teacher ? teacher.id : (student as Student).id;
  const recent = d.scans.find(s => s.personId === pid && now - s.ts < SCAN_DUPLICATE_MS);
  if (recent) {
    // Identity fields so the left panel still shows who re-scanned (not "Student / ID VERIFIED").
    const p = (teacher || student) as Teacher | Student;
    const dupDep = teacher ? d.departments.find(x => x.id === teacher.departmentId) : undefined;
    const dupSec = !teacher ? d.sections.find(x => x.id === (student as Student).sectionId) : undefined;
    return {
      ok: false,
      kind: 'duplicate',
      personId: p.id,
      name: p.firstName,
      fullName: personName(p),
      message: `Already scanned, ${p.firstName}. Please wait a moment.`,
      label: teacher ? 'Login' : undefined,
      statusCategory: teacher ? 'teacher' : 'error',
      qr: p.qr,
      subDetail: dupDep ? `${dupDep.name} Department` : dupSec ? dupSec.name.replace(' - ', ' • ') : teacher ? 'Faculty' : 'Student',
      photoData: p.photoData,
      sex: p.sex
    };
  }

  if (teacher) return teacherScan(d, teacher, now, date);
  return studentScan(d, student as Student, now, date);
}

const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** The next class this section still has today after nowMin, as "1:00 PM". */
function nextClassStart(d: AppData, student: Student, date: string, afterMin: number): string | null {
  const dow = new Date(date + 'T00:00:00').getDay();
  const next = d.slots
    .filter(s => s.sectionId === student.sectionId && s.days.includes(dow) && timeToMin(s.start) > afterMin)
    .sort((a, b) => timeToMin(a.start) - timeToMin(b.start))[0];
  return next ? fmt12(next.start) : null;
}

/**
 * The next day the school actually runs, skipping weekends and declared
 * holidays. Used so a goodbye never promises "tomorrow" on a Friday.
 */
function nextSchoolDay(d: AppData, date: string): { date: string; gap: number } | null {
  const base = new Date(date + 'T00:00:00');
  for (let i = 1; i <= 14; i++) {
    const nx = new Date(base);
    nx.setDate(nx.getDate() + i);
    const iso = todayStr(nx);
    if (isSchoolDay(d, iso)) return { date: iso, gap: i };
  }
  return null;
}

/** Sign-off that matches what comes next: tomorrow, Monday, or after a break. */
function goodbyeLine(d: AppData, date: string): string {
  const nx = nextSchoolDay(d, date);
  if (!nx) return 'See you soon!\nTravel safe.';
  if (nx.gap === 1) return 'See you tomorrow!\nTravel safe.';
  const dayName = WEEKDAY_NAMES[new Date(nx.date + 'T00:00:00').getDay()];
  const today = new Date(date + 'T00:00:00').getDay();
  // Friday → Monday is a weekend, not a mysterious two-day absence.
  if (today === 5 && dayName === 'Monday') return 'Have a great weekend!\nTravel safe.';
  return `See you on ${dayName}!\nTravel safe.`;
}

/** Whether a scan by a student who is already in school is a time-out right now. */
function departureDue(d: AppData, student: Student, nowMin: number): boolean {
  // Two windows only: the lunch break (AM time-out until afternoon classes
  // start) and the end of the day (PM time-out onwards). The lunch window used
  // to run amOut + 90 and swallow the first half hour of the afternoon, so a
  // 1:10 PM scan by a student who never scanned out at noon was recorded as a
  // departure — an out row plus a "left school" text to the parent for someone
  // arriving for class.
  const w = studentWindows(d, student.id);
  const amOut = timeToMin(w.amOut);
  const pmIn = timeToMin(w.pmIn);
  const pmOut = timeToMin(w.pmOut);
  // A section whose PM time-in is not after its AM time-out keeps a 90-minute
  // lunch window rather than an empty one.
  const lunchEnd = pmIn > amOut ? pmIn : amOut + 90;
  return (nowMin >= amOut && nowMin < lunchEnd) || nowMin >= pmOut;
}

function teacherScan(d: AppData, teacher: Teacher, now: number, date: string): ScanResult {
  const dow = new Date(date + 'T00:00:00').getDay();
  const nowMin = minutesOfDay(now);
  const dep = d.departments.find(x => x.id === teacher.departmentId);
  const base = {
    personId: teacher.id,
    name: teacher.firstName,
    fullName: personName(teacher),
    qr: teacher.qr,
    subDetail: dep ? `${dep.name} Department` : 'Faculty',
    photoData: teacher.photoData,
    sex: teacher.sex
  };
  const candidates = d.slots.filter(s => s.teacherId === teacher.id && s.days.includes(dow));

  // Holiday / weekend without classes: the login is kept for the audit, but it
  // must not invent a class attendance for a day the school did not run.
  if (!isSchoolDay(d, date)) {
    logScan(d, teacher.id, 'teacher', now, 'in');
    return {
      ...base, ok: true, kind: 'teacher', statusCategory: 'teacher', label: 'Login',
      message: `No classes today, ${teacherHonorific(teacher.sex)} ${teacher.firstName}.`,
      detail: `Logged in at ${clockOf(now)} · holiday, no class counted`
    };
  }

  // 1. A class period this login falls into.
  let best: Slot | null = null;
  let bestDelta = Infinity;
  for (const s of candidates) {
    const delta = nowMin - timeToMin(s.start);
    if (delta >= -LOGIN_EARLY_MIN && delta <= LOGIN_LATE_MIN && Math.abs(delta) < Math.abs(bestDelta)) {
      best = s;
      bestDelta = delta;
    }
  }

  if (best) {
    const chosen = best;
    // First scan for this slot wins: a second login during the same class must
    // not create another entry or move the arrival time forward.
    const recorded = d.classEvents.find(e => e.slotId === chosen.id && e.date === date);
    if (!recorded) {
      d.classEvents.push({ id: nextId('cev'), slotId: chosen.id, teacherId: teacher.id, date, ts: now });
    }
    logScan(d, teacher.id, 'teacher', now, 'in');
    const sec = d.sections.find(x => x.id === chosen.sectionId);
    const secName = sec ? sec.name.split(' - ')[0] : '';
    const allSecSlots = d.slots
      .filter(s => s.sectionId === chosen.sectionId)
      .sort((a, b) => a.start.localeCompare(b.start));
    const pNum = allSecSlots.findIndex(s => s.id === chosen.id) + 1;
    return {
      ...base, ok: true, kind: 'teacher', statusCategory: 'teacher', label: 'Now teaching',
      message: `Welcome, ${teacherHonorific(teacher.sex)} ${teacher.firstName}. Have a great class!`,
      detail: recorded
        ? `Already recorded for ${secName} ${chosen.subject} at ${clockOf(recorded.ts)}`
        : `Period ${pNum || 1} · ${secName} · ${chosen.subject} · ${fmt12(chosen.start)}`
    };
  }

  // 2. No class right now: this login is an arrival, a departure, or a repeat.
  const todays = d.scans
    .filter(s => s.role === 'teacher' && s.personId === teacher.id && sameDay(s.ts, date))
    .sort((a, b) => a.ts - b.ts);
  const last = todays[todays.length - 1];
  const lastSlot = [...candidates].sort((a, b) => timeToMin(a.start) - timeToMin(b.start))[candidates.length - 1];
  // Only log a departure once the day's teaching is over, so a scan during a
  // free period cannot check the teacher out while a class is still coming.
  const dayFinished = !lastSlot || nowMin >= timeToMin(lastSlot.end);

  if (last && last.kind === 'in' && dayFinished && now - last.ts >= TEACHER_DEPART_AFTER_MS) {
    logScan(d, teacher.id, 'teacher', now, 'out');
    return {
      ...base, ok: true, kind: 'teacher_out', statusCategory: 'departure', label: 'Logged out',
      message: `Goodbye, ${teacherHonorific(teacher.sex)} ${teacher.firstName}. Travel safe.`,
      detail: `Logged out at ${clockOf(now)} · came in ${clockOf(last.ts)}`
    };
  }

  if (last && last.kind === 'in') {
    // Same arrival, scanned again: say so plainly instead of implying a new record.
    return {
      ...base, ok: false, kind: 'duplicate', statusCategory: 'teacher', label: 'Login',
      message: `You are already logged in, ${teacherHonorific(teacher.sex)} ${teacher.firstName}.`,
      detail: `Logged in at ${clockOf(last.ts)}`
    };
  }

  logScan(d, teacher.id, 'teacher', now, 'in');
  const returning = !!last && last.kind === 'out';
  const next = candidates
    .filter(s => timeToMin(s.start) > nowMin)
    .sort((a, b) => timeToMin(a.start) - timeToMin(b.start))[0];
  return {
    ...base, ok: true, kind: 'teacher', statusCategory: 'teacher', label: 'Login',
    message: returning
      ? `Welcome back, ${teacherHonorific(teacher.sex)} ${teacher.firstName}.`
      : `Welcome, ${teacherHonorific(teacher.sex)} ${teacher.firstName}. Have a great day!`,
    // The class is only credited from 10 minutes before it starts, so an early
    // login has to say what it is waiting for — otherwise the teacher believes
    // the class was recorded and the grid stays empty.
    detail: next
      ? `Logged in · ${next.subject} at ${fmt12(next.start)} — scan again within ${LOGIN_EARLY_MIN} min of the start to record it`
      : 'Logged in for the day · no class scheduled'
  };
}

function studentScan(d: AppData, student: Student, now: number, date: string): ScanResult {
  const sec = d.sections.find(x => x.id === student.sectionId);
  const secName = sec ? sec.name.replace(' - ', ' • ') : 'Student';
  const base = {
    personId: student.id,
    name: student.firstName,
    fullName: personName(student),
    qr: student.qr,
    subDetail: secName,
    photoData: student.photoData,
    sex: student.sex
  };
  const w = studentWindows(d, student.id);
  const nowMin = minutesOfDay(now);

  // No classes: keep the scan on record, count nothing.
  if (!isSchoolDay(d, date)) {
    logScan(d, student.id, 'student', now, 'in');
    return {
      ...base, ok: false, kind: 'closed', statusCategory: 'error',
      message: `No classes today, ${student.firstName}.`,
      detail: 'Your scan was logged but not counted'
    };
  }

  const evs = d.attendance
    .filter(e => e.studentId === student.id && e.date === date)
    .sort((a, b) => a.ts - b.ts);
  const last = evs[evs.length - 1];
  const inSchool = !!last && last.kind === 'in';

  // A scan after dismissal is not an arrival: recording it as present would let
  // a student who never came to school be counted by scanning at 4 PM. Someone
  // who IS still in school is leaving, which is recorded below.
  if (!inSchool && nowMin > timeToMin(w.pmOut)) {
    logScan(d, student.id, 'student', now, 'in');
    return {
      ...base, ok: false, kind: 'closed', statusCategory: 'error',
      message: `The school day is over, ${student.firstName}.`,
      detail: `Please see the office · dismissal was ${fmt12(w.pmOut)}`
    };
  }

  if (!inSchool) {
    d.attendance.push({ id: nextId('att'), studentId: student.id, date, ts: now, kind: 'in' });
    logScan(d, student.id, 'student', now, 'in');
    // Back after an early departure: the afternoon must be recorded, not lost.
    if (last) {
      return {
        ...base, ok: true, kind: 'student_in', statusCategory: 'on_time',
        message: `Welcome back, ${student.firstName}!`,
        detail: 'Back in school · your parent has been notified'
      };
    }
    // Per-grade windows: Swiped in before AM in, Perfectly on time until PM in,
    // Just-in-time after that.
    const early = timeToMin(w.amIn);
    const late = timeToMin(w.pmIn);
    let msg: string;
    let cat: 'early' | 'on_time' | 'late';
    if (nowMin < early) {
      msg = 'Swiped in!\nHave an amazing day.';
      cat = 'early';
    } else if (nowMin <= late) {
      msg = 'Perfectly on time!\nHave an amazing day.';
      cat = 'on_time';
    } else {
      msg = 'Just-in-time.\nHave an amazing day.';
      cat = 'late';
    }
    return {
      ...base, ok: true, kind: 'student_in', statusCategory: cat, message: msg,
      detail: 'Your parent has been notified by text message'
    };
  }

  // Still in school (their last record is an arrival): only a time-out window
  // makes this scan a departure. After the PM time-in it never does — they are
  // back for the afternoon or simply scanned twice, and the day's record must
  // stay "in school" either way.
  if (departureDue(d, student, nowMin)) {
    d.attendance.push({ id: nextId('att'), studentId: student.id, date, ts: now, kind: 'out' });
    logScan(d, student.id, 'student', now, 'out');
    // Two time-outs are not the end of the day: the noon time-out is a lunch
    // break (they come back at 1 PM), and a Friday time-out ends the week. Both
    // used to say "See you tomorrow", which was wrong in opposite directions.
    const back = nextClassStart(d, student, date, nowMin);
    if (back) {
      return {
        ...base, ok: true, kind: 'student_out', statusCategory: 'departure',
        message: 'Lunch break!\nSee you after lunch.',
        detail: `Your parent has been notified · back for ${back}`
      };
    }
    return {
      ...base, ok: true, kind: 'student_out', statusCategory: 'departure',
      message: goodbyeLine(d, date),
      detail: 'Your parent has been notified that you left school'
    };
  }

  logScan(d, student.id, 'student', now, 'in');
  // Not an error: the student is simply in school and the next time-out has not
  // opened yet, so the pane shows the normal arrival colours.
  return {
    ...base, ok: false, kind: 'duplicate', statusCategory: 'on_time',
    message: `You're already checked in, ${student.firstName}.`,
    detail: `Time-out opens at ${fmt12(w.pmOut)}`
  };
}
