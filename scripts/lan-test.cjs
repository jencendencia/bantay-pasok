// Headless test of the LAN sharing server + client (compiled dist-electron JS).
// Run after `npm run build:electron`:  node scripts/lan-test.cjs
const http = require('node:http');
const { startLanServer, stopLanServer, lanServerRunning } = require('../dist-electron/electron/lanHost.js');
const { lanProbe, lanRequest, parseHost } = require('../dist-electron/electron/lanClient.js');

let pass = 0, failed = 0;
function check(name, cond) {
  if (cond) { pass++; console.log('  ok -', name); }
  else { failed++; console.log('  FAIL -', name); }
}

// Port pair deliberately off the app default (39500) so the test never collides
// with a real instance of the app sharing its database.
const PORT = 39577;

let state = {
  users: [{ id: 'u1', username: 'admin', passwordHash: 'x', role: 'admin', displayName: 'Admin' }],
  students: [{ id: 's1' }],
  settings: { schoolName: 'LAN Test School' },
  announcements: []
};

const handlers = {
  getData: async () => JSON.parse(JSON.stringify(state)),
  login: async (u, p) => (u === 'admin' && p === 'pw'
    ? { ok: true, data: { role: 'admin' } }
    : { ok: false, error: 'Wrong username or password.' }),
  patch: async patch => { Object.assign(state, patch); return { ok: true }; },
  scan: async code => ({ ok: true, data: code === 'GOOD'
    ? { ok: true, kind: 'teacher', message: 'Welcome' }
    : { ok: false, kind: 'unknown', message: 'not recognized' } }),
  slotReason: async () => ({ ok: true }),
  retry: async () => ({ ok: true }),
  announceAdd: async a => { state.announcements.push(a); return { ok: true }; },
  announceRemove: async id => { state.announcements = state.announcements.filter(x => x.id !== id); return { ok: true }; }
};

function rawPost(route, rawBody) {
  return new Promise(resolve => {
    const req = http.request({ host: '127.0.0.1', port: PORT, method: 'POST', path: route,
      headers: { 'Content-Type': 'application/json' } }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', e => resolve({ status: 0, body: String(e) }));
    req.end(rawBody);
  });
}

async function main() {
  // 1. Host parsing (what a user can type into Settings)
  check("parseHost('192.168.1.10') keeps the default port",
    JSON.stringify(parseHost('192.168.1.10', 39500)) === JSON.stringify({ host: '192.168.1.10', port: 39500 }));
  check("parseHost('192.168.1.10:4000') overrides the port",
    JSON.stringify(parseHost('192.168.1.10:4000', 39500)) === JSON.stringify({ host: '192.168.1.10', port: 4000 }));
  check("parseHost('http://192.168.1.10/') strips scheme and slash", parseHost('http://192.168.1.10/', 39500)?.host === '192.168.1.10');
  check('parseHost rejects empty and garbage input', parseHost('', 39500) === null && parseHost('bad host', 39500) === null && parseHost('a/b', 39500) === null);

  // 2. Server lifecycle
  const started = await startLanServer(PORT, handlers);
  check('server starts on a free port', started.ok === true);
  check('lanServerRunning reflects the live server', lanServerRunning() === true);
  const busy = await startLanServer(PORT, handlers); // stop + rebind within one call
  check('restart on the same port succeeds', busy.ok === true);

  // 3. Probe / connectivity semantics (the "Test and connect" button)
  const probeOk = await lanProbe('127.0.0.1', PORT);
  check('lanProbe answers true for a live server', probeOk.ok === true);
  const probeDown = await lanProbe('127.0.0.1', 1);
  check('lanProbe fails with a friendly error when nothing listens', probeDown.ok === false && typeof probeDown.error === 'string' && probeDown.error.length > 10);
  const probeBadHost = await lanProbe('@@@', PORT);
  check('lanProbe rejects a malformed address', probeBadHost.ok === false && /IP address/.test(probeBadHost.error));

  // 4. Snapshot round-trip
  const get = await lanRequest('127.0.0.1', PORT, 'GET', '/data');
  check('GET /data returns the snapshot', get.ok && get.body?.ok === true && get.body.data.users[0].username === 'admin');

  // 5. Mutation round-trip: response carries the fresh snapshot like main.ts expects
  const patch = await lanRequest('127.0.0.1', PORT, 'POST', '/patch', { patch: { students: [{ id: 's2' }] } });
  check('POST /patch applies and echoes fresh data',
    patch.ok && patch.body?.ok === true && patch.body.data.students.length === 1 && state.students.length === 1);
  const patchFail = await lanRequest('127.0.0.1', PORT, 'POST', '/patch', { unexpected: true, patch: 'not-an-object' });
  check('handlers report failures instead of crashing', patchFail.ok);

  // 6. Login result passthrough (kiosk login on the client computer)
  const okLogin = await lanRequest('127.0.0.1', PORT, 'POST', '/login', { username: 'admin', password: 'pw' });
  check('POST /login wraps the IpcResult in `result`', okLogin.ok && okLogin.body?.result?.ok === true && okLogin.body.result.data.role === 'admin');
  const badLogin = await lanRequest('127.0.0.1', PORT, 'POST', '/login', { username: 'admin', password: 'no' });
  check('wrong password travels back as an error', badLogin.ok && badLogin.body?.result?.ok === false && /Wrong username/.test(badLogin.body.result.error));

  // 7. Scan passthrough + fresh data in the same response
  const scan = await lanRequest('127.0.0.1', PORT, 'POST', '/scan', { code: 'GOOD' });
  check('POST /scan returns result + fresh data',
    scan.ok && scan.body?.result?.data?.kind === 'teacher' && !!scan.body.data && typeof scan.body.data.users !== 'undefined');
  const scanBad = await lanRequest('127.0.0.1', PORT, 'POST', '/scan', { code: 'NOPE' });
  check('rejected scan still returns its ScanResult', scanBad.ok && scanBad.body?.result?.data?.kind === 'unknown');

  // 8. Remaining mutation routes behave like the IPC handlers
  const slot = await lanRequest('127.0.0.1', PORT, 'POST', '/slot', { slotId: 'x', date: '2026-10-18', reason: 'on_leave', note: '' });
  const retry = await lanRequest('127.0.0.1', PORT, 'POST', '/retry', { kind: 'sms', id: 'm1' });
  const add = await lanRequest('127.0.0.1', PORT, 'POST', '/announce/add', { announcement: { id: 'a1', type: 'text', body: 'hi' } });
  check('slot / retry / announce routes return ok with fresh data',
    slot.ok && slot.body?.ok === true && !!slot.body.data
    && retry.ok && retry.body?.ok === true
    && add.ok && add.body?.data?.announcements?.length === 1);
  const rm = await lanRequest('127.0.0.1', PORT, 'POST', '/announce/remove', { id: 'a1' });
  check('announce remove deletes the row', rm.ok && rm.body?.data?.announcements?.length === 0);

  // 9. Revision counter moves only on accepted mutations (this is the poll signal)
  const rev1 = await lanRequest('127.0.0.1', PORT, 'GET', '/rev');
  const ping = await lanRequest('127.0.0.1', PORT, 'GET', '/ping');
  const rev2 = await lanRequest('127.0.0.1', PORT, 'GET', '/rev');
  check('GET /rev and /ping work, and a read does not bump the revision',
    rev1.ok && typeof rev1.body?.rev === 'number' && ping.ok && ping.body?.ok === true && rev2.body.rev === rev1.body.rev);
  await lanRequest('127.0.0.1', PORT, 'POST', '/slot', { slotId: 'y', date: '2026-10-18', reason: 'holiday', note: '' });
  const rev3 = await lanRequest('127.0.0.1', PORT, 'GET', '/rev');
  check('a mutation bumps the revision', rev3.body.rev > rev2.body.rev);

  // 10. Protocol errors
  const missing = await lanRequest('127.0.0.1', PORT, 'GET', '/nope');
  check('unknown route reports 404 as an error', missing.ok === false && missing.status === 404);
  const badJson = await rawPost('/patch', '{oops');
  check('malformed JSON body rejected with 400, server stays alive', badJson.status === 400);
  const stillAlive = await lanRequest('127.0.0.1', PORT, 'GET', '/ping');
  check('server still answers after a bad request', stillAlive.ok === true);

  // 11. Shutdown leaves the port free (app switching modes must not leak the server)
  stopLanServer();
  check('stopLanServer flips lanServerRunning', lanServerRunning() === false);
  const afterStop = await lanProbe('127.0.0.1', PORT);
  check('a stopped server refuses connections', afterStop.ok === false);
  const rebound = await startLanServer(PORT, handlers);
  check('the port is released and can be rebound immediately', rebound.ok === true);
  stopLanServer();
  check('final stop succeeds', lanServerRunning() === false);

  console.log(`\n${pass} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch(e => { console.error(e); stopLanServer(); process.exit(1); });