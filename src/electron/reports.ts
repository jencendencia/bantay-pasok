import ExcelJS from 'exceljs';
import type { AppData, ReportParams } from '../shared/types';
import { timeToMin } from '../shared/constants';
import {
  bucketByKey, countMarks, dayMark, schoolDaysBetween, teacherOccurrences, weekKey
} from '../shared/reportStats';
import type { MarkCounts } from '../shared/reportStats';

const GREEN = 'FF0E3A2F';
const YELLOW = 'FFF7E08A';
const SOFT = 'FFEAF3EE';
const RED = 'FFF6CBC4';
const ORANGE = 'FFF8D8B0';
const PURPLE = 'FFE3DBF5';

type CellVal = string | number;

function titleBlock(ws: ExcelJS.Worksheet, title: string, subtitle: string, cols: number): void {
  ws.mergeCells(1, 1, 1, cols);
  ws.getCell(1, 1).value = title;
  ws.getCell(1, 1).font = { bold: true, size: 14, color: { argb: 'FF1F2A24' } };
  ws.mergeCells(2, 1, 2, cols);
  ws.getCell(2, 1).value = subtitle;
  ws.getCell(2, 1).font = { size: 10, color: { argb: 'FF5E6E66' } };
}

function headerRow(ws: ExcelJS.Worksheet, row: number, headers: string[]): void {
  headers.forEach((h, i) => {
    const c = ws.getCell(row, i + 1);
    c.value = h;
    c.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: GREEN } };
    c.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
  });
  ws.getRow(row).height = 24;
}

function statusFill(status: string): string | null {
  if (status === 'P') return SOFT;
  if (status === 'L') return ORANGE;
  if (status === 'A') return RED;
  if (status === 'OL' || status === 'M') return PURPLE;
  return null;
}

/** Paint a mark cell. Must run AFTER the row's values are set: assigning row.values resets cell style. */
function fillMark(ws: ExcelJS.Worksheet, row: number, col: number, mark: string): void {
  const fill = statusFill(mark);
  if (!fill) return;
  const cell = ws.getCell(row, col);
  cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fill } };
  cell.alignment = { horizontal: 'center' };
}

export async function buildReport(d: AppData, p: ReportParams): Promise<{ buffer: Buffer; filename: string }> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Swiped Perfectly Just-in-time';
  wb.created = new Date();

  // Weekday, non-holiday, local-calendar school days in range.
  const schoolDays = schoolDaysBetween(d, p.from, p.to);

  if (p.type === 'teacher') {
    return teacherAttendanceWorkbook(d, wb, schoolDays, p);
  }
  if (p.type === 'teacher_individual') {
    return teacherIndividualWorkbook(d, wb, p);
  }
  if (p.type === 'student') {
    return studentAttendanceWorkbook(d, wb, schoolDays, p);
  }
  return studentPunctualityWorkbook(d, wb, schoolDays, p);
}

async function teacherAttendanceWorkbook(
  d: AppData, wb: ExcelJS.Workbook, days: string[], p: ReportParams
): Promise<{ buffer: Buffer; filename: string }> {
  const ws = wb.addWorksheet('Summary');
  const occs = teacherOccurrences(d, p.from, p.to)
    .filter(o => !p.sectionId || o.slot.sectionId === p.sectionId);
  const totals = bucketByKey(occs, o => o.slot.teacherId);
  // teacherId -> date -> marks of that day (one cell per teacher-day)
  const marksByTD = new Map<string, Map<string, string[]>>();
  for (const o of occs) {
    let perDate = marksByTD.get(o.slot.teacherId);
    if (!perDate) { perDate = new Map(); marksByTD.set(o.slot.teacherId, perDate); }
    const arr = perDate.get(o.date) ?? [];
    arr.push(o.mark);
    perDate.set(o.date, arr);
  }

  titleBlock(ws, `${d.settings.schoolName} · Teacher class attendance`,
    `${p.from} to ${p.to} · Late = scan more than ${d.settings.graceMinutes} minutes after the scheduled start · Excused leave is not counted absent`,
    2 + days.length + 4);
  headerRow(ws, 4, ['Teacher', 'Department', ...days, 'Scheduled', 'Attended', 'Late', 'Absent']);

  let r = 5;
  const teachers = [...d.teachers].sort((a, b) => a.lastName.localeCompare(b.lastName));
  for (const t of teachers) {
    const c = totals.get(t.id) ?? { scheduled: 0, attended: 0, late: 0, absent: 0, excused: 0 };
    const dep = d.departments.find(x => x.id === t.departmentId);
    const rowVals: CellVal[] = [`${t.lastName}, ${t.firstName}`, dep ? dep.name : ''];
    const perDate = marksByTD.get(t.id);
    const dayMarks = days.map(dt => dayMark(perDate?.get(dt) ?? []));
    rowVals.push(...dayMarks, c.scheduled, c.attended, c.late, c.absent);
    ws.getRow(r).values = rowVals;
    dayMarks.forEach((mk, i) => fillMark(ws, r, 3 + i, mk));
    r++;
  }
  const note = ws.getRow(r).getCell(3);
  note.value = '* Excused leave (OL/M) is excluded from the attendance rate.';
  note.font = { italic: true, size: 9, color: { argb: 'FF5E6E66' } };

  ws.columns.forEach(c => { c.width = 14; });
  ws.getColumn(1).width = 24;
  ws.getColumn(2).width = 18;

  // Daily log sheet
  const log = wb.addWorksheet('Daily log');
  titleBlock(log, 'Daily log', 'Every class meeting: date, section, subject, scheduled time, time in, minutes late, reason', 8);
  headerRow(log, 4, ['Date', 'Teacher', 'Section', 'Subject', 'Scheduled', 'Time in', 'Minutes late', 'Reason']);
  for (const o of occs) {
    const s = o.slot;
    const t = d.teachers.find(x => x.id === s.teacherId);
    const sec = d.sections.find(x => x.id === s.sectionId);
    const ev = d.classEvents.find(e => e.slotId === s.id && e.date === o.date);
    const st = d.slotStatuses.find(x => x.id === `${s.id}|${o.date}`);
    log.addRow([o.date, t ? `${t.lastName}, ${t.firstName}` : '', sec ? sec.name : '', s.subject,
      fmt12(s.start), ev ? fmtTime(ev.ts) : '', lateMinutes(ev?.ts, s.start, d.settings.graceMinutes),
      st ? reasonLabel(st.reason) : (ev ? '' : 'No scan')]);
  }
  log.columns.forEach(c => { c.width = 16; });

  // By section sheet
  const bySec = wb.addWorksheet('By section');
  titleBlock(bySec, 'Attendance by section', 'How often each teacher attended each section', 2 + d.sections.length + 2);
  headerRow(bySec, 4, ['Teacher', ...d.sections.map(s => s.name), 'Attended', 'Scheduled']);
  let br = 5;
  for (const t of teachers) {
    const vals: CellVal[] = [`${t.lastName}, ${t.firstName}`];
    let attended = 0, scheduled = 0;
    for (const sec of d.sections) {
      const rows = occs.filter(o => o.slot.teacherId === t.id && o.slot.sectionId === sec.id);
      const a = rows.filter(o => o.mark === 'P' || o.mark === 'L').length;
      vals.push(a);
      attended += a;
      scheduled += rows.length;
    }
    vals.push(attended, scheduled);
    bySec.getRow(br).values = vals;
    br++;
  }
  bySec.columns.forEach(c => { c.width = 18; });

  const buf = await wb.xlsx.writeBuffer();
  return { buffer: Buffer.from(buf), filename: `Attendance_Teachers_${p.from}_${p.to}.xlsx` };
}

async function teacherIndividualWorkbook(
  d: AppData, wb: ExcelJS.Workbook, p: ReportParams
): Promise<{ buffer: Buffer; filename: string }> {
  const teacher = d.teachers.find(t => t.id === p.teacherId);
  if (!teacher) throw new Error('Teacher not found');
  const dep = d.departments.find(x => x.id === teacher.departmentId);
  const occs = teacherOccurrences(d, p.from, p.to, teacher.id);
  const c = countMarks(occs);

  const ws = wb.addWorksheet('Summary');
  titleBlock(ws, `${teacher.firstName} ${teacher.lastName} · Attendance to class`,
    `${dep ? dep.name : ''} · ${p.from} to ${p.to} · Late = scan more than ${d.settings.graceMinutes} min after start`, 8);

  headerRow(ws, 4, ['Metric', 'Value']);
  const addStat = (label: string, v: CellVal) => { ws.addRow([, label, v]); };
  addStat('Classes scheduled', c.scheduled);
  addStat('Attended', c.attended);
  addStat('Late', c.late);
  addStat('Absent (unexcused)', c.absent);
  addStat('Attendance rate', `${c.scheduled ? Math.round((c.attended / c.scheduled) * 100) : 0}%`);
  addStat('Punctuality rate', `${c.attended ? Math.round(((c.attended - c.late) / c.attended) * 100) : 0}%`);

  const freq = wb.addWorksheet('Frequency');
  titleBlock(freq, 'Frequency', 'Attendance to class per week / month / term', 6);
  headerRow(freq, 4, ['Period', 'Scheduled', 'Attended', 'Late', 'Absent', 'Rate']);
  let fr = 5;
  const writeBuckets = (m: Map<string, MarkCounts>): void => {
    for (const [k, v] of m) {
      freq.getCell(fr, 1).value = k;
      fillFreq(freq, fr, v);
      fr++;
    }
  };
  writeBuckets(bucketByKey(occs, o => weekKey(o.date)));
  writeBuckets(bucketByKey(occs, o => o.date.slice(0, 7)));
  writeBuckets(bucketByKey(
    occs.filter(o => d.settings.terms.some(t => o.date >= t.start && o.date <= t.end)),
    o => d.settings.terms.find(t => o.date >= t.start && o.date <= t.end)!.name));
  freq.columns.forEach(c => { c.width = 16; });

  const log = wb.addWorksheet('Daily log');
  titleBlock(log, 'Daily log', 'Every class: date, section, subject, scheduled, time in, minutes late, reason', 8);
  headerRow(log, 4, ['Date', 'Section', 'Subject', 'Scheduled', 'Time in', 'Minutes late', 'Reason', 'Status']);
  for (const o of occs) {
    const s = o.slot;
    const sec = d.sections.find(x => x.id === s.sectionId);
    const ev = d.classEvents.find(e => e.slotId === s.id && e.date === o.date);
    const st = d.slotStatuses.find(x => x.id === `${s.id}|${o.date}`);
    log.addRow([o.date, sec ? sec.name : '', s.subject, fmt12(s.start),
      ev ? fmtTime(ev.ts) : '', lateMinutes(ev?.ts, s.start, d.settings.graceMinutes),
      st ? reasonLabel(st.reason) : (ev ? '' : 'No scan'),
      o.mark === 'OL' ? 'Excused' : o.mark === 'M' ? 'Excused (meeting)' : o.mark]);
  }
  log.columns.forEach(c => { c.width = 16; });

  const buf = await wb.xlsx.writeBuffer();
  const ln = `${teacher.lastName}`.replace(/\s+/g, '');
  return { buffer: Buffer.from(buf), filename: `Attendance_${ln}_${p.from}_${p.to}.xlsx` };
}

async function studentAttendanceWorkbook(
  d: AppData, wb: ExcelJS.Workbook, schoolDays: string[], p: ReportParams
): Promise<{ buffer: Buffer; filename: string }> {
  const ws = wb.addWorksheet('Summary');
  titleBlock(ws, `${d.settings.schoolName} · Student attendance`,
    `${p.from} to ${p.to} · Present = any arrival scan on the day`, 8);
  headerRow(ws, 4, ['Student', 'Section', 'Sex', ...schoolDays.map(dt => dt), 'Present', 'Absent', 'Rate']);

  const sections = p.sectionId ? d.sections.filter(s => s.id === p.sectionId) : d.sections;
  let r = 5;
  for (const sec of sections) {
    const studs = d.students.filter(s => s.sectionId === sec.id)
      .sort((a, b) => a.lastName.localeCompare(b.lastName));
    for (const st of studs) {
      let present = 0, absent = 0;
      const vals: CellVal[] = [`${st.lastName}, ${st.firstName}`, sec.name, st.sex];
      const marks: string[] = [];
      for (const dt of schoolDays) {
        const cameIn = d.attendance.some(e => e.studentId === st.id && e.date === dt && e.kind === 'in');
        marks.push(cameIn ? 'P' : 'A');
        vals.push(cameIn ? 'P' : 'A');
        if (cameIn) present++; else absent++;
      }
      vals.push(present, absent, `${Math.round((present / Math.max(1, schoolDays.length)) * 100)}%`);
      ws.getRow(r).values = vals;
      // Paint after the values: assigning row.values resets cell style.
      marks.forEach((m, di) => {
        const cell = ws.getCell(r, 4 + di);
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: m === 'P' ? SOFT : RED } };
        cell.alignment = { horizontal: 'center' };
      });
      r++;
    }
  }
  ws.columns.forEach(c => { c.width = 12; });
  ws.getColumn(1).width = 26;
  ws.getColumn(2).width = 18;

  const buf = await wb.xlsx.writeBuffer();
  return { buffer: Buffer.from(buf), filename: `Attendance_Students_${p.from}_${p.to}.xlsx` };
}

async function studentPunctualityWorkbook(
  d: AppData, wb: ExcelJS.Workbook, schoolDays: string[], p: ReportParams
): Promise<{ buffer: Buffer; filename: string }> {
  const ws = wb.addWorksheet('Summary');
  titleBlock(ws, `${d.settings.schoolName} · Student punctuality`,
    `${p.from} to ${p.to} · Early before ${d.settings.earlyCutoff} · On time until ${d.settings.lateAfter} · Late after`, 8);
  headerRow(ws, 4, ['Student', 'Section', 'Early', 'On time', 'Late', 'Absent', 'Punctuality rate']);

  const sections = p.sectionId ? d.sections.filter(s => s.id === p.sectionId) : d.sections;
  let r = 5;
  const earlyC = timeToMin(d.settings.earlyCutoff);
  const lateC = timeToMin(d.settings.lateAfter);
  for (const sec of sections) {
    const studs = d.students.filter(s => s.sectionId === sec.id)
      .sort((a, b) => a.lastName.localeCompare(b.lastName));
    for (const st of studs) {
      let early = 0, onTime = 0, late = 0, absent = 0;
      for (const dt of schoolDays) {
        const inEv = d.attendance.find(e => e.studentId === st.id && e.date === dt && e.kind === 'in');
        if (!inEv) { absent++; continue; }
        const mins = minsOf(inEv.ts);
        if (mins < earlyC) early++;
        else if (mins <= lateC) onTime++;
        else late++;
      }
      const total = early + onTime + late + absent;
      const rate = total ? Math.round(((early + onTime) / total) * 100) : 0;
      ws.getRow(r).values = [`${st.lastName}, ${st.firstName}`, sec.name, early, onTime, late, absent, `${rate}%`];
      r++;
    }
  }
  ws.columns.forEach(c => { c.width = 12; });
  ws.getColumn(1).width = 26;
  ws.getColumn(2).width = 18;

  const buf = await wb.xlsx.writeBuffer();
  return { buffer: Buffer.from(buf), filename: `Punctuality_Students_${p.from}_${p.to}.xlsx` };
}

// ---------- helpers ----------

function fillFreq(ws: ExcelJS.Worksheet, r: number, v: MarkCounts): void {
  const rate = v.scheduled ? Math.round((v.attended / v.scheduled) * 100) : 0;
  ws.getCell(r, 2).value = v.scheduled;
  ws.getCell(r, 3).value = v.attended;
  ws.getCell(r, 4).value = v.late;
  ws.getCell(r, 5).value = v.absent;
  ws.getCell(r, 6).value = `${rate}%`;
  const fill = rate >= 95 ? SOFT : rate >= 85 ? YELLOW : RED;
  ws.getCell(r, 6).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fill } };
}

/**
 * "Minutes late" for the daily logs: blank when there is no scan, 0 when the
 * scan was within the grace period, otherwise the minutes after start — the
 * same threshold markFor uses, so the log can never contradict the Summary.
 */
function lateMinutes(ts: number | undefined, start: string, grace: number): number | '' {
  if (!ts) return '';
  const diff = minsOf(ts) - timeToMin(start);
  return diff > grace ? diff : 0;
}

function reasonLabel(reason: string | null | undefined): string {
  if (!reason) return '';
  switch (reason) {
    case 'on_leave': return 'On leave';
    case 'in_meeting': return 'In a meeting';
    case 'unknown': return 'Unknown reason';
    case 'others': return 'Others';
    default: return reason;
  }
}

function fmtTime(ts: number): string {
  const dt = new Date(ts);
  let h = dt.getHours();
  const m = String(dt.getMinutes()).padStart(2, '0');
  const ampm = h >= 12 ? 'PM' : 'AM';
  if (h === 0) h = 12; else if (h > 12) h -= 12;
  return `${h}:${m} ${ampm}`;
}

function minsOf(ts: number): number {
  const dt = new Date(ts);
  return dt.getHours() * 60 + dt.getMinutes();
}

function fmt12(t: string): string {
  const [h, m] = t.split(':').map(Number);
  const ampm = h >= 12 ? 'PM' : 'AM';
  const hh = h % 12 === 0 ? 12 : h % 12;
  return `${hh}:${String(m).padStart(2, '0')} ${ampm}`;
}
