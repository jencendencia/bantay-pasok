// The scan engine — ONE implementation for every surface that accepts a scan:
//   - Electron: src/electron/main.ts IPC 'scan' → processScan (records persist to data.json / SQLite)
//   - Browser:  src/api.ts browser fallback      → processScan (records persist to localStorage)
// Keep this module free of Node and DOM APIs so both runtimes can import it.
// Classification, duplicate gating, attendance/class-event records, and result
// assembly must never be re-implemented in a caller — that is what let the two
// copies drift apart (e.g. the browser copy stopped recording class events).
import type { AppData, ScanResult, Slot, Student, Teacher } from './types';
import { timeToMin, fmt12, teacherHonorific, minutesOfDay, studentWindows, todayStr } from './constants';

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
  const recent = d.scans.find(s => s.personId === pid && now - s.ts < 60_000);
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
      statusCategory: teacher ? 'teacher' : 'error',
      qr: p.qr,
      subDetail: dupDep ? `${dupDep.name} Department` : dupSec ? dupSec.name.replace(' - ', ' • ') : teacher ? 'Faculty' : 'Student',
      photoData: p.photoData,
      sex: p.sex
    };
  }
  d.scans.push({ id: nextId('scan'), personId: pid, role: teacher ? 'teacher' : 'student', ts: now, kind: 'in' });

  if (teacher) return teacherScan(d, teacher, now, date);
  return studentScan(d, student as Student, now, date);
}

/** Which kind of scan this is for a student who already checked in: departure or duplicate. */
function nextStudentScanKind(d: AppData, student: Student, now: number, date: string): 'out' | 'duplicate' {
  const evs = d.attendance.filter(e => e.studentId === student.id && e.date === date);
  const hasOut = evs.some(e => e.kind === 'out');
  if (hasOut) return 'duplicate';
  // Departure only counts inside the grade's AM-out or PM-out windows.
  const w = studentWindows(d, student.id);
  const nowMin = minutesOfDay(now);
  const amOut = timeToMin(w.amOut);
  const pmOut = timeToMin(w.pmOut);
  return nowMin >= amOut && nowMin < amOut + 90 ? 'out'
    : nowMin >= pmOut ? 'out'
    : 'duplicate';
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
      ok: true, kind: 'teacher', personId: teacher.id, name: teacher.firstName,
      fullName: personName(teacher),
      message: `Welcome, ${teacherHonorific(teacher.sex)} ${teacher.firstName}. Have a great class!`,
      statusCategory: 'teacher',
      qr: teacher.qr,
      subDetail: dep ? `${dep.name} Department` : 'Faculty',
      detail: 'Checked in to school',
      photoData: teacher.photoData,
      sex: teacher.sex
    };
  }
  // First scan for this slot wins; later scans within the slot are ignored as duplicates anyway.
  d.classEvents.push({ id: nextId('cev'), slotId: best.id, teacherId: teacher.id, date, ts: now });
  const sec = d.sections.find(x => x.id === best!.sectionId);
  const allSecSlots = d.slots.filter(s => s.sectionId === best!.sectionId).sort((a, b) => a.start.localeCompare(b.start));
  const pNum = allSecSlots.findIndex(s => s.id === best!.id) + 1;
  return {
    ok: true, kind: 'teacher', personId: teacher.id, name: teacher.firstName,
    fullName: personName(teacher),
    message: `Welcome, ${teacherHonorific(teacher.sex)} ${teacher.firstName}. Have a great class!`,
    statusCategory: 'teacher',
    qr: teacher.qr,
    subDetail: dep ? `${dep.name} Department` : 'Faculty',
    detail: `Period ${pNum || 1} · ${sec ? sec.name.split(' - ')[0] : ''} · ${best.subject} · ${fmt12(best.start)}`,
    photoData: teacher.photoData,
    sex: teacher.sex
  };
}

function studentScan(d: AppData, student: Student, now: number, date: string): ScanResult {
  const evs = d.attendance.filter(e => e.studentId === student.id && e.date === date);
  const hasIn = evs.some(e => e.kind === 'in');
  const sec = d.sections.find(x => x.id === student.sectionId);
  const secName = sec ? sec.name.replace(' - ', ' • ') : 'Student';

  if (!hasIn) {
    d.attendance.push({ id: nextId('att'), studentId: student.id, date, ts: now, kind: 'in' });
    const mins = minutesOfDay(now);
    // Per-grade windows: Swiped in before AM in, Perfectly on time until PM in,
    // Just-in-time after that.
    const w = studentWindows(d, student.id);
    const early = timeToMin(w.amIn);
    const late = timeToMin(w.pmIn);
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
      ok: true, kind: 'student_in', personId: student.id, name: student.firstName,
      fullName: personName(student),
      message: msg,
      statusCategory: cat,
      qr: student.qr,
      subDetail: secName,
      detail: 'Your parent has been notified by text message',
      photoData: student.photoData,
      sex: student.sex
    };
  }

  if (nextStudentScanKind(d, student, now, date) === 'out') {
    d.attendance.push({ id: nextId('att'), studentId: student.id, date, ts: now, kind: 'out' });
    return {
      ok: true, kind: 'student_out', personId: student.id, name: student.firstName,
      fullName: personName(student),
      message: 'See you tomorrow!\nTravel safe.',
      statusCategory: 'departure',
      qr: student.qr,
      subDetail: secName,
      detail: 'Your parent has been notified that you left school',
      photoData: student.photoData,
      sex: student.sex
    };
  }

  return {
    ok: false,
    kind: 'duplicate',
    personId: student.id,
    name: student.firstName,
    fullName: personName(student),
    message: `Done for today, ${student.firstName}. See you tomorrow!`,
    statusCategory: 'error',
    qr: student.qr,
    subDetail: secName,
    photoData: student.photoData,
    sex: student.sex
  };
}
