import * as fs from 'fs';
import * as path from 'path';
import type { Database as SqliteDatabase } from 'better-sqlite3';
import { DEFAULT_SETTINGS } from '../shared/constants';
import type { AppData } from '../shared/types';

export interface DbConfig {
  enabled: boolean;
  /** Absolute path of the .db file. Empty string means "use the default location". */
  file: string;
}

// Collections mirrored row-by-row (table name === collection name unless mapped below).
export const COLLECTIONS = [
  'users', 'sections', 'departments', 'teachers', 'guardians', 'students',
  'slots', 'slotStatuses', 'scans', 'attendance', 'classEvents',
  'sms', 'emails', 'announcements'
] as const;

// Singleton documents stored in the kv table as JSON blobs.
export const KV_KEYS = ['settings', 'holiday', 'borrowed'] as const;

// Columns stored as JSON text; parsed back into objects/arrays on read.
const JSON_COLUMNS = new Set(['days', 'terms', 'holidayDates']);

// Collections whose rows carry a derived unique key column instead of plain id.
const KEY_COLUMNS: Record<string, string> = {
  slotStatuses: 'slot_status_key',
  attendance: 'attendance_key',
  classEvents: 'class_event_key',
  sms: 'id',
  emails: 'id',
  scans: 'id'
};

// Columns added after the first release; added to existing databases on connect.
const COLUMN_MIGRATIONS: Array<{ table: string; column: string; ddl: string }> = [
  { table: 'announcements', column: 'video_data', ddl: 'TEXT' },
  { table: 'students', column: 'photo_data', ddl: 'TEXT' },
  { table: 'teachers', column: 'photo_data', ddl: 'TEXT' }
];

function defaultConfig(userDataDir: string): DbConfig {
  return { enabled: true, file: path.join(userDataDir, 'bantay-pasok.db') };
}

function configPath(userDataDir: string): string {
  return path.join(userDataDir, 'sqlite.json');
}

export function loadDbConfig(userDataDir: string): DbConfig {
  const fallback = defaultConfig(userDataDir);
  try {
    const raw = fs.readFileSync(configPath(userDataDir), 'utf-8');
    const parsed = JSON.parse(raw) as Partial<DbConfig>;
    const cfg: DbConfig = {
      enabled: parsed.enabled !== false,
      file: typeof parsed.file === 'string' && parsed.file.trim() ? parsed.file : fallback.file
    };
    // Relative paths are resolved against the data directory.
    if (!path.isAbsolute(cfg.file)) cfg.file = path.join(userDataDir, cfg.file);
    return cfg;
  } catch {
    return fallback;
  }
}

export function saveDbConfig(userDataDir: string, cfg: DbConfig): void {
  fs.mkdirSync(userDataDir, { recursive: true });
  fs.writeFileSync(configPath(userDataDir), JSON.stringify(cfg, null, 2), 'utf-8');
}

// better-sqlite3 is loaded lazily (see file comment).
type SqliteCtor = new (file: string) => SqliteDatabase;
let sqliteCtor: SqliteCtor | null = null;
function getSqlite(): SqliteCtor {
  if (!sqliteCtor) {
    const mod = require('better-sqlite3') as SqliteCtor | { default: SqliteCtor };
    sqliteCtor = ((mod as { default?: SqliteCtor }).default ?? mod) as SqliteCtor;
  }
  return sqliteCtor;
}

function openDatabase(file: string): SqliteDatabase {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new (getSqlite())(file);
  db.pragma('journal_mode = WAL');
  return db;
}

function columnExists(db: SqliteDatabase, table: string, column: string): boolean {
  const rows = db.prepare(`PRAGMA table_info("${table}")`).all() as Array<{ name: string }>;
  return rows.some(r => r.name === column);
}

const TABLE_DDL: Record<string, string> = {
  users: '"id" TEXT PRIMARY KEY, "username" TEXT, "password_hash" TEXT, "role" TEXT, "display_name" TEXT',
  sections: '"id" TEXT PRIMARY KEY, "name" TEXT, "grade" TEXT, "color" TEXT',
  departments: '"id" TEXT PRIMARY KEY, "name" TEXT',
  teachers: '"id" TEXT PRIMARY KEY, "qr" TEXT, "last_name" TEXT, "first_name" TEXT, "middle_name" TEXT, "department_id" TEXT, "number" TEXT',
  guardians: '"id" TEXT PRIMARY KEY, "last_name" TEXT, "first_name" TEXT, "number" TEXT, "address" TEXT, "email" TEXT',
  students: '"id" TEXT PRIMARY KEY, "qr" TEXT, "last_name" TEXT, "first_name" TEXT, "middle_name" TEXT, "sex" TEXT, "number" TEXT, "section_id" TEXT, "guardian_id" TEXT, "photo_data" TEXT',
  slots: '"id" TEXT PRIMARY KEY, "section_id" TEXT, "subject" TEXT, "department_id" TEXT, "teacher_id" TEXT, "start" TEXT, "end" TEXT, "days" TEXT',
  slot_statuses: '"id" TEXT PRIMARY KEY, "slot_status_key" TEXT UNIQUE, "slot_id" TEXT, "reason" TEXT, "note" TEXT, "date" TEXT',
  scans: '"id" TEXT PRIMARY KEY, "person_id" TEXT, "role" TEXT, "ts" INTEGER, "kind" TEXT',
  attendance: '"id" TEXT PRIMARY KEY, "attendance_key" TEXT UNIQUE, "student_id" TEXT, "date" TEXT, "ts" INTEGER, "kind" TEXT',
  class_events: '"id" TEXT PRIMARY KEY, "class_event_key" TEXT UNIQUE, "slot_id" TEXT, "teacher_id" TEXT, "date" TEXT, "ts" INTEGER',
  sms: '"id" TEXT PRIMARY KEY, "ts" INTEGER, "to" TEXT, "body" TEXT, "student_id" TEXT, "kind" TEXT, "status" TEXT, "attempts" INTEGER, "last_error" TEXT, "sent_ts" INTEGER, "next_retry_ts" INTEGER',
  emails: '"id" TEXT PRIMARY KEY, "ts" INTEGER, "to" TEXT, "subject" TEXT, "body" TEXT, "student_id" TEXT, "kind" TEXT, "status" TEXT, "attempts" INTEGER, "last_error" TEXT, "sent_ts" INTEGER, "next_retry_ts" INTEGER',
  announcements: '"id" TEXT PRIMARY KEY, "type" TEXT, "title" TEXT, "body" TEXT, "photo_path" TEXT, "photo_data" TEXT, "video_data" TEXT, "from" TEXT, "to" TEXT, "enabled" INTEGER, "posted_by" TEXT',
  kv: '"key" TEXT PRIMARY KEY, "value" TEXT'
};

// Table names use snake_case; the in-memory collections use camelCase.
const TABLE_OF: Record<string, string> = {
  slotStatuses: 'slot_statuses',
  classEvents: 'class_events'
};

function tableFor(collection: string): string {
  return TABLE_OF[collection] ?? collection;
}

export function ensureSchema(cfg: DbConfig): void {
  const db = openDatabase(cfg.file);
  try {
    for (const [table, ddl] of Object.entries(TABLE_DDL)) {
      db.prepare(`CREATE TABLE IF NOT EXISTS "${table}" (${ddl})`).run();
    }
    for (const m of COLUMN_MIGRATIONS) {
      if (!columnExists(db, m.table, m.column)) {
        db.prepare(`ALTER TABLE "${m.table}" ADD COLUMN "${m.column}" ${m.ddl}`).run();
      }
    }
  } finally {
    db.close();
  }
}

// ---------- row mapping ----------

function rowKey(collection: string, row: Record<string, unknown>): string {
  if (collection === 'attendance') return `${row.studentId}|${row.date}|${row.kind}`;
  if (collection === 'classEvents') return `${row.slotId}|${row.date}`;
  return String(row.id);
}

function snake(k: string): string {
  return k.replace(/[A-Z]/g, c => `_${c.toLowerCase()}`);
}

function camel(k: string): string {
  return k.replace(/_([a-z])/g, (_m, c: string) => c.toUpperCase());
}

export function rowToDb(collection: string, row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    if (JSON_COLUMNS.has(k)) {
      out[snake(k)] = JSON.stringify(v ?? null);
    } else if (typeof v === 'boolean') {
      out[snake(k)] = v ? 1 : 0; // SQLite has no boolean; store as 0/1.
    } else {
      out[snake(k)] = v;
    }
  }
  const keyCol = KEY_COLUMNS[collection];
  if (keyCol && out[keyCol] === undefined) out[keyCol] = rowKey(collection, row);
  return out;
}

export function rowFromDb(collection: string, row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    const key = camel(k);
    if (JSON_COLUMNS.has(key) && typeof v === 'string') {
      try { out[key] = JSON.parse(v); continue; } catch { /* fall through to raw value */ }
    }
    out[key] = v;
  }
  const keyCol = KEY_COLUMNS[collection];
  if (keyCol && keyCol !== 'id') delete out[keyCol];
  return out;
}

// ---------- connection ----------

export class DbConnection {
  private db: SqliteDatabase | null = null;
  lastError: string | null = null;

  get enabled(): boolean {
    return this.db !== null;
  }

  connect(cfg: DbConfig): void {
    this.disconnect();
    this.db = openDatabase(cfg.file);
    this.db.prepare('SELECT 1').get(); // sanity check the handle
  }

  disconnect(): void {
    if (this.db) {
      try { this.db.close(); } catch { /* already closed */ }
      this.db = null;
    }
  }

  /** Opens the file independently and returns the SQLite version. */
  test(cfg: DbConfig): string {
    const probe = openDatabase(cfg.file);
    try {
      const row = probe.prepare('SELECT sqlite_version() AS v').get() as { v: string };
      return row.v;
    } finally {
      probe.close();
    }
  }

  loadAll(): AppData {
    if (!this.db) throw new Error('SQLite database is not connected');
    const db = this.db;
    const d = {
      settings: { ...DEFAULT_SETTINGS },
      holiday: { date: null },
      borrowed: { sections: [] }
    } as unknown as Record<string, unknown>;
    for (const c of COLLECTIONS) {
      const rows = db.prepare(`SELECT * FROM "${tableFor(c)}"`).all() as Array<Record<string, unknown>>;
      d[c] = rows.map(r => rowFromDb(c, r));
    }
    const kvRows = db.prepare('SELECT "key", "value" FROM "kv"').all() as Array<{ key: string; value: unknown }>;
    for (const row of kvRows) {
      if (!KV_KEYS.includes(row.key as never)) continue;
      let value: unknown = row.value;
      if (typeof value === 'string') {
        try { value = JSON.parse(value); } catch { /* keep raw */ }
      }
      if (row.key === 'settings' && value && typeof value === 'object') {
        d.settings = { ...DEFAULT_SETTINGS, ...(value as object) };
      } else {
        d[row.key] = value;
      }
    }
    if (!Array.isArray(d.emails)) d.emails = [];
    return d as unknown as AppData;
  }

  /** Mirrors the whole snapshot into SQLite inside one transaction. */
  sync(d: AppData): void {
    if (!this.db) throw new Error('SQLite database is not connected');
    const db = this.db;
    const src = d as unknown as Record<string, unknown>;

    const run = db.transaction((): void => {
      for (const c of COLLECTIONS) {
        const table = tableFor(c);
        const keyCol = KEY_COLUMNS[c] ?? 'id';
        const rows = (Array.isArray(src[c]) ? src[c] : []) as Array<Record<string, unknown>>;
        const target = rows.map(r => rowToDb(c, r));
        const targetKeys = new Set(target.map(r => String(r[keyCol])));

        const existingRows = db.prepare(`SELECT "${keyCol}" AS k FROM "${table}"`).all() as Array<{ k: unknown }>;
        const existingKeys = new Set(existingRows.map(r => String(r.k)));

        const delStmt = db.prepare(`DELETE FROM "${table}" WHERE "${keyCol}" = ?`);
        for (const k of existingKeys) {
          if (!targetKeys.has(k)) delStmt.run(k);
        }

        for (const row of target) {
          const key = String(row[keyCol]);
          // Keep keys whose value is explicitly undefined: binding ??.null clears
          // the column (e.g. a removed photo) instead of leaving a stale value.
          const cols = Object.keys(row);
          if (cols.length === 0) continue;
          if (!existingKeys.has(key)) {
            const names = cols.map(k => `"${k}"`).join(', ');
            const marks = cols.map(() => '?').join(', ');
            db.prepare(`INSERT INTO "${table}" (${names}) VALUES (${marks})`)
              .run(...cols.map(k => row[k] ?? null));
          } else {
            const updatable = cols.filter(k => k !== keyCol);
            if (updatable.length === 0) continue;
            const sets = updatable.map(k => `"${k}" = ?`).join(', ');
            db.prepare(`UPDATE "${table}" SET ${sets} WHERE "${keyCol}" = ?`)
              .run(...updatable.map(k => row[k] ?? null), key);
          }
        }
      }

      const kvUpsert = db.prepare(
        'INSERT INTO "kv" ("key", "value") VALUES (?, ?) ' +
        'ON CONFLICT("key") DO UPDATE SET "value" = excluded."value"'
      );
      for (const k of KV_KEYS) {
        if (src[k] === undefined) continue;
        kvUpsert.run(k, JSON.stringify(src[k]));
      }
    });
    run();
  }
}
