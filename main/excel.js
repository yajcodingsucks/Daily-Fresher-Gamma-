// Reads an Excel workbook (.xlsx / .xls) into plain rows for the importer (importer.js).
// Only what a person can SEE is kept: hidden rows and columns, hidden sheets, cells covered by a merged
// cell, and white text are dropped (some receipts contain a wrong white "Belle Vue No:1").
// Cell values: text → string, number → number, date → { date: 'YYYY-MM-DD' }, empty → null.

const XLSX = require('xlsx');

const pad = (n) => String(n).padStart(2, '0');

// White font: rgb FFFFFF, or theme colour 0 ("background 1", white in Office themes).
function isWhite(cell) {
  const c = cell && cell.s && (cell.s.color || (cell.s.font && cell.s.font.color));
  if (!c) return false;
  if (c.rgb && /^(FF)?FFFFFF$/i.test(c.rgb)) return true;
  return c.theme === 0 && !c.tint;
}

function cellValue(cell) {
  if (!cell || cell.v === undefined || cell.v === null) return null;
  if (cell.t === 'd' && cell.v instanceof Date) {
    const d = cell.v;
    return { date: `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}` };
  }
  if (cell.t === 'n') {
    if (cell.z && XLSX.SSF.is_date(cell.z)) {
      const p = XLSX.SSF.parse_date_code(cell.v);
      if (p && p.y) return { date: `${p.y}-${pad(p.m)}-${pad(p.d)}` };
    }
    return cell.v;
  }
  if (cell.t === 'b') return cell.v ? 'TRUE' : 'FALSE';
  if (cell.t === 'e') return null;
  const s = String(cell.v);
  return s.trim() === '' ? null : s;
}

// source: a file path or a Buffer. Returns { sheets: [{ name, rows }], hiddenSheets: [names] }.
function readWorkbook(source) {
  const opts = { cellStyles: true, cellDates: false, cellNF: true };
  const wb = Buffer.isBuffer(source) ? XLSX.read(source, { ...opts, type: 'buffer' }) : XLSX.readFile(source, opts);
  const meta = (wb.Workbook && wb.Workbook.Sheets) || [];
  const sheets = [];
  const hiddenSheets = [];
  wb.SheetNames.forEach((name, i) => {
    if (meta[i] && meta[i].Hidden) { hiddenSheets.push(name); return; }
    const ws = wb.Sheets[name];
    if (!ws || !ws['!ref']) { sheets.push({ name, rows: [] }); return; }
    const range = XLSX.utils.decode_range(ws['!ref']);
    const hiddenRows = new Set((ws['!rows'] || []).map((r, k) => (r && r.hidden ? k : -1)).filter((k) => k >= 0));
    const hiddenCols = new Set((ws['!cols'] || []).map((c, k) => (c && c.hidden ? k : -1)).filter((k) => k >= 0));
    const covered = new Set();
    for (const m of ws['!merges'] || []) {
      for (let r = m.s.r; r <= m.e.r; r++) for (let c = m.s.c; c <= m.e.c; c++) if (r !== m.s.r || c !== m.s.c) covered.add(`${r}:${c}`);
    }
    const rows = [];
    for (let r = 0; r <= range.e.r; r++) {
      const row = [];
      for (let c = 0; c <= range.e.c; c++) {
        const cell = ws[XLSX.utils.encode_cell({ r, c })];
        const hidden = hiddenRows.has(r) || hiddenCols.has(c) || covered.has(`${r}:${c}`) || isWhite(cell);
        row.push(hidden ? null : cellValue(cell));
      }
      rows.push(row);
    }
    sheets.push({ name, rows });
  });
  return { sheets, hiddenSheets };
}

module.exports = { readWorkbook };
