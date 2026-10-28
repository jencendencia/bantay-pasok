# Swiped Perfectly Just-in-time — School Attendance Monitoring System

An Electron desktop app that monitors student arrival/departure and teacher class attendance in real time via QR scanning, with automatic SMS notification to parents over a GSM modem.

## Features

- **Standby screen** (second display/scanner station): greeting header, text + photo announcements, live QR scan popups for teachers and students.
- **One scanner for everyone**: a single QR scan identifies the person as teacher or student and follows the designated flow.
  - Teacher: *"Welcome, Ma'am {Name}. Have a great class!"* ("Sir" for male teachers, based on the sex chosen at enrollment)
  - Student: early / on-time / late greetings (the screen never says "late" — only the parent SMS does).
  - Repeat scans within **60 s** are ignored.
- **Parent SMS via GSM modem**: arrival and departure texts sent over serial AT commands; failures retry automatically and show in the dashboard sidebar. A simulation mode is available when no modem is connected.
- **Parent email via Gmail**: guardians can store an email address; arrival/departure notices go out through SMTP (Gmail App Password) with the same retry queue. A Settings → Test connection button verifies credentials, and an Email log shows every message.
- **Admin dashboard**: live class-program grid per section; each period lights **yellow** when the assigned teacher has scanned; clickable empty slots to record an absence reason (On leave / In a meeting / Unknown / Others); Holiday and Class Borrowed toggles (borrowed by G7–G10 or all sections).
- **8 admin tabs**: Standby Screen, Class Program, Sections, Teachers, Reports, Students, Guardians, Settings.
- **Class Program**: enrolment of section/time/subject/teacher with a **double-booking warning**, an add-slot confirmation dialog, and a brief highlight on the newly added row.
- **Sections**: roster + attendance reports by section and by time of arrival, sortable alphabetically or by arrival time, plus an **enroll-students modal** (un-enrolled students with checkboxes). A searchable dropdown handles long section lists, and each section can set its own **AM time in / AM time out / PM time in / PM time out** — sections without their own times follow the global time rules from Settings.
- **Kiosk mode**: opening the scanner closes the admin panel; the kiosk's **⚙ Admin** button opens a login (accounts from Settings → Users) that brings the admin panel back.
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

## Two computers on one network (LAN database)

One computer can be the **main computer** (for example the office PC) while a second computer uses *the same database* over the local network — no extra database server to install, works with any mix of Windows versions (e.g. Windows 7 main + Windows 11 second).

**Main computer (hosts the database):**

1. Settings → Database → *Where this computer keeps the data* = **This computer's database** (the default).
2. Turn on **Share this computer's database over the network**. The Settings card then shows this computer's IP address (port `39500`) — that is exactly what the other computer needs.
3. Windows will ask for firewall permission the first time — choose **Allow access** (or open TCP port 39500 yourself). Give the PC a fixed IP address so the other computer never loses it.

**Second computer (the client):**

1. Settings → Database → choose **Database of another computer on the network (LAN)**.
2. Enter the main computer's IP address (e.g. `192.168.1.10`) and click **Test and connect**.

While in LAN mode the client computer keeps **no local database**: students, settings, users, scans and reports all read and write on the main computer; attendance times follow the main computer's clock; parent SMS/email go out from its modem; and a status pill plus a 3-second poll keep every window live. Switching back to *This computer's database* restores the local SQLite connection and GSM/SMTP loops. The choice is stored in `network.json` next to the data (`mode`, `host`, `share`, `port`).

> **Security note:** the sharing protocol has **no password** (by design) — anyone on the same network who can reach that IP:port can read and change the data. Keep sharing off on computers nobody connects to, and keep the school network on a trusted router.

## Windows installer (deployment)

Build the installer for school PCs:

```bash
npm run dist           # full build + NSIS installer
npm run dist:dir       # unpacked folder only (faster, for quick testing)
```

- Output: `release/SwipedPerfectlyJustInTime.Setup.<version>.exe` — run it on the school computer and follow the wizard (choose the install folder, desktop shortcut is created).
- The app icon lives in `build/icon.png` (regenerate with `npm run icon`).
- The GSM modem driver (`serialport`) is rebuilt for Electron automatically during packaging and unpacked from the asar at runtime.
- User data (`data.json`, `sqlite.json`, `bantay-pasok.db`) lives in `%APPDATA%\Bantay Pasok\bantay-pasok-data\` — it survives app updates and uninstalling. Back that folder up when moving schools/PCs.
- If SmartScreen warns on first run (unsigned build), click *More info → Run anyway*.
- Windows 7 cannot run this build (Electron 33 needs Windows 10+). It needs the separate Electron 22 package; the steps and the native-module workaround are in [GITHUB_RELEASE_UPLOAD_GUIDE.md](GITHUB_RELEASE_UPLOAD_GUIDE.md#windows-7-installer-electron-22).

## Notes

- All data is stored in a local SQLite database (`bantay-pasok-data/bantay-pasok.db` under the app's user-data folder) with `data.json` kept as an automatic backup (see above).
- Tests: `npm run build:electron && node scripts/smoke-test.cjs` (seed integrity, scan flows, per-section time rules, duplicate suppression, SMS queue, Excel reports, GSM retry). Storage: `npm run db:test` (SQLite sync round-trip). LAN sharing: `node scripts/lan-test.cjs` (host parser, server lifecycle, snapshot/mutation/login/scan routes, revision polling, protocol errors).
