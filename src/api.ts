import type { AppData, IpcResult, ReportParams, ScanResult, Announcement, UpdateEvent, UpdateStatusInfo } from './shared/types';
import { buildSeedData, hashPassword } from './shared/seed';
import { normalizeTerms } from './shared/constants';
import { processScan } from './shared/scan';

export interface DbConfigView {
  enabled: boolean;
  file: string;
}

export interface BantayApi {
  getData(): Promise<IpcResult<AppData>>;
  login(username: string, password: string): Promise<IpcResult<{ role: 'admin' | 'teacher' }>>;
  patchData(patch: Partial<AppData>): Promise<IpcResult>;
  scan(code: string): Promise<IpcResult<ScanResult>>;
  setSlotReason(slotId: string, date: string, reason: string | null, note: string): Promise<IpcResult>;
  smsRetry(id: string): Promise<IpcResult>;
  emailRetry(id: string): Promise<IpcResult>;
  smtpVerify(cfg: { host: string; port: number; secure: boolean; user: string; pass: string }): Promise<IpcResult>;
  openScanner(): Promise<IpcResult>;
  toggleFullscreen(): Promise<IpcResult>;
  winMinimize(): Promise<IpcResult>;
  winMaximize(target?: 'admin' | 'scanner'): Promise<IpcResult>;
  winClose(target?: 'admin' | 'scanner'): Promise<IpcResult>;
  onWinState(cb: (s: { maximized: boolean }) => void): () => void;
  buildReport(params: ReportParams): Promise<IpcResult<{ saved: boolean; filename: string }>>;
  addAnnouncement(a: Announcement): Promise<IpcResult>;
  removeAnnouncement(id: string): Promise<IpcResult>;
  appInfo(): Promise<IpcResult<{ dataDir: string; today: string; platform: string }>>;
  dbStatus(): Promise<IpcResult<{ enabled: boolean; lastError: string | null; config: DbConfigView }>>;
  saveDbConfig(cfg: DbConfigView, testOnly: boolean): Promise<IpcResult<{ ok: boolean; version?: string; error?: string }>>;
  dbConnect(): Promise<IpcResult>;
  dbDisconnect(): Promise<IpcResult>;
  dbImportJson(): Promise<IpcResult>;
  updateStatus(): Promise<IpcResult<UpdateStatusInfo>>;
  updateCheck(): Promise<IpcResult<UpdateStatusInfo>>;
  updateDownload(): Promise<IpcResult<UpdateStatusInfo>>;
  updateInstall(): Promise<IpcResult>;
  updateSetToken(token: string): Promise<IpcResult>;
  onUpdateEvent(cb: (e: UpdateEvent) => void): () => void;
  onDataChanged(cb: (d: AppData) => void): () => void;
}

declare global {
  interface Window {
    api?: BantayApi;
  }
}

// In-browser mock fallback if running directly in browser outside Electron
function createBrowserFallback(): BantayApi {
  const STORAGE_KEY = 'bantay_pasok_browser_data';
  const listeners: Set<(d: AppData) => void> = new Set();

  function loadLocal(): AppData {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const d = JSON.parse(raw) as AppData;
        // Defensive backfill for data written by older builds.
        if (!Array.isArray(d.emails)) d.emails = [];
        d.settings.terms = normalizeTerms(d.settings.terms);
        return d;
      }
    } catch { /* ignore */ }
    const initial = buildSeedData();
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(initial)); } catch { /* ignore */ }
    return initial;
  }

  function saveLocal(d: AppData): void {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(d)); } catch { /* ignore */ }
    listeners.forEach(cb => cb(d));
  }

  return {
    async getData() {
      return { ok: true, data: loadLocal() };
    },
    async login(username, password) {
      const d = loadLocal();
      const u = d.users.find(x => x.username.toLowerCase() === username.trim().toLowerCase());
      if (!u || u.passwordHash !== hashPassword(password)) {
        return { ok: false, error: 'Wrong username or password.' };
      }
      return { ok: true, data: { role: u.role } };
    },
    async patchData(patch: Partial<AppData>) {
      const d = loadLocal();
      Object.assign(d, patch);
      saveLocal(d);
      return { ok: true };
    },
    async scan(code: string) {
      const d = loadLocal();
      // ONE scan engine with the desktop app (src/shared/scan.ts): duplicate
      // gating, classification, and the attendance/class-event records are all
      // shared, so preview and packaged behavior cannot drift apart again.
      const res = processScan(d, code);

      // Browser-only transport: there is no GSM modem or SMTP here, so parent
      // notices are queued as already-sent. The desktop app enqueues pending
      // messages through gsm.ts / email.ts after the same shared scan.
      const now = Date.now();
      if (res.ok && (res.kind === 'student_in' || res.kind === 'student_out')) {
        const st = d.students.find(s => s.id === res.personId);
        const guardian = st?.guardianId ? d.guardians.find(g => g.id === st.guardianId) : null;
        const sec = st ? d.sections.find(x => x.id === st.sectionId) : undefined;
        const secName = sec ? sec.name.replace(' - ', ' • ') : 'Student';
        const arrived = res.kind === 'student_in';
        const fullName = st ? `${st.firstName} ${st.lastName}` : '';
        if (st && d.settings.smsEnabled) {
          const to = guardian?.number || st.number;
          if (to) {
            d.sms.push({
              id: `sms_${now}`,
              ts: now,
              to,
              body: arrived
                ? `Good morning! Your child ${fullName} (${secName}) arrived at school. – ${d.settings.schoolName}`
                : `Your child ${fullName} (${secName}) left school. Safe travels! – ${d.settings.schoolName}`,
              studentId: st.id,
              kind: arrived ? 'arrival' : 'departure',
              status: 'sent',
              attempts: 1
            });
          }
        }
        if (st && d.settings.emailEnabled && guardian?.email) {
          d.emails.push({
            id: `em_${now}`,
            ts: now,
            to: guardian.email,
            subject: `[${d.settings.schoolName}] ${arrived ? 'Arrival' : 'Departure'} notice - ${fullName}`,
            body: arrived
              ? `Good day! ${fullName} arrived at school. - ${d.settings.emailFromName}`
              : `${fullName} left school. Safe travels! - ${d.settings.emailFromName}`,
            studentId: st.id,
            kind: arrived ? 'arrival' : 'departure',
            status: 'sent',
            attempts: 1
          });
        }
      }
      saveLocal(d);
      return res.ok ? { ok: true, data: res } : { ok: false, data: res };
    },
    async setSlotReason(slotId, date, reason, note) {
      const d = loadLocal();
      const id = `${slotId}|${date}`;
      const idx = d.slotStatuses.findIndex(s => s.id === id);
      if (reason === null) {
        if (idx >= 0) d.slotStatuses.splice(idx, 1);
      } else if (idx >= 0) {
        d.slotStatuses[idx] = { id, reason: reason as never, note, date };
      } else {
        d.slotStatuses.push({ id, reason: reason as never, note, date });
      }
      saveLocal(d);
      return { ok: true };
    },
    async smsRetry(id) {
      const d = loadLocal();
      const m = d.sms.find(s => s.id === id);
      if (m) m.status = 'sent';
      saveLocal(d);
      return { ok: true };
    },
    async emailRetry(id) {
      const d = loadLocal();
      const m = d.emails.find(s => s.id === id);
      if (m) m.status = 'sent';
      saveLocal(d);
      return { ok: true };
    },
    async smtpVerify(_cfg) {
      // Simulated in-browser: pretend verification succeeded.
      await new Promise(r => setTimeout(r, 600));
      return { ok: true };
    },
    async openScanner() {
      window.open('#/scanner', '_blank', 'width=1280,height=800');
      return { ok: true };
    },
    async toggleFullscreen() {
      if (document.fullscreenElement) void document.exitFullscreen();
      else void document.documentElement.requestFullscreen();
      return { ok: true };
    },
    async winMinimize() {
      return { ok: false, error: 'Window controls are only available in the desktop app' };
    },
    async winMaximize(_target) {
      return { ok: false, error: 'Window controls are only available in the desktop app' };
    },
    async winClose(_target) {
      return { ok: false, error: 'Window controls are only available in the desktop app' };
    },
    onWinState(_cb) {
      return () => {};
    },
    async buildReport(params) {
      return { ok: true, data: { saved: true, filename: `Attendance_Report_${params.from}_${params.to}.xlsx` } };
    },
    async addAnnouncement(a) {
      const d = loadLocal();
      d.announcements.push(a);
      saveLocal(d);
      return { ok: true };
    },
    async removeAnnouncement(id) {
      const d = loadLocal();
      d.announcements = d.announcements.filter(x => x.id !== id);
      saveLocal(d);
      return { ok: true };
    },
    async appInfo() {
      return { ok: true, data: { dataDir: 'LocalBrowserStorage', today: new Date().toISOString().slice(0, 10), platform: 'web' } };
    },
    async dbStatus() {
      return {
        ok: true,
        data: {
          enabled: false,
          lastError: null,
          config: { enabled: false, file: '' }
        }
      };
    },
    async saveDbConfig(_cfg, _testOnly) {
      return { ok: false, error: 'SQLite is only available in the desktop app' } as IpcResult<{ ok: boolean; error?: string }>;
    },
    async dbConnect() {
      return { ok: false, error: 'SQLite is only available in the desktop app' };
    },
    async dbDisconnect() {
      return { ok: true };
    },
    async dbImportJson() {
      return { ok: false, error: 'SQLite is only available in the desktop app' };
    },
    async updateStatus() {
      return { ok: false, error: 'Software updates are only available in the desktop app' } as IpcResult<UpdateStatusInfo>;
    },
    async updateCheck() {
      return { ok: false, error: 'Software updates are only available in the desktop app' } as IpcResult<UpdateStatusInfo>;
    },
    async updateDownload() {
      return { ok: false, error: 'Software updates are only available in the desktop app' } as IpcResult<UpdateStatusInfo>;
    },
    async updateSetToken(_token) {
      return { ok: false, error: 'Software updates are only available in the desktop app' };
    },
    async updateInstall() {
      return { ok: false, error: 'Software updates are only available in the desktop app' };
    },
    onUpdateEvent(_cb) {
      return () => {};
    },
    onDataChanged(cb) {
      listeners.add(cb);
      return () => { listeners.delete(cb); };
    }
  };
}

export const api: BantayApi = typeof window !== 'undefined' && window.api ? window.api : createBrowserFallback();

