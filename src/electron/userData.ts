import { app } from 'electron';
import * as path from 'path';

/**
 * The app was renamed from "Bantay Pasok" to "Swiped Perfectly Just-in-time".
 * Electron derives %APPDATA%\<productName> from productName, which would leave
 * every existing install's data.json / SQLite database behind in the old folder.
 * Pin the data directory to the original name so data survives the rename
 * (and any future renames). Import this module FIRST in main.ts, before the
 * store reads app.getPath('userData').
 */
app.setPath('userData', path.join(app.getPath('appData'), 'Bantay Pasok'));
