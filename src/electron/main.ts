import { app, BrowserWindow, ipcMain, dialog } from 'electron';
import * as path from 'path';
// Must run before ./store reads app.getPath('userData') — pins the data folder across renames.
import './userData';
import {
  loadData, patchData, saveData, flushSave, getDataDir,
  initStore, getDbConfig, applyDbConfig, connectSqlite, disconnectSqlite,
  importJsonToSqlite, dbStatus, getNetConfig, setNetConfig, isLanMode
} from './store';
import { startLanServer, stopLanServer, lanServerRunning } from './lanHost';
import type { LanHandlers } from './lanHost';
import { lanProbe, lanRequest } from './lanClient';
import type { LanResponse } from './lanClient';
import { localLanIps } from './net';
import type { AppData } from '../shared/types';
import { processScan } from './attendance';
import { GsmModule } from './gsm';
import { EmailModule } from './email';
import { buildReport } from './reports';
import { todayStr } from './timeutil';
import type { Announcement, IpcResult, NetConfig, NetStatus, ReportParams, ScanResult, UpdateEvent } from '../shared/types';
import type { DbConfig } from './db';
import { hashPassword } from '../shared/seed';
import { initUpdater, checkForUpdates, downloadUpdate, installUpdate, updateStatus, setGithubToken } from './updater';

let adminWin: BrowserWindow | null = null;
let scanWin: BrowserWindow | null = null;
const gsm = new GsmModule(() => loadData());
const emailer = new EmailModule(() => loadData());

const DEV_URL = process.env.VITE_DEV_SERVER_URL;

function createAdminWindow(): void {
  adminWin = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    show: false,
    frame: false,
    backgroundColor: '#e9efe9',
    title: 'Swiped Perfectly Just-in-time · Admin',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  adminWin.once('ready-to-show', () => adminWin?.show());
  wireWindowEvents(adminWin);
  if (DEV_URL) void adminWin.loadURL(DEV_URL);
  else void adminWin.loadFile(path.join(__dirname, '../../dist/index.html'));
  adminWin.on('closed', () => { adminWin = null; });
}

function createScannerWindow(): void {
  if (scanWin && !scanWin.isDestroyed()) { scanWin.show(); return; }
  scanWin = new BrowserWindow({
    width: 1280,
    height: 800,
    // Open on the whole display: fullscreen tracks the current screen size
    // (resolution, scaling, orientation), so the standby screen always fits.
    fullscreen: true,
    show: false,
    frame: false,
    backgroundColor: '#0e3a2f',
    title: 'Swiped Perfectly Just-in-time · Scanner',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  scanWin.once('ready-to-show', () => scanWin?.show());
  wireWindowEvents(scanWin);
  const hash = '#/scanner';
  if (DEV_URL) void scanWin.loadURL(DEV_URL + hash);
  else void scanWin.loadFile(path.join(__dirname, '../../dist/index.html'), { hash });
  scanWin.on('closed', () => { scanWin = null; });
  // Kiosk mode: the scanner replaces the admin window; it comes back via the
  // kiosk's Admin button (auth:login).
  if (adminWin && !adminWin.isDestroyed()) adminWin.close();
}

/** Shows (or recreates) the admin window — used at startup and after kiosk login. */
function showAdminWindow(): void {
  if (adminWin && !adminWin.isDestroyed()) { adminWin.show(); adminWin.focus(); return; }
  createAdminWindow();
}

function broadcast(channel: string, payload: unknown): void {
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) w.webContents.send(channel, payload);
  }
}

function ok<T>(data: T): IpcResult<T> {
  return { ok: true, data };
}

function fail(err: unknown): IpcResult<never> {
  return { ok: false, error: err instanceof Error ? err.message : String(err) };
}

// ---------- LAN (network database) — client side ----------
// In LAN mode this computer keeps NO local database: every operation is
// forwarded to the host computer over HTTP, and a cheap revision poll picks up
// changes made there so all windows stay fresh.
let remoteCache: AppData | null = null;
let remoteKey = '';
let lastRev: number | null = null;
let lanReachable: boolean | null = null;
let lanError: string | null = null;
let lanPollTimer: NodeJS.Timeout | null = null;

async function lanReq(method: 'GET' | 'POST', route: string, body?: unknown): Promise<LanResponse> {
  const cfg = getNetConfig();
  return lanRequest(cfg.host, cfg.port, method, route, body);
}

function markLanOk(): void {
  lanReachable = true;
  lanError = null;
}

function markLanDown(error?: string): void {
  lanReachable = false;
  lanError = error ?? 'Cannot reach the network database.';
}

function setRemote(d: AppData): void {
  remoteCache = d;
  try { remoteKey = JSON.stringify(d); } catch { remoteKey = ''; }
  broadcast('data:changed', d);
}

/** POST to the host that changes data; the response carries the fresh snapshot. */
async function lanForwardAction(route: string, body: unknown): Promise<IpcResult> {
  const r = await lanReq('POST', route, body);
  if (!r.ok) {
    markLanDown(r.error);
    return fail(new Error(r.error ?? 'Cannot reach the network database.'));
  }
  markLanOk();
  const payload = r.body as { ok?: boolean; error?: string; data?: AppData } | null;
  if (payload?.data) setRemote(payload.data);
  if (!payload || payload.ok === false) {
    return fail(new Error(payload?.error ?? 'The host computer rejected the request.'));
  }
  return ok(true);
}

/** POST to the host whose answer is itself an IpcResult (login / scan). */
async function lanForwardQuery<T>(route: string, body: unknown): Promise<IpcResult<T>> {
  const r = await lanReq('POST', route, body);
  if (!r.ok) {
    markLanDown(r.error);
    return { ok: false, error: r.error ?? 'Cannot reach the network database.' };
  }
  markLanOk();
  const payload = r.body as { result?: IpcResult<T>; data?: AppData } | null;
  if (payload?.data) setRemote(payload.data);
  if (payload?.result) return payload.result;
  return { ok: false, error: 'Invalid response from the host computer.' };
}

async function lanGetData(): Promise<{ ok: boolean; data?: AppData; error?: string }> {
  const r = await lanReq('GET', '/data');
  if (r.ok && r.body && r.body.ok === true && r.body.data) {
    const d = r.body.data as AppData;
    markLanOk();
    // Serve from the cache while the host is briefly unreachable; mutations
    // still fail loudly so this computer can never drift into a shadow copy.
    remoteCache = d;
    try { remoteKey = JSON.stringify(d); } catch { remoteKey = ''; }
    return { ok: true, data: d };
  }
  markLanDown(r.error);
  if (remoteCache) return { ok: true, data: remoteCache };
  return { ok: false, error: lanError ?? 'Cannot reach the network database.' };
}

async function remoteSnapshot(): Promise<AppData> {
  const r = await lanGetData();
  if (!r.ok || !r.data) throw new Error(r.error ?? 'Cannot reach the network database.');
  return r.data;
}

/** Revision poll: the host bumps a counter on each write, so we only fetch
 *  the (potentially multi-MB) snapshot when something actually changed. */
function startLanPolling(): void {
  if (lanPollTimer) return;
  const tick = async (): Promise<void> => {
    const rev = await lanReq('GET', '/rev');
    if (!rev.ok || !rev.body || rev.body.ok !== true) {
      markLanDown(rev.error);
      return;
    }
    markLanOk();
    const n = typeof rev.body.rev === 'number' ? rev.body.rev : null;
    if (n === null || n === lastRev) return;
    const res = await lanReq('GET', '/data');
    if (!res.ok || !res.body || res.body.ok !== true || !res.body.data) return;
    lastRev = n;
    const d = res.body.data as AppData;
    let key = '';
    try { key = JSON.stringify(d); } catch { /* treat as changed */ }
    if (key !== remoteKey) setRemote(d);
  };
  void tick();
  lanPollTimer = setInterval(() => { void tick(); }, 3000);
}

function stopLanPolling(): void {
  if (lanPollTimer) {
    clearInterval(lanPollTimer);
    lanPollTimer = null;
  }
}

function netStatus(): NetStatus {
  const cfg = getNetConfig();
  return {
    ...cfg,
    shareActive: lanServerRunning(),
    ips: localLanIps(),
    reachable: lanReachable,
    error: lanError
  };
}

// ---------- shared operation handlers (IPC and the LAN server use these) ----------

async function handleGetData(): Promise<IpcResult> {
  if (isLanMode()) {
    const r = await lanGetData();
    if (r.ok && r.data) return ok(r.data);
    return fail(new Error(r.error ?? 'Cannot reach the network database.'));
  }
  return ok(loadData());
}

async function verifyCredentials(username: string, password: string): Promise<IpcResult<{ role: 'admin' | 'teacher' }>> {
  if (isLanMode()) return lanForwardQuery<{ role: 'admin' | 'teacher' }>('/login', { username, password });
  try {
    const d = loadData();
    const u = d.users.find(x => x.username.toLowerCase() === String(username ?? '').trim().toLowerCase());
    if (!u || u.passwordHash !== hashPassword(String(password ?? ''))) {
      return fail(new Error('Wrong username or password.'));
    }
    return ok({ role: u.role });
  } catch (err) { return fail(err); }
}

async function handlePatch(patch: Partial<AppData>): Promise<IpcResult> {
  if (isLanMode()) return lanForwardAction('/patch', { patch });
  try {
    patchData(d => Object.assign(d, patch));
    broadcast('data:changed', loadData());
    return ok(true);
  } catch (err) { return fail(err); }
}

async function handleScan(code: string, nowMs?: number): Promise<IpcResult<ScanResult>> {
  if (isLanMode()) return lanForwardQuery<ScanResult>('/scan', { code, nowMs });
  try {
    const d = loadData();
    const res = processScan(d, code, nowMs);
    // Queue parent SMS for student scans
    if (res.ok && (res.kind === 'student_in' || res.kind === 'student_out')) {
      const student = d.students.find(s => s.id === res.personId);
      if (student && d.settings.smsEnabled) {
        const guardian = student.guardianId ? d.guardians.find(g => g.id === student.guardianId) : null;
        const number = guardian?.number || student.number;
        if (number) {
          gsm.enqueue(d, {
            ts: Date.now(),
            to: number,
            body: GsmModule.parentBody(
              res.kind === 'student_in' ? 'arrival' : 'departure',
              `${student.firstName} ${student.lastName}`,
              new Date().toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit' }),
              res.kind === 'student_in' ? (res.statusCategory === 'early' ? 'early' : res.statusCategory === 'on_time' ? 'on time' : 'late') : undefined,
              d.settings.schoolName
            ),
            studentId: student.id,
            kind: res.kind === 'student_in' ? 'arrival' : 'departure'
          });
        }
      }
      // Email notification to the guardian (Gmail / SMTP)
      if (student && d.settings.emailEnabled) {
        const guardian = student.guardianId ? d.guardians.find(g => g.id === student.guardianId) : null;
        const email = guardian?.email?.trim();
        if (email) {
          const time12 = new Date().toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit' });
          const punctual = res.kind === 'student_in'
            ? (res.statusCategory === 'early' ? 'early' : res.statusCategory === 'on_time' ? 'on time' : 'late')
            : undefined;
          const { subject, body } = EmailModule.parentMail(
            res.kind === 'student_in' ? 'arrival' : 'departure',
            `${student.firstName} ${student.lastName}`,
            time12,
            punctual,
            d.settings.schoolName
          );
          emailer.enqueue(d, {
            ts: Date.now(),
            to: email,
            subject,
            body,
            studentId: student.id,
            kind: res.kind === 'student_in' ? 'arrival' : 'departure'
          });
        }
      }
    }
    saveData();
    broadcast('data:changed', d);
    return ok(res);
  } catch (err) { return fail(err); }
}

async function handleSlotReason(slotId: string, date: string, reason: string | null, note: string): Promise<IpcResult> {
  if (isLanMode()) return lanForwardAction('/slot', { slotId, date, reason, note });
  try {
    patchData(d => {
      const id = `${slotId}|${date}`;
      const idx = d.slotStatuses.findIndex(s => s.id === id);
      if (reason === null) {
        if (idx >= 0) d.slotStatuses.splice(idx, 1);
      } else if (idx >= 0) {
        d.slotStatuses[idx] = { id, reason: reason as never, note, date };
      } else {
        d.slotStatuses.push({ id, reason: reason as never, note, date });
      }
    });
    broadcast('data:changed', loadData());
    return ok(true);
  } catch (err) { return fail(err); }
}

async function handleRetry(kind: 'sms' | 'email', id: string): Promise<IpcResult> {
  if (isLanMode()) return lanForwardAction('/retry', { kind, id });
  try {
    patchData(d => {
      if (kind === 'sms') gsm.retryFailed(d, id);
      else emailer.retryFailed(d, id);
    });
    broadcast('data:changed', loadData());
    return ok(true);
  } catch (err) { return fail(err); }
}

async function handleAnnounceAdd(a: Announcement): Promise<IpcResult> {
  if (isLanMode()) return lanForwardAction('/announce/add', { announcement: a });
  try {
    patchData(d => { d.announcements.push(a); });
    broadcast('data:changed', loadData());
    return ok(true);
  } catch (err) { return fail(err); }
}

async function handleAnnounceRemove(id: string): Promise<IpcResult> {
  if (isLanMode()) return lanForwardAction('/announce/remove', { id });
  try {
    patchData(d => { d.announcements = d.announcements.filter(x => x.id !== id); });
    broadcast('data:changed', loadData());
    return ok(true);
  } catch (err) { return fail(err); }
}

/** The exact handler set the LAN sharing server exposes (host side). */
function buildLanHandlers(): LanHandlers {
  return {
    getData: async () => loadData(),
    login: verifyCredentials,
    patch: handlePatch,
    scan: handleScan,
    slotReason: handleSlotReason,
    retry: handleRetry,
    announceAdd: handleAnnounceAdd,
    announceRemove: handleAnnounceRemove
  };
}

/** Applies a new network/storage-mode config (Settings → Database). */
async function applyNetConfig(cfg: NetConfig): Promise<{ ok: boolean; error?: string }> {
  const prev = getNetConfig();
  const normalized: NetConfig = {
    mode: cfg.mode === 'lan' ? 'lan' : 'local',
    host: String(cfg.host ?? '').trim(),
    share: cfg.share === true,
    port: Number.isInteger(cfg.port) && cfg.port > 0 ? cfg.port : prev.port
  };
  setNetConfig(normalized);
  stopLanServer();
  stopLanPolling();

  if (normalized.mode === 'lan') {
    // Disable the local database connection and the hardware loops; from now
    // on every operation runs on the host computer.
    disconnectSqlite();
    gsm.stop();
    emailer.stop();
    remoteCache = null;
    remoteKey = '';
    lastRev = null;
    lanReachable = null;
    lanError = null;
    const probe = await lanProbe(normalized.host, normalized.port);
    if (probe.ok) {
      markLanOk();
      startLanPolling();
      const snap = await lanGetData();
      if (snap.ok && snap.data) broadcast('data:changed', snap.data);
      return { ok: true };
    }
    markLanDown(probe.error);
    startLanPolling();
    return { ok: true, error: probe.error ?? 'Could not reach that computer.' };
  }

  // Back to this computer's own storage after a LAN session.
  if (prev.mode === 'lan') {
    await initStore();
    const s = loadData().settings;
    gsm.configure(s.gsmPort, s.gsmBaud);
    gsm.start();
    emailer.start();
    broadcast('data:changed', loadData());
  }
  if (normalized.share) {
    const started = await startLanServer(normalized.port, buildLanHandlers());
    if (!started.ok) return { ok: true, error: started.error };
  }
  return { ok: true };
}

function wireWindowEvents(w: BrowserWindow): void {
  const send = (): void => { if (!w.isDestroyed()) w.webContents.send('win:state', { maximized: w.isMaximized() }); };
  w.on('maximize', send);
  w.on('unmaximize', send);
}

const LAN_LOCAL_HINT = 'This computer uses a network database — switch back to "This computer\'s database" first.';

function registerIpc(): void {
  ipcMain.handle('win:minimize', () => { (scanWin && !scanWin.isDestroyed() && scanWin.isFocused() ? scanWin : adminWin)?.minimize(); return ok(true); });
  ipcMain.handle('win:maximize', (_e, target?: 'admin' | 'scanner') => {
    const w = target === 'scanner'
      ? (scanWin && !scanWin.isDestroyed() ? scanWin : adminWin)
      : (adminWin && !adminWin.isDestroyed() ? adminWin : scanWin);
    if (w && !w.isDestroyed()) { w.isMaximized() ? w.unmaximize() : w.maximize(); }
    return ok(true);
  });
  ipcMain.handle('win:close', (_e, target?: 'admin' | 'scanner') => {
    const w = target === 'scanner'
      ? (scanWin && !scanWin.isDestroyed() ? scanWin : adminWin)
      : (adminWin && !adminWin.isDestroyed() ? adminWin : scanWin);
    if (w && !w.isDestroyed()) w.close();
    return ok(true);
  });
  ipcMain.handle('data:get', (): Promise<IpcResult> => handleGetData());

  // Kiosk login: verifies against the user accounts managed in Settings → Users,
  // then opens the admin panel (the scanner window stays open).
  ipcMain.handle('auth:login', async (_e, username: string, password: string): Promise<IpcResult> => {
    const res = await verifyCredentials(username, password);
    if (res.ok) showAdminWindow();
    return res;
  });

  ipcMain.handle('data:patch', (_e, patch: Partial<AppData>): Promise<IpcResult> => handlePatch(patch));

  // handleScan above holds the scan engine wiring; it also forwards scans to
  // the host when this computer runs in LAN mode.
  ipcMain.handle('scan', (_e, code: string, nowMs?: number): Promise<IpcResult<ScanResult>> => handleScan(code, nowMs));

  ipcMain.handle('slot:reason', (_e, slotId: string, date: string, reason: string | null, note: string): Promise<IpcResult> =>
    handleSlotReason(slotId, date, reason, note));

  ipcMain.handle('sms:retry', (_e, id: string): Promise<IpcResult> => handleRetry('sms', id));

  ipcMain.handle('email:retry', (_e, id: string): Promise<IpcResult> => handleRetry('email', id));

  ipcMain.handle('smtp:verify', async (_e, cfg: { host: string; port: number; secure: boolean; user: string; pass: string }): Promise<IpcResult> => {
    try {
      await emailer.verify(cfg.user, cfg.pass, cfg.host, cfg.port, cfg.secure);
      return ok(true);
    } catch (err) { return fail(err); }
  });

  ipcMain.handle('windows:openScanner', (): IpcResult => {
    createScannerWindow();
    return ok(true);
  });

  ipcMain.handle('windows:toggleFullscreen', (): IpcResult => {
    const w = scanWin && !scanWin.isDestroyed() ? scanWin : adminWin;
    if (w) w.setFullScreen(!w.isFullScreen());
    return ok(true);
  });

  ipcMain.handle('report:build', async (_e, params: ReportParams): Promise<IpcResult> => {
    try {
      const d = isLanMode() ? await remoteSnapshot() : loadData();
      const { buffer, filename } = await buildReport(d, params);
      const res = await dialog.showSaveDialog(adminWin!, {
        title: 'Save report',
        defaultPath: filename,
        filters: [{ name: 'Excel', extensions: ['xlsx'] }]
      });
      if (res.canceled || !res.filePath) return ok({ saved: false, filename });
      const fs = await import('fs');
      fs.writeFileSync(res.filePath, buffer);
      return ok({ saved: true, filename: res.filePath });
    } catch (err) { return fail(err); }
  });

  ipcMain.handle('announce:add', (_e, a: Announcement): Promise<IpcResult> => handleAnnounceAdd(a));

  ipcMain.handle('announce:remove', (_e, id: string): Promise<IpcResult> => handleAnnounceRemove(id));

  ipcMain.handle('app:info', (): IpcResult => ok({
    dataDir: getDataDir(),
    today: todayStr(),
    platform: process.platform
  }));

  ipcMain.handle('db:status', (): IpcResult => {
    return ok({
      ...dbStatus(),
      config: getDbConfig(),
      net: netStatus()
    });
  });

  ipcMain.handle('db:saveConfig', async (_e, cfg: DbConfig, testOnly: boolean): Promise<IpcResult> => {
    if (isLanMode()) return fail(new Error(LAN_LOCAL_HINT));
    try {
      return ok(await applyDbConfig(cfg, testOnly));
    } catch (err) { return fail(err); }
  });

  ipcMain.handle('db:connect', async (): Promise<IpcResult> => {
    if (isLanMode()) return fail(new Error(LAN_LOCAL_HINT));
    const res = await connectSqlite();
    if (res.ok) broadcast('data:changed', loadData());
    return res.ok ? ok(true) : fail(new Error(res.error ?? 'Connection failed'));
  });

  ipcMain.handle('db:disconnect', (): IpcResult => {
    if (isLanMode()) return fail(new Error(LAN_LOCAL_HINT));
    disconnectSqlite();
    broadcast('data:changed', loadData());
    return ok(true);
  });

  ipcMain.handle('db:importJson', async (): Promise<IpcResult> => {
    if (isLanMode()) return fail(new Error(LAN_LOCAL_HINT));
    try {
      await importJsonToSqlite();
      broadcast('data:changed', loadData());
      return ok(true);
    } catch (err) { return fail(err); }
  });

  // Network / storage mode (Settings → Database): test and apply.
  ipcMain.handle('net:save', async (_e, cfg: NetConfig, testOnly: boolean): Promise<IpcResult<{ ok: boolean; error?: string }>> => {
    try {
      if (testOnly) {
        if (cfg.mode !== 'lan') return ok({ ok: true });
        const probe = await lanProbe(String(cfg.host ?? ''), cfg.port);
        return ok({ ok: probe.ok, error: probe.error });
      }
      return ok(await applyNetConfig(cfg));
    } catch (err) { return fail(err); }
  });

  ipcMain.handle('update:status', (): IpcResult => ok(updateStatus()));
  ipcMain.handle('update:check', async (): Promise<IpcResult> => {
    try {
      const status = await checkForUpdates();
      return ok(status);
    } catch (err) { return fail(err); }
  });
  ipcMain.handle('update:download', async (): Promise<IpcResult> => {
    try {
      const status = await downloadUpdate();
      return ok(status);
    } catch (err) { return fail(err); }
  });
  ipcMain.handle('update:install', (): IpcResult => {
    installUpdate();
    return ok(true);
  });
  ipcMain.handle('update:setToken', (_e, token: string): IpcResult => {
    try {
      setGithubToken(token);
      return ok(true);
    } catch (err) { return fail(err); }
  });
}

let quitting = false;
app.on('before-quit', e => {
  if (!quitting) {
    // Hold the quit until the stores are flushed (flushSave is async).
    e.preventDefault();
    quitting = true;
    void flushSave().finally(() => {
      stopLanPolling();
      stopLanServer();
      gsm.stop();
      emailer.stop();
      app.quit();
    });
  }
});

void app.whenReady().then(async () => {
  registerIpc();
  await initStore();
  if (isLanMode()) {
    // Client of a network database: no local storage and no GSM/SMTP loop here
    // — scans run on the host computer, which queues parent SMS/email itself.
    startLanPolling();
  } else {
    gsm.configure(loadData().settings.gsmPort, loadData().settings.gsmBaud);
    gsm.start();
    emailer.start();
  }
  // Host side: start the sharing server when this computer serves its database.
  {
    const net = getNetConfig();
    if (net.mode === 'local' && net.share) {
      void startLanServer(net.port, buildLanHandlers()).then(r => {
        if (!r.ok) console.error('LAN sharing failed to start:', r.error);
      });
    }
  }
  // Auto-update: silent check on launch; only packaged builds do anything.
  if (!DEV_URL && app.isPackaged) {
    initUpdater((e: UpdateEvent) => broadcast('update:event', e));
    setTimeout(() => { void checkForUpdates(); }, 8000);
  }
  createAdminWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createAdminWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
