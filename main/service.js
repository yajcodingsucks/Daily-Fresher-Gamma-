// All the business rules live here: numbering, dates, prices, totals, locking, statements.
// The screens only ask for things; this file decides what is allowed and does the maths.

const schema = require('./schema');
const seed = require('./seed');

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
  store.exec(schema);
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

  const log = (invoiceId, action, detail) =>
    store.run('INSERT INTO change_log (at, invoice_id, action, detail) VALUES (?, ?, ?, ?)',
      [now(), invoiceId, action, detail || null]);

  // ---------- settings ----------
  function getSettings() {
    const out = { ...seed.settings };
    for (const r of store.all('SELECT key, value FROM settings')) out[r.key] = JSON.parse(r.value);
    return out;
  }

  function saveSettings(patch) {
    const clean = {};
    for (const k of SETTING_KEYS) if (k in patch) clean[k] = patch[k];
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
  const listProducts = () => store.all('SELECT * FROM products ORDER BY series DESC, sort, name');

  function saveDorm(d) {
    const name = String(d.name || '').trim();
    const stmt = String(d.statement_name || '').trim() || name;
    const no = Number(d.no);
    if (!name) throw new UserError('Dormitory name is required.');
    if (!Number.isInteger(no) || no < 1) throw new UserError('Dormitory number must be a whole number.');
    return store.tx(() => {
      const clash = store.get('SELECT id FROM dorms WHERE no = ? AND id <> ?', [no, d.id || 0]);
      if (clash) throw new UserError(`Dormitory No ${no} already exists.`);
      const vals = [no, name, stmt, String(d.vehicle || '').trim(), d.active === false || d.active === 0 ? 0 : 1];
      if (d.id) {
        store.run('UPDATE dorms SET no = ?, name = ?, statement_name = ?, vehicle = ?, active = ? WHERE id = ?', [...vals, d.id]);
        return d.id;
      }
      return store.run('INSERT INTO dorms (no, name, statement_name, vehicle, active) VALUES (?, ?, ?, ?, ?)', vals).lastId;
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

  function newWeek(dateOverride) {
    return store.tx(() => {
      const plan = nextWeekPlan();
      const date = dateOverride || plan.date;
      if (!isIsoDate(date)) throw new UserError('Not a valid date.');
      const lastDate = store.get('SELECT MAX(date) AS d FROM weeks').d;
      if (lastDate && date <= lastDate) throw new UserError('The new week must come after the last week.');
      const dorms = store.all('SELECT * FROM dorms WHERE active = 1 ORDER BY no');
      if (!dorms.length) throw new UserError('There are no active dormitories.');
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
      SELECT i.*, d.no AS dorm_no, d.name AS dorm_name, d.statement_name
      FROM invoices i JOIN dorms d ON d.id = i.dorm_id
      WHERE i.week_id = ? ORDER BY i.series DESC, d.no`, [weekId]);
    const lines = store.all(`
      SELECT l.* FROM invoice_lines l JOIN invoices i ON i.id = l.invoice_id WHERE i.week_id = ?`, [weekId]);
    for (const inv of invoices) {
      inv.lines = lines.filter((l) => l.invoice_id === inv.id);
      inv.total = round2(inv.lines.reduce((s, l) => s + round2(l.qty * l.unit_price), 0));
      inv.balance = round2(inv.total - inv.part_payment);
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

    return {
      week, invoices, products, prices, prevPrices, usual,
      prev: prev || null, next: next || null,
      isLatest: !!latest && latest.id === week.id,
      everPrinted: everPrinted(weekId),
    };
  }

  function lockedCheck(inv) {
    if (!inv) throw new UserError('Invoice not found.');
    if (inv.printed_at) throw new UserError(`${inv.series}-${inv.number} is printed and locked. Unlock the week to make a correction.`);
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
        if (r.changes) log(id, 'printed', null);
      }
      return true;
    });
  }

  function unlockWeek(weekId, reason) {
    const why = String(reason || '').trim();
    if (!why) throw new UserError('Please write why the invoices need correcting.');
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
    }
    return months;
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
    return {
      month, weeks: outWeeks, summary,
      df_total: round2(dfTotal), inv_total: round2(invTotal), total: round2(dfTotal + invTotal),
      payment: store.get('SELECT * FROM payments WHERE month = ?', [month]) || null,
    };
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
    };
  }

  return {
    bootstrap, getSettings, saveSettings, listDorms, saveDorm, listProducts, saveProduct, deleteProduct,
    nextWeekPlan, newWeek, deleteWeek, listWeeks, getWeek, setQty, setWeekPrice, setInvoiceFields,
    markPrinted, unlockWeek, getLog, listMonths, monthly, setPayment,
  };
}

module.exports = { createService, UserError, addDays };
