// All the business rules live here: numbering, dates, prices, totals, locking, statements.
// The screens only ask for things; this file decides what is allowed and does the maths.

const schema = require('./schema');
const seed = require('./seed');
const formats = require('./formats');

const SETTING_KEYS = Object.keys(seed.settings);
const round2 = (x) => Math.round((Number(x) + Number.EPSILON) * 100) / 100;
const round3 = (x) => Math.round((Number(x) + Number.EPSILON) * 1000) / 1000;
const now = () => new Date().toISOString();

function addDays(iso, n) {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function isIsoDate(s) {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s + 'T00:00:00Z'));
}

class UserError extends Error {}

function createService(store) {
  // ---------- setup ----------
  store.exec(schema.sql);
  // Older databases: add the columns that came later (e.g. dorms.cook_name).
  for (const [table, column, def] of schema.added) {
    if (!store.all(`PRAGMA table_info(${table})`).some((c) => c.name === column)) {
      store.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${def}`);
    }
  }
  if (!store.get('SELECT 1 AS x FROM settings LIMIT 1')) {
    store.tx(() => {
      for (const [k, v] of Object.entries(seed.settings)) {
        store.run('INSERT INTO settings (key, value) VALUES (?, ?)', [k, JSON.stringify(v)]);
      }
      for (const [no, name, stmt, vehicle] of seed.dorms) {
        store.run('INSERT INTO dorms (no, name, statement_name, vehicle) VALUES (?, ?, ?, ?)', [no, name, stmt, vehicle]);
      }
      seed.products.forEach(([code, name, unit, series, price], i) => {
        store.run('INSERT INTO products (code, name, unit, series, price, sort) VALUES (?, ?, ?, ?, ?, ?)',
          [code, name, unit, series, price, i + 1]);
      });
    });
  }

  // Older databases kept the receipt look in separate keys (color, note, print_copy, ...).
  // Move them into receipt_format / statement_format once, then remove the old keys.
  if (!store.get("SELECT 1 AS x FROM settings WHERE key = 'receipt_format'")) {
    store.tx(() => {
      const old = {};
      for (const r of store.all('SELECT key, value FROM settings')) {
        if (formats.OLD_KEYS.includes(r.key)) { try { old[r.key] = JSON.parse(r.value); } catch (_) { /* skip */ } }
      }
      const { receipt, statement } = formats.fromOldKeys(old);
      const put = (k, v) => store.run('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
        [k, JSON.stringify(v)]);
      put('receipt_format', receipt);
      if (!store.get("SELECT 1 AS x FROM settings WHERE key = 'statement_format'")) put('statement_format', statement);
      for (const k of formats.OLD_KEYS) store.run('DELETE FROM settings WHERE key = ?', [k]);
    });
  }

  const log = (invoiceId, action, detail) =>
    store.run('INSERT INTO change_log (at, invoice_id, action, detail) VALUES (?, ?, ?, ?)',
      [now(), invoiceId, action, detail || null]);
  const parse = (s) => { try { return JSON.parse(s); } catch (_) { return {}; } };

  // A month marked as paid can no longer be changed.
  const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  function paidCheck(date) {
    const month = String(date).slice(0, 7);
    if (store.get('SELECT 1 AS x FROM payments WHERE month = ?', [month])) {
      throw new UserError(`${MONTH_NAMES[Number(month.slice(5, 7)) - 1]} is marked as paid. Undo paid on the Monthly page first.`);
    }
  }
  const weekDate = (weekId) => (store.get('SELECT date FROM weeks WHERE id = ?', [weekId]) || {}).date;
  const invoiceDate = (invoiceId) => (store.get('SELECT w.date FROM invoices i JOIN weeks w ON w.id = i.week_id WHERE i.id = ?', [invoiceId]) || {}).date;

  // ---------- settings ----------
  function getSettings() {
    const out = { ...seed.settings };
    for (const r of store.all('SELECT key, value FROM settings')) {
      if (SETTING_KEYS.includes(r.key)) out[r.key] = JSON.parse(r.value);
    }
    out.receipt_format = formats.normalizeReceipt(out.receipt_format);
    out.statement_format = formats.normalizeStatement(out.statement_format);
    return out;
  }

  function saveSettings(patch) {
    const clean = {};
    for (const k of SETTING_KEYS) if (k in patch) clean[k] = patch[k];
    if ('receipt_format' in clean) {
      clean.receipt_format = formats.normalizeReceipt(clean.receipt_format, true, (m) => { throw new UserError(m); });
    }
    if ('statement_format' in clean) clean.statement_format = formats.normalizeStatement(clean.statement_format);
    for (const k of ['last_df', 'last_inv']) {
      if (k in clean) {
        const n = Number(clean[k]);
        if (!Number.isInteger(n) || n < 0) throw new UserError('Last invoice numbers must be whole numbers.');
        clean[k] = n;
      }
    }
    if ('last_date' in clean && !isIsoDate(clean.last_date)) throw new UserError('Last date is not a valid date.');
    store.tx(() => {
      for (const [k, v] of Object.entries(clean)) {
        store.run('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
          [k, JSON.stringify(v)]);
      }
    });
    return getSettings();
  }

  // ---------- dorms & products ----------
  const listDorms = () => store.all('SELECT * FROM dorms ORDER BY no');
  // A→Z by description (ignoring capitals and accents, "2" before "10").
  const byName = (a, b) => String(a).localeCompare(String(b), 'fr', { sensitivity: 'base', numeric: true });
  const listProducts = () => store.all('SELECT * FROM products').sort((a, b) => byName(a.name, b.name) || a.id - b.id);

  function saveDorm(d) {
    const name = String(d.name || '').trim();
    const stmt = String(d.statement_name || '').trim() || name;
    const no = Number(d.no);
    if (!name) throw new UserError('Dormitory name is required.');
    if (!Number.isInteger(no) || no < 1) throw new UserError('Dormitory number must be a whole number.');
    return store.tx(() => {
      const clash = store.get('SELECT id FROM dorms WHERE no = ? AND id <> ?', [no, d.id || 0]);
      if (clash) throw new UserError(`Dormitory No ${no} already exists.`);
      // cook_name: left as it is when not given
      const cook = d.cook_name === undefined || d.cook_name === null ? null : String(d.cook_name).trim().slice(0, 60);
      const vals = [no, name, stmt, String(d.vehicle || '').trim(), d.active === false || d.active === 0 ? 0 : 1];
      if (d.id) {
        store.run(`UPDATE dorms SET no = ?, name = ?, statement_name = ?, vehicle = ?, active = ?, cook_name = COALESCE(?, cook_name)
                   WHERE id = ?`, [...vals, cook, d.id]);
        return d.id;
      }
      return store.run('INSERT INTO dorms (no, name, statement_name, vehicle, active, cook_name) VALUES (?, ?, ?, ?, ?, ?)',
        [...vals, cook || '']).lastId;
    });
  }

  function saveProduct(p) {
    const code = String(p.code || '').trim();
    const name = String(p.name || '').trim();
    const unit = String(p.unit || '').trim() || 'Kg';
    const series = p.series;
    const price = round2(p.price || 0);
    if (!code) throw new UserError('Item code is required.');
    if (!name) throw new UserError('Description is required.');
    if (!['DF', 'INV'].includes(series)) throw new UserError('Choose DF or INV.');
    if (!(price >= 0)) throw new UserError('Price must be 0 or more.');
    return store.tx(() => {
      const clash = store.get('SELECT id FROM products WHERE lower(code) = lower(?) AND id <> ?', [code, p.id || 0]);
      if (clash) throw new UserError(`Code ${code} is already used.`);
      if (p.id) {
        const old = store.get('SELECT series FROM products WHERE id = ?', [p.id]);
        if (old && old.series !== series && store.get('SELECT 1 AS x FROM invoice_lines WHERE product_id = ? LIMIT 1', [p.id])) {
          throw new UserError('This item is already on invoices, so it cannot move between DF and INV.');
        }
        store.run('UPDATE products SET code = ?, name = ?, unit = ?, series = ?, price = ?, active = ? WHERE id = ?',
          [code, name, unit, series, price, p.active === false || p.active === 0 ? 0 : 1, p.id]);
        return p.id;
      }
      const sort = (store.get('SELECT MAX(sort) AS m FROM products').m || 0) + 1;
      return store.run('INSERT INTO products (code, name, unit, series, price, sort) VALUES (?, ?, ?, ?, ?, ?)',
        [code, name, unit, series, price, sort]).lastId;
    });
  }

  function deleteProduct(id) {
    return store.tx(() => {
      if (store.get('SELECT 1 AS x FROM invoice_lines WHERE product_id = ? LIMIT 1', [id])) {
        store.run('UPDATE products SET active = 0 WHERE id = ?', [id]);
        return { deactivated: true };
      }
      store.run('DELETE FROM week_prices WHERE product_id = ?', [id]);
      store.run('DELETE FROM products WHERE id = ?', [id]);
      return { deleted: true };
    });
  }

  // ---------- numbering ----------
  function nextWeekPlan() {
    const s = getSettings();
    const last = store.get('SELECT MAX(date) AS d FROM weeks').d;
    const base = last && last > s.last_date ? last : s.last_date;
    const maxDf = store.get("SELECT MAX(number) AS n FROM invoices WHERE series = 'DF'").n || 0;
    const maxInv = store.get("SELECT MAX(number) AS n FROM invoices WHERE series = 'INV'").n || 0;
    const dorms = store.all('SELECT * FROM dorms WHERE active = 1 ORDER BY no');
    return {
      date: addDays(base, 7),
      dfStart: Math.max(maxDf, s.last_df) + 1,
      invStart: Math.max(maxInv, s.last_inv) + 1,
      dormCount: dorms.length,
    };
  }

  // starts: optional { dfStart, invStart } to choose the first invoice number of each series.
  // A chosen number must come after every number already used in the app; it then becomes the
  // new base for numbering, so the following week carries on from it.
  function newWeek(dateOverride, starts = {}) {
    return store.tx(() => {
      const plan = nextWeekPlan();
      const date = dateOverride || plan.date;
      if (!isIsoDate(date)) throw new UserError('Not a valid date.');
      const lastDate = store.get('SELECT MAX(date) AS d FROM weeks').d;
      if (lastDate && date <= lastDate) throw new UserError('The new week must come after the last week.');
      const dorms = store.all('SELECT * FROM dorms WHERE active = 1 ORDER BY no');
      if (!dorms.length) throw new UserError('There are no active dormitories.');
      for (const [series, key, setting] of [['DF', 'dfStart', 'last_df'], ['INV', 'invStart', 'last_inv']]) {
        const raw = starts[key];
        if (raw === undefined || raw === null || raw === '') continue;
        const n = Number(raw);
        if (!Number.isInteger(n) || n < 1) throw new UserError(`The first ${series} number must be a whole number.`);
        const used = store.get('SELECT MAX(number) AS n FROM invoices WHERE series = ?', [series]).n || 0;
        if (n <= used) throw new UserError(`${series}-${used} is already used, so ${series} must start at ${used + 1} or higher.`);
        plan[key] = n;
        store.run('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
          [setting, JSON.stringify(n - 1)]);
      }
      const weekId = store.run('INSERT INTO weeks (date, created_at) VALUES (?, ?)', [date, now()]).lastId;
      for (const p of store.all('SELECT id, price FROM products WHERE active = 1')) {
        store.run('INSERT INTO week_prices (week_id, product_id, price) VALUES (?, ?, ?)', [weekId, p.id, p.price]);
      }
      dorms.forEach((d, i) => {
        store.run('INSERT INTO invoices (series, number, week_id, dorm_id, vehicle) VALUES (?, ?, ?, ?, ?)',
          ['DF', plan.dfStart + i, weekId, d.id, d.vehicle]);
        store.run('INSERT INTO invoices (series, number, week_id, dorm_id, vehicle) VALUES (?, ?, ?, ?, ?)',
          ['INV', plan.invStart + i, weekId, d.id, d.vehicle]);
      });
      return weekId;
    });
  }

  function deleteWeek(weekId) {
    return store.tx(() => {
      const last = store.get('SELECT id FROM weeks ORDER BY date DESC LIMIT 1');
      if (!last || last.id !== weekId) throw new UserError('Only the latest week can be deleted, so no invoice numbers are skipped.');
      if (everPrinted(weekId)) {
        throw new UserError('Invoices from this week have been printed, so it cannot be deleted. Unlock and correct it instead.');
      }
      store.run('DELETE FROM invoice_lines WHERE invoice_id IN (SELECT id FROM invoices WHERE week_id = ?)', [weekId]);
      store.run('DELETE FROM invoices WHERE week_id = ?', [weekId]);
      store.run('DELETE FROM week_prices WHERE week_id = ?', [weekId]);
      store.run('DELETE FROM weeks WHERE id = ?', [weekId]);
      return true;
    });
  }

  // ---------- weeks ----------
  const everPrinted = (weekId) => !!store.get(`
    SELECT 1 AS x FROM invoices i WHERE i.week_id = ? AND (i.printed_at IS NOT NULL
      OR EXISTS (SELECT 1 FROM change_log c WHERE c.invoice_id = i.id AND c.action = 'printed')) LIMIT 1`, [weekId]);

  const invoiceTotal = (id) =>
    round2(store.get('SELECT COALESCE(SUM(ROUND(qty * unit_price, 2)), 0) AS t FROM invoice_lines WHERE invoice_id = ?', [id]).t);

  function listWeeks() {
    return store.all(`
      SELECT w.id, w.date,
        MIN(CASE WHEN i.series = 'DF' THEN i.number END) AS df_from,
        MAX(CASE WHEN i.series = 'DF' THEN i.number END) AS df_to,
        MIN(CASE WHEN i.series = 'INV' THEN i.number END) AS inv_from,
        MAX(CASE WHEN i.series = 'INV' THEN i.number END) AS inv_to,
        SUM(CASE WHEN i.printed_at IS NOT NULL THEN 1 ELSE 0 END) AS printed,
        COUNT(i.id) AS invoices,
        (SELECT COALESCE(SUM(ROUND(l.qty * l.unit_price, 2)), 0) FROM invoice_lines l JOIN invoices x ON x.id = l.invoice_id
           WHERE x.week_id = w.id AND x.series = 'DF') AS df_total,
        (SELECT COALESCE(SUM(ROUND(l.qty * l.unit_price, 2)), 0) FROM invoice_lines l JOIN invoices x ON x.id = l.invoice_id
           WHERE x.week_id = w.id AND x.series = 'INV') AS inv_total
      FROM weeks w LEFT JOIN invoices i ON i.week_id = w.id
      GROUP BY w.id ORDER BY w.date DESC`);
  }

  function getWeek(weekId) {
    const week = store.get('SELECT * FROM weeks WHERE id = ?', [weekId]);
    if (!week) throw new UserError('Week not found.');
    const latest = store.get('SELECT id FROM weeks ORDER BY date DESC LIMIT 1');
    const prev = store.get('SELECT id, date FROM weeks WHERE date < ? ORDER BY date DESC LIMIT 1', [week.date]);
    const next = store.get('SELECT id, date FROM weeks WHERE date > ? ORDER BY date ASC LIMIT 1', [week.date]);

    const invoices = store.all(`
      SELECT i.*, d.no AS dorm_no, d.name AS dorm_name, d.statement_name, d.cook_name AS dorm_cook
      FROM invoices i JOIN dorms d ON d.id = i.dorm_id
      WHERE i.week_id = ? ORDER BY i.series DESC, d.no`, [weekId]);
    // The cook's name saved when each invoice was printed (newest print wins).
    const printedCook = new Map();
    for (const c of store.all(`SELECT c.invoice_id, c.detail FROM change_log c JOIN invoices i ON i.id = c.invoice_id
      WHERE i.week_id = ? AND c.action = 'printed' ORDER BY c.id`, [weekId])) {
      const d = parse(c.detail);
      if (typeof d.cook_name === 'string') printedCook.set(c.invoice_id, d.cook_name);
    }
    const lines = store.all(`
      SELECT l.* FROM invoice_lines l JOIN invoices i ON i.id = l.invoice_id WHERE i.week_id = ?`, [weekId]);
    const corrections = store.all(`
      SELECT c.invoice_id, c.at, c.detail FROM change_log c JOIN invoices i ON i.id = c.invoice_id
      WHERE i.week_id = ? AND c.action = 'corrected' ORDER BY c.id`, [weekId]);
    for (const inv of invoices) {
      inv.lines = lines.filter((l) => l.invoice_id === inv.id);
      inv.total = round2(inv.lines.reduce((s, l) => s + round2(l.qty * l.unit_price), 0));
      inv.balance = round2(inv.total - inv.part_payment);
      // A printed invoice keeps the cook's name it was printed with, so reprints match the paper copy.
      // Not printed yet (or printed before names were saved): the dorm's cook name now.
      inv.cook_name = inv.printed_at && printedCook.has(inv.id) ? printedCook.get(inv.id) : (inv.dorm_cook || '');
      delete inv.dorm_cook;
      // Corrections of printed invoices: newest last. revised_at goes on reprinted copies.
      inv.corrections = corrections.filter((c) => c.invoice_id === inv.id).map((c) => ({ at: c.at, ...parse(c.detail) }));
      inv.revised_at = inv.corrections.length ? inv.corrections[inv.corrections.length - 1].at : null;
      inv.original_total = inv.corrections.length && inv.corrections[0].before ? inv.corrections[0].before.total : null;
    }

    const prices = {};
    for (const r of store.all('SELECT product_id, price FROM week_prices WHERE week_id = ?', [weekId])) prices[r.product_id] = r.price;
    const prevPrices = {};
    if (prev) for (const r of store.all('SELECT product_id, price FROM week_prices WHERE week_id = ?', [prev.id])) prevPrices[r.product_id] = r.price;

    // Products shown in the grid: active ones, plus any inactive one already used this week.
    const used = new Set(lines.map((l) => l.product_id));
    const products = listProducts().filter((p) => p.active || used.has(p.id));
    for (const p of products) if (!(p.id in prices)) prices[p.id] = p.price;

    // Usual quantity per dorm + item over the previous 4 weeks (for "much bigger than usual" warnings).
    const usual = {};
    for (const r of store.all(`
      SELECT i.dorm_id, l.product_id, AVG(l.qty) AS avg_qty
      FROM invoice_lines l JOIN invoices i ON i.id = l.invoice_id
      WHERE i.week_id IN (SELECT id FROM weeks WHERE date < ? ORDER BY date DESC LIMIT 4)
      GROUP BY i.dorm_id, l.product_id`, [week.date])) {
      usual[`${r.dorm_id}:${r.product_id}`] = round3(r.avg_qty);
    }
    // Items ordered by anyone in the previous 4 weeks (the grid hides the others by default).
    const recent = [...new Set(Object.keys(usual).map((k) => Number(k.split(':')[1])))];

    // Last week's quantity per dorm + item, shown as a hint in empty boxes.
    const lastQty = {};
    if (prev) {
      for (const r of store.all(`
        SELECT i.dorm_id, l.product_id, l.qty FROM invoice_lines l JOIN invoices i ON i.id = l.invoice_id
        WHERE i.week_id = ?`, [prev.id])) {
        lastQty[`${r.dorm_id}:${r.product_id}`] = r.qty;
      }
    }

    return {
      week, invoices, products, prices, prevPrices, usual, recent, lastQty,
      prev: prev || null, next: next || null,
      isLatest: !!latest && latest.id === week.id,
      everPrinted: everPrinted(weekId),
      paid: !!store.get('SELECT 1 AS x FROM payments WHERE month = ?', [week.date.slice(0, 7)]),
    };
  }

  // Fill every EMPTY box of this week's unprinted invoices with the previous week's quantity for the
  // same dorm, series and item, at this week's price. Boxes that already have a value are never touched.
  function copyLastWeek(weekId) {
    return store.tx(() => {
      const week = store.get('SELECT * FROM weeks WHERE id = ?', [weekId]);
      if (!week) throw new UserError('Week not found.');
      paidCheck(week.date);
      const prev = store.get('SELECT id, date FROM weeks WHERE date < ? ORDER BY date DESC LIMIT 1', [week.date]);
      if (!prev) throw new UserError('There is no previous week to copy from.');
      const rows = store.all(`
        SELECT cur.id AS invoice_id, l.product_id, l.qty
        FROM invoices cur
        JOIN invoices old ON old.week_id = ? AND old.dorm_id = cur.dorm_id AND old.series = cur.series
        JOIN invoice_lines l ON l.invoice_id = old.id
        JOIN products p ON p.id = l.product_id AND p.active = 1 AND p.series = cur.series
        WHERE cur.week_id = ? AND cur.printed_at IS NULL AND l.qty > 0
          AND NOT EXISTS (SELECT 1 FROM invoice_lines x WHERE x.invoice_id = cur.id AND x.product_id = l.product_id)`,
      [prev.id, weekId]);
      for (const r of rows) {
        store.run('INSERT INTO invoice_lines (invoice_id, product_id, qty, unit_price) VALUES (?, ?, ?, ?)',
          [r.invoice_id, r.product_id, r.qty, weekPrice(weekId, r.product_id)]);
      }
      return { copied: rows.length, from: prev.date };
    });
  }

  function lockedCheck(inv) {
    if (!inv) throw new UserError('Invoice not found.');
    paidCheck(invoiceDate(inv.id));
    if (inv.printed_at) throw new UserError(`${inv.series}-${inv.number} is printed and locked. Unlock the week to make a correction.`);
  }

  // ---------- controlled corrections of old / printed invoices ----------
  const wasPrinted = (invoiceId) => !!store.get(`
    SELECT 1 AS x FROM invoices i WHERE i.id = ? AND (i.printed_at IS NOT NULL
      OR EXISTS (SELECT 1 FROM change_log c WHERE c.invoice_id = i.id AND c.action = 'printed'))`, [invoiceId]);

  function snapshot(invoiceId) {
    const lines = store.all(`
      SELECT l.product_id, p.code, p.name, p.unit, l.qty, l.unit_price
      FROM invoice_lines l JOIN products p ON p.id = l.product_id WHERE l.invoice_id = ?`, [invoiceId])
      .sort((a, b) => byName(a.name, b.name));
    return { lines, total: invoiceTotal(invoiceId) };
  }

  // edits: [{ invoice_id, lines: [{ product_id, qty, unit_price }] }] — the full new contents of each
  // invoice. Invoice numbers and printed_at never change. A printed invoice needs a reason; each change
  // is saved in change_log as 'corrected' with snapshots of the invoice before and after.
  function correctInvoices(edits, reason) {
    const why = String(reason || '').trim();
    return store.tx(() => {
      const results = [];
      for (const e of edits || []) {
        const inv = store.get('SELECT * FROM invoices WHERE id = ?', [e.invoice_id]);
        if (!inv) throw new UserError('Invoice not found.');
        paidCheck(invoiceDate(inv.id));
        const want = new Map();
        for (const l of e.lines || []) {
          const q = l.qty === '' || l.qty === null || l.qty === undefined ? 0 : round3(l.qty);
          const pr = round2(l.unit_price);
          if (!(q >= 0)) throw new UserError('Quantities must be numbers, 0 or more.');
          if (!(pr >= 0)) throw new UserError('Prices must be 0 or more.');
          if (q === 0) continue;
          const prod = store.get('SELECT * FROM products WHERE id = ?', [l.product_id]);
          if (!prod) throw new UserError('Item not found.');
          if (prod.series !== inv.series) throw new UserError(`${prod.name} belongs on ${prod.series} invoices.`);
          want.set(prod.id, { qty: q, unit_price: pr });
        }
        const before = snapshot(inv.id);
        const same = before.lines.length === want.size && before.lines.every((l) => {
          const w = want.get(l.product_id);
          return w && w.qty === l.qty && w.unit_price === l.unit_price;
        });
        if (same) { results.push({ invoice_id: inv.id, series: inv.series, number: inv.number, changed: false }); continue; }
        const printed = wasPrinted(inv.id);
        if (printed && !why) throw new UserError(`${inv.series}-${inv.number} was printed, so please write what needs correcting.`);
        store.run('DELETE FROM invoice_lines WHERE invoice_id = ?', [inv.id]);
        for (const [pid, w] of want) {
          store.run('INSERT INTO invoice_lines (invoice_id, product_id, qty, unit_price) VALUES (?, ?, ?, ?)', [inv.id, pid, w.qty, w.unit_price]);
        }
        const after = snapshot(inv.id);
        if (printed) log(inv.id, 'corrected', JSON.stringify({ reason: why, before, after }));
        results.push({ invoice_id: inv.id, series: inv.series, number: inv.number, changed: true, corrected: printed,
          before_total: before.total, after_total: after.total });
      }
      return results;
    });
  }

  function weekPrice(weekId, productId) {
    const r = store.get('SELECT price FROM week_prices WHERE week_id = ? AND product_id = ?', [weekId, productId]);
    if (r) return r.price;
    const p = store.get('SELECT price FROM products WHERE id = ?', [productId]);
    if (!p) throw new UserError('Item not found.');
    store.run('INSERT INTO week_prices (week_id, product_id, price) VALUES (?, ?, ?)', [weekId, productId, p.price]);
    return p.price;
  }

  function setQty(invoiceId, productId, qty) {
    return store.tx(() => {
      const inv = store.get('SELECT * FROM invoices WHERE id = ?', [invoiceId]);
      lockedCheck(inv);
      const prod = store.get('SELECT * FROM products WHERE id = ?', [productId]);
      if (!prod) throw new UserError('Item not found.');
      if (prod.series !== inv.series) throw new UserError(`${prod.name} belongs on ${prod.series} invoices.`);
      const q = qty === '' || qty === null || qty === undefined ? 0 : round3(qty);
      if (!(q >= 0)) throw new UserError('Quantity must be a number, 0 or more.');
      if (q === 0) {
        store.run('DELETE FROM invoice_lines WHERE invoice_id = ? AND product_id = ?', [invoiceId, productId]);
      } else {
        const price = weekPrice(inv.week_id, productId);
        store.run(`INSERT INTO invoice_lines (invoice_id, product_id, qty, unit_price) VALUES (?, ?, ?, ?)
                   ON CONFLICT(invoice_id, product_id) DO UPDATE SET qty = excluded.qty, unit_price = excluded.unit_price`,
          [invoiceId, productId, q, price]);
      }
      return invoiceTotal(invoiceId);
    });
  }

  function setWeekPrice(weekId, productId, price) {
    const pr = round2(price);
    if (!(pr >= 0)) throw new UserError('Price must be 0 or more.');
    paidCheck(weekDate(weekId));
    return store.tx(() => {
      const printed = store.get(`
        SELECT i.series, i.number FROM invoices i JOIN invoice_lines l ON l.invoice_id = i.id
        WHERE i.week_id = ? AND l.product_id = ? AND i.printed_at IS NOT NULL LIMIT 1`, [weekId, productId]);
      if (printed) throw new UserError(`This price is on printed invoice ${printed.series}-${printed.number}. Unlock the week first.`);
      store.run(`INSERT INTO week_prices (week_id, product_id, price) VALUES (?, ?, ?)
                 ON CONFLICT(week_id, product_id) DO UPDATE SET price = excluded.price`, [weekId, productId, pr]);
      store.run(`UPDATE invoice_lines SET unit_price = ? WHERE product_id = ?
                 AND invoice_id IN (SELECT id FROM invoices WHERE week_id = ?)`, [pr, productId, weekId]);
      // The latest week's price becomes the starting price for next week.
      const latest = store.get('SELECT id FROM weeks ORDER BY date DESC LIMIT 1');
      if (latest && latest.id === weekId) store.run('UPDATE products SET price = ? WHERE id = ?', [pr, productId]);
      return pr;
    });
  }

  function setInvoiceFields(invoiceId, fields) {
    return store.tx(() => {
      const inv = store.get('SELECT * FROM invoices WHERE id = ?', [invoiceId]);
      lockedCheck(inv);
      if ('vehicle' in fields) store.run('UPDATE invoices SET vehicle = ? WHERE id = ?', [String(fields.vehicle || '').trim(), invoiceId]);
      if ('part_payment' in fields) {
        const pp = round2(fields.part_payment || 0);
        if (!(pp >= 0)) throw new UserError('Part payment must be 0 or more.');
        if (pp > invoiceTotal(invoiceId)) throw new UserError('Part payment cannot be more than the invoice total.');
        store.run('UPDATE invoices SET part_payment = ? WHERE id = ?', [pp, invoiceId]);
      }
      return true;
    });
  }

  function markPrinted(invoiceIds) {
    return store.tx(() => {
      for (const id of invoiceIds) {
        const r = store.run('UPDATE invoices SET printed_at = ? WHERE id = ? AND printed_at IS NULL', [now(), id]);
        if (r.changes) {
          const d = store.get('SELECT d.cook_name FROM invoices i JOIN dorms d ON d.id = i.dorm_id WHERE i.id = ?', [id]);
          log(id, 'printed', JSON.stringify({ cook_name: (d && d.cook_name) || '' }));
        }
      }
      return true;
    });
  }

  function unlockWeek(weekId, reason) {
    const why = String(reason || '').trim();
    if (!why) throw new UserError('Please write why the invoices need correcting.');
    paidCheck(weekDate(weekId));
    return store.tx(() => {
      for (const inv of store.all('SELECT id FROM invoices WHERE week_id = ? AND printed_at IS NOT NULL', [weekId])) {
        store.run('UPDATE invoices SET printed_at = NULL WHERE id = ?', [inv.id]);
        log(inv.id, 'unlocked', why);
      }
      return true;
    });
  }

  function getLog(weekId) {
    return store.all(`
      SELECT c.*, i.series, i.number FROM change_log c LEFT JOIN invoices i ON i.id = c.invoice_id
      WHERE i.week_id = ? ORDER BY c.id DESC`, [weekId]);
  }

  // ---------- monthly statement ----------
  function listMonths() {
    const months = store.all(`
      SELECT substr(w.date, 1, 7) AS month, COUNT(DISTINCT w.id) AS weeks,
        COALESCE(SUM(CASE WHEN i.series = 'DF' THEN ROUND(l.qty * l.unit_price, 2) END), 0) AS df_total,
        COALESCE(SUM(CASE WHEN i.series = 'INV' THEN ROUND(l.qty * l.unit_price, 2) END), 0) AS inv_total
      FROM weeks w LEFT JOIN invoices i ON i.week_id = w.id LEFT JOIN invoice_lines l ON l.invoice_id = i.id
      GROUP BY month ORDER BY month DESC`);
    for (const m of months) {
      m.total = round2(m.df_total + m.inv_total);
      m.payment = store.get('SELECT * FROM payments WHERE month = ?', [m.month]) || null;
      m.week_dates = store.all('SELECT date FROM weeks WHERE substr(date, 1, 7) = ? ORDER BY date', [m.month]).map((r) => r.date);
      const last = lastStatementPrint(m.month);
      m.statement_printed_at = last ? last.at : null;
    }
    return months;
  }

  // Statement prints / PDFs are logged as 'statement_printed' with the month as detail.
  // (Older entries were 'statement' with JSON {month}; both are read.)
  function lastStatementPrint(month) {
    return store.all("SELECT id, at, action, detail FROM change_log WHERE action IN ('statement_printed', 'statement') AND invoice_id IS NULL ORDER BY id")
      .filter((r) => (r.action === 'statement_printed' ? r.detail === month : parse(r.detail).month === month)).pop() || null;
  }

  function monthly(month) {
    if (!/^\d{4}-\d{2}$/.test(month)) throw new UserError('Choose a month.');
    const weeks = store.all("SELECT * FROM weeks WHERE substr(date, 1, 7) = ? ORDER BY date", [month]);
    const byDorm = new Map();
    let dfTotal = 0; let invTotal = 0;
    const outWeeks = weeks.map((w) => {
      const data = getWeek(w.id);
      const rows = new Map();
      for (const inv of data.invoices) {
        const key = inv.dorm_id;
        if (!rows.has(key)) rows.set(key, { dorm_no: inv.dorm_no, dorm: inv.statement_name, df: null, inv: null });
        rows.get(key)[inv.series === 'DF' ? 'df' : 'inv'] = { number: inv.number, total: inv.total, balance: inv.balance };
      }
      const list = [...rows.values()].sort((a, b) => a.dorm_no - b.dorm_no);
      let wDf = 0; let wInv = 0;
      for (const r of list) {
        const d = r.df ? r.df.total : 0; const i = r.inv ? r.inv.total : 0;
        wDf += d; wInv += i;
        if (!byDorm.has(r.dorm_no)) byDorm.set(r.dorm_no, { dorm_no: r.dorm_no, dorm: r.dorm, weeks: 0, df: 0, inv: 0 });
        const s = byDorm.get(r.dorm_no);
        s.weeks += 1; s.df = round2(s.df + d); s.inv = round2(s.inv + i);
      }
      dfTotal += wDf; invTotal += wInv;
      return { id: w.id, date: w.date, rows: list, df_total: round2(wDf), inv_total: round2(wInv), total: round2(wDf + wInv) };
    });
    const summary = [...byDorm.values()].sort((a, b) => a.dorm_no - b.dorm_no).map((s) => ({ ...s, total: round2(s.df + s.inv) }));

    // Last time this month's statement was printed or saved, and whether an invoice was corrected
    // (or unlocked to be corrected) after that.
    const lastPrint = lastStatementPrint(month);
    const changedAfter = !!lastPrint && !!store.get(`
      SELECT 1 AS x FROM change_log c JOIN invoices i ON i.id = c.invoice_id JOIN weeks w ON w.id = i.week_id
      WHERE substr(w.date, 1, 7) = ? AND c.action IN ('corrected', 'unlocked') AND c.id > ? LIMIT 1`, [month, lastPrint.id]);

    return {
      month, weeks: outWeeks, summary,
      statement: { printed_at: lastPrint ? lastPrint.at : null, changed_after: changedAfter },
      df_total: round2(dfTotal), inv_total: round2(invTotal), total: round2(dfTotal + invTotal),
      payment: store.get('SELECT * FROM payments WHERE month = ?', [month]) || null,
    };
  }

  // Record that a month's statement was printed or saved as PDF.
  function logStatement(month) {
    if (!/^\d{4}-\d{2}$/.test(month)) throw new UserError('Choose a month.');
    return store.tx(() => { log(null, 'statement_printed', month); return true; });
  }

  function setPayment(month, p) {
    if (!/^\d{4}-\d{2}$/.test(month)) throw new UserError('Choose a month.');
    return store.tx(() => {
      if (!p) { store.run('DELETE FROM payments WHERE month = ?', [month]); return null; }
      if (!isIsoDate(p.paid_date)) throw new UserError('Payment date is not valid.');
      const amount = round2(p.amount);
      if (!(amount > 0)) throw new UserError('Payment amount must be more than 0.');
      store.run(`INSERT INTO payments (month, paid_date, amount, reference) VALUES (?, ?, ?, ?)
                 ON CONFLICT(month) DO UPDATE SET paid_date = excluded.paid_date, amount = excluded.amount, reference = excluded.reference`,
        [month, p.paid_date, amount, String(p.reference || '').trim()]);
      return store.get('SELECT * FROM payments WHERE month = ?', [month]);
    });
  }

  function bootstrap() {
    return {
      settings: getSettings(), dorms: listDorms(), products: listProducts(),
      weeks: listWeeks(), plan: nextWeekPlan(),
      formatDefaults: { receipt: formats.DEFAULT_RECEIPT, statement: formats.DEFAULT_STATEMENT },
    };
  }

  return {
    bootstrap, getSettings, saveSettings, listDorms, saveDorm, listProducts, saveProduct, deleteProduct,
    nextWeekPlan, newWeek, deleteWeek, listWeeks, getWeek, copyLastWeek, setQty, setWeekPrice, setInvoiceFields,
    correctInvoices, markPrinted, unlockWeek, getLog, listMonths, monthly, setPayment, logStatement,
  };
}

module.exports = { createService, UserError, addDays };
