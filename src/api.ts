import type { AppData, IpcResult, ReportParams, ScanResult, Announcement, SlotTimeWindows, Student, UpdateEvent, UpdateStatusInfo } from './shared/types';
import { buildSeedData, hashPassword } from './shared/seed';
import { timeToMin, fmt12, normalizeTerms, windowsForSection } from './shared/constants';

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

  /** The AM/PM scan windows for a student (mirrors electron/attendance.ts). */
  function windowsFor(d: AppData, st: Student): SlotTimeWindows {
    const sec = d.sections.find(x => x.id === st.sectionId);
    return windowsForSection(sec, d.settings);
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
      const raw = code.trim().toUpperCase();
      const teacher = d.teachers.find(t => t.qr.toUpperCase() === raw || t.id.toUpperCase() === raw);
      const student = d.students.find(s => s.qr.toUpperCase() === raw || s.id.toUpperCase() === raw);
      if (!teacher && !student) {
        return { ok: false, data: { ok: false, kind: 'unknown', message: 'ID not recognized. Please see the admin.', statusCategory: 'error' } };
      }
      const now = Date.now();
      const pid = teacher ? teacher.id : student!.id;
      const recent = d.scans.find(s => s.personId === pid && now - s.ts < 60_000);
      if (recent) {
        const p = teacher || student!;
        return {
          ok: false,
          data: {
            ok: false,
            kind: 'duplicate',
            name: p.firstName,
            message: `Already scanned, ${p.firstName}. Please wait a moment.`,
            statusCategory: 'error'
          }
        };
      }
      d.scans.push({ id: `scan_${now}`, personId: pid, role: teacher ? 'teacher' : 'student', ts: now, kind: 'in' });

      if (teacher) {
        const dep = d.departments.find(x => x.id === teacher.departmentId);
        const sec = d.sections[0];
        const res: ScanResult = {
          ok: true,
          kind: 'teacher',
          personId: teacher.id,
          name: teacher.firstName,
          message: `Welcome, Ma'am/Sir ${teacher.firstName}. Have a great class!`,
          statusCategory: 'teacher',
          qr: teacher.qr,
          subDetail: dep ? `${dep.name} Department` : 'Faculty',
          detail: `Period 3 · ${sec ? sec.name.split(' - ')[0] : ''} · Filipino · 9:30 AM`,
          photoData: teacher.photoData,
          sex: teacher.sex
        };
        saveLocal(d);
        return { ok: true, data: res };
      }

      const st = student!;
      const evs = d.attendance.filter(e => e.studentId === st.id);
      const hasIn = evs.some(e => e.kind === 'in');
      const sec = d.sections.find(x => x.id === st.sectionId);
      const secName = sec ? sec.name.replace(' - ', ' • ') : 'Grade 8 • Narra';

      if (!hasIn) {
        d.attendance.push({ id: `att_${now}`, studentId: st.id, date: new Date(now).toISOString().slice(0, 10), ts: now, kind: 'in' });
        const dt = new Date(now);
        const mins = dt.getHours() * 60 + dt.getMinutes();
        // Per-grade windows: Swiped in before AM in, Perfectly on time until PM in.
        const w = windowsFor(d, st);
        const earlyC = timeToMin(w.amIn);
        const lateC = timeToMin(w.pmIn);
        let msg = 'Just-in-time.\nHave an amazing day.';
        let cat: 'early' | 'on_time' | 'late' = 'late';
        if (mins < earlyC) { msg = 'Swiped in!\nHave an amazing day.'; cat = 'early'; }
        else if (mins <= lateC) { msg = 'Perfectly on time!\nHave an amazing day.'; cat = 'on_time'; }

        // queue mock SMS to guardian (real pipeline resolves the guardian's number; st.number is the fallback)
        const guardianIn = st.guardianId ? d.guardians.find(g => g.id === st.guardianId) : null;
        const smsTo = guardianIn?.number || st.number;
        if (smsTo) {
          d.sms.push({
            id: `sms_${now}`,
            ts: now,
            to: smsTo,
            body: `Good morning! Your child ${st.firstName} ${st.lastName} (${secName}) arrived at school. – ${d.settings.schoolName}`,
            studentId: st.id,
            kind: 'arrival',
            status: 'sent',
            attempts: 1
          });
        }
        // queue mock email to guardian
        const guardian = st.guardianId ? d.guardians.find(g => g.id === st.guardianId) : null;
        if (guardian?.email) {
          d.emails.push({
            id: `em_${now}`,
            ts: now,
            to: guardian.email,
            subject: `[${d.settings.schoolName}] Arrival notice - ${st.firstName} ${st.lastName}`,
            body: `Good day! ${st.firstName} ${st.lastName} arrived at school. - ${d.settings.emailFromName}`,
            studentId: st.id,
            kind: 'arrival',
            status: 'sent',
            attempts: 1
          });
        }

        const res: ScanResult = {
          ok: true,
          kind: 'student_in',
          personId: st.id,
          name: st.firstName,
          message: msg,
          statusCategory: cat,
          qr: st.qr,
          subDetail: secName,
          detail: 'Your parent has been notified by text message',
          photoData: st.photoData,
          sex: st.sex
        };
        saveLocal(d);
        return { ok: true, data: res };
      }

      // Departure only records inside the grade's AM-out or PM-out window;
      // otherwise the tap is treated as a duplicate (mirrors electron/attendance.ts).
      const wOut = windowsFor(d, st);
      const nowMin = new Date(now).getHours() * 60 + new Date(now).getMinutes();
      const amOutM = timeToMin(wOut.amOut);
      const pmOutM = timeToMin(wOut.pmOut);
      const canLeave = (nowMin >= amOutM && nowMin < amOutM + 90) || nowMin >= pmOutM;
      if (!canLeave) {
        return {
          ok: false,
          data: {
            ok: false,
            kind: 'duplicate',
            personId: st.id,
            name: st.firstName,
            message: `See you at dismissal, ${st.firstName}!`,
            statusCategory: 'error',
            qr: st.qr,
            subDetail: secName,
            photoData: st.photoData,
            sex: st.sex
          }
        };
      }

      // departure
      d.attendance.push({ id: `att_${now}`, studentId: st.id, date: new Date(now).toISOString().slice(0, 10), ts: now, kind: 'out' });
      const guardianOutNum = st.guardianId ? d.guardians.find(g => g.id === st.guardianId)?.number : null;
      const smsOutTo = guardianOutNum || st.number;
      if (smsOutTo) {
        d.sms.push({
          id: `sms_${now}`,
          ts: now,
          to: smsOutTo,
          body: `Your child ${st.firstName} ${st.lastName} (${secName}) left school. Safe travels! – ${d.settings.schoolName}`,
          studentId: st.id,
          kind: 'departure',
          status: 'sent',
          attempts: 1
        });
      }
      const guardianOut = st.guardianId ? d.guardians.find(g => g.id === st.guardianId) : null;
      if (guardianOut?.email) {
        d.emails.push({
          id: `em_${now}`,
          ts: now,
          to: guardianOut.email,
          subject: `[${d.settings.schoolName}] Departure notice - ${st.firstName} ${st.lastName}`,
          body: `${st.firstName} ${st.lastName} left school. Safe travels! - ${d.settings.emailFromName}`,
          studentId: st.id,
          kind: 'departure',
          status: 'sent',
          attempts: 1
        });
      }
      const res: ScanResult = {
        ok: true,
        kind: 'student_out',
        personId: st.id,
        name: st.firstName,
        message: 'See you tomorrow!\nTravel safe.',
        statusCategory: 'departure',
        qr: st.qr,
        subDetail: secName,
        detail: 'Your parent has been notified that you left school',
        photoData: st.photoData,
        sex: st.sex
      };
      saveLocal(d);
      return { ok: true, data: res };
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

