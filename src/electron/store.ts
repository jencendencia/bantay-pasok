import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { buildSeedData } from '../shared/seed';
import { DEFAULT_SETTINGS, normalizeTerms } from '../shared/constants';
import type { AppData, Settings } from '../shared/types';
import { DbConnection, ensureSchema, loadDbConfig, saveDbConfig } from './db';
import { dedupeTeacherQr } from '../shared/teacherQr';
import type { DbConfig } from './db';
import { loadNetConfig, saveNetConfig } from './net';
import type { NetConfig } from '../shared/types';

const DATA_DIR = path.join(app.getPath('userData'), 'bantay-pasok-data');
const DATA_FILE = path.join(DATA_DIR, 'data.json');
// One previous JSON generation: if a save reaches data.json but not SQLite,
// the snapshot that was live at that moment is still on disk to recover from.
const PREV_FILE = path.join(DATA_DIR, 'data.json.prev');
// Timestamp of the last save that actually reached SQLite. When data.json is
// newer than this, at least one save never made it into the database.
const SYNC_MARKER_FILE = path.join(DATA_DIR, 'last-sync.json');

let data: AppData | null = null;
let saveTimer: NodeJS.Timeout | null = null;

/** Whether the database is behind the in-memory/JSON snapshot. */
export interface SyncState {
  pending: boolean;
  error: string | null;
  /** When the automatic retry will run (epoch ms). */
  retryAt: number | null;
}

let syncState: SyncState = { pending: false, error: null, retryAt: null };
let syncListener: ((s: SyncState) => void) | null = null;
let retryTimer: NodeJS.Timeout | null = null;
let retryDelay = 5_000;

const db = new DbConnection();
let dbCfg: DbConfig = loadDbConfig(DATA_DIR);
let netCfg: NetConfig = loadNetConfig(DATA_DIR);

export function getDataDir(): string {
  return DATA_DIR;
}

export function getDbConfig(): DbConfig {
  return dbCfg;
}

export function getNetConfig(): NetConfig {
  return netCfg;
}

export function setNetConfig(cfg: NetConfig): void {
  netCfg = cfg;
  saveNetConfig(DATA_DIR, cfg);
}

/** True when this computer uses another computer's database over the network. */
export function isLanMode(): boolean {
  return netCfg.mode === 'lan';
}

export async function initStore(): Promise<void> {
  netCfg = loadNetConfig(DATA_DIR);
  if (netCfg.mode === 'lan') {
    // The database lives on another computer (Settings → Database): open no
    // local storage at all and seed nothing — main.ts forwards every read and
    // write to the host over the network.
    data = null;
    return;
  }
  // Always make sure the JSON fallback file exists and is loadable.
  const json = loadJson();

  if (dbCfg.enabled) {
    try {
      await ensureSchema(dbCfg);
      await db.connect(dbCfg);
      // Load SQLite, but never throw away records data.json holds and the
      // database never received (a save whose sync failed).
      await loadDbWithRecovery();
      return;
    } catch (err) {
      console.error('SQLite unavailable, falling back to JSON storage:', err);
      db.lastError = err instanceof Error ? err.message : String(err);
      await db.disconnect();
    }
  }
  data = json;
  saveJson();
}

function loadJson(): AppData {
  let d: AppData | null = null;
  // Fall back to the previous generation when the current file is missing or
  // unreadable (e.g. power loss in the middle of the atomic replace).
  for (const file of [DATA_FILE, PREV_FILE]) {
    try {
      if (!fs.existsSync(file)) continue;
      d = JSON.parse(fs.readFileSync(file, 'utf-8')) as AppData;
      if (file === PREV_FILE) console.warn('Recovered data from data.json.prev');
      break;
    } catch (err) {
      console.error(`Failed to read ${path.basename(file)}`, err);
    }
  }
  if (!d) {
    d = buildSeedData();
  }
  repairData(d);
  return d;
}

/** Raw data.json plus its timestamp, without falling back to the seed. */
function readJsonSnapshot(): { data: AppData; mtime: number } | null {
  try {
    const mtime = fs.statSync(DATA_FILE).mtimeMs;
    const parsed = JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8')) as AppData;
    repairData(parsed);
    return { data: parsed, mtime };
  } catch {
    return null;
  }
}

function readSyncMarker(): number | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(SYNC_MARKER_FILE, 'utf-8')) as { at?: unknown };
    return typeof parsed.at === 'number' ? parsed.at : null;
  } catch {
    return null;
  }
}

function writeSyncMarker(): void {
  try {
    fs.writeFileSync(SYNC_MARKER_FILE, JSON.stringify({ at: Date.now() }));
  } catch (err) {
    console.error('Failed to write sync marker', err);
  }
}

/**
 * Repair known seed-data defects in previously saved files.
 * Runs once on load, then saves back if anything changed.
 */
function repairData(d: AppData): boolean {
  let changed = false;
  // v1.1: email settings backfill for data files created before this feature
  const s = d.settings as Settings;
  if (s.emailEnabled === undefined) { s.emailEnabled = DEFAULT_SETTINGS.emailEnabled; changed = true; }
  if (s.smtpHost === undefined) { s.smtpHost = DEFAULT_SETTINGS.smtpHost; changed = true; }
  if (s.smtpPort === undefined) { s.smtpPort = DEFAULT_SETTINGS.smtpPort; changed = true; }
  if (s.smtpSecure === undefined) { s.smtpSecure = DEFAULT_SETTINGS.smtpSecure; changed = true; }
  if (s.smtpUser === undefined) { s.smtpUser = ''; changed = true; }
  if (s.smtpPass === undefined) { s.smtpPass = ''; changed = true; }
  if (s.emailFromName === undefined) { s.emailFromName = DEFAULT_SETTINGS.emailFromName; changed = true; }
  if (!Array.isArray(d.emails)) { d.emails = []; changed = true; }
  // v1.0.3: terms are fixed to Term 1–3 (older builds saved a Term 4)
  const fixedTerms = normalizeTerms(s.terms);
  if (JSON.stringify(fixedTerms) !== JSON.stringify(s.terms)) { s.terms = fixedTerms; changed = true; }
  // v1.0.1: seed generator could hand the same QR to two students
  const seenStudents = new Set<string>();
  for (const s2 of d.students) {
    const key = (s2.qr || '').toUpperCase();
    if (!key) continue;
    if (seenStudents.has(key)) {
      let n = 417;
      let candidate: string;
      do { candidate = `S-2026-${String(n++).padStart(5, '0')}`; } while (seenStudents.has(candidate) || d.teachers.some(t => t.qr === candidate));
      s2.qr = candidate;
      changed = true;
    } else {
      seenStudents.add(key);
    }
  }
  // v1.0.16: the teacher counter could reissue an already-taken code after a
  // deletion (T-0041 and T-0065 each landed on two people). Keep the first
  // holder of each code and give later duplicates a fresh free one.
  if (dedupeTeacherQr(d.teachers)) changed = true;
  return changed;
}

function saveJson(): void {
  if (!data) return;
  const tmp = `${DATA_FILE}.tmp`;
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    // Write the new generation first, then rotate: data.json is never left
    // half-written, and the previous snapshot survives as data.json.prev.
    fs.writeFileSync(tmp, JSON.stringify(data));
    try { fs.rmSync(PREV_FILE, { force: true }); } catch { /* locked */ }
    try { if (fs.existsSync(DATA_FILE)) fs.renameSync(DATA_FILE, PREV_FILE); } catch { /* keep going */ }
    fs.renameSync(tmp, DATA_FILE);
  } catch (err) {
    console.error('Failed to save data', err);
    try { fs.rmSync(tmp, { force: true }); } catch { /* ignore */ }
  }
}

/** Marks the moment the current snapshot is known to be in SQLite. */
function markSynced(): void {
  db.lastError = null;
  writeSyncMarker();
  if (retryTimer) {
    clearTimeout(retryTimer);
    retryTimer = null;
  }
  if (!syncState.pending && !syncState.error) return;
  syncState = { pending: false, error: null, retryAt: null };
  retryDelay = 5_000;
  publishSyncState();
}

function publishSyncState(): void {
  if (!syncListener) return;
  try { syncListener(syncState); } catch { /* window closed */ }
}

function noteSyncFailure(err: unknown): void {
  const message = err instanceof Error ? err.message : String(err);
  db.lastError = message;
  console.error('SQLite sync failed:', err);
  retryDelay = syncState.pending ? Math.min(retryDelay * 2, 60_000) : 5_000;
  syncState = { pending: true, error: message, retryAt: Date.now() + retryDelay };
  publishSyncState();
  if (retryTimer) return;
  retryTimer = setTimeout(() => {
    retryTimer = null;
    void flushSave();
  }, retryDelay);
  if (typeof retryTimer.unref === 'function') retryTimer.unref();
}

/** Subscribes to sync health (main.ts broadcasts it to every window). */
export function onSyncState(cb: (s: SyncState) => void): void {
  syncListener = cb;
  cb(syncState);
}

/**
 * True when data.json holds a record the database has never seen. Counting rows
 * is not enough: a stale file with the same number of rows would pass and then
 * delete the newer records (the save path prunes anything the snapshot lacks).
 */
function addsRecords(snap: AppData, fromDb: AppData): boolean {
  const ids = (rows: Array<{ id: string }>): Set<string> => new Set(rows.map(r => r.id));
  const dbScans = ids(fromDb.scans);
  if (snap.scans.some(r => !dbScans.has(r.id))) return true;
  const dbAtt = ids(fromDb.attendance);
  if (snap.attendance.some(r => !dbAtt.has(r.id))) return true;
  // Class events are one per period per day, keyed by that pair rather than id.
  const dbEv = new Set(fromDb.classEvents.map(e => `${e.slotId}|${e.date}`));
  return snap.classEvents.some(e => !dbEv.has(`${e.slotId}|${e.date}`));
}

/** True when data.json may hold rows the database never received. */
function jsonHoldsUnsyncedRows(fromDb: AppData): { data: AppData } | null {
  const snap = readJsonSnapshot();
  if (!snap) return null;
  if (!addsRecords(snap.data, fromDb)) return null;
  const lastSync = readSyncMarker();
  if (lastSync !== null) return snap.mtime > lastSync ? { data: snap.data } : null;
  // First run of this build (no marker yet): the database file itself is the
  // baseline. A JSON written after it may hold saves that never landed.
  try {
    return snap.mtime > fs.statSync(dbCfg.file).mtimeMs ? { data: snap.data } : null;
  } catch {
    return null;
  }
}

/** Loads SQLite as the base, recovering any newer records that only reached JSON. */
async function loadDbWithRecovery(): Promise<void> {
  const fromDb = await db.loadAll();
  const dbEmpty = fromDb.users.length === 0 && fromDb.students.length === 0;
  if (dbEmpty) {
    const json = loadJson();
    await db.sync(json);
    data = json;
    writeSyncMarker();
    return;
  }
  const recovered = jsonHoldsUnsyncedRows(fromDb);
  if (recovered) {
    console.warn('data.json holds records the database never received — merging them back.');
    // Merge, never replace: anything already in the database (possibly written
    // by a newer save) survives even if this snapshot predates it.
    await db.sync(recovered.data, { prune: false });
    data = await db.loadAll();
    saveJson();
    writeSyncMarker();
    return;
  }
  data = fromDb;
  if (repairData(data)) {
    await flushSave();
  } else {
    // Make JSON mirror the database and start a clean sync baseline.
    saveJson();
    writeSyncMarker();
  }
}

function scheduleSave(): void {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    void flushSave();
  }, 300);
}

/** Persists current data: always to JSON (offline fallback), plus SQLite when enabled. */
export async function flushSave(): Promise<void> {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  if (!data) return;
  saveJson();
  if (!db.enabled) return;
  try {
    await db.sync(data);
    markSynced();
  } catch (err) {
    // The JSON above is the recovery copy: keep the app running, warn the
    // operator and retry until the database file is writable again.
    noteSyncFailure(err);
  }
}

export function loadData(): AppData {
  if (!data) {
    if (netCfg.mode === 'lan') {
      // Tripwire: in LAN mode every caller must reach the data through the
      // network path in main.ts — silently returning the stale local JSON
      // would let this computer write records that vanish.
      throw new Error('LAN mode: this computer does not keep a local database.');
    }
    // Synchronous fallback for early IPC before initStore completes.
    data = loadJson();
  }
  return data;
}

export function saveData(): void {
  scheduleSave();
}

export function patchData(fn: (d: AppData) => void): void {
  const d = loadData();
  fn(d);
  saveData();
}

/**
 * Import of the JSON store into SQLite (Settings → Import data.json). Merges:
 * rows in data.json are added or updated, and nothing already in the database
 * is deleted — importing an older file must never erase recent logins.
 */
export async function importJsonToSqlite(): Promise<void> {
  if (!db.enabled) throw new Error('SQLite is not connected');
  const json = loadJson();
  await db.sync(json, { prune: false });
  data = await db.loadAll();
  saveJson();
  writeSyncMarker();
}

/** Applies a new SQLite config at runtime (Settings → Database). */
export async function applyDbConfig(cfg: DbConfig, testOnly: boolean): Promise<{ ok: boolean; version?: string; error?: string }> {
  if (testOnly) {
    const probe = new DbConnection();
    try {
      const version = await probe.test(cfg);
      return { ok: true, version };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    } finally {
      await probe.disconnect();
    }
  }
  dbCfg = cfg;
  saveDbConfig(DATA_DIR, cfg);
  if (!cfg.enabled) {
    // Turning SQLite off closes the database immediately; JSON keeps working.
    disconnectSqlite();
  }
  return { ok: true };
}

/** Connects using the stored config, seeds from JSON if the DB is empty. */
export async function connectSqlite(): Promise<{ ok: boolean; error?: string }> {
  try {
    await ensureSchema(dbCfg);
    await db.connect(dbCfg);
    await loadDbWithRecovery();
    return { ok: true };
  } catch (err) {
    db.lastError = err instanceof Error ? err.message : String(err);
    await db.disconnect();
    return { ok: false, error: db.lastError ?? 'Unknown error' };
  }
}

export function disconnectSqlite(): void {
  void db.disconnect();
}

export function dbStatus(): { enabled: boolean; lastError: string | null; sync: SyncState } {
  return { enabled: db.enabled, lastError: db.lastError, sync: syncState };
}
