// Starts the app: opens the database, connects the screens to the business rules, handles printing and backups.

const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { openSqlJs } = require('./store');
const { createService, UserError } = require('./service');
const { makeBackup, isSqliteFile } = require('./backup');
const { readWorkbook } = require('./excel');
const { createCrashLog, describeExit } = require('./crashlog');

const DATA_DIR = path.join(app.getPath('documents'), 'Daily Fresher Invoices');
const DB_PATH = path.join(DATA_DIR, 'daily-fresher.db');
const BACKUP_DIR = path.join(DATA_DIR, 'backups');

// No graphics acceleration: the app is forms and tables, and some laptops (drivers, new Windows builds)
// crash in the GPU process. Must be called before the app is ready.
app.disableHardwareAcceleration();

let win;
let svc;
let shown = false;   // true once the main window is on screen

// ---- never close silently: log every crash, and tell the user when the window cannot be shown ----
const crash = createCrashLog(DATA_DIR);

function fatal(title, what, details) {
  crash.write(title, `${what}\n${details || ''}`);
  try { dialog.showErrorBox(title, crash.message(what)); } catch (_) { /* nothing else we can do */ }
}

// A problem while the window is open: tell the user without closing the app.
function warnUser(what) {
  if (win && !win.isDestroyed() && shown) {
    dialog.showMessageBox(win, { type: 'error', title: 'Something went wrong', message: what, detail: `The details were saved in:\n${crash.file}`, buttons: ['OK'] }).catch(() => {});
  } else {
    fatal('Daily Fresher Invoices has a problem', what);
  }
}

process.on('uncaughtException', (err) => {
  crash.write('Uncaught exception (main process)', err && err.stack ? err.stack : String(err));
  if (!shown) { fatal('Daily Fresher Invoices could not start', `An unexpected error stopped the app: ${err && err.message}`); app.exit(1); return; }
  warnUser(`An unexpected error happened: ${err && err.message}. You can keep working; if something looks wrong, restart the app.`);
});

process.on('unhandledRejection', (reason) => {
  crash.write('Unhandled promise rejection (main process)', reason && reason.stack ? reason.stack : String(reason));
  if (!shown) return;   // logged; a failure during start-up is reported by the start-up code itself
  warnUser(`An unexpected error happened: ${reason && reason.message ? reason.message : reason}.`);
});

// A helper process (GPU, network, utility, ...) stopped.
app.on('child-process-gone', (_e, d) => {
  crash.write(`Child process gone: ${d.type}${d.name ? ` (${d.name})` : ''}`,
    `reason: ${d.reason}\n${describeExit(d.exitCode)}${d.serviceName ? `\nservice: ${d.serviceName}` : ''}`);
});

// The window's page stopped. Reload it once; if it keeps stopping, say so and close.
let renderCrashes = [];
app.on('render-process-gone', (_e, wc, d) => {
  const isMain = win && !win.isDestroyed() && wc === win.webContents;
  crash.write(`Renderer gone (${isMain ? 'main window' : 'print / helper window'})`, `reason: ${d.reason}\n${describeExit(d.exitCode)}`);
  if (!isMain || d.reason === 'clean-exit') return;
  const now = Date.now();
  renderCrashes = renderCrashes.filter((t) => now - t < 60000).concat(now);
  if (renderCrashes.length >= 2) {
    fatal('Daily Fresher Invoices stopped', `The app window stopped twice in a minute (${d.reason}, ${describeExit(d.exitCode)}), so the app will close. Your data is saved.`);
    app.exit(1);
    return;
  }
  win.reload();
  if (shown) warnUser(`The app window stopped (${d.reason}) and was reloaded. Your data is saved; check the last thing you typed.`);
});

// Only these functions can be called from the screens.
const ALLOWED = new Set([
  'bootstrap', 'getSettings', 'saveSettings', 'listDorms', 'saveDorm', 'listProducts', 'saveProduct', 'deleteProduct',
  'nextWeekPlan', 'newWeek', 'deleteWeek', 'listWeeks', 'getWeek', 'copyLastWeek', 'setQty', 'setWeekPrice', 'setInvoiceFields',
  'markPrinted', 'unlockWeek', 'getLog', 'listMonths', 'monthly', 'setPayment', 'correctInvoices', 'logStatement',
  'checkPastWeek', 'addPastWeek', 'finishPastWeek', 'deletePastWeek', 'missingWeeks', 'checkImport', 'importWeek',
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
// paper: 'A4' (default), 'A5' or 'Letter', from the receipt format.
ipcMain.handle('print', (_e, html, mode, fileName, paper) => wrap(async () => {
  const pageSize = ['A4', 'A5', 'Letter'].includes(paper) ? paper : 'A4';
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
      const pdf = await pw.webContents.printToPDF({ pageSize, printBackground: true, margins: { marginType: 'none' } });
      fs.writeFileSync(filePath, pdf);
      shell.openPath(filePath);
      return { done: true, filePath };
    }
    const done = await new Promise((resolve) => {
      pw.webContents.print({ silent: false, printBackground: true, pageSize, margins: { marginType: 'none' } },
        (success) => resolve(success));
    });
    return { done };
  } finally {
    pw.destroy();
    fs.rm(tmp, () => {});
  }
})());

// ---- import a past week from Excel ----
// Opens the file picker, reads the visible cells of every sheet, and returns the first draft + check
// (service.startImport). Nothing is saved until importWeek.
ipcMain.handle('openExcel', () => wrap(async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog(win, {
    title: 'Choose an Excel receipt file', defaultPath: app.getPath('downloads'),
    filters: [{ name: 'Excel workbook', extensions: ['xlsx', 'xls'] }], properties: ['openFile'],
  });
  if (canceled || !filePaths[0]) return null;
  let book;
  try {
    book = readWorkbook(filePaths[0]);
  } catch (err) {
    throw new UserError(`${path.basename(filePaths[0])} could not be read as an Excel workbook (${err.message}).`);
  }
  return svc.startImport({ file: path.basename(filePaths[0]), ...book });
})());

// ---- data & backups ----
ipcMain.handle('dataInfo', wrap(() => ({ dataDir: DATA_DIR, dbPath: DB_PATH, backupDir: BACKUP_DIR, version: app.getVersion() })));
ipcMain.handle('backupNow', wrap(() => makeBackup(DB_PATH, BACKUP_DIR, 'manual')));
ipcMain.handle('openDataFolder', wrap(() => shell.openPath(DATA_DIR)));

// ---- Settings → Help → Check the app ----
// Versions, Windows, CPU, data folder, database health, backups and the end of error.log.
ipcMain.handle('appCheck', wrap(() => {
  const stat = (f) => { try { return fs.statSync(f); } catch (_) { return null; } };
  const db = stat(DB_PATH);
  const backups = (() => { try { return fs.readdirSync(BACKUP_DIR).filter((f) => f.endsWith('.db')).sort(); } catch (_) { return []; } })();
  const logStat = stat(crash.file);
  let logTail = '';
  if (logStat) {
    const text = fs.readFileSync(crash.file, 'utf8');
    logTail = text.split(/\r?\n/).slice(-40).join('\n').trim();
  }
  const build = Number(os.release().split('.')[2] || 0);
  const gpu = (() => { try { return app.getGPUFeatureStatus(); } catch (_) { return {}; } })();
  let health;
  try { health = svc.databaseHealth(); } catch (err) { health = { ok: false, error: err.message }; }
  return {
    app: app.getVersion(), packaged: app.isPackaged, exe: app.getPath('exe'),
    electron: process.versions.electron, chrome: process.versions.chrome, node: process.versions.node,
    windows: `${build >= 22000 ? 'Windows 11' : 'Windows 10'} (${os.version()}, build ${os.release()})`,
    appArch: process.arch, machine: typeof os.machine === 'function' ? os.machine() : os.arch(),
    cpu: (os.cpus()[0] || {}).model || '?', cores: os.cpus().length,
    memoryGb: Math.round((os.totalmem() / 1024 ** 3) * 10) / 10,
    graphics: `acceleration off (${gpu.gpu_compositing || '?'} compositing)`,
    dataDir: DATA_DIR, dbPath: DB_PATH, dbSize: db ? db.size : 0, dbSaved: db ? db.mtime.toISOString() : null,
    backupDir: BACKUP_DIR, backups: backups.length, lastBackup: backups[backups.length - 1] || null,
    health,
    errorLog: crash.file, errorLogSize: logStat ? logStat.size : 0, errorLogTail: logTail,
  };
}));
ipcMain.handle('openErrorLog', wrap(async () => {
  if (!fs.existsSync(crash.file)) throw new UserError('There is no error log: nothing has gone wrong so far.');
  const err = await shell.openPath(crash.file);
  if (err) throw new UserError(err);
  return true;
}));
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
  const show = () => { if (shown || win.isDestroyed()) return; shown = true; win.maximize(); win.show(); };
  win.once('ready-to-show', show);
  // If the page never says it is ready (a crash while loading), show the window anyway after 20 s,
  // so the app does not sit invisible; the log says why.
  setTimeout(() => {
    if (shown || win.isDestroyed()) return;
    crash.write('Window not ready after 20 s', 'The window was shown anyway.');
    show();
  }, 20000);
  win.webContents.on('did-fail-load', (_e, code, desc, url) => {
    fatal('Daily Fresher Invoices could not open its window', `The app screens could not be loaded (${desc}, ${code}).`, url);
  });
  win.webContents.on('preload-error', (_e, file, err) => crash.write('Preload error', `${file}\n${err && err.stack}`));
  win.on('unresponsive', () => crash.write('Window not responding', 'The app window stopped responding for a while.'));
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html')).catch((err) => crash.write('loadFile failed', err && err.stack));
}

app.whenReady().then(async () => {
  try {
    const store = await openSqlJs(DB_PATH);
    svc = createService(store);
    makeBackup(DB_PATH, BACKUP_DIR, 'start');
  } catch (err) {
    fatal('Daily Fresher Invoices could not start', `The data in ${DB_PATH} could not be opened: ${err && err.message}`, err && err.stack);
    app.exit(1);
    return;
  }
  createWindow();
}).catch((err) => {
  fatal('Daily Fresher Invoices could not start', `Electron could not start: ${err && err.message}`, err && err.stack);
  app.exit(1);
});

app.on('before-quit', () => {
  try { makeBackup(DB_PATH, BACKUP_DIR, 'close'); } catch (_) { /* ignore */ }
});

app.on('window-all-closed', () => app.quit());
