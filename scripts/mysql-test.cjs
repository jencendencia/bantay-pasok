// Headless MySQL integration test against the compiled dist-electron JS.
// Usage: node scripts/mysql-test.cjs [password]
const { ensureSchema, DbConnection, loadDbConfig, saveDbConfig, rowToDb, rowFromDb } = require('../dist-electron/electron/db.js');
const { buildSeedData } = require('../dist-electron/shared/seed.js');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const PASSWORD = process.argv[2] || '';
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'bantay-dbtest-'));

function assert(name, cond) {
  console.log((cond ? '  ok   - ' : '  FAIL - ') + name);
  if (!cond) process.exitCode = 1;
}

async function main() {
  const cfg = { enabled: true, host: '127.0.0.1', port: 3306, user: 'root', password: PASSWORD, database: 'bantay_pasok_test' };

  // config persistence round-trip
  saveDbConfig(TMP, cfg);
  const loaded = loadDbConfig(TMP);
  assert('config round-trip', loaded.host === cfg.host && loaded.database === cfg.database && loaded.enabled === true);

  const seed = buildSeedData();
  seed.sms.push({ id: 'sms_test1', ts: Date.now(), to: '+639170000001', body: 'hello', studentId: seed.students[0].id, kind: 'arrival', status: 'sent', attempts: 1 });

  await ensureSchema(cfg);
  const db = new DbConnection();
  await db.connect(cfg);
  const version = await db.test(cfg);
  assert('connected to MySQL ' + version, !!version);

  // first sync on empty schema == full insert
  await db.sync(seed);
  const loaded1 = await db.loadAll();
  assert('students round-trip', loaded1.students.length === seed.students.length);
  assert('teachers round-trip', loaded1.teachers.length === seed.teachers.length);
  assert('slots round-trip (days JSON)', loaded1.slots.length === seed.slots.length && loaded1.slots[0].days.length === 5);
  assert('settings kv round-trip', loaded1.settings.schoolName === seed.settings.schoolName && loaded1.settings.smtpPort === 465);
  assert('borrowed/holiday kv', Array.isArray(loaded1.borrowed.sections) && loaded1.holiday.date === null);
  assert('sms with derived key', loaded1.sms.length === seed.sms.length);
  const att1 = loaded1.attendance.map(a => `${a.studentId}|${a.date}|${a.kind}`).sort().join(',');
  const att2 = seed.attendance.map(a => `${a.studentId}|${a.date}|${a.kind}`).sort().join(',');
  assert('attendance derived keys stable', att1 === att2);

  // mutate: add scan+attendance, change a student, delete a slot
  seed.scans.push({ id: 'scan_test2', personId: seed.students[1].id, role: 'student', ts: Date.now(), kind: 'in' });
  seed.students[0].firstName = 'Renamed';
  const removedSlot = seed.slots.pop();
  await db.sync(seed);
  const loaded2 = await db.loadAll();
  assert('insert propagated', loaded2.scans.some(s => s.id === 'scan_test2'));
  const renamed = loaded2.students.find(s => s.id === seed.students[0].id);
  assert('update propagated', renamed?.firstName === 'Renamed');
  assert('delete propagated', !loaded2.slots.some(s => s.id === removedSlot.id));

  // row mappers
  const dbRow = rowToDb('slots', { ...seed.slots[0], days: [1, 2] });
  assert('rowToDb snakes + JSON', dbRow.department_id === seed.slots[0].departmentId && dbRow.days === '[1,2]');
  const back = rowFromDb('slots', dbRow);
  assert('rowFromDb camelizes', back.departmentId === seed.slots[0].departmentId && Array.isArray(back.days) === false);

  // empty snapshot wipes tables (edge case, not used in app)
  const empty = buildSeedData();
  empty.students = []; empty.teachers = []; empty.slots = []; empty.users = [];
  empty.sections = []; empty.departments = []; empty.guardians = [];
  empty.sms = []; empty.emails = []; empty.scans = []; empty.attendance = [];
  empty.classEvents = []; empty.slotStatuses = []; empty.announcements = [];
  await db.sync(empty);
  const loaded3 = await db.loadAll();
  assert('full delete sync', loaded3.students.length === 0 && loaded3.slots.length === 0);

  await db.disconnect();

  // clean up test database
  const mysql = require('mysql2/promise');
  const c = await mysql.createConnection({ host: cfg.host, port: cfg.port, user: cfg.user, password: PASSWORD });
  await c.query('DROP DATABASE IF EXISTS bantay_pasok_test');
  await c.end();
  fs.rmSync(TMP, { recursive: true, force: true });
  console.log('\nMySQL integration test done.');
}

main().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
