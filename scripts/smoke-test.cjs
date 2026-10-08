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
  check('seed: teachers have sex', d.teachers.every(t => t.sex === 'M' || t.sex === 'F'));

  // 2. Teacher scan flow
  const teacher = d.teachers[0];
  check('teacher has slots', d.slots.some(s => s.teacherId === teacher.id));
  const tScan = processScan(d, teacher.qr);
  check('teacher scan accepted', tScan.ok && tScan.kind === 'teacher');
  check('teacher scan message (female: Ma\'am)', tScan.message === `Welcome, Ma'am ${teacher.firstName}. Have a great class!`);
  const maleTeacher = d.teachers.find(t => t.sex === 'M');
  const mScan = processScan(d, maleTeacher.qr);
  check('teacher scan message (male: Sir)', mScan.message === `Welcome, Sir ${maleTeacher.firstName}. Have a great class!`);
  const legacyTeacher = { ...teacher, id: 't_legacy', qr: 'T-LEGACY-1', sex: undefined };
  d.teachers.push(legacyTeacher);
  const lScan = processScan(d, legacyTeacher.qr);
  check('teacher with no sex on record defaults to Ma\'am', lScan.message === `Welcome, Ma'am ${legacyTeacher.firstName}. Have a great class!`);
  check('teacher scan screen name is first name only', tScan.name === teacher.firstName && !tScan.name.includes(teacher.lastName));
  check('teacher scan left panel shows full name', tScan.fullName === `${teacher.firstName} ${teacher.lastName}`);
  check('teacher scan message uses first name only', !tScan.message.includes(teacher.lastName));
  check('teacher scan result carries sex', tScan.sex === 'M' || tScan.sex === 'F');
  const tAgain = processScan(d, teacher.qr);
  check('repeat scan within 60s ignored', !tAgain.ok && tAgain.kind === 'duplicate');
  check('duplicate scan carries full identity (no Student/ID VERIFIED fallback)', tAgain.fullName === `${teacher.firstName} ${teacher.lastName}` && tAgain.qr === teacher.qr && !!tAgain.photoData === !!teacher.photoData);
  check('duplicate scan keeps teacher identity panel', tAgain.subDetail === 'Filipino Department' && tAgain.statusCategory === 'teacher');
  // No-department teacher: sub-line must be exactly 'Faculty' (no leading space).
  const depless = { ...teacher, id: 't_nodep', qr: 'T-NODEP-1', departmentId: 'dep_missing' };
  d.teachers.push(depless);
  const dow = new Date().getDay();
  const depSlot = d.slots.find(s => s.teacherId === teacher.id && s.days.includes(dow)) || d.slots.find(s => s.teacherId === teacher.id);
  const [sh, sm] = depSlot.start.split(':').map(Number);
  const depAt = new Date();
  depAt.setHours(sh, sm, 0, 0);
  const ndScan = processScan(d, depless.qr, depAt.getTime());
  check('teacher with no department shows "Faculty" sub-line', ndScan.ok && ndScan.kind === 'teacher' && ndScan.subDetail === 'Faculty');

  // Unknown code: rejected with the admin hint and the error panel category.
  const unk = processScan(d, 'NOPE-999');
  check('unknown QR rejected with admin hint', !unk.ok && unk.kind === 'unknown' && /not recognized/.test(unk.message) && unk.statusCategory === 'error');
  // The engine accepts the printed QR or the internal record id on every surface.
  const idClone = { ...teacher, id: 't_idlookup', qr: 'T-IDLOOKUP-1' };
  d.teachers.push(idClone);
  const idScan = processScan(d, idClone.id);
  check('scan accepts the internal id as well as the printed QR', idScan.ok && idScan.kind === 'teacher' && idScan.personId === idClone.id);
  // A teacher scanning inside a scheduled period records the class event —
  // that row is what the admin Teachers log displays (the old browser copy
  // never recorded it, so preview mode always showed "No scan yet").
  d.scans.length = 0; // fresh duplicate gate so the pinned time below can't trip the 60s dedup
  const ceSlot = d.slots.find(s => s.teacherId === teacher.id);
  const ceAt = new Date();
  let ceGuard = 0;
  while (!ceSlot.days.includes(ceAt.getDay()) && ceGuard++ < 7) ceAt.setDate(ceAt.getDate() + 1);
  const [ceh, cem] = ceSlot.start.split(':').map(Number);
  ceAt.setHours(ceh, cem, 0, 0);
  const ceBefore = d.classEvents.length;
  const ceScan = processScan(d, teacher.qr, ceAt.getTime());
  const ceLast = d.classEvents[d.classEvents.length - 1];
  check('teacher scan inside a period records the class event', ceScan.ok && ceScan.kind === 'teacher' && d.classEvents.length === ceBefore + 1 && ceLast.slotId === ceSlot.id && !!ceScan.detail);

  // 3. Student in + out + duplicate suppression (clock pinned: 10:00 arrival, 15:31 departure)
  const at = (h, m) => { const dt = new Date(); dt.setHours(h, m, 0, 0); return dt.getTime(); };
  const student = d.students[0];
  const sIn = processScan(d, student.qr, at(10, 0));
  check('student arrival accepted', sIn.ok && sIn.kind === 'student_in');
  check('student screen name is first name only', sIn.name === student.firstName);
  check('student left panel shows full name', sIn.fullName === `${student.firstName} ${student.lastName}`);
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

  // 8. The browser fallback (src/api.ts) runs the SAME shared scan engine
  //    (src/shared/scan.ts) — proven here against its localStorage store.
  globalThis.localStorage = (() => {
    const store = new Map();
    return {
      getItem: k => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => { store.set(k, String(v)); },
      removeItem: k => { store.delete(k); }
    };
  })();
  const { fmt12 } = require('../dist-electron/shared/constants.js');
  const browserApi = require('../dist-electron/api.js').api;
  const bUnknown = await browserApi.scan('NOPE-999');
  check('browser: unknown QR rejected like the desktop app', bUnknown.ok === false && bUnknown.data?.kind === 'unknown' && bUnknown.data?.statusCategory === 'error');
  const bd = JSON.parse(globalThis.localStorage.getItem('bantay_pasok_browser_data'));
  const bTeacher = bd.teachers[0];
  const bSlot = bd.slots.find(s => s.teacherId === bTeacher.id);
  const bAt = new Date();
  let bGuard = 0;
  while (!bSlot.days.includes(bAt.getDay()) && bGuard++ < 7) bAt.setDate(bAt.getDate() + 1);
  const [bh, bm] = bSlot.start.split(':').map(Number);
  bAt.setHours(bh, bm, 0, 0);
  const realNow = Date.now;
  Date.now = () => bAt.getTime(); // pin the browser clock into the scheduled period
  let bTeacherRes;
  try { bTeacherRes = await browserApi.scan(bTeacher.qr); } finally { Date.now = realNow; }
  const bd2 = JSON.parse(globalThis.localStorage.getItem('bantay_pasok_browser_data'));
  check('browser: teacher scan records the class event (the old copy never did)', bTeacherRes.ok === true && bTeacherRes.data?.ok === true && bd2.classEvents.length === 1 && bd2.classEvents[0].slotId === bSlot.id);
  check('browser: teacher detail matches the scheduled slot', !!bTeacherRes.data?.detail && bTeacherRes.data.detail.includes(fmt12(bSlot.start)));
  Date.now = () => bAt.getTime() + 5_000;
  let bDupRes;
  try { bDupRes = await browserApi.scan(bTeacher.qr); } finally { Date.now = realNow; }
  check('browser: duplicate keeps full identity like the desktop app', bDupRes.data?.kind === 'duplicate' && bDupRes.data?.fullName === `${bTeacher.firstName} ${bTeacher.lastName}` && bDupRes.data?.statusCategory === 'teacher');
  const bStudent = bd2.students[0];
  Date.now = () => bAt.getTime();
  let bStudRes;
  try { bStudRes = await browserApi.scan(bStudent.qr); } finally { Date.now = realNow; }
  const bd3 = JSON.parse(globalThis.localStorage.getItem('bantay_pasok_browser_data'));
  check('browser: student arrival records attendance and queues parent SMS', bStudRes.data?.kind === 'student_in' && bd3.attendance.length === 1 && bd3.sms.length === 1 && bd3.sms[0].status === 'sent');

  // 9. ID-card batch ZIP (src/shared/zip.ts) — structure and CRCs verified
  //    with Node's own zlib.crc32, an implementation independent of ours.
  const { zipStore } = require('../dist-electron/shared/zip.js');
  const { crc32: nodeCrc32 } = require('node:zlib');
  const jpg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 70, 0]);
  const txt = new TextEncoder().encode('id card batch');
  const zip = zipStore([{ name: 'A_S-1.jpg', data: jpg }, { name: 'B_S-2.jpg', data: txt }]);
  const zdv = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  const eocd = zip.length - 22;
  check('zip: end-of-central-directory lists 2 entries',
    zdv.getUint32(eocd, true) === 0x06054b50 && zdv.getUint16(eocd + 10, true) === 2);
  let zp = zdv.getUint32(eocd + 16, true);
  const zNames = [], zPayloads = [];
  let zOk = true;
  for (let i = 0; i < 2 && zOk; i++) {
    if (zdv.getUint32(zp, true) !== 0x02014b50) { zOk = false; break; }
    const crc = zdv.getUint32(zp + 16, true);
    const size = zdv.getUint32(zp + 20, true);
    const nlen = zdv.getUint16(zp + 28, true);
    const lho = zdv.getUint32(zp + 42, true);
    if (zdv.getUint32(lho, true) !== 0x04034b50 || zdv.getUint16(lho + 8, true) !== 0) { zOk = false; break; }
    const dataOff = lho + 30 + zdv.getUint16(lho + 26, true) + zdv.getUint16(lho + 28, true);
    const data = zip.subarray(dataOff, dataOff + size);
    if (nodeCrc32(data) !== crc) { zOk = false; break; }
    zNames.push(Buffer.from(zip.subarray(zp + 46, zp + 46 + nlen)).toString('ascii'));
    zPayloads.push(Buffer.from(data));
    zp += 46 + nlen;
  }
  check('zip: local headers, store method and zlib-verified CRCs', zOk);
  check('zip: names and payloads round-trip byte-for-byte',
    zNames.join(',') === 'A_S-1.jpg,B_S-2.jpg'
    && Buffer.compare(zPayloads[0], Buffer.from(jpg)) === 0
    && zPayloads[1].toString('ascii') === 'id card batch');

  console.log(`\n${pass} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
