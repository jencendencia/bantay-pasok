import { contextBridge, ipcRenderer } from 'electron';
import type { Announcement, AppData, IpcResult, ReportParams, ScanResult, UpdateEvent, UpdateStatusInfo } from '../shared/types';

const api = {
  getData: (): Promise<IpcResult<AppData>> => ipcRenderer.invoke('data:get'),
  patchData: (patch: Partial<AppData>): Promise<IpcResult> => ipcRenderer.invoke('data:patch', patch),
  scan: (code: string): Promise<IpcResult<ScanResult>> => ipcRenderer.invoke('scan', code),
  setSlotReason: (slotId: string, date: string, reason: string | null, note: string): Promise<IpcResult> =>
    ipcRenderer.invoke('slot:reason', slotId, date, reason, note),
  smsRetry: (id: string): Promise<IpcResult> => ipcRenderer.invoke('sms:retry', id),
  emailRetry: (id: string): Promise<IpcResult> => ipcRenderer.invoke('email:retry', id),
  smtpVerify: (cfg: { host: string; port: number; secure: boolean; user: string; pass: string }): Promise<IpcResult> =>
    ipcRenderer.invoke('smtp:verify', cfg),
  openScanner: (): Promise<IpcResult> => ipcRenderer.invoke('windows:openScanner'),
  toggleFullscreen: (): Promise<IpcResult> => ipcRenderer.invoke('windows:toggleFullscreen'),
  winMinimize: (): Promise<IpcResult> => ipcRenderer.invoke('win:minimize'),
  winMaximize: (target?: 'admin' | 'scanner'): Promise<IpcResult> => ipcRenderer.invoke('win:maximize', target),
  winClose: (target?: 'admin' | 'scanner'): Promise<IpcResult> => ipcRenderer.invoke('win:close', target),
  onWinState: (cb: (s: { maximized: boolean }) => void): () => void => {
    const handler = (_e: unknown, s: { maximized: boolean }): void => cb(s);
    ipcRenderer.on('win:state', handler);
    return () => { ipcRenderer.removeListener('win:state', handler); };
  },
  buildReport: (params: ReportParams): Promise<IpcResult<{ saved: boolean; filename: string }>> =>
    ipcRenderer.invoke('report:build', params),
  addAnnouncement: (a: Announcement): Promise<IpcResult> => ipcRenderer.invoke('announce:add', a),
  removeAnnouncement: (id: string): Promise<IpcResult> => ipcRenderer.invoke('announce:remove', id),
  appInfo: (): Promise<IpcResult<{ dataDir: string; today: string; platform: string }>> => ipcRenderer.invoke('app:info'),
  dbStatus: (): Promise<IpcResult<{ enabled: boolean; lastError: string | null; config: { enabled: boolean; file: string } }>> =>
    ipcRenderer.invoke('db:status'),
  saveDbConfig: (cfg: { enabled: boolean; file: string }, testOnly: boolean): Promise<IpcResult<{ ok: boolean; version?: string; error?: string }>> =>
    ipcRenderer.invoke('db:saveConfig', cfg, testOnly),
  dbConnect: (): Promise<IpcResult> => ipcRenderer.invoke('db:connect'),
  dbDisconnect: (): Promise<IpcResult> => ipcRenderer.invoke('db:disconnect'),
  dbImportJson: (): Promise<IpcResult> => ipcRenderer.invoke('db:importJson'),
  updateStatus: (): Promise<IpcResult<UpdateStatusInfo>> => ipcRenderer.invoke('update:status'),
  updateCheck: (): Promise<IpcResult<UpdateStatusInfo>> => ipcRenderer.invoke('update:check'),
  updateDownload: (): Promise<IpcResult<UpdateStatusInfo>> => ipcRenderer.invoke('update:download'),
  updateInstall: (): Promise<IpcResult> => ipcRenderer.invoke('update:install'),
  updateSetToken: (token: string): Promise<IpcResult> => ipcRenderer.invoke('update:setToken', token),
  onUpdateEvent: (cb: (e: UpdateEvent) => void): () => void => {
    const handler = (_e: unknown, ev: UpdateEvent): void => cb(ev);
    ipcRenderer.on('update:event', handler);
    return () => { ipcRenderer.removeListener('update:event', handler); };
  },
  onDataChanged: (cb: (d: AppData) => void): () => void => {
    const handler = (_e: unknown, d: AppData): void => cb(d);
    ipcRenderer.on('data:changed', handler);
    return () => { ipcRenderer.removeListener('data:changed', handler); };
  }
};

export type Api = typeof api;

contextBridge.exposeInMainWorld('api', api);
