import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { buildSeedData } from '../shared/seed';
import { DEFAULT_SETTINGS, normalizeTerms } from '../shared/constants';
import type { AppData, Settings } from '../shared/types';
import { DbConnection, ensureSchema, loadDbConfig, saveDbConfig } from './db';
import type { DbConfig } from './db';

const DATA_DIR = path.join(app.getPath('userData'), 'bantay-pasok-data');
const DATA_FILE = path.join(DATA_DIR, 'data.json');

let data: AppData | null = null;
let saveTimer: NodeJS.Timeout | null = null;

const db = new DbConnection();
let dbCfg: DbConfig = loadDbConfig(DATA_DIR);

export function getDataDir(): string {
  return DATA_DIR;
}

export function getDbConfig(): DbConfig {
  return dbCfg;
}

export async function initStore(): Promise<void> {
  // Always make sure the JSON fallback file exists and is loadable.
  const json = loadJson();

  if (dbCfg.enabled) {
    try {
      await ensureSchema(dbCfg);
      await db.connect(dbCfg);
      // Prefer whatever is already in SQLite; seed it on first run.
      const fromDb = await db.loadAll();
      const dbEmpty = fromDb.users.length === 0 && fromDb.students.length === 0;
      if (dbEmpty) {
        await db.sync(json);
        data = json;
      } else {
        data = fromDb;
      }
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
  try {
    if (fs.existsSync(DATA_FILE)) {
      d = JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8')) as AppData;
    }
  } catch (err) {
    console.error('Failed to read data file, reseeding', err);
    d = null;
  }
  if (!d) {
    d = buildSeedData();
  }
  repairData(d);
  return d;
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
  return changed;
}

function saveJson(): void {
  if (!data) return;
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(DATA_FILE, JSON.stringify(data));
  } catch (err) {
    console.error('Failed to save data', err);
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
  if (db.enabled) {
    try {
      await db.sync(data);
    } catch (err) {
      db.lastError = err instanceof Error ? err.message : String(err);
      console.error('SQLite sync failed:', err);
    }
  }
}

export function loadData(): AppData {
  if (!data) {
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

/** One-time import of the JSON store into SQLite (Settings → Import data.json). */
export async function importJsonToSqlite(): Promise<void> {
  if (!db.enabled) throw new Error('SQLite is not connected');
  const json = loadJson();
  await db.sync(json);
  const fromDb = await db.loadAll();
  data = fromDb;
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
    const fromDb = await db.loadAll();
    const dbEmpty = fromDb.users.length === 0 && fromDb.students.length === 0;
    if (dbEmpty) {
      const json = loadJson();
      await db.sync(json);
      data = loadJson();
    } else {
      data = fromDb;
    }
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

export function dbStatus(): { enabled: boolean; lastError: string | null } {
  return { enabled: db.enabled, lastError: db.lastError };
}
