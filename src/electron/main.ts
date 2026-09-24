import { app, BrowserWindow, ipcMain, dialog } from 'electron';
import * as path from 'path';
import {
  loadData, patchData, saveData, flushSave, getDataDir,
  initStore, getDbConfig, applyDbConfig, connectSqlite, disconnectSqlite,
  importJsonToSqlite, dbStatus
} from './store';
import type { AppData } from '../shared/types';
import { processScan } from './attendance';
import { GsmModule } from './gsm';
import { EmailModule } from './email';
import { buildReport } from './reports';
import { todayStr } from './timeutil';
import type { Announcement, IpcResult, ReportParams, UpdateEvent } from '../shared/types';
import type { DbConfig } from './db';
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
    title: 'Bantay Pasok · Admin',
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
    show: false,
    frame: false,
    backgroundColor: '#0e3a2f',
    title: 'Bantay Pasok · Scanner',
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

function wireWindowEvents(w: BrowserWindow): void {
  const send = (): void => { if (!w.isDestroyed()) w.webContents.send('win:state', { maximized: w.isMaximized() }); };
  w.on('maximize', send);
  w.on('unmaximize', send);
}

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
  ipcMain.handle('data:get', (): IpcResult => ok(loadData()));

  ipcMain.handle('data:patch', (_e, patch: Partial<AppData>) => {
    try {
      patchData(d => Object.assign(d, patch));
      broadcast('data:changed', loadData());
      return ok(true);
    } catch (err) { return fail(err); }
  });

  ipcMain.handle('scan', (_e, code: string, nowMs?: number): IpcResult => {
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
  });

  ipcMain.handle('slot:reason', (_e, slotId: string, date: string, reason: string | null, note: string): IpcResult => {
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
  });

  ipcMain.handle('sms:retry', (_e, id: string): IpcResult => {
    try {
      patchData(d => gsm.retryFailed(d, id));
      broadcast('data:changed', loadData());
      return ok(true);
    } catch (err) { return fail(err); }
  });

  ipcMain.handle('email:retry', (_e, id: string): IpcResult => {
    try {
      patchData(d => emailer.retryFailed(d, id));
      broadcast('data:changed', loadData());
      return ok(true);
    } catch (err) { return fail(err); }
  });

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
      const d = loadData();
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

  ipcMain.handle('announce:add', (_e, a: Announcement): IpcResult => {
    try {
      patchData(d => { d.announcements.push(a); });
      broadcast('data:changed', loadData());
      return ok(true);
    } catch (err) { return fail(err); }
  });

  ipcMain.handle('announce:remove', (_e, id: string): IpcResult => {
    try {
      patchData(d => { d.announcements = d.announcements.filter(x => x.id !== id); });
      broadcast('data:changed', loadData());
      return ok(true);
    } catch (err) { return fail(err); }
  });

  ipcMain.handle('app:info', (): IpcResult => ok({
    dataDir: getDataDir(),
    today: todayStr(),
    platform: process.platform
  }));

  ipcMain.handle('db:status', (): IpcResult => {
    const cfg = getDbConfig();
    return ok({
      ...dbStatus(),
      config: cfg
    });
  });

  ipcMain.handle('db:saveConfig', async (_e, cfg: DbConfig, testOnly: boolean): Promise<IpcResult> => {
    try {
      return ok(await applyDbConfig(cfg, testOnly));
    } catch (err) { return fail(err); }
  });

  ipcMain.handle('db:connect', async (): Promise<IpcResult> => {
    const res = await connectSqlite();
    if (res.ok) broadcast('data:changed', loadData());
    return res.ok ? ok(true) : fail(new Error(res.error ?? 'Connection failed'));
  });

  ipcMain.handle('db:disconnect', (): IpcResult => {
    disconnectSqlite();
    broadcast('data:changed', loadData());
    return ok(true);
  });

  ipcMain.handle('db:importJson', async (): Promise<IpcResult> => {
    try {
      await importJsonToSqlite();
      broadcast('data:changed', loadData());
      return ok(true);
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
      gsm.stop();
      emailer.stop();
      app.quit();
    });
  }
});

void app.whenReady().then(async () => {
  registerIpc();
  await initStore();
  gsm.configure(loadData().settings.gsmPort, loadData().settings.gsmBaud);
  gsm.start();
  emailer.start();
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
