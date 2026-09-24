// Standalone SQLite storage test (no Electron required).
// Usage: npm run db:test   (requires `npm run build:electron` first)
//
// Verifies the full storage pipeline against a throwaway database file:
// config round-trip, schema creation, seed sync + load, row mappers,
// boolean/JSON column handling, insert/update/delete propagation and
// the empty-snapshot wipe behaviour.

const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  ensureSchema,
  DbConnection,
  loadDbConfig,
  saveDbConfig,
  rowToDb,
  rowFromDb
} = require('../dist-electron/electron/db.js');
const { buildSeedData } = require('../dist-electron/shared/seed.js');

let passed = 0;
function ok(cond, label) {
  if (!cond) {
    console.error(`FAIL: ${label}`);
    process.exitCode = 1;
  } else {
    passed++;
    console.log(`ok - ${label}`);
  }
}

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'bantay-dbtest-'));
const cfg = { enabled: true, file: path.join(TMP, 'test.db') };

try {
  // 1. Config round-trip.
  saveDbConfig(TMP, cfg);
  const loaded = loadDbConfig(TMP);
  ok(loaded.enabled === true && loaded.file === cfg.file, 'config round-trip');

  // 2. Seed data + one SMS row.
  const seed = buildSeedData();
  seed.sms.push({
    id: 'sms_test1',
    ts: Date.now(),
    to: '+639170000001',
    body: 'hello',
    studentId: seed.students[0].id,
    kind: 'arrival',
    status: 'sent',
    attempts: 1
  });

  // 3. Schema + connect + version probe.
  ensureSchema(cfg);
  const db = new DbConnection();
  const version = db.test(cfg);
  ok(/^\d+\.\d+\.\d+/.test(version), `sqlite version probe (${version})`);
  db.connect(cfg);
  ok(db.enabled === true, 'connect');

  // 4. Full sync + load round-trip.
  db.sync(seed);
  const back = db.loadAll();
  ok(back.students.length === seed.students.length, `students round-trip (${back.students.length})`);
  ok(back.teachers.length === seed.teachers.length, 'teachers round-trip');
  ok(Array.isArray(back.slots[0].days) && back.slots[0].days.length === 5, 'slots days JSON column');
  ok(back.settings.schoolName === seed.settings.schoolName, 'settings kv schoolName');
  ok(back.settings.smtpPort === seed.settings.smtpPort, 'settings kv smtpPort');
  ok(Array.isArray(back.borrowed.sections), 'borrowed kv');
  ok('date' in back.holiday, 'holiday kv');
  ok(back.sms.some(s => s.id === 'sms_test1' && s.to === '+639170000001'), 'sms row with derived key');
  ok(
    back.attendance.every(a => a.id) &&
    back.attendance.map(a => `${a.studentId}|${a.date}|${a.kind}`).join(',') ===
    seed.attendance.map(a => `${a.studentId}|${a.date}|${a.kind}`).join(','),
    'attendance derived keys'
  );

  // 5. Mutations propagate (insert / update / delete).
  seed.scans.push({ id: 'scan_test2', personId: seed.students[1].id, role: 'student', ts: Date.now(), kind: 'in' });
  seed.students[0].firstName = 'Renamed';
  seed.slots.pop();
  db.sync(seed);
  const back2 = db.loadAll();
  ok(back2.scans.some(s => s.id === 'scan_test2'), 'insert propagated');
  ok(back2.students[0].firstName === 'Renamed', 'update propagated');
  ok(back2.slots.length === seed.slots.length, 'delete propagated');

  // 6. Row mappers.
  const dbRow = rowToDb('slots', { ...seed.slots[0], days: [1, 2] });
  ok(dbRow.department_id === seed.slots[0].departmentId, 'rowToDb snake_case');
  ok(dbRow.days === '[1,2]', 'rowToDb JSON column');
  const backRow = rowFromDb('slots', dbRow);
  ok(Array.isArray(backRow.days) && backRow.days.length === 2, 'rowFromDb parses JSON');
  ok(rowToDb('announcements', { enabled: true }).enabled === 1, 'booleans bound as 0/1');

  // 7. Empty snapshot wipes the database.
  const empty = buildSeedData();
  db.sync(empty);
  const back3 = db.loadAll();
  ok(back3.students.length === empty.students.length && back3.scans.length === 0, 'empty snapshot wipes');

  db.disconnect();
  ok(db.enabled === false, 'disconnect');

  console.log(`\n${passed} checks passed.`);
} finally {
  fs.rmSync(TMP, { recursive: true, force: true });
}
