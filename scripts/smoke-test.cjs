// Headless smoke test against the compiled dist-electron JS (CommonJS).
const { buildSeedData } = require('../dist-electron/shared/seed.js');
const { processScan, slotAttendance } = require('../dist-electron/electron/attendance.js');
const { buildReport } = require('../dist-electron/electron/reports.js');
const { GsmModule } = require('../dist-electron/electron/gsm.js');
const { writeFileSync, rmSync, existsSync } = require('node:fs');

let pass = 0, failed = 0;
function check(name, cond) {
  if (cond) { pass++; console.log('  ok -', name); }
  else { failed++; console.log('  FAIL -', name); }
}

async function main() {
  // 1. Seed data integrity
  const d = buildSeedData();
  check('seed: 4 sections', d.sections.length === 4);
  check('seed: 80 students with sections', d.students.length === 80 && d.students.every(s => s.sectionId));
  check('seed: 32 slots, no double-booking', d.slots.length === 32 && (() => {
    const seen = new Set();
    for (const s of d.slots) {
      for (const day of s.days) {
        const key = `${s.teacherId}|${day}|${s.start}-${s.end}`;
        if (seen.has(key)) return false;
        seen.add(key);
      }
    }
    return true;
  })());
  check('seed: users include admin', d.users.some(u => u.username === 'admin'));
  check('seed: student QRs unique', d.students.length === new Set(d.students.map(s => s.qr)).size);
  check('seed: teacher QRs unique', d.teachers.length === new Set(d.teachers.map(t => t.qr)).size);

  // 2. Teacher scan flow
  const teacher = d.teachers[0];
  check('teacher has slots', d.slots.some(s => s.teacherId === teacher.id));
  const tScan = processScan(d, teacher.qr);
  check('teacher scan accepted', tScan.ok && tScan.kind === 'teacher');
  check('teacher scan message', /Welcome, Ma'am\/Sir/.test(tScan.message));
  const tAgain = processScan(d, teacher.qr);
  check('repeat scan within 60s ignored', !tAgain.ok && tAgain.kind === 'duplicate');

  // 3. Student in + out + duplicate suppression (clock pinned: 10:00 arrival, 15:31 departure)
  const at = (h, m) => { const dt = new Date(); dt.setHours(h, m, 0, 0); return dt.getTime(); };
  const student = d.students[0];
  const sIn = processScan(d, student.qr, at(10, 0));
  check('student arrival accepted', sIn.ok && sIn.kind === 'student_in');
  check('screen message friendly (never says late)', !/late/i.test(sIn.message));
  const sOutside = processScan(d, student.qr, at(10, 1));
  check('mid-morning re-scan keeps student checked in', !sOutside.ok && sOutside.kind === 'duplicate');
  const sAgain = processScan(d, student.qr, at(15, 31));
  check('second scan in PM-out window records departure', sAgain.ok && sAgain.kind === 'student_out');
  const sThird = processScan(d, student.qr, at(15, 32));
  check('third scan suppressed', !sThird.ok && sThird.kind === 'duplicate');

  // 3b. Per-section time rules: a section with its own AM time in classifies
  // scans by its own window; sections without overrides follow the global rules.
  const secA = d.sections[0];
  const secB = d.sections[1];
  const studentA = d.students.find(s => s.sectionId === secA.id && !d.attendance.some(e => e.studentId === s.id));
  const studentB = d.students.find(s => s.sectionId === secB.id && !d.attendance.some(e => e.studentId === s.id));
  secA.slotTimes = { amIn: '08:00' }; // only AM in overridden; rest follows global rules
  const scanA = processScan(d, studentA.qr, at(7, 30)); // 7:30 — late globally, early for secA
  check('section with 8am AM-in accepts 7:30 scan as early', scanA.ok && scanA.kind === 'student_in' && scanA.statusCategory === 'early');
  const scanB = processScan(d, studentB.qr, at(7, 30)); // global early cutoff is 7:00 → on_time
  check('section without override follows global rules', scanB.ok && scanB.kind === 'student_in' && scanB.statusCategory === 'on_time');

  // 4. SMS enqueue + parent body
  const sms = {
    ts: Date.now(), to: '+639171234567',
    body: GsmModule.parentBody('arrival', 'Juan Dela Cruz', '7:15 AM', 'early', 'Mabuhay NHS'),
    studentId: student.id, kind: 'arrival'
  };
  GsmModule.prototype.enqueue.call({}, d, sms);
  check('sms queued', d.sms.length === 1 && d.sms[0].status === 'pending');
  check('sms body mentions arrival', /arrived at school/.test(d.sms[0].body));

  // 5. Slot status / reason flow
  const slot = d.slots[0];
  const date = '2026-09-21';
  d.slotStatuses.push({ id: `${slot.id}|${date}`, reason: 'on_leave', note: '', date });
  const att = slotAttendance(d, slot, date);
  check('on-leave slot shows excused', att.status === 'excused');

  // 6. Excel reports build without error
  for (const type of ['teacher', 'teacher_individual', 'student', 'student_punctuality']) {
    const out = await buildReport(d, { type, from: '2026-09-14', to: '2026-09-18', teacherId: d.teachers[0].id });
    const p = `test_${type}.xlsx`;
    writeFileSync(p, out.buffer);
    const okFile = existsSync(p) && out.buffer.length > 4000;
    check(`report ${type} generated (${out.buffer.length} bytes)`, okFile);
    rmSync(p);
  }

  // 7. GSM retry classification
  const g = new GsmModule(() => d);
  g.enqueue(d, { ts: Date.now(), to: '+639170000000', body: 'test', studentId: 'x', kind: 'arrival' });
  const m = d.sms[d.sms.length - 1];
  for (let i = 0; i < 4; i++) { try { await g.tick(); } catch { /* tick swallows */ } }
  check('sms retry ends sent or failed', m.status === 'sent' || m.status === 'failed');

  console.log(`\n${pass} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
