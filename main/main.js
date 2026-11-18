// Starts the app: opens the database, connects the screens to the business rules, handles printing and backups.

const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { openSqlJs } = require('./store');
const { createService, UserError } = require('./service');
const { makeBackup, isSqliteFile } = require('./backup');

const DATA_DIR = path.join(app.getPath('documents'), 'Daily Fresher Invoices');
const DB_PATH = path.join(DATA_DIR, 'daily-fresher.db');
const BACKUP_DIR = path.join(DATA_DIR, 'backups');

let win;
let svc;

// Only these functions can be called from the screens.
const ALLOWED = new Set([
  'bootstrap', 'getSettings', 'saveSettings', 'listDorms', 'saveDorm', 'listProducts', 'saveProduct', 'deleteProduct',
  'nextWeekPlan', 'newWeek', 'deleteWeek', 'listWeeks', 'getWeek', 'copyLastWeek', 'setQty', 'setWeekPrice', 'setInvoiceFields',
  'markPrinted', 'unlockWeek', 'getLog', 'listMonths', 'monthly', 'setPayment', 'correctInvoices', 'logStatement',
]);

function wrap(fn) {
  return async (...args) => {
    try {
      return { ok: true, data: await fn(...args) };
    } catch (err) {
      if (!(err instanceof UserError)) console.error(err);
      const msg = err instanceof UserError ? err.message
        : /UNIQUE/.test(err.message) ? 'That number or code is already used.'
          : err.message;
      return { ok: false, error: msg };
    }
  };
}

ipcMain.handle('api', (_e, method, ...args) => wrap(() => {
  if (!ALLOWED.has(method)) throw new UserError(`Unknown action: ${method}`);
  return svc[method](...args);
})());

// ---- printing ----
// html: a full HTML document. mode: 'print' (opens the Windows print dialog) or 'pdf' (save a PDF file).
ipcMain.handle('print', (_e, html, mode, fileName) => wrap(async () => {
  const tmp = path.join(os.tmpdir(), `daily-fresher-print-${Date.now()}.html`);
  fs.writeFileSync(tmp, html, 'utf8');
  const pw = new BrowserWindow({ show: false, webPreferences: { sandbox: true } });
  try {
    await pw.loadFile(tmp);
    if (mode === 'pdf') {
      const { canceled, filePath } = await dialog.showSaveDialog(win, {
        defaultPath: path.join(app.getPath('documents'), fileName || 'invoice.pdf'),
        filters: [{ name: 'PDF', extensions: ['pdf'] }],
      });
      if (canceled || !filePath) return { done: false };
      const pdf = await pw.webContents.printToPDF({ pageSize: 'A4', printBackground: true, margins: { marginType: 'none' } });
      fs.writeFileSync(filePath, pdf);
      shell.openPath(filePath);
      return { done: true, filePath };
    }
    const done = await new Promise((resolve) => {
      pw.webContents.print({ silent: false, printBackground: true, pageSize: 'A4', margins: { marginType: 'none' } },
        (success) => resolve(success));
    });
    return { done };
  } finally {
    pw.destroy();
    fs.rm(tmp, () => {});
  }
})());

// ---- data & backups ----
ipcMain.handle('dataInfo', wrap(() => ({ dataDir: DATA_DIR, dbPath: DB_PATH, backupDir: BACKUP_DIR, version: app.getVersion() })));
ipcMain.handle('backupNow', wrap(() => makeBackup(DB_PATH, BACKUP_DIR, 'manual')));
ipcMain.handle('openDataFolder', wrap(() => shell.openPath(DATA_DIR)));
ipcMain.handle('restoreBackup', wrap(async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog(win, {
    title: 'Choose a backup to restore', defaultPath: BACKUP_DIR,
    filters: [{ name: 'Daily Fresher database', extensions: ['db'] }], properties: ['openFile'],
  });
  if (canceled || !filePaths[0]) return { done: false };
  if (!isSqliteFile(filePaths[0])) throw new UserError('That file is not a Daily Fresher database.');
  const { response } = await dialog.showMessageBox(win, {
    type: 'warning', buttons: ['Restore', 'Cancel'], defaultId: 1, cancelId: 1,
    message: 'Replace all current data with this backup?',
    detail: 'A backup of the current data is made first, so you can undo this.',
  });
  if (response !== 0) return { done: false };
  makeBackup(DB_PATH, BACKUP_DIR, 'before-restore');
  fs.copyFileSync(filePaths[0], DB_PATH);
  app.relaunch();
  app.exit(0);
  return { done: true };
}));

function createWindow() {
  win = new BrowserWindow({
    width: 1400, height: 900, minWidth: 1100, minHeight: 700, show: false,
    title: 'Daily Fresher Invoices', backgroundColor: '#f3f6f9',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  win.removeMenu();
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  win.once('ready-to-show', () => { win.maximize(); win.show(); });
}

app.whenReady().then(async () => {
  try {
    const store = await openSqlJs(DB_PATH);
    svc = createService(store);
    makeBackup(DB_PATH, BACKUP_DIR, 'start');
  } catch (err) {
    dialog.showErrorBox('Daily Fresher Invoices could not start', String(err && err.stack || err));
    app.exit(1);
    return;
  }
  createWindow();
});

app.on('before-quit', () => {
  try { makeBackup(DB_PATH, BACKUP_DIR, 'close'); } catch (_) { /* ignore */ }
});

app.on('window-all-closed', () => app.quit());
