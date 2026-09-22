import * as fs from 'fs';
import * as path from 'path';
import * as mysql from 'mysql2/promise';
import type { Pool } from 'mysql2/promise';
import { DEFAULT_SETTINGS } from '../shared/constants';
import type { AppData } from '../shared/types';

export interface DbConfig {
  enabled: boolean;
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
}

/** Row collections mirrored as tables. */
const COLLECTIONS = [
  'users', 'sections', 'departments', 'teachers', 'guardians', 'students',
  'slots', 'slotStatuses', 'scans', 'attendance', 'classEvents', 'sms',
  'emails', 'announcements'
] as const;

/** Object-valued parts of AppData stored in the kv table. */
const KV_KEYS = ['settings', 'holiday', 'borrowed'] as const;

const JSON_COLUMNS = new Set(['days', 'terms', 'holidayDates']);

/** Per-row sync identity inside each table. */
const KEY_COLUMNS: Record<string, string> = {
  slotStatuses: 'slot_status_key',
  attendance: 'attendance_key',
  classEvents: 'class_event_key',
  sms: 'id',
  emails: 'id',
  scans: 'id'
};

function defaultConfig(): DbConfig {
  return { enabled: false, host: '127.0.0.1', port: 3306, user: 'root', password: '', database: 'bantay_pasok' };
}

function configPath(userDataDir: string): string {
  return path.join(userDataDir, 'mysql.json');
}

export function loadDbConfig(userDataDir: string): DbConfig {
  try {
    const raw = fs.readFileSync(configPath(userDataDir), 'utf-8');
    return { ...defaultConfig(), ...JSON.parse(raw) } as DbConfig;
  } catch { return defaultConfig(); }
}

export function saveDbConfig(userDataDir: string, cfg: DbConfig): void {
  fs.mkdirSync(userDataDir, { recursive: true });
  fs.writeFileSync(configPath(userDataDir), JSON.stringify(cfg, null, 2));
}

function rowKey(collection: string, row: Record<string, unknown>): string {
  switch (collection) {
    case 'attendance': return `${row.studentId}|${row.date}|${row.kind}`;
    case 'classEvents': return `${row.slotId}|${row.date}`;
    default: return String(row.id);
  }
}

function snake(k: string): string {
  return k.replace(/[A-Z]/g, c => '_' + c.toLowerCase());
}

function camel(k: string): string {
  return k.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
}

export function rowToDb(collection: string, row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    out[snake(k)] = (JSON_COLUMNS.has(k) && v !== undefined) ? JSON.stringify(v) : v;
  }
  const keyCol = KEY_COLUMNS[collection];
  if (keyCol && keyCol !== 'id' && !out[keyCol]) {
    out[keyCol] = rowKey(collection, row);
  }
  return out;
}

export function rowFromDb(collection: string, row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) out[camel(k)] = v;
  const keyCol = KEY_COLUMNS[collection];
  if (keyCol && keyCol !== 'id') delete out[keyCol];
  return out;
}

/** Adds columns that were introduced after the first schema release (existing installs). */
const COLUMN_MIGRATIONS: Array<{ table: string; column: string; ddl: string }> = [
  { table: 'announcements', column: 'video_data', ddl: 'LONGTEXT NULL' },
];

/** Creates the database and all tables if they do not exist yet. */
export async function ensureSchema(cfg: DbConfig): Promise<void> {
  const server = await mysql.createConnection({
    host: cfg.host, port: cfg.port, user: cfg.user, password: cfg.password, connectTimeout: 5000
  });
  try {
    await server.query(
      `CREATE DATABASE IF NOT EXISTS \`${cfg.database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
    );
  } finally {
    await server.end();
  }

  const pool = await mysql.createPool({
    host: cfg.host, port: cfg.port, user: cfg.user, password: cfg.password,
    database: cfg.database, connectionLimit: 5, connectTimeout: 5000
  });
  try {
    const defs: Record<string, string> = {
      users: '`id` VARCHAR(64) PRIMARY KEY, `username` VARCHAR(64), `password_hash` VARCHAR(128), `role` VARCHAR(16), `display_name` VARCHAR(128)',
      sections: '`id` VARCHAR(64) PRIMARY KEY, `name` VARCHAR(128), `grade` VARCHAR(64), `color` VARCHAR(16)',
      departments: '`id` VARCHAR(64) PRIMARY KEY, `name` VARCHAR(128)',
      teachers: '`id` VARCHAR(64) PRIMARY KEY, `qr` VARCHAR(64), `last_name` VARCHAR(128), `first_name` VARCHAR(128), `middle_name` VARCHAR(64), `department_id` VARCHAR(64), `number` VARCHAR(32)',
      guardians: '`id` VARCHAR(64) PRIMARY KEY, `last_name` VARCHAR(128), `first_name` VARCHAR(128), `number` VARCHAR(32), `address` VARCHAR(255), `email` VARCHAR(190)',
      students: '`id` VARCHAR(64) PRIMARY KEY, `qr` VARCHAR(64), `last_name` VARCHAR(128), `first_name` VARCHAR(128), `middle_name` VARCHAR(64), `sex` VARCHAR(2), `number` VARCHAR(32), `section_id` VARCHAR(64), `guardian_id` VARCHAR(64)',
      slots: '`id` VARCHAR(64) PRIMARY KEY, `section_id` VARCHAR(64), `subject` VARCHAR(128), `department_id` VARCHAR(64), `teacher_id` VARCHAR(64), `start` VARCHAR(8), `end` VARCHAR(8), `days` JSON',
      slotStatuses: '`id` VARCHAR(64) PRIMARY KEY, `slot_status_key` VARCHAR(160) UNIQUE, `slot_id` VARCHAR(64), `reason` VARCHAR(24), `note` VARCHAR(512), `date` VARCHAR(10)',
      scans: '`id` VARCHAR(64) PRIMARY KEY, `person_id` VARCHAR(64), `role` VARCHAR(16), `ts` BIGINT, `kind` VARCHAR(8)',
      attendance: '`id` VARCHAR(64) PRIMARY KEY, `attendance_key` VARCHAR(128) UNIQUE, `student_id` VARCHAR(64), `date` VARCHAR(10), `ts` BIGINT, `kind` VARCHAR(8)',
      classEvents: '`id` VARCHAR(64) PRIMARY KEY, `class_event_key` VARCHAR(160) UNIQUE, `slot_id` VARCHAR(64), `teacher_id` VARCHAR(64), `date` VARCHAR(10), `ts` BIGINT',
      sms: '`id` VARCHAR(64) PRIMARY KEY, `ts` BIGINT, `to` VARCHAR(32), `body` VARCHAR(512), `student_id` VARCHAR(64), `kind` VARCHAR(16), `status` VARCHAR(16), `attempts` INT, `last_error` VARCHAR(512), `sent_ts` BIGINT, `next_retry_ts` BIGINT',
      emails: '`id` VARCHAR(64) PRIMARY KEY, `ts` BIGINT, `to` VARCHAR(190), `subject` VARCHAR(255), `body` TEXT, `student_id` VARCHAR(64), `kind` VARCHAR(16), `status` VARCHAR(16), `attempts` INT, `last_error` VARCHAR(512), `sent_ts` BIGINT, `next_retry_ts` BIGINT',
      announcements: '`id` VARCHAR(64) PRIMARY KEY, `type` VARCHAR(8), `title` VARCHAR(190), `body` TEXT, `photo_path` VARCHAR(512), `photo_data` LONGTEXT, `video_data` LONGTEXT, `from` VARCHAR(10), `to` VARCHAR(10), `enabled` TINYINT(1), `posted_by` VARCHAR(128)',
      kv: '`key` VARCHAR(64) PRIMARY KEY, `value` JSON'
    };
    for (const [table, ddl] of Object.entries(defs)) {
      await pool.query(`CREATE TABLE IF NOT EXISTS \`${table}\` (${ddl}) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    }
    for (const m of COLUMN_MIGRATIONS) {
      try {
        await pool.query(`ALTER TABLE \`${m.table}\` ADD COLUMN \`${m.column}\` ${m.ddl}`);
      } catch (err) {
        const e = err as { errno?: number; code?: string };
        if (e.errno !== 1060 && e.code !== 'ER_DUP_FIELDNAME') throw err; // 1060 = column already exists
      }
    }
  } finally {
    await pool.end();
  }
}

export class DbConnection {
  private pool: Pool | null = null;
  lastError: string | null = null;

  get enabled(): boolean {
    return this.pool !== null;
  }

  async connect(cfg: DbConfig): Promise<void> {
    await this.disconnect();
    this.pool = await mysql.createPool({
      host: cfg.host,
      port: cfg.port,
      user: cfg.user,
      password: cfg.password,
      database: cfg.database,
      connectionLimit: 5,
      connectTimeout: 5000
    });
    await this.pool.query('SELECT 1');
  }

  async disconnect(): Promise<void> {
    if (this.pool) {
      try { await this.pool.end(); } catch { /* ignore */ }
      this.pool = null;
    }
  }

  /** Verifies connectivity; returns the server version. Throws on failure. */
  async test(cfg: DbConfig): Promise<string> {
    const conn = await mysql.createConnection({
      host: cfg.host, port: cfg.port, user: cfg.user, password: cfg.password, connectTimeout: 5000
    });
    try {
      const [rows] = await conn.query('SELECT VERSION() AS v');
      return (rows as { v: string }[])[0]?.v ?? 'unknown';
    } finally {
      await conn.end();
    }
  }

  /** Reads everything into an AppData shape (settings backfilled if missing). */
  async loadAll(): Promise<AppData> {
    if (!this.pool) throw new Error('MySQL not connected');
    const d = { settings: { ...DEFAULT_SETTINGS }, holiday: { date: null }, borrowed: { sections: [] } } as unknown as AppData;
    for (const c of COLLECTIONS) {
      const [result] = await this.pool.query(`SELECT * FROM \`${c}\``);
      (d as unknown as Record<string, unknown>)[c] =
        (result as Record<string, unknown>[]).map(r => rowFromDb(c, r));
    }
    const [kvRows] = await this.pool.query('SELECT `key`, `value` FROM `kv`');
    for (const r of kvRows as { key: string; value: unknown }[]) {
      const parsed = typeof r.value === 'string' ? JSON.parse(r.value) : r.value;
      if (r.key === 'settings') d.settings = { ...DEFAULT_SETTINGS, ...parsed };
      else if (r.key === 'holiday') d.holiday = parsed;
      else if (r.key === 'borrowed') d.borrowed = parsed;
    }
    if (!Array.isArray(d.emails)) d.emails = [];
    return d;
  }

  /**
   * Syncs an AppData snapshot into MySQL: inserts new rows, updates changed
   * ones, deletes rows that disappeared (by primary key), and upserts the
   * settings/holiday/borrowed JSON blobs.
   */
  async sync(d: AppData): Promise<void> {
    if (!this.pool) throw new Error('MySQL not connected');
    const src = d as unknown as Record<string, unknown>;

    for (const c of COLLECTIONS) {
      const keyCol = KEY_COLUMNS[c] ?? 'id';
      const rows = Array.isArray(src[c]) ? (src[c] as Record<string, unknown>[]) : [];
      const target = rows.map(r => rowToDb(c, r));
      const targetKeys = new Set(target.map(r => String(r[keyCol])));

      const [existing] = await this.pool.query(`SELECT \`${keyCol}\` FROM \`${c}\``);
      const existingKeys = new Set((existing as Record<string, unknown>[]).map(r => String(r[keyCol])));

      for (const k of [...existingKeys].filter(k => !targetKeys.has(k))) {
        await this.pool.query(`DELETE FROM \`${c}\` WHERE \`${keyCol}\` = ?`, [k]);
      }

      for (const row of target) {
        const key = String(row[keyCol]);
        const cols = Object.keys(row).filter(k => row[k] !== undefined);
        if (cols.length === 0) continue;
        if (!existingKeys.has(key)) {
          const names = cols.map(k => `\`${k}\``).join(', ');
          const placeholders = cols.map(() => '?').join(', ');
          await this.pool.query(
            `INSERT INTO \`${c}\` (${names}) VALUES (${placeholders})`,
            cols.map(k => row[k] ?? null)
          );
        } else {
          const updatable = cols.filter(k => k !== keyCol);
          if (updatable.length === 0) continue;
          const assignments = updatable.map(k => `\`${k}\` = ?`).join(', ');
          await this.pool.query(
            `UPDATE \`${c}\` SET ${assignments} WHERE \`${keyCol}\` = ?`,
            [...updatable.map(k => row[k] ?? null), key]
          );
        }
      }
    }

    // settings / holiday / borrowed as JSON blobs
    for (const k of KV_KEYS) {
      if (src[k] === undefined) continue;
      await this.pool.query(
        'INSERT INTO `kv` (`key`, `value`) VALUES (?, ?) ON DUPLICATE KEY UPDATE `value` = ?',
        [k, JSON.stringify(src[k]), JSON.stringify(src[k])]
      );
    }
  }
}
