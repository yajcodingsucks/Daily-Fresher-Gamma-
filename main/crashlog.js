// The app never closes silently: problems are appended to Documents\Daily Fresher Invoices\error.log
// (date + details), and when the window cannot be shown an error box says what happened and where the log is.

const fs = require('fs');
const path = require('path');

// Windows exit codes that are worth explaining in words.
const CODES = {
  0xC000001D: 'STATUS_ILLEGAL_INSTRUCTION: the processor could not run an instruction (usually an Electron/Chromium build that does not support this Windows or CPU)',
  0xC0000005: 'STATUS_ACCESS_VIOLATION: the program read or wrote memory it should not',
  0xC0000409: 'STATUS_STACK_BUFFER_OVERRUN: Windows stopped the program for safety',
  0xC0000135: 'STATUS_DLL_NOT_FOUND: a Windows file the program needs is missing',
  0xC0000142: 'STATUS_DLL_INIT_FAILED: Windows could not start part of the program',
  0xC00000FD: 'STATUS_STACK_OVERFLOW',
  0xC0000017: 'STATUS_NO_MEMORY: not enough memory',
};

function describeExit(code) {
  if (code === undefined || code === null) return '';
  const u = code >>> 0;
  const hex = `0x${u.toString(16).toUpperCase().padStart(8, '0')}`;
  return `exit code ${code} (${hex})${CODES[u] ? ` = ${CODES[u]}` : ''}`;
}

function createCrashLog(dataDir) {
  const file = path.join(dataDir, 'error.log');

  function write(kind, details) {
    try {
      fs.mkdirSync(dataDir, { recursive: true });
      // keep the log small: start a new one after 1 MB (the old one is kept as error.old.log)
      try { if (fs.statSync(file).size > 1024 * 1024) fs.renameSync(file, path.join(dataDir, 'error.old.log')); } catch (_) { /* no log yet */ }
      const now = new Date();
      const local = now.toLocaleString('en-GB', { hour12: false });
      fs.appendFileSync(file, `[${local} | ${now.toISOString()}] ${kind}\n${String(details || '').trim()}\n\n`, 'utf8');
    } catch (_) {
      // nowhere to write: the error box below still tells the user
    }
  }

  const message = (what) => `${what}\n\nThe details were saved in:\n${file}\n\nIf you ask for help, send this file (Settings → Help → Check the app also shows it).`;

  return { file, write, message };
}

module.exports = { createCrashLog, describeExit };
