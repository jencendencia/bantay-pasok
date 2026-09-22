import { app, BrowserWindow } from 'electron';
import { autoUpdater } from 'electron-updater';
import * as fs from 'fs';
import * as path from 'path';
import type { UpdateEvent, UpdateState, UpdateStatusInfo } from '../shared/types';

/**
 * Auto-update from GitHub Releases (HOW_TO_ADD_AUTO_UPDATE_AND_ACTIVATION.md, Part A).
 *
 * electron-builder's publish config points at the GitHub repo; the running app
 * reads `latest.yml` from the newest release and — when a newer version is
 * found — lets the admin download it with a visible progress bar, then
 * "Restart & install". autoDownload is OFF (the guide's flow): the admin
 * decides when an 80 MB download happens on the school connection.
 *
 * Public repo: no token needed. Private repo: staff paste a fine-grained token
 * in Settings once; it is stored in userData/github_token.json and passed to
 * the updater via GH_TOKEN (GitHubReleaseProvider reads it at check time).
 */

let broadcast: ((e: UpdateEvent) => void) | null = null;

type UpdaterState = UpdateState;
let state: UpdaterState = 'idle';
let progress = 0;
let lastError: string | null = null;
let availableVersion: string | null = null;
let downloadedVersion: string | null = null;

export function updateStatus(): UpdateStatusInfo {
  return {
    currentVersion: app.getVersion(),
    state,
    progress,
    error: lastError,
    version: availableVersion ?? undefined,
    downloadedVersion
  };
}

function emit(e: UpdateEvent): void {
  if (broadcast) broadcast(e);
}

function setState(s: UpdaterState, extra: Partial<UpdateEvent> = {}): void {
  state = s;
  if (s === 'idle' || s === 'checking') {
    progress = 0;
    availableVersion = null;
  }
  if (s === 'downloading' && extra.progress === undefined) progress = progress;
  emit({ state: s, progress, error: lastError, ...extra });
}

function sendToFocused(e: UpdateEvent): void {
  // The guide broadcasts to the focused window; we have two windows, so broadcast to all.
  emit(e);
}

export function tokenFile(): string {
  return path.join(app.getPath('userData'), 'github_token.json');
}

/** Loads a stored GitHub token (private repos) or clears stale GH_TOKEN (public repos). */
export function loadGithubToken(): void {
  try {
    if (fs.existsSync(tokenFile())) {
      const data = JSON.parse(fs.readFileSync(tokenFile(), 'utf-8')) as { token?: string };
      if (data.token) {
        process.env.GH_TOKEN = data.token;
        return;
      }
    }
  } catch { /* ignore malformed token file */ }
  delete process.env.GH_TOKEN;
}

export function setGithubToken(token: string): void {
  fs.writeFileSync(tokenFile(), JSON.stringify({ token: token.trim(), updatedAt: new Date().toISOString() }, null, 2));
  process.env.GH_TOKEN = token.trim();
}

export function initUpdater(onEvent: (e: UpdateEvent) => void): void {
  broadcast = onEvent;

  autoUpdater.autoDownload = false;        // guide A3: the admin clicks Download
  autoUpdater.autoInstallOnAppQuit = true; // installing also happens on quit
  autoUpdater.logger = console;
  autoUpdater.allowDowngrade = false;

  autoUpdater.on('checking-for-update', () => {
    lastError = null;
    downloadedVersion = null;
    setState('checking');
  });
  autoUpdater.on('update-available', info => {
    availableVersion = info.version ?? null;
    setState('available', { version: info.version ?? '' });
  });
  autoUpdater.on('update-not-available', info => setState('not-available', { version: info.version ?? '' }));
  autoUpdater.on('download-progress', p => {
    progress = Math.round(p.percent ?? 0);
    emit({ state: 'downloading', progress });
  });
  autoUpdater.on('update-downloaded', info => {
    downloadedVersion = info.version ?? null;
    setState('downloaded', { version: info.version ?? '' });
  });
  autoUpdater.on('error', err => {
    lastError = err?.message ?? String(err);
    setState('error');
  });
  void sendToFocused;
}

export async function checkForUpdates(): Promise<UpdateStatusInfo> {
  loadGithubToken();
  try {
    await autoUpdater.checkForUpdates();
  } catch (err) {
    // The 'error' event also fires; this catch keeps the promise from escaping.
    lastError = err instanceof Error ? err.message : String(err);
    setState('error');
  }
  return updateStatus();
}

export async function downloadUpdate(): Promise<UpdateStatusInfo> {
  try {
    await autoUpdater.downloadUpdate();
  } catch (err) {
    lastError = err instanceof Error ? err.message : String(err);
    setState('error');
  }
  return updateStatus();
}

/** Quit and install the downloaded update (guide A3). Silent install, app relaunches. */
export function installUpdate(): void {
  if (state !== 'downloaded') return;
  autoUpdater.quitAndInstall(false, true);
}
