// All the business rules live here: numbering, dates, prices, totals, locking, statements.
// The screens only ask for things; this file decides what is allowed and does the maths.

const schema = require('./schema');
const seed = require('./seed');
const formats = require('./formats');
const importer = require('./importer');

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
  // the date must really exist: 2026-02-30 is not rolled over into March
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const t = Date.parse(s + 'T00:00:00Z');
  return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === s;
}

class UserError extends Error {}

function createService(store) {
  // ---------- setup ----------
  store.exec(schema.sql);
  // Older databases: add the columns that came later (e.g. dorms.cook_name).
  for (const [table, column, def] of schema.added) {
    if (!store.all(`PRAGMA table_info(${table})`).some((c) => c.name === column)) {
      store.tx(() => store.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${def}`));   // tx: written to disk at once
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

  // ---------- past weeks (typed in or imported from Excel) ----------
  // A past week is a week dated BEFORE the latest week (or between weeks), with invoice numbers chosen
  // by the user. Its invoices are locked like printed ones (printed_at = the week date) and logged as
  // 'imported'. A week-level 'past_week' entry in change_log (no invoice) keeps how it was added:
  // { week_id, mode: 'typed' | 'excel', entering, file, sheets, autofixes, mappings, skipped, ... }.
  // "Start next week" is unaffected: it still uses the highest number + 1 and the latest date + 7 days.
  const days = (a, b) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000);

  function pastWeekInfo() {
    const out = new Map();
    for (const r of store.all("SELECT id, at, detail FROM change_log WHERE action = 'past_week' AND invoice_id IS NULL ORDER BY id")) {
      const d = parse(r.detail);
      if (d.week_id) out.set(d.week_id, { ...d, log_id: r.id, at: r.at });
    }
    return out;
  }
  const pastWeek = (weekId) => pastWeekInfo().get(weekId) || null;

  // The weeks before and after a date, and whether the date sits on their 7-day rhythm.
  function weekNeighbours(date) {
    const prev = store.get('SELECT id, date FROM weeks WHERE date < ? ORDER BY date DESC LIMIT 1', [date]) || null;
    const next = store.get('SELECT id, date FROM weeks WHERE date > ? ORDER BY date ASC LIMIT 1', [date]) || null;
    const prevGap = prev ? days(prev.date, date) : null;
    const nextGap = next ? days(date, next.date) : null;
    return { prev, next, prevGap, nextGap, onRhythm: (prevGap === null || prevGap % 7 === 0) && (nextGap === null || nextGap % 7 === 0) };
  }

  const pastDorms = (dormIds) => (Array.isArray(dormIds) && dormIds.length
    ? store.all(`SELECT * FROM dorms WHERE id IN (${dormIds.map(() => '?').join(',')}) ORDER BY no`, dormIds.map(Number))
    : store.all('SELECT * FROM dorms WHERE active = 1 ORDER BY no'));

  // Which of these numbers are already used (any week).
  function usedNumbers(series, numbers) {
    if (!numbers.length) return [];
    const set = new Set(store.all(`SELECT number FROM invoices WHERE series = ? AND number IN (${numbers.map(() => '?').join(',')})`,
      [series, ...numbers]).map((r) => r.number));
    return numbers.filter((n) => set.has(n));
  }

  // Suggested first numbers for a past week: counted back from the week after it (or on from the week before).
  function suggestNumbers(date, n) {
    const { prev, next } = weekNeighbours(date);
    const range = (weekId, series, fn) => store.get(`SELECT ${fn}(number) AS n FROM invoices WHERE week_id = ? AND series = ?`, [weekId, series]).n;
    if (next) {
      const k = Math.max(1, Math.round(days(date, next.date) / 7));
      const df = range(next.id, 'DF', 'MIN'); const iv = range(next.id, 'INV', 'MIN');
      if (df && iv) return { dfStart: Math.max(1, df - n * k), invStart: Math.max(1, iv - n * k) };
    }
    if (prev) {
      const k = Math.max(1, Math.round(days(prev.date, date) / 7));
      const df = range(prev.id, 'DF', 'MAX'); const iv = range(prev.id, 'INV', 'MAX');
      if (df && iv) return { dfStart: df + 1 + n * (k - 1), invStart: iv + 1 + n * (k - 1) };
    }
    const s = getSettings();
    return { dfStart: Math.max(1, s.last_df - n + 1), invStart: Math.max(1, s.last_inv - n + 1) };
  }

  // Live check for the "Type it in" dialog. Never throws for bad input: it says what is wrong.
  function checkPastWeek({ date, dfStart, invStart, dormIds } = {}) {
    const dorms = pastDorms(dormIds);
    const n = dorms.length;
    const out = { date: date || '', valid: isIsoDate(date), exists: false, dorms: n, problems: [] };
    if (!out.valid) { out.problems.push('Choose a valid date.'); return out; }
    out.exists = !!store.get('SELECT 1 AS x FROM weeks WHERE date = ?', [date]);
    if (out.exists) out.problems.push(`There is already a week on ${date.split('-').reverse().join('.')}.`);
    const latest = store.get('SELECT MAX(date) AS d FROM weeks').d;
    out.afterLatest = !!latest && date > latest;
    if (out.afterLatest) out.problems.push('This date is after the latest week. Use "Start next week" on This Week for new weeks.');
    out.paid = !!store.get('SELECT 1 AS x FROM payments WHERE month = ?', [date.slice(0, 7)]);
    if (out.paid) out.problems.push(`${MONTH_NAMES[Number(date.slice(5, 7)) - 1]} is marked as paid. Undo paid on the Monthly page first.`);
    out.suggest = suggestNumbers(date, n);
    out.neighbours = weekNeighbours(date);
    for (const [series, start] of [['DF', dfStart], ['INV', invStart]]) {
      const from = start === undefined || start === null || start === '' ? out.suggest[series === 'DF' ? 'dfStart' : 'invStart'] : Number(start);
      const r = { from, to: from + n - 1, clashes: [], valid: Number.isInteger(from) && from >= 1 };
      if (!r.valid) out.problems.push(`The first ${series} number must be a whole number.`);
      else r.clashes = usedNumbers(series, Array.from({ length: n }, (_, i) => from + i));
      if (r.clashes.length) out.problems.push(`${r.clashes.map((x) => `${series}-${x}`).join(', ')} ${r.clashes.length === 1 ? 'is' : 'are'} already used.`);
      out[series.toLowerCase()] = r;
    }
    if (!n) out.problems.push('There are no dormitories.');
    out.ok = out.problems.length === 0;
    return out;
  }

  // Week prices for a past week: the nearest week's prices, else the item's current price.
  function nearestPrices(date, excludeWeekId = 0) {
    const prices = new Map();
    const near = store.all('SELECT id, date FROM weeks WHERE id <> ?', [excludeWeekId])
      .sort((a, b) => Math.abs(days(a.date, date)) - Math.abs(days(b.date, date)));
    for (const w of near.reverse()) {   // farthest first, so the nearest week wins
      for (const r of store.all('SELECT product_id, price FROM week_prices WHERE week_id = ?', [w.id])) prices.set(r.product_id, r.price);
    }
    return prices;
  }

  // Create the week row, its week prices, and the 'past_week' log entry. Used by addPastWeek and the Excel import.
  function createPastWeekRow(date, info, filePrices = new Map()) {
    const weekId = store.run('INSERT INTO weeks (date, created_at) VALUES (?, ?)', [date, now()]).lastId;
    const near = nearestPrices(date, weekId);
    for (const p of store.all('SELECT id, price, active FROM products').filter((x) => x.active || filePrices.has(x.id))) {
      const price = filePrices.has(p.id) ? filePrices.get(p.id) : near.has(p.id) ? near.get(p.id) : p.price;
      store.run('INSERT INTO week_prices (week_id, product_id, price) VALUES (?, ?, ?)', [weekId, p.id, round2(price)]);
    }
    log(null, 'past_week', JSON.stringify({ week_id: weekId, date, ...info }));
    return weekId;
  }

  // Lock a past week's invoices like printed ones and log each as 'imported'.
  function lockAsImported(weekId, date, detail) {
    for (const inv of store.all('SELECT i.id, d.cook_name FROM invoices i JOIN dorms d ON d.id = i.dorm_id WHERE i.week_id = ?', [weekId])) {
      store.run('UPDATE invoices SET printed_at = ? WHERE id = ?', [date, inv.id]);
      log(inv.id, 'imported', JSON.stringify({ ...detail, cook_name: detail.cook_name ?? inv.cook_name ?? '' }));
    }
  }

  // { date, dfStart, invStart, dormIds?, entering? } — one DF and one INV per dorm, numbered in dorm order.
  // entering: true leaves the invoices unlocked so quantities can be typed; finishPastWeek locks them.
  function addPastWeek({ date, dfStart, invStart, dormIds, entering = false } = {}) {
    return store.tx(() => {
      const c = checkPastWeek({ date, dfStart, invStart, dormIds });
      if (!c.ok) throw new UserError(c.problems.join(' '));
      const dorms = pastDorms(dormIds);
      const weekId = createPastWeekRow(date, { mode: 'typed', entering: !!entering, dorms: dorms.length });
      dorms.forEach((d, i) => {
        store.run('INSERT INTO invoices (series, number, week_id, dorm_id, vehicle) VALUES (?, ?, ?, ?, ?)', ['DF', c.df.from + i, weekId, d.id, d.vehicle]);
        store.run('INSERT INTO invoices (series, number, week_id, dorm_id, vehicle) VALUES (?, ?, ?, ?, ?)', ['INV', c.inv.from + i, weekId, d.id, d.vehicle]);
      });
      if (!entering) lockAsImported(weekId, date, { mode: 'typed' });
      return weekId;
    });
  }

  // "✓ Finish" on a past week being typed in: lock it with the 'imported' status.
  function finishPastWeek(weekId) {
    return store.tx(() => {
      const info = pastWeek(weekId);
      if (!info || !info.entering) throw new UserError('This week is not being entered.');
      const week = store.get('SELECT * FROM weeks WHERE id = ?', [weekId]);
      paidCheck(week.date);
      lockAsImported(weekId, week.date, { mode: 'typed' });
      const { log_id: logId, at: _at, ...detail } = info;
      store.run('UPDATE change_log SET detail = ? WHERE id = ?', [JSON.stringify({ ...detail, entering: false, finished_at: now() }), logId]);
      return true;
    });
  }

  // Cancel a past week while it is still being entered (nothing was locked yet).
  function deletePastWeek(weekId) {
    return store.tx(() => {
      const info = pastWeek(weekId);
      if (!info || !info.entering) throw new UserError('Only a past week that is still being entered can be deleted.');
      store.run('DELETE FROM invoice_lines WHERE invoice_id IN (SELECT id FROM invoices WHERE week_id = ?)', [weekId]);
      store.run('DELETE FROM invoices WHERE week_id = ?', [weekId]);
      store.run('DELETE FROM week_prices WHERE week_id = ?', [weekId]);
      store.run('DELETE FROM weeks WHERE id = ?', [weekId]);
      store.run('DELETE FROM change_log WHERE id = ?', [info.log_id]);
      return true;
    });
  }

  // Weeks missing from the weekly rhythm, by month: gaps of more than 7 days between weeks, and the
  // weeks before the first week in its month. [{ month: '2026-11', dates: ['2026-11-06', ...] }]
  function missingWeeks() {
    const dates = store.all('SELECT date FROM weeks ORDER BY date').map((r) => r.date);
    const missing = [];
    if (dates.length) {
      for (let d = addDays(dates[0], -7); d.slice(0, 7) === dates[0].slice(0, 7); d = addDays(d, -7)) missing.push(d);
      for (let i = 1; i < dates.length; i++) {
        for (let d = addDays(dates[i - 1], 7); days(d, dates[i]) > 3; d = addDays(d, 7)) missing.push(d);
      }
    }
    const byMonth = new Map();
    for (const d of missing.sort()) {
      if (!byMonth.has(d.slice(0, 7))) byMonth.set(d.slice(0, 7), []);
      byMonth.get(d.slice(0, 7)).push(d);
    }
    return [...byMonth].map(([month, list]) => ({ month, dates: list }));
  }

  // ---------- import a week from Excel (the checks are in importer.js) ----------
  // What the importer needs to know about the database.
  function importContext() {
    const used = new Map(store.all('SELECT i.series, i.number, w.date FROM invoices i JOIN weeks w ON w.id = i.week_id')
      .map((r) => [`${r.series}-${r.number}`, r.date]));
    const weekDates = store.all('SELECT date FROM weeks').map((r) => r.date);
    const paidMonths = store.all('SELECT month FROM payments').map((r) => r.month);
    const priceRows = store.all('SELECT wp.product_id, wp.price, w.date FROM week_prices wp JOIN weeks w ON w.id = wp.week_id');
    const qtyRows = store.all(`SELECT i.dorm_id, l.product_id, l.qty, w.date FROM invoice_lines l
      JOIN invoices i ON i.id = l.invoice_id JOIN weeks w ON w.id = i.week_id`);
    const products = listProducts();
    const near = (rows, date) => [...rows].sort((a, b) => Math.abs(days(a.date, date)) - Math.abs(days(b.date, date)));
    return {
      dorms: listDorms(), products, used, weekDates, paidMonths,
      // the price of the week nearest to the date (the current price when there are no weeks yet)
      nearestPrice(productId, date) {
        const best = near(priceRows.filter((r) => r.product_id === productId), date)[0];
        if (best) return { price: best.price, date: best.date };
        const p = products.find((x) => x.id === productId);
        return p && p.price > 0 ? { price: p.price, date: null } : null;
      },
      // average quantity of the 4 nearest weeks this dorm ordered the item
      usualQty(dormId, productId, date) {
        const list = near(qtyRows.filter((r) => r.dorm_id === dormId && r.product_id === productId), date).slice(0, 4);
        return list.length ? round3(list.reduce((t, r) => t + r.qty, 0) / list.length) : null;
      },
    };
  }

  // book: { file, sheets: [{ name, rows }] } from excel.readWorkbook → the first draft and its check.
  function startImport(book) {
    if (!book || !Array.isArray(book.sheets) || !book.sheets.length) throw new UserError('This workbook has no sheets to read.');
    const ctx = importContext();
    const draft = importer.buildDraft(book, ctx);
    return { draft, check: importer.validate(draft, ctx) };
  }

  // The screen sends the edited draft back after every change.
  const checkImport = (draft) => importer.validate(draft, importContext());

  // Save the week: invoices locked as 'imported' (printed_at = week date), lines with the recalculated
  // amounts, the file's prices as this week's prices (current item prices unchanged), new items if any,
  // and a summary in change_log ('past_week': file, auto-fixes, item mappings, skipped sheets).
  function importWeek(draft) {
    return store.tx(() => {
      const v = importer.validate(draft, importContext());
      if (v.blocking.length) throw new UserError(`Not imported: ${v.blocking[0]}${v.blocking.length > 1 ? ` (and ${v.blocking.length - 1} more)` : ''}`);
      if (v.warnings) throw new UserError(`Not imported: ${v.warnings} warning${v.warnings === 1 ? ' needs' : 's need'} a decision first.`);
      const p = importer.plan(draft, v);
      paidCheck(p.date);
      const newIds = new Map();
      for (const c of p.created) {
        const clash = store.get('SELECT id FROM products WHERE lower(code) = lower(?)', [c.code]);
        if (clash) { newIds.set(importer.norm(c.code), clash.id); continue; }
        const sort = (store.get('SELECT MAX(sort) AS m FROM products').m || 0) + 1;
        newIds.set(importer.norm(c.code), store.run('INSERT INTO products (code, name, unit, series, price, sort) VALUES (?, ?, ?, ?, ?, ?)',
          [c.code, c.name, c.unit || 'Kg', c.series, c.price, sort]).lastId);
      }
      const pid = (l) => l.product_id || newIds.get(importer.norm(l.newCode));
      const filePrices = new Map();
      for (const [key, price] of p.prices) filePrices.set(typeof key === 'number' ? key : newIds.get(key.slice(4)), price);
      const weekId = createPastWeekRow(p.date, p.summary, filePrices);
      for (const inv of p.invoices) {
        const id = store.run('INSERT INTO invoices (series, number, week_id, dorm_id, vehicle, printed_at) VALUES (?, ?, ?, ?, ?, ?)',
          [inv.series, inv.number, weekId, inv.dorm_id, inv.vehicle, p.date]).lastId;
        for (const l of inv.lines) {
          store.run('INSERT INTO invoice_lines (invoice_id, product_id, qty, unit_price) VALUES (?, ?, ?, ?)', [id, pid(l), l.qty, l.unit_price]);
        }
        log(id, 'imported', JSON.stringify({ mode: 'excel', file: p.summary.file, sheet: inv.sheet, cook_name: '' }));
      }
      return { weekId, summary: p.summary };
    });
  }

  // ---------- weeks ----------
  const everPrinted = (weekId) => !!store.get(`
    SELECT 1 AS x FROM invoices i WHERE i.week_id = ? AND (i.printed_at IS NOT NULL
      OR EXISTS (SELECT 1 FROM change_log c WHERE c.invoice_id = i.id AND c.action = 'printed')) LIMIT 1`, [weekId]);

  const invoiceTotal = (id) =>
    round2(store.get('SELECT COALESCE(SUM(ROUND(qty * unit_price, 2)), 0) AS t FROM invoice_lines WHERE invoice_id = ?', [id]).t);

  function listWeeks() {
    const past = pastWeekInfo();
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
      GROUP BY w.id ORDER BY w.date DESC`).map((w) => {
      const p = past.get(w.id);
      return { ...w, past: p ? { mode: p.mode, entering: !!p.entering, file: p.file || null } : null };
    });
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
      WHERE i.week_id = ? AND c.action IN ('printed', 'imported') ORDER BY c.id`, [weekId])) {
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
      past: pastWeek(week.id),   // null, or how this past week was added (typed / Excel) and its import summary
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

  // For Settings → Help → Check the app: SQLite's own integrity check and what is in the database.
  function databaseHealth() {
    const check = store.all('PRAGMA integrity_check').map((r) => Object.values(r)[0]);
    const count = (t) => store.get(`SELECT COUNT(*) AS n FROM ${t}`).n;
    const range = store.get('SELECT MIN(date) AS first, MAX(date) AS last FROM weeks');
    return {
      ok: check.length === 1 && check[0] === 'ok', integrity: check.slice(0, 5).join('; '),
      weeks: count('weeks'), invoices: count('invoices'), lines: count('invoice_lines'), products: count('products'), dorms: count('dorms'),
      first: range.first, last: range.last,
    };
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
    checkPastWeek, addPastWeek, finishPastWeek, deletePastWeek, missingWeeks, startImport, checkImport, importWeek, databaseHealth,
  };
}

module.exports = { createService, UserError, addDays };
