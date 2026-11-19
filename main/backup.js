// Copies of the database file. Made automatically when the app starts and closes,
// and whenever you click "Backup now". The newest 60 are kept.

const fs = require('fs');
const path = require('path');

const KEEP = 60;

function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function makeBackup(dbPath, backupDir, tag) {
  if (!fs.existsSync(dbPath)) return null;
  fs.mkdirSync(backupDir, { recursive: true });
  const file = path.join(backupDir, `daily-fresher_${stamp()}_${tag}.db`);
  fs.copyFileSync(dbPath, file);
  prune(backupDir);
  return file;
}

function prune(backupDir) {
  const files = fs.readdirSync(backupDir).filter((f) => f.endsWith('.db')).sort().reverse();
  for (const f of files.slice(KEEP)) fs.unlinkSync(path.join(backupDir, f));
}

function isSqliteFile(file) {
  const fd = fs.openSync(file, 'r');
  try {
    const buf = Buffer.alloc(16);
    fs.readSync(fd, buf, 0, 16, 0);
    return buf.toString('latin1') === 'SQLite format 3\u0000';
  } finally { fs.closeSync(fd); }
}

module.exports = { makeBackup, isSqliteFile };
