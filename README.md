# Bantay Pasok — School Attendance Monitoring System

An Electron desktop app that monitors student arrival/departure and teacher class attendance in real time via QR scanning, with automatic SMS notification to parents over a GSM modem.

## Features

- **Standby screen** (second display/scanner station): greeting header, text + photo announcements, live QR scan popups for teachers and students.
- **One scanner for everyone**: a single QR scan identifies the person as teacher or student and follows the designated flow.
  - Teacher: *"Welcome, Ma'am/Sir [Name]. Have a great class!"*
  - Student: early / on-time / late greetings (the screen never says "late" — only the parent SMS does).
  - Repeat scans within **60 s** are ignored.
- **Parent SMS via GSM modem**: arrival and departure texts sent over serial AT commands; failures retry automatically and show in the dashboard sidebar. A simulation mode is available when no modem is connected.
- **Parent email via Gmail**: guardians can store an email address; arrival/departure notices go out through SMTP (Gmail App Password) with the same retry queue. A Settings → Test connection button verifies credentials, and an Email log shows every message.
- **Admin dashboard**: live class-program grid per section; each period lights **yellow** when the assigned teacher has scanned; clickable empty slots to record an absence reason (On leave / In a meeting / Unknown / Others); Holiday and Class Borrowed toggles (borrowed by G7–G10 or all sections).
- **8 admin tabs**: Standby Screen, Class Program, Sections, Teachers, Reports, Students, Guardians, Settings.
- **Class Program**: enrolment of section/time/subject/teacher with a **double-booking warning**.
- **Sections**: roster + attendance reports by section and by time of arrival, sortable alphabetically or by arrival time, plus an **enroll-students modal** (un-enrolled students with checkboxes).
- **Teachers**: logs derived from class-program enrolments; late marks based on each slot's scheduled start; reports by section and department; alphabetical/arrival sorting.
- **Reports**: styled, downloadable Excel workbooks (ExcelJS) — teacher attendance, individual teacher frequency (weekly/monthly/by term), student attendance, and student punctuality. Daily/weekly/monthly/term ranges. Excused leave is never counted as absent.
- **Students / Guardians**: enrollment records (students by sex and number; guardians with name, number, email, address), a searchable multi-child picker in the Add Guardian modal, and printable **QR ID cards**.
- **Settings**: users, school time (grace period, late cutoff), GSM module (port, baud, simulation), Gmail/SMTP setup, and backup/restore.
- **Gmail App Password**: in Google Account → Security → 2-Step Verification → App passwords, generate a 16-character password and paste it into Settings → Gmail setup (your normal Gmail password will not work).

## Project layout

```
src/
  shared/      types, constants, seed data, id helpers (used by both processes)
  electron/    main process: store, attendance logic, GSM, Excel reports, IPC
  scanner/     second-window React app (standby screen + scan popups)
  pages/       admin dashboard tabs
  styles.css   shared dark-green/yellow design system
scripts/       smoke-test.cjs (headless test of the core logic)
```

## Setup

```bash
npm install
npm run build          # vite build + electron tsc
npm start              # launch the app (admin dashboard)
npm run dev            # vite dev server + electron
```

- The admin dashboard opens on launch; open the **scanner display** via *Standby Screen → Open scanner display*.
- Default login: **admin / admin123** (change it in Settings → Users).

## GSM modem

- Settings → GSM: pick the COM port and baud rate (default 9600), or enable **Simulation mode** to test the whole flow without hardware.
- The module speaks AT commands (`AT+CMGF=1`, `AT+CMGS`), retries failed sends with backoff, and surfaces every message status in the dashboard sidebar.
- Recommended cheap modem: SIM800L/SIM900 module over USB-serial. Make sure the SIM has load/credit and the antenna is attached.

## SQLite database

Everything lives in a local SQLite database file — no server to install or configure. `data.json` is always written too, so it doubles as an automatic backup.

1. SQLite is **enabled by default**. The database file is created automatically at `%APPDATA%\Bantay Pasok\bantay-pasok-data\bantay-pasok.db` on first run.
2. On first connect the tables are created and the existing `data.json` is imported if the database is empty.
3. Every save writes to `data.json` *and* syncs to SQLite (inserts, updates, deletes). If the database file is locked or moved, the app keeps running on JSON and retries on the next save.

Use **Import data.json now** (Settings → SQLite database) to re-push the local file into SQLite at any time. The configuration is stored next to the data in `sqlite.json`.

## Windows installer (deployment)

Build the installer for school PCs:

```bash
npm run dist           # full build + NSIS installer
npm run dist:dir       # unpacked folder only (faster, for quick testing)
```

- Output: `release/BantayPasok-Setup-<version>.exe` — run it on the school computer and follow the wizard (choose the install folder, desktop shortcut is created).
- The app icon lives in `build/icon.png` (regenerate with `npm run icon`).
- The GSM modem driver (`serialport`) is rebuilt for Electron automatically during packaging and unpacked from the asar at runtime.
- User data (`data.json`, `sqlite.json`, `bantay-pasok.db`) lives in `%APPDATA%\Bantay Pasok\bantay-pasok-data\` — it survives app updates and uninstalling. Back that folder up when moving schools/PCs.
- If SmartScreen warns on first run (unsigned build), click *More info → Run anyway*.

## Notes

- All data is stored in a local SQLite database (`bantay-pasok-data/bantay-pasok.db` under the app's user-data folder) with `data.json` kept as an automatic backup (see above).
- Tests: `npm run build:electron && node scripts/smoke-test.cjs` (22 checks: seed integrity, scan flows, duplicate suppression, SMS queue, Excel reports, GSM retry). Storage: `npm run db:test` (SQLite sync round-trip).
