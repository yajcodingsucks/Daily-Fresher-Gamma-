// Developer tool: runs the screens in a normal browser without Electron, using an in-memory database.
//   node test/ui-harness.js        then open http://localhost:5173
// Printing is simulated: the HTML that would be printed is saved to test/out/.

const http = require('http');
const fs = require('fs');
const path = require('path');
const { openNodeSqlite } = require('../main/store');
const { createService } = require('../main/service');

const svc = createService(openNodeSqlite());
const ROOT = path.join(__dirname, '..', 'renderer');
const OUT = path.join(__dirname, 'out');
fs.mkdirSync(OUT, { recursive: true });
let printCount = 0;

const bridgeJs = `
window.bridge = {
  call: (m, ...a) => fetch('/api', { method: 'POST', body: JSON.stringify({ m, a }) }).then((r) => r.json()),
  print: (html, mode, name) => fetch('/print', { method: 'POST', body: JSON.stringify({ html, mode, name }) }).then((r) => r.json()),
  dataInfo: async () => ({ ok: true, data: { dataDir: 'C:/Users/you/Documents/Daily Fresher Invoices', dbPath: 'C:/Users/you/Documents/Daily Fresher Invoices/daily-fresher.db', version: '0.1.0' } }),
  backupNow: async () => ({ ok: true, data: 'backup.db' }),
  restoreBackup: async () => ({ ok: true, data: { done: false } }),
  openDataFolder: async () => ({ ok: true, data: '' }),
};`;

const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript' };

http.createServer((req, res) => {
  if (req.method === 'POST') {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const j = JSON.parse(body);
      let out;
      if (req.url === '/api') {
        try { out = { ok: true, data: svc[j.m](...j.a) }; } catch (e) { out = { ok: false, error: e.message }; }
      } else {
        printCount += 1;
        const file = path.join(OUT, `print-${printCount}-${j.mode}.html`);
        fs.writeFileSync(file, j.html);
        out = { ok: true, data: { done: true, filePath: file } };
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(out));
    });
    return;
  }
  if (req.url === '/__bridge.js') { res.writeHead(200, { 'Content-Type': 'text/javascript' }); return res.end(bridgeJs); }
  const file = path.join(ROOT, req.url === '/' ? 'index.html' : decodeURIComponent(req.url.split('?')[0]));
  if (!file.startsWith(ROOT) || !fs.existsSync(file)) { res.writeHead(404); return res.end(); }
  let data = fs.readFileSync(file);
  if (file.endsWith('index.html')) data = data.toString().replace('<script src="js/util.js">', '<script src="/__bridge.js"></script><script src="js/util.js">');
  res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' });
  res.end(data);
}).listen(5173, () => console.log('UI harness on http://localhost:5173'));

module.exports = { svc };
