// Puts Electron in place WITHOUT downloading anything (for laptops where npm cannot download it).
//
//   1. Download from https://github.com/electron/electron/releases/tag/v<version> into the folder electron-zips\ :
//        electron-v<version>-win32-x64.zip, electron-v<version>-win32-arm64.zip and SHASUMS256.txt
//   2. npm run setup:electron
//
// It checks the zips against SHASUMS256.txt, then unpacks the zip for this laptop into node_modules\electron\dist
// (so `npm start` works). `npm run dist` builds from the zips in electron-zips\ (package.json "electronDist").
// With --check it only checks that the zips are there (used before every build).

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const ZIPS = path.join(ROOT, 'electron-zips');
const ARCHS = ['x64', 'arm64'];           // the Windows builds made by `npm run dist`
const checkOnly = process.argv.includes('--check');

function fail(msg) {
  console.error(`\n✗ ${msg}\n`);
  process.exit(1);
}

let version;
try {
  version = JSON.parse(fs.readFileSync(path.join(ROOT, 'node_modules', 'electron', 'package.json'), 'utf8')).version;
} catch (_) {
  fail('Electron is not installed in node_modules. Run `npm install` first.');
}
const zipName = (arch) => `electron-v${version}-win32-${arch}.zip`;
const url = `https://github.com/electron/electron/releases/tag/v${version}`;

const missing = ARCHS.filter((a) => !fs.existsSync(path.join(ZIPS, zipName(a))));
if (missing.length) {
  fail(`Missing in electron-zips\\: ${missing.map(zipName).join(', ')}\n  Download ${missing.length === 1 ? 'it' : 'them'} (and SHASUMS256.txt) from ${url}`);
}

// Checksums (SHASUMS256.txt from the same release page)
const sums = path.join(ZIPS, 'SHASUMS256.txt');
if (fs.existsSync(sums)) {
  const text = fs.readFileSync(sums, 'utf8');
  for (const a of ARCHS) {
    const line = text.split(/\r?\n/).find((l) => l.trim().endsWith(`*${zipName(a)}`) || l.trim().endsWith(` ${zipName(a)}`));
    if (!line) fail(`SHASUMS256.txt has no line for ${zipName(a)}. Is it from release v${version}?`);
    const want = line.trim().split(/\s+/)[0].toLowerCase();
    const have = crypto.createHash('sha256').update(fs.readFileSync(path.join(ZIPS, zipName(a)))).digest('hex');
    if (have !== want) fail(`${zipName(a)} is damaged or not the official file (checksum does not match). Download it again.`);
  }
  console.log(`✓ ${ARCHS.map(zipName).join(' and ')}: checksums OK`);
} else {
  console.log(`! SHASUMS256.txt not found in electron-zips\\ — zips not checked. (Download it from ${url}.)`);
}

const others = fs.readdirSync(ZIPS).filter((f) => /^electron-v.*\.zip$/.test(f) && !ARCHS.map(zipName).includes(f));
if (others.length) console.log(`  (old zips you can delete: ${others.join(', ')})`);
if (checkOnly) process.exit(0);

// Unpack the zip for this laptop so `npm start` can run Electron.
const arch = ARCHS.includes(process.arch) ? process.arch : 'x64';
const dist = path.join(ROOT, 'node_modules', 'electron', 'dist');
fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(dist, { recursive: true });
execFileSync('tar', ['-xf', path.join(ZIPS, zipName(arch)), '-C', dist], { stdio: 'inherit' });
if (!fs.existsSync(path.join(dist, 'electron.exe'))) fail('electron.exe was not found after unpacking.');
fs.writeFileSync(path.join(ROOT, 'node_modules', 'electron', 'path.txt'), 'electron.exe');
console.log(`✓ Electron ${version} (${arch}) unpacked into node_modules\\electron\\dist — npm start and npm run dist are ready.`);
