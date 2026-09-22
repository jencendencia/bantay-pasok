import ExcelJS from 'exceljs';
import type { AppData, ReportParams } from '../shared/types';
import { timeToMin } from '../shared/constants';
import { todayStr } from './timeutil';

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

function statusFill(status: string): { fill?: string } {
  if (status === 'P') return { fill: SOFT };
  if (status === 'L') return { fill: ORANGE };
  if (status === 'A') return { fill: RED };
  if (status === 'OL') return { fill: PURPLE };
  if (status === 'E') return { fill: SOFT };
  if (status === 'T') return { fill: SOFT };
  if (status === 'M') return { fill: PURPLE };
  return {};
}

function markFor(d: AppData, slotId: string, date: string, grace: number, slotStartMin: number): string {
  const e = d.classEvents.find(x => x.slotId === slotId && x.date === date);
  if (e) {
    const dt = new Date(e.ts);
    const mins = dt.getHours() * 60 + dt.getMinutes();
    return mins - slotStartMin > grace ? 'L' : 'P';
  }
  const st = d.slotStatuses.find(s => s.id === `${slotId}|${date}`);
  if (st) {
    if (st.reason === 'on_leave') return 'OL';
    if (st.reason === 'in_meeting') return 'M';
    return 'A';
  }
  return 'A';
}

export async function buildReport(d: AppData, p: ReportParams): Promise<{ buffer: Buffer; filename: string }> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Bantay Pasok';
  wb.created = new Date();

  const grace = d.settings.graceMinutes;
  const from = p.from, to = p.to;
  const dateList: string[] = [];
  {
    const cur = new Date(from + 'T00:00:00');
    const end = new Date(to + 'T00:00:00');
    while (cur <= end) {
      dateList.push(cur.toISOString().slice(0, 10));
      cur.setDate(cur.getDate() + 1);
    }
  }
  const schoolDays = dateList.filter(dt => {
    const dow = new Date(dt + 'T00:00:00').getDay();
    return dow >= 1 && dow <= 5 && !d.settings.holidayDates.includes(dt) && d.holiday.date !== dt;
  });

  if (p.type === 'teacher') {
    return teacherAttendanceWorkbook(d, wb, schoolDays, p);
  }
  if (p.type === 'teacher_individual') {
    return teacherIndividualWorkbook(d, wb, schoolDays, p);
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
  const dow = (dt: string) => new Date(dt + 'T00:00:00').getDay();
  const schoolDays = days.filter(dt => dow(dt) >= 1 && dow(dt) <= 5);
  const slots = d.slots.filter(s => (!p.sectionId || s.sectionId === p.sectionId) && s.days.some(x => x >= 1 && x <= 5));

  titleBlock(ws, `${d.settings.schoolName} · Teacher class attendance`,
    `${p.from} to ${p.to} · Late = scan more than ${d.settings.graceMinutes} minutes after the scheduled start · Excused leave is not counted absent`, 9);
  headerRow(ws, 4, ['Teacher', 'Department', ...schoolDays.map(dt => dt), 'Scheduled', 'Attended', 'Late', 'Absent']);

  let r = 5;
  const teachers = [...d.teachers].sort((a, b) => a.lastName.localeCompare(b.lastName));
  for (const t of teachers) {
    const mySlots = slots.filter(s => s.teacherId === t.id);
    const dep = d.departments.find(x => x.id === t.departmentId);
    const rowVals: CellVal[] = [`${t.lastName}, ${t.firstName}`, dep ? dep.name : ''];
    let scheduled = 0, attended = 0, late = 0, absent = 0;
    for (const dt of schoolDays) {
      const dowNum = dow(dt);
      const daySlots = mySlots.filter(s => s.days.includes(dowNum));
      let mark = '';
      for (const s of daySlots) {
        const m = markFor(d, s.id, dt, d.settings.graceMinutes, timeToMin(s.start));
        if (m === 'P') { attended++; mark = 'P'; }
        else if (m === 'L') { attended++; late++; mark = 'L'; }
        else if (m === 'OL' || m === 'M') { mark = m; }
        else { absent++; mark = 'A'; }
      }
      if (!mark) mark = '';
      scheduled += daySlots.length;
      rowVals.push(mark);
      const cell = ws.getCell(r, rowVals.length);
      const sf = statusFill(mark);
      if (sf.fill) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: sf.fill } };
      cell.alignment = { horizontal: 'center' };
    }
    rowVals.push(scheduled, attended, late, absent);
    ws.getRow(r).values = ['', ...rowVals];
    r++;
  }
  ws.getRow(r).values = ['', '', `* Excused leave (OL/M) is excluded from the attendance rate.`];
  ws.getCell(r, 3).font = { italic: true, size: 9, color: { argb: 'FF5E6E66' } };

  ws.columns.forEach(c => { c.width = 14; });
  ws.getColumn(1).width = 24;
  ws.getColumn(2).width = 18;

  // Daily log sheet
  const log = wb.addWorksheet('Daily log');
  titleBlock(log, 'Daily log', 'Every class meeting: date, section, subject, scheduled time, time in, minutes late, reason', 8);
  headerRow(log, 4, ['Date', 'Teacher', 'Section', 'Subject', 'Scheduled', 'Time in', 'Minutes late', 'Reason']);
  let lr = 5;
  for (const dt of schoolDays) {
    const dowNum = dow(dt);
    for (const s of d.slots.filter(s => s.days.includes(dowNum) && (!p.sectionId || s.sectionId === p.sectionId))) {
      const t = d.teachers.find(x => x.id === s.teacherId);
      const sec = d.sections.find(x => x.id === s.sectionId);
      const ev = d.classEvents.find(e => e.slotId === s.id && e.date === dt);
      const st = d.slotStatuses.find(x => x.id === `${s.id}|${dt}`);
      const tIn = ev ? fmtTime(ev.ts) : '';
      const late = ev ? Math.max(0, minsOf(ev.ts) - timeToMin(s.start)) : '';
      const reason = st ? reasonLabel(st.reason) : (ev ? '' : 'No scan');
      log.addRow([dt, t ? `${t.lastName}, ${t.firstName}` : '', sec ? sec.name : '', s.subject,
        fmt12(s.start), tIn, late, reason]);
      lr++;
    }
  }
  log.columns.forEach(c => { c.width = 16; });

  // By section sheet
  const bySec = wb.addWorksheet('By section');
  titleBlock(bySec, 'Attendance by section', 'How often each teacher attended each section', 6);
  headerRow(bySec, 4, ['Teacher', ...d.sections.map(s => s.name), 'Attended', 'Scheduled']);
  let br = 5;
  for (const t of teachers) {
    const vals: CellVal[] = [`${t.lastName}, ${t.firstName}`];
    let attended = 0, scheduled = 0;
    for (const sec of d.sections) {
      const secSlots = d.slots.filter(s => s.teacherId === t.id && s.sectionId === sec.id);
      let a = 0;
      for (const s of secSlots) {
        for (const dt of schoolDays) {
          if (s.days.includes(dow(dt))) {
            scheduled++;
    const m = markFor(d, s.id, dt, d.settings.graceMinutes, timeToMin(s.start));
            if (m === 'P' || m === 'L') a++;
          }
        }
      }
      vals.push(a);
      attended += a;
    }
    vals.push(attended, scheduled);
    bySec.getRow(br).values = ['', ...vals];
    br++;
  }
  bySec.columns.forEach(c => { c.width = 18; });

  const buf = await wb.xlsx.writeBuffer();
  return { buffer: Buffer.from(buf), filename: `Attendance_Teachers_${p.from}_${p.to}.xlsx` };
}

async function teacherIndividualWorkbook(
  d: AppData, wb: ExcelJS.Workbook, days: string[], p: ReportParams
): Promise<{ buffer: Buffer; filename: string }> {
  const teacher = d.teachers.find(t => t.id === p.teacherId);
  if (!teacher) throw new Error('Teacher not found');
  const dep = d.departments.find(x => x.id === teacher.departmentId);
  const dow = (dt: string) => new Date(dt + 'T00:00:00').getDay();
  const schoolDays = days.filter(dt => dow(dt) >= 1 && dow(dt) <= 5);
  const mySlots = d.slots.filter(s => s.teacherId === teacher.id);

  const ws = wb.addWorksheet('Summary');
  titleBlock(ws, `${teacher.firstName} ${teacher.lastName} · Attendance to class`,
    `${dep ? dep.name : ''} · ${p.from} to ${p.to} · Late = scan more than ${grace(d)} min after start`, 8);

  let scheduled = 0, attended = 0, late = 0, absent = 0;
  const perWeek = new Map<string, { s: number; a: number; l: number; ab: number }>();
  const perMonth = new Map<string, { s: number; a: number; l: number; ab: number }>();
  const perTerm = new Map<string, { s: number; a: number; l: number; ab: number }>();
  const bump = (m: Map<string, { s: number; a: number; l: number; ab: number }>, k: string, x: { s: number; a: number; l: number; ab: number }) => {
    const cur = m.get(k) || { s: 0, a: 0, l: 0, ab: 0 };
    cur.s += x.s; cur.a += x.a; cur.l += x.l; cur.ab += x.ab;
    m.set(k, cur);
  };

  for (const s of mySlots) {
    for (const dt of schoolDays) {
      if (!s.days.includes(dow(dt))) continue;
      scheduled++;
      const m = markFor(d, s.id, dt, d.settings.graceMinutes, timeToMin(s.start));
      const rec = { s: 1, a: m === 'P' || m === 'L' ? 1 : 0, l: m === 'L' ? 1 : 0, ab: m === 'A' ? 1 : 0 };
      attended += rec.a; late += rec.l; absent += rec.ab;
      const wk = weekKey(dt), mo = dt.slice(0, 7);
      bump(perWeek, wk, rec);
      bump(perMonth, mo, rec);
      const term = d.settings.terms.find(t => dt >= t.start && dt <= t.end);
      if (term) bump(perTerm, term.name, rec);
    }
  }

  headerRow(ws, 4, ['Metric', 'Value']);
  const addStat = (label: string, v: CellVal) => { ws.addRow([, label, v]); };
  addStat('Classes scheduled', scheduled);
  addStat('Attended', attended);
  addStat('Late', late);
  addStat('Absent (unexcused)', absent);
  const rate = scheduled ? Math.round(((attended) / scheduled) * 100) : 0;
  addStat('Attendance rate', `${rate}%`);
  const puncture = attended ? Math.round(((attended - late) / attended) * 100) : 0;
  addStat('Punctuality rate', `${puncture}%`);

  const freq = wb.addWorksheet('Frequency');
  titleBlock(freq, 'Frequency', 'Attendance to class per week / month / term', 6);
  headerRow(freq, 4, ['Period', 'Scheduled', 'Attended', 'Late', 'Absent', 'Rate']);
  let fr = 5;
  for (const [k, v] of perWeek) {
    freq.getCell(fr, 1).value = k;
    fillFreq(freq, fr, v);
    fr++;
  }
  for (const [k, v] of perMonth) {
    freq.getCell(fr, 1).value = k;
    fillFreq(freq, fr, v);
    fr++;
  }
  for (const [k, v] of perTerm) {
    freq.getCell(fr, 1).value = k;
    fillFreq(freq, fr, v);
    fr++;
  }
  freq.columns.forEach(c => { c.width = 16; });

  const log = wb.addWorksheet('Daily log');
  titleBlock(log, 'Daily log', 'Every class: date, section, subject, scheduled, time in, minutes late, reason', 8);
  headerRow(log, 4, ['Date', 'Section', 'Subject', 'Scheduled', 'Time in', 'Minutes late', 'Reason', 'Status']);
  for (const s of mySlots) {
    for (const dt of schoolDays) {
      if (!s.days.includes(dow(dt))) continue;
      const sec = d.sections.find(x => x.id === s.sectionId);
      const ev = d.classEvents.find(e => e.slotId === s.id && e.date === dt);
      const st = d.slotStatuses.find(x => x.id === `${s.id}|${dt}`);
      const m = markFor(d, s.id, dt, d.settings.graceMinutes, timeToMin(s.start));
      log.addRow([dt, sec ? sec.name : '', s.subject, fmt12(s.start),
        ev ? fmtTime(ev.ts) : '', ev ? Math.max(0, minsOf(ev.ts) - timeToMin(s.start)) : '',
        st ? reasonLabel(st.reason) : (ev ? '' : 'No scan'), m === 'OL' ? 'Excused' : m === 'M' ? 'Excused (meeting)' : m]);
    }
  }
  log.columns.forEach(c => { c.width = 16; });

  const buf = await wb.xlsx.writeBuffer();
  const ln = `${teacher.lastName}`.replace(/\s+/g, '');
  return { buffer: Buffer.from(buf), filename: `Attendance_${ln}_${p.from}_${p.to}.xlsx` };
}

async function studentAttendanceWorkbook(
  d: AppData, wb: ExcelJS.Workbook, days: string[], p: ReportParams
): Promise<{ buffer: Buffer; filename: string }> {
  const dow = (dt: string) => new Date(dt + 'T00:00:00').getDay();
  const schoolDays = days.filter(dt => dow(dt) >= 1 && dow(dt) <= 5);
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
      for (let di = 0; di < schoolDays.length; di++) {
        const dt = schoolDays[di];
        const cameIn = d.attendance.some(e => e.studentId === st.id && e.date === dt && e.kind === 'in');
        vals.push(cameIn ? 'P' : 'A');
        if (cameIn) present++; else absent++;
        const cell = ws.getCell(r, 5 + di);
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: cameIn ? SOFT : RED } };
        cell.alignment = { horizontal: 'center' };
      }
      vals.push(present, absent, `${Math.round((present / Math.max(1, schoolDays.length)) * 100)}%`);
      ws.getRow(r).values = ['', ...vals];
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
  d: AppData, wb: ExcelJS.Workbook, days: string[], p: ReportParams
): Promise<{ buffer: Buffer; filename: string }> {
  const dow = (dt: string) => new Date(dt + 'T00:00:00').getDay();
  const schoolDays = days.filter(dt => dow(dt) >= 1 && dow(dt) <= 5);
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
      ws.getRow(r).values = ['', `${st.lastName}, ${st.firstName}`, sec.name, early, onTime, late, absent, `${rate}%`];
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

function fillFreq(ws: ExcelJS.Worksheet, r: number, v: { s: number; a: number; l: number; ab: number }): void {
  const rate = v.s ? Math.round((v.a / v.s) * 100) : 0;
  ws.getCell(r, 2).value = v.s;
  ws.getCell(r, 3).value = v.a;
  ws.getCell(r, 4).value = v.l;
  ws.getCell(r, 5).value = v.ab;
  ws.getCell(r, 6).value = `${rate}%`;
  const fill = rate >= 95 ? SOFT : rate >= 85 ? YELLOW : RED;
  ws.getCell(r, 6).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fill } };
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

function grace(d: AppData): number {
  return d.settings.graceMinutes;
}

function weekKey(dt: string): string {
  const d0 = new Date(dt + 'T00:00:00');
  const day = (d0.getDay() + 6) % 7; // Mon=0
  const monday = new Date(d0);
  monday.setDate(d0.getDate() - day);
  return `Week of ${monday.toISOString().slice(0, 10)}`;
}
