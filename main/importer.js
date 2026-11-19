// Import one week from an Excel receipt workbook (the format of Receipt Format02.xlsx: one sheet per
// dorm per series). Pure functions only — no database, no Electron — so they can be tested directly:
//   parseSheet(sheet)          reads one sheet's visible cells, finding fields by their LABELS
//   buildDraft(book, ctx)      first guesses: dorm of each sheet, item of each line
//   validate(draft, ctx)       checks an (edited) draft and says what was fixed, what needs a decision,
//                              and what blocks the import
// ctx describes the database: { dorms, products, used: Map('DF-494' → week date), weekDates, paidMonths,
//   nearestPrice(productId, date) → { price, date } | null, usualQty(dormId, productId, date) → number | null }.
// The draft is plain JSON: the screen edits it (numbers, dates, qty, price, item, skip, decisions) and
// sends it back to validate, until it can be imported.

const round2 = (x) => Math.round((Number(x) + Number.EPSILON) * 100) / 100;
const pad = (n) => String(n).padStart(2, '0');
const norm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
const dmy = (iso) => (iso ? iso.split('-').reverse().join('.') : '');
const money = (n) => Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const qtyText = (n) => String(Math.round(n * 1000) / 1000);

function cellText(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'object') return v.date ? dmy(v.date) : '';
  return String(v);
}

function validIso(y, m, d) {
  if (!(y >= 1900 && y <= 2200 && m >= 1 && m <= 12 && d >= 1 && d <= 31)) return null;
  const iso = `${y}-${pad(m)}-${pad(d)}`;
  const t = Date.parse(iso + 'T00:00:00Z');
  return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === iso ? iso : null;
}
const addDays = (iso, n) => { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const daysBetween = (a, b) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000);

// "20.11.2026", "20/11/2026", "5-11-26" → always DAY first. swap: the MM/DD reading, if that is also a date.
function parseDateText(s) {
  const m = String(s).match(/(\d{1,2})\s*[./-]\s*(\d{1,2})\s*[./-]\s*(\d{2,4})/);
  if (!m) return null;
  const d = Number(m[1]); const mo = Number(m[2]); let y = Number(m[3]);
  if (y < 100) y += 2000;
  const iso = validIso(y, mo, d);
  if (!iso) return null;
  const swap = d <= 12 && d !== mo ? validIso(y, d, mo) : null;
  return { iso, swap, text: m[0] };
}

// "DF- 494", "INV - 353", "df494" → { series, n, text }
function parseNumberText(s) {
  const m = String(s ?? '').match(/\b(DF|INV)\s*-?\s*(\d{1,7})\b/i);
  return m ? { series: m[1].toUpperCase(), n: Number(m[2]), text: m[0] } : null;
}

const toNum = (v) => {
  if (typeof v === 'number') return v;
  if (v === null || v === undefined || typeof v === 'object') return NaN;
  const t = String(v).trim().replace(/\s/g, '').replace(/,(\d{1,2})$/, '.$1').replace(/,/g, '');
  return t === '' ? NaN : Number(t);
};

const UNITS = { kg: 'Kg', kgs: 'Kg', kilo: 'Kg', kilos: 'Kg', kilogram: 'Kg', kilograms: 'Kg', pc: 'Pcs', pcs: 'Pcs',
  piece: 'Pcs', pieces: 'Pcs', bundle: 'Bundle', bundles: 'Bundle', bdl: 'Bundle' };
const normUnit = (u) => { const t = String(u ?? '').trim(); return UNITS[t.toLowerCase().replace(/\./g, '')] || t; };

// Similarity 0..1 from the edit distance (catches typos like "LONG MONTAIN").
function similarity(a, b) {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const dp = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0]; dp[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j];
      dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return 1 - dp[b.length] / Math.max(a.length, b.length);
}

// ---------------------------------------------------------------- parse one sheet

function parseSheet({ name, rows }) {
  const out = { name, numberRaw: '', number: null, dateRaw: '', date: null, dateSwap: null, dorm_line: '', vehicle: '',
    lines: [], dropped: [], excelTotal: null, problems: [] };
  rows = rows || [];
  const rowText = (r) => (r || []).map(cellText).filter((x) => x.trim()).join('  ');

  // the item table: the row with an "Item Code" label; its columns found by their labels
  const head = rows.findIndex((r) => (r || []).some((v) => norm(cellText(v)) === 'itemcode'));
  const top = head >= 0 ? rows.slice(0, head) : rows;

  // "Original  Sales Invoice  DF- 494  DATE: 20.11.2026" (one cell, or spread over several)
  const invRow = top.find((r) => /sales\s*invoice/i.test(rowText(r)));
  const invText = invRow ? rowText(invRow) : '';
  let num = parseNumberText(invText.replace(/^.*?sales\s*invoice/i, ''));
  if (!num) for (const r of top) { num = parseNumberText(rowText(r)); if (num) break; }
  if (num) { out.numberRaw = num.text.trim(); out.number = { series: num.series, n: num.n }; }

  // date: a real date cell on the invoice line, else "DATE: 20.11.2026" text, else any row with a date label
  const dateRows = [invRow, ...top.filter((r) => r !== invRow && /\bdate\b/i.test(rowText(r)))].filter(Boolean);
  for (const r of dateRows) {
    const cell = (r || []).find((v) => v && typeof v === 'object' && v.date);
    if (cell) { out.date = cell.date; out.dateRaw = dmy(cell.date); out.dateFromCell = true; break; }
    const t = rowText(r);
    const after = /\bdate\b/i.test(t) ? t.replace(/^.*?\bdate\b\s*:?/i, '') : t;
    const p = parseDateText(after);
    if (p) { out.date = p.iso; out.dateSwap = p.swap; out.dateRaw = p.text.replace(/\s+/g, ''); break; }
  }

  // "DORMITORY- BELLE-VUE" (the visible line; the sheet name is used too, see matchDorm)
  for (const r of top) {
    const cell = (r || []).map(cellText).find((v) => /dormitory/i.test(v));
    if (cell) { out.dorm_line = cell.replace(/^.*?dormitory\s*[-:–]?\s*/i, '').trim(); break; }
  }
  for (const r of rows) {
    const cell = (r || []).map(cellText).find((v) => /vehicle\s*no/i.test(v));
    if (cell) { out.vehicle = cell.replace(/^.*?vehicle\s*no\.?\s*:?\s*/i, '').trim(); break; }
  }

  if (head < 0) { out.problems.push('No "Item Code" table found on this sheet.'); return out; }
  const labels = (rows[head] || []).map((v) => norm(cellText(v)));
  const col = (test) => labels.findIndex((l) => l && test(l));
  const C = {
    code: col((l) => l === 'itemcode'),
    desc: col((l) => l.startsWith('description') || l === 'item' || l === 'designation'),
    qty: col((l) => /qty|quantity/.test(l)),
    unit: col((l) => (/unit|uom/.test(l)) && !/price/.test(l)),
    price: col((l) => /price/.test(l)),
    amount: col((l) => /amount/.test(l)),
  };
  for (let i = head + 1; i < rows.length; i++) {
    const r = rows[i] || [];
    const texts = r.map((v) => norm(cellText(v)));
    if (texts.some((t) => t === 'total' || t === 'subtotal' || t === 'grandtotal' || t === 'partpayment')) {   // the totals block
      const amt = toNum(r[C.amount]);
      if (!Number.isNaN(amt)) out.excelTotal = amt;
      break;
    }
    const get = (k) => (C[k] >= 0 ? r[C[k]] : null);
    const code = cellText(get('code')).trim();
    const desc = cellText(get('desc')).trim();
    const qty = toNum(get('qty'));
    const price = toNum(get('price'));
    if (!code && !desc && Number.isNaN(qty)) continue;                     // empty row
    if (!code && !desc) continue;                                          // stray number outside the table
    if (Number.isNaN(qty) || qty <= 0) { out.dropped.push(`${desc || code}: no quantity, row left out`); continue; }
    const amount = toNum(get('amount'));
    out.lines.push({ codeRaw: code, desc, qty: Math.round(qty * 1000) / 1000, price: Number.isNaN(price) ? null : price,
      unitRaw: cellText(get('unit')).trim(), amountExcel: Number.isNaN(amount) ? null : amount });
  }
  return out;
}

// ---------------------------------------------------------------- first guesses

// Dorm from the sheet name and the visible "DORMITORY-" line (both, when they agree).
function matchDorm(parsed, dorms) {
  const best = (key) => {
    let top = null;
    for (const d of dorms) {
      for (const n of [d.name, d.statement_name]) {
        const s = similarity(key, norm(n));
        if (s >= 0.85 && (!top || s > top.score)) top = { id: d.id, score: s, name: d.name };
      }
    }
    return top;
  };
  const byName = best(norm(parsed.name.replace(/\b(df|inv)\b/gi, '')));
  const byLine = best(norm(parsed.dorm_line));
  if (byName && byLine && byName.id !== byLine.id) return { dorm_id: null, conflict: [byName.id, byLine.id] };
  const m = byLine || byName;
  if (!m) return { dorm_id: null };
  return { dorm_id: m.id, fuzzy: byLine && byLine.score < 1 ? parsed.dorm_line : null };
}

function findProduct(codeRaw, products) {
  const k = norm(codeRaw);
  return k ? products.find((p) => norm(p.code) === k) || null : null;
}

// book: { file, sheets: [{ name, rows }], hiddenSheets? } → draft
function buildDraft(book, ctx) {
  const sheets = book.sheets.map((s, idx) => {
    const p = parseSheet(s);
    const dorm = matchDorm(p, ctx.dorms);
    return {
      idx, name: s.name, skip: false,
      numberRaw: p.numberRaw, numberText: p.number ? `${p.number.series}-${p.number.n}` : p.numberRaw,
      date: p.date, dateRaw: p.dateRaw, dateSwap: p.dateSwap, useWeekDate: false,
      dorm_line: p.dorm_line, dorm_id: dorm.dorm_id, dormConflict: dorm.conflict || null, dormFuzzy: dorm.fuzzy || null, dormChosen: false,
      vehicle: p.vehicle, emptyChoice: null, excelTotal: p.excelTotal, dropped: p.dropped, problems: p.problems,
      lines: p.lines.map((l, i) => {
        const prod = findProduct(l.codeRaw, ctx.products);
        const suggest = prod ? null : ctx.products.find((x) => norm(x.name) === norm(l.desc)) || null;
        return { idx: i, ...l, product_id: prod ? prod.id : null, mapSource: prod ? 'code' : null,
          suggest_id: suggest ? suggest.id : null, newItem: null, keepPrice: false, keepQty: false, remove: false };
      }),
    };
  });
  return { file: book.file, sheetCount: book.sheets.length, hiddenSheets: book.hiddenSheets || [], date: null, dateOk: null, sheets };
}

// ---------------------------------------------------------------- validate

function validate(draft, ctx) {
  const products = new Map(ctx.products.map((p) => [p.id, p]));
  const dorms = new Map(ctx.dorms.map((d) => [d.id, d]));
  const active = draft.sheets.filter((s) => !s.skip);
  const blocking = [];
  const fixNotes = [];

  // ---- week date: chosen, or the date most sheets have
  const counts = new Map();
  for (const s of active) if (s.date) counts.set(s.date, (counts.get(s.date) || 0) + 1);
  const fileDate = [...counts].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).map((x) => x[0])[0] || null;
  const date = draft.date || fileDate;
  const week = { date, fileDate, warnings: [], errors: [] };
  if (!date) week.errors.push('No week date could be read. Type the date of the week.');
  else {
    const dates = [...ctx.weekDates].sort();
    week.exists = dates.includes(date);
    if (week.exists) week.errors.push(`There is already a week on ${dmy(date)} in the app.`);
    const latest = dates[dates.length - 1];
    if (latest && date > latest) week.errors.push(`${dmy(date)} is after the latest week (${dmy(latest)}). New weeks are started on This Week.`);
    if ((ctx.paidMonths || []).includes(date.slice(0, 7))) week.errors.push(`${date.slice(0, 7)} is marked as paid. Undo paid on the Monthly page first.`);
    const prev = dates.filter((d) => d < date).pop() || null;
    const next = dates.find((d) => d > date) || null;
    week.prev = prev; week.next = next;
    week.prevGap = prev ? daysBetween(prev, date) : null;
    week.nextGap = next ? daysBetween(date, next) : null;
    week.onRhythm = (!prev || week.prevGap % 7 === 0) && (!next || week.nextGap % 7 === 0);
    const swaps = [...new Set(active.filter((s) => s.date === date && s.dateSwap).map((s) => s.dateSwap))];
    const swap = swaps.length === 1 ? swaps[0] : null;
    if (!week.exists && draft.dateOk !== date) {
      const opts = [{ label: `Keep ${dmy(date)}`, set: { date, dateOk: date } }];
      const add = (d, why) => { if (d && d !== date && !dates.includes(d) && !opts.some((o) => o.set.date === d)) opts.push({ label: `Use ${dmy(d)} (${why})`, set: { date: d, dateOk: d } }); };
      if (!week.onRhythm) {
        add(swap, 'read as month/day');
        if (prev) add(addDays(prev, 7), `7 days after ${dmy(prev)}`);
        if (next) add(addDays(next, -7), `7 days before ${dmy(next)}`);
        const where = [prev && `${week.prevGap} days after ${dmy(prev)}`, next && `${week.nextGap} days before ${dmy(next)}`].filter(Boolean).join(' and ');
        week.warnings.push({ id: 'date', text: `${dmy(date)} is ${where} — not on the weekly rhythm. Which date is right?`, options: opts });
      } else if (!prev && !next && swap) {
        add(swap, 'read as month/day');
        week.warnings.push({ id: 'date', text: `${dmy(date)} was read day first. If the file was written month first it would be ${dmy(swap)}. Which is right?`, options: opts });
      }
    }
  }

  // ---- numbers used twice in the file, and dorms with two sheets of one series
  const numbersSeen = new Map();
  const dormSeen = new Map();
  for (const s of active) {
    const p = parseNumberText(s.numberText);
    if (p) { const k = `${p.series}-${p.n}`; numbersSeen.set(k, [...(numbersSeen.get(k) || []), s.name]); }
    if (p && s.dorm_id) { const k = `${s.dorm_id}:${p.series}`; dormSeen.set(k, [...(dormSeen.get(k) || []), s.name]); }
  }

  const sheets = draft.sheets.map((s) => {
    const r = { idx: s.idx, name: s.name, skip: !!s.skip, fixes: [], warnings: [], errors: [], lines: [], total: 0 };
    if (s.skip) return r;
    const num = parseNumberText(s.numberText);
    r.series = num ? num.series : null;
    r.number = num ? num.n : null;
    r.numberText = num ? `${num.series}-${num.n}` : s.numberText;
    r.dorm_id = s.dorm_id || null;
    r.dorm = s.dorm_id && dorms.get(s.dorm_id) ? dorms.get(s.dorm_id).name : null;
    for (const p of s.problems || []) r.errors.push(p);

    // number
    if (!num) r.errors.push(`Invoice number missing or unreadable${s.numberRaw ? ` ("${s.numberRaw}")` : ''}. Type it like DF-494 or INV-345.`);
    else {
      if (s.numberRaw && s.numberRaw !== r.numberText && s.numberText === r.numberText) r.fixes.push(`Number "${s.numberRaw}" → ${r.numberText}`);
      if (ctx.used.has(r.numberText)) r.errors.push(`${r.numberText} is already in the app (week of ${dmy(ctx.used.get(r.numberText))}).`);
      if ((numbersSeen.get(r.numberText) || []).length > 1) r.errors.push(`${r.numberText} is used twice in the file (sheets ${numbersSeen.get(r.numberText).map((x) => `"${x.trim()}"`).join(' and ')}).`);
    }

    // date of this sheet
    if (date) {
      if (!s.date && !s.useWeekDate) {
        r.errors.push(`The date on this sheet is missing or unreadable${s.dateRaw ? ` ("${s.dateRaw}")` : ''}.`);
        r.warnings.push({ id: `date${s.idx}`, text: 'Use the week date for this sheet?', options: [{ label: `Use ${dmy(date)}`, sheet: s.idx, set: { useWeekDate: true } }, { label: 'Skip sheet', sheet: s.idx, set: { skip: true } }] });
      } else if (s.date && s.date !== fileDate && !s.useWeekDate) {
        // compared with the date most sheets have (if the week date was corrected, the sheets follow it)
        r.warnings.push({ id: `date${s.idx}`, text: `This sheet is dated ${dmy(s.date)}, not ${dmy(fileDate)} like the rest of the file.`,
          options: [{ label: `Import it in the week of ${dmy(date)}`, sheet: s.idx, set: { useWeekDate: true } }, { label: 'Skip sheet', sheet: s.idx, set: { skip: true } }] });
      }
    }

    // dorm
    if (!s.dorm_id) {
      const text = s.dormConflict
        ? `The sheet name says ${dorms.get(s.dormConflict[0]).name}, the dormitory line says ${dorms.get(s.dormConflict[1]).name}. Which dorm is it?`
        : `"${s.name.trim()}"${s.dorm_line ? ` (${s.dorm_line})` : ''} is not one of the dormitories. Pick the dorm, or skip this sheet.`;
      const opts = (s.dormConflict || []).map((id) => ({ label: dorms.get(id).name, sheet: s.idx, set: { dorm_id: id, dormChosen: true } }));
      r.warnings.push({ id: `dorm${s.idx}`, kind: 'dorm', text, options: [...opts, { label: 'Skip sheet', sheet: s.idx, set: { skip: true } }] });
    } else {
      if (s.dormFuzzy && !s.dormChosen) r.fixes.push(`"${s.dorm_line}" read as ${r.dorm}`);
      if (num && (dormSeen.get(`${s.dorm_id}:${num.series}`) || []).length > 1) {
        r.errors.push(`Two ${num.series} invoices for ${r.dorm} (sheets ${dormSeen.get(`${s.dorm_id}:${num.series}`).map((x) => `"${x.trim()}"`).join(' and ')}). Pick another dorm or skip one.`);
      }
    }

    // lines
    const byProduct = new Map();
    const units = new Map();
    for (const l of s.lines) {
      if (l.remove) continue;
      const out = { idx: l.idx, codeRaw: l.codeRaw, desc: l.desc, qty: l.qty, price: l.price, unitRaw: l.unitRaw, notes: [], amountExcel: l.amountExcel };
      let prod = l.product_id ? products.get(l.product_id) : null;
      if (!prod && l.newItem) prod = { id: null, code: l.newItem.code, name: l.newItem.name, unit: l.newItem.unit, series: r.series, isNew: true };
      out.product = prod ? { id: prod.id, code: prod.code, name: prod.name, unit: prod.unit, series: prod.series, isNew: !!prod.isNew } : null;
      const label = prod ? prod.name : l.desc || l.codeRaw;
      if (!prod) {
        const sug = l.suggest_id ? products.get(l.suggest_id) : null;
        r.warnings.push({ id: `map${s.idx}.${l.idx}`, kind: 'map', sheet: s.idx, line: l.idx, series: r.series,
          text: `Unknown item code "${l.codeRaw}" (${l.desc}). Choose the item, or create a new one.`,
          options: [...(sug ? [{ label: `Use ${sug.name} (${sug.code})`, sheet: s.idx, line: l.idx, set: { product_id: sug.id, mapSource: 'chosen' } }] : []),
            { label: `Create "${l.desc || l.codeRaw}"`, sheet: s.idx, line: l.idx, set: { newItem: { code: tidyCode(l.codeRaw), name: l.desc || l.codeRaw, unit: normUnit(l.unitRaw) || 'Kg' }, mapSource: 'new' } }] });
      } else if (!prod.isNew && l.mapSource === 'code' && l.codeRaw !== prod.code) {
        r.fixes.push(`Code "${l.codeRaw}" → ${prod.code}`);
      }
      if (prod && r.series && prod.series && prod.series !== r.series) {
        r.errors.push(`${prod.name} is ${prod.series === 'INV' ? 'an onions & potatoes (INV)' : 'a vegetables (DF)'} item, so it cannot be on ${r.numberText}. Remove the line, or fix the number.`);
        out.wrongSeries = true;
      }
      const u = normUnit(l.unitRaw);
      if (l.unitRaw && u !== l.unitRaw) {
        const g = units.get(u) || { raw: new Set(), n: 0 };
        g.raw.add(l.unitRaw); g.n += 1; units.set(u, g);
      }
      out.unit = prod ? prod.unit : u;
      const q = Number(l.qty); const p = Number(l.price);
      if (!(q > 0)) r.errors.push(`${label}: the quantity must be more than 0.`);
      if (l.price === null || l.price === '' || !(p >= 0)) r.errors.push(`${label}: the price is missing or not a number.`);
      out.amount = q > 0 && p >= 0 ? round2(q * p) : 0;
      if (out.amount && l.amountExcel !== null && l.amountExcel !== undefined && Math.abs(round2(l.amountExcel) - out.amount) > 0.005) {
        out.notes.push(`Excel said ${money(l.amountExcel)}`);
        r.fixes.push(`${label}: amount recalculated ${qtyText(q)} × ${money(p)} = ${money(out.amount)} (Excel said ${money(l.amountExcel)})`);
      }
      if (prod && prod.id && date && p >= 0) {
        const near = ctx.nearestPrice(prod.id, date);
        if (near && near.price > 0 && Math.abs(p - near.price) / near.price > 0.5 && !l.keepPrice) {
          const pct = Math.round((Math.abs(p - near.price) / near.price) * 100);
          r.warnings.push({ id: `price${s.idx}.${l.idx}`, sheet: s.idx, line: l.idx,
            text: `${prod.name}: Rs ${money(p)} is ${pct}% ${p > near.price ? 'more' : 'less'} than Rs ${money(near.price)} (${near.date ? `week of ${dmy(near.date)}` : 'its current price'}).`,
            options: [{ label: `Keep Rs ${money(p)}`, sheet: s.idx, line: l.idx, set: { keepPrice: true } },
              { label: `Use Rs ${money(near.price)}`, sheet: s.idx, line: l.idx, set: { price: near.price, keepPrice: true } }] });
        }
      }
      if (prod && prod.id && s.dorm_id && date && q > 0) {
        const usual = ctx.usualQty(s.dorm_id, prod.id, date);
        if (usual > 0 && q > 3 * usual && !l.keepQty) {
          r.warnings.push({ id: `qty${s.idx}.${l.idx}`, sheet: s.idx, line: l.idx,
            text: `${prod.name}: ${qtyText(q)} ${out.unit} is more than 3× the usual ${qtyText(usual)} for ${r.dorm}. Correct it in the line, or keep it.`,
            options: [{ label: `Keep ${qtyText(q)}`, sheet: s.idx, line: l.idx, set: { keepQty: true } }] });
        }
      }
      // the same item twice on one invoice: added together when the price is the same
      const key = prod ? (prod.id ? `p${prod.id}` : `n${norm(prod.code)}`) : null;
      if (key) {
        if (byProduct.has(key)) {
          const first = byProduct.get(key);
          if (first.price === out.price) { r.fixes.push(`${prod.name} is on two rows: added together`); first.mergedQty = round2((first.mergedQty ?? first.qty) + q); out.merged = true; }
          else r.errors.push(`${prod.name} is on two rows with different prices. Change or remove one.`);
        } else byProduct.set(key, out);
      }
      r.lines.push(out);
    }
    for (const [u, g] of units) r.fixes.push(`Unit ${[...g.raw].join(' / ')} → ${u}${g.n > 1 ? ` (${g.n} rows)` : ''}`);
    for (const d of s.dropped || []) r.fixes.push(d);
    r.total = round2(r.lines.filter((l) => !l.merged).reduce((t, l) => t + round2((l.mergedQty ?? l.qty) * l.price || 0), 0));
    if (!r.lines.length && !s.emptyChoice) {
      r.warnings.push({ id: `empty${s.idx}`, text: `${r.numberText || 'This invoice'} has no items.`,
        options: [{ label: 'Import it empty', sheet: s.idx, set: { emptyChoice: 'import' } }, { label: 'Skip sheet', sheet: s.idx, set: { skip: true } }] });
    }
    fixNotes.push(...r.fixes);
    return r;
  });

  // ---- one row per dorm (and one per sheet without a dorm), DF and INV side by side
  const rows = [];
  for (const r of sheets) {
    if (r.skip) continue;
    let row = r.dorm_id ? rows.find((x) => x.dorm_id === r.dorm_id && !(r.series && x[r.series] !== null)) : null;
    if (!row) {
      const d = dorms.get(r.dorm_id);
      row = { dorm_id: r.dorm_id || null, no: d ? d.no : null, name: d ? d.name : r.name.trim(), DF: null, INV: null, other: [] };
      rows.push(row);
    }
    if (r.series === 'DF' || r.series === 'INV') row[r.series] = r.idx; else row.other.push(r.idx);
  }
  rows.sort((a, b) => (a.no ?? 999) - (b.no ?? 999));
  for (const row of rows) row.total = round2([row.DF, row.INV].filter((i) => i !== null).reduce((t, i) => t + sheets[i].total, 0));

  const range = (series) => {
    const list = sheets.filter((r) => !r.skip && r.series === series && r.number);
    const nums = list.map((r) => r.number).sort((a, b) => a - b);
    return { count: nums.length, from: nums[0] ?? null, to: nums[nums.length - 1] ?? null,
      used: list.filter((r) => ctx.used.has(r.numberText)).map((r) => r.numberText),
      total: round2(list.reduce((t, r) => t + r.total, 0)) };
  };

  for (const e of week.errors) blocking.push(e);
  for (const r of sheets) for (const e of r.errors) blocking.push(`${r.numberText || `"${r.name.trim()}"`}: ${e}`);
  const warnings = week.warnings.length + sheets.reduce((t, r) => t + r.warnings.length, 0);
  const importing = sheets.filter((r) => !r.skip);
  if (!importing.length) blocking.push('Every sheet is skipped: there is nothing to import.');
  return {
    file: draft.file, sheetCount: draft.sheetCount, hiddenSheets: draft.hiddenSheets || [],
    week, sheets, rows, df: range('DF'), inv: range('INV'), fixes: fixNotes.length,
    blocking, warnings, canImport: blocking.length === 0 && warnings === 0,
  };
}

// "Veg- Chou" → "Veg-Chou", "VegOni" → "Veg-Oni" (for a new item made from an unknown code)
function tidyCode(code) {
  const t = String(code || '').replace(/\s+/g, '');
  return /^veg[^-]/i.test(t) ? `Veg-${t.slice(3)}` : t;
}

// What an import saves: invoices with their lines (same item twice added together), the week's prices
// (the price most used in the file for each item), and the summary kept in change_log.
function plan(draft, v) {
  const date = v.week.date;
  const invoices = [];
  const priceVotes = new Map();
  const mappings = [];
  const created = new Map();
  for (const r of v.sheets) {
    if (r.skip) continue;
    const s = draft.sheets[r.idx];
    const lines = [];
    for (const l of r.lines) {
      if (l.merged) continue;
      const qty = l.mergedQty ?? l.qty;
      const key = l.product.id ? l.product.id : `new:${norm(l.product.code)}`;
      lines.push({ product_id: l.product.id, newCode: l.product.isNew ? l.product.code : null, qty: Math.round(qty * 1000) / 1000, unit_price: round2(l.price) });
      const votes = priceVotes.get(key) || new Map();
      votes.set(round2(l.price), (votes.get(round2(l.price)) || 0) + 1);
      priceVotes.set(key, votes);
      const src = draft.sheets[r.idx].lines.find((x) => x.idx === l.idx);
      if (l.product.isNew && !created.has(norm(l.product.code))) created.set(norm(l.product.code), { code: l.product.code, name: l.product.name, unit: l.product.unit, series: r.series, price: round2(l.price) });
      if (src && src.mapSource === 'chosen') mappings.push({ from: l.codeRaw, to: l.product.code, name: l.product.name, invoice: r.numberText });
    }
    invoices.push({ sheet: s.name, series: r.series, number: r.number, dorm_id: r.dorm_id, vehicle: s.vehicle || '', lines });
  }
  const prices = new Map();
  for (const [key, votes] of priceVotes) prices.set(key, [...votes].sort((a, b) => b[1] - a[1])[0][0]);
  const summary = {
    mode: 'excel', file: draft.file, sheets: draft.sheetCount, imported: invoices.length,
    skipped: v.sheets.filter((r) => r.skip).map((r) => r.name.trim()),
    autofixes: v.fixes, mappings, created: [...created.values()].map((c) => c.code),
    total: round2(v.sheets.filter((r) => !r.skip).reduce((t, r) => t + r.total, 0)),
  };
  return { date, invoices, prices, created: [...created.values()], summary };
}

module.exports = { parseSheet, parseDateText, parseNumberText, normUnit, matchDorm, buildDraft, validate, plan, tidyCode, norm };
