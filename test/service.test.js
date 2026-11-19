// Run with: npm test
const test = require('node:test');
const assert = require('node:assert');
const { openNodeSqlite } = require('../main/store');
const { createService } = require('../main/service');

const fresh = () => createService(openNodeSqlite());
const prod = (svc, code) => svc.listProducts().find((p) => p.code === code);

test('first week continues from the Excel numbers and date', () => {
  const svc = fresh();
  const plan = svc.nextWeekPlan();
  assert.deepStrictEqual(plan, { date: '2026-11-27', dfStart: 503, invStart: 354, dormCount: 9 });
  const w = svc.getWeek(svc.newWeek());
  const df = w.invoices.filter((i) => i.series === 'DF').map((i) => i.number);
  const inv = w.invoices.filter((i) => i.series === 'INV').map((i) => i.number);
  assert.deepStrictEqual(df, [503, 504, 505, 506, 507, 508, 509, 510, 511]);
  assert.deepStrictEqual(inv, [354, 355, 356, 357, 358, 359, 360, 361, 362]);
  assert.strictEqual(w.invoices.find((i) => i.series === 'DF').dorm_name, 'Belle-Vue');
  assert.strictEqual(w.invoices.find((i) => i.dorm_no === 4).vehicle, '9828 SP 2026');
});

test('second week follows on with no gaps, 7 days later', () => {
  const svc = fresh();
  svc.newWeek();
  const w2 = svc.getWeek(svc.newWeek());
  assert.strictEqual(w2.week.date, '2026-12-04');
  assert.strictEqual(Math.min(...w2.invoices.filter((i) => i.series === 'DF').map((i) => i.number)), 512);
  assert.strictEqual(Math.min(...w2.invoices.filter((i) => i.series === 'INV').map((i) => i.number)), 363);
});

test('totals are calculated, with decimals, like the Excel', () => {
  const svc = fresh();
  const w = svc.getWeek(svc.newWeek());
  const chebelDf = w.invoices.find((i) => i.series === 'DF' && i.dorm_no === 7);
  svc.setQty(chebelDf.id, prod(svc, 'Veg-lecho').id, 17.9);   // 17.9 x 90 = 1611 (Excel showed 1610.9999)
  svc.setQty(chebelDf.id, prod(svc, 'Veg-Marg').id, 12.8);    // 12.8 x 150 = 1920
  const total = svc.setQty(chebelDf.id, prod(svc, 'Veg-Pvert').id, 3); // 510
  assert.strictEqual(total, 4041);
});

test('onions cannot go on a DF invoice', () => {
  const svc = fresh();
  const w = svc.getWeek(svc.newWeek());
  const df = w.invoices.find((i) => i.series === 'DF');
  assert.throws(() => svc.setQty(df.id, prod(svc, 'Veg-Oni').id, 10), /INV/);
});

test('printed invoices are locked until the week is unlocked with a reason', () => {
  const svc = fresh();
  const w = svc.getWeek(svc.newWeek());
  const inv = w.invoices.find((i) => i.series === 'INV');
  const oni = prod(svc, 'Veg-Oni').id;
  svc.setQty(inv.id, oni, 25);
  svc.markPrinted([inv.id]);
  assert.throws(() => svc.setQty(inv.id, oni, 30), /locked/);
  assert.throws(() => svc.setWeekPrice(w.week.id, oni, 55), /Unlock/);
  assert.throws(() => svc.unlockWeek(w.week.id, ''), /why/);
  svc.unlockWeek(w.week.id, 'Cook said 30 kg not 25');
  assert.strictEqual(svc.setQty(inv.id, oni, 30), 1500);
  assert.strictEqual(svc.getLog(w.week.id)[0].action, 'unlocked');
});

test('changing a price updates this week only; old weeks keep their prices', () => {
  const svc = fresh();
  const w1 = svc.getWeek(svc.newWeek());
  const voem = prod(svc, 'Veg-Voem').id;
  const a = w1.invoices.find((i) => i.series === 'DF');
  svc.setQty(a.id, voem, 10);                      // 10 x 155
  svc.markPrinted(w1.invoices.map((i) => i.id));
  const w2 = svc.getWeek(svc.newWeek());
  svc.setWeekPrice(w2.week.id, voem, 140);
  const b = w2.invoices.find((i) => i.series === 'DF');
  assert.strictEqual(svc.setQty(b.id, voem, 10), 1400);
  assert.strictEqual(svc.getWeek(w1.week.id).invoices.find((i) => i.id === a.id).total, 1550);
  assert.strictEqual(prod(svc, 'Veg-Voem').price, 140); // next week starts at 140
});

test('only the latest, unprinted week can be deleted', () => {
  const svc = fresh();
  const w1 = svc.newWeek();
  const w2 = svc.newWeek();
  assert.throws(() => svc.deleteWeek(w1), /latest/);
  svc.deleteWeek(w2);
  assert.strictEqual(svc.nextWeekPlan().dfStart, 512);
});

test('the database itself refuses duplicate invoice numbers', () => {
  const store = openNodeSqlite();
  const svc = createService(store);
  const w = svc.getWeek(svc.newWeek());
  assert.throws(() => store.run("INSERT INTO invoices (series, number, week_id, dorm_id) VALUES ('DF', 503, ?, ?)",
    [w.week.id, w.invoices[0].dorm_id]));
});

test('monthly statement adds up weeks, dorms and series', () => {
  const svc = fresh();
  const pdt = prod(svc, 'Veg-PDT').id;
  const brin = prod(svc, 'Veg-Brin').id;
  for (let k = 0; k < 2; k++) {
    const w = svc.getWeek(svc.newWeek());
    for (const inv of w.invoices) {
      if (inv.series === 'DF') svc.setQty(inv.id, brin, 10);   // 600 each
      else svc.setQty(inv.id, pdt, 20);                        // 1000 each
    }
  }
  const nov = svc.monthly('2026-11');
  assert.strictEqual(nov.weeks.length, 1);                     // 27.11 only
  assert.strictEqual(nov.total, 9 * 1600);
  const dec = svc.monthly('2026-12');
  assert.strictEqual(dec.weeks[0].rows[3].dorm, 'Valton');     // statement name
  assert.strictEqual(dec.summary[0].df, 600);
  svc.setPayment('2026-11', { paid_date: '2026-12-05', amount: 14400, reference: 'CHQ 1234' });
  assert.strictEqual(svc.listMonths().find((m) => m.month === '2026-11').payment.reference, 'CHQ 1234');
});

test('settings can move the numbering forward but never backward past used numbers', () => {
  const svc = fresh();
  svc.saveSettings({ last_df: 600 });
  assert.strictEqual(svc.nextWeekPlan().dfStart, 601);
  svc.newWeek();
  svc.saveSettings({ last_df: 100 });
  assert.strictEqual(svc.nextWeekPlan().dfStart, 610);
});

test('a week that was printed can never be deleted, even after unlocking', () => {
  const svc = fresh();
  const w = svc.getWeek(svc.newWeek());
  svc.markPrinted([w.invoices[0].id]);
  svc.unlockWeek(w.week.id, 'fix a quantity');
  assert.strictEqual(svc.getWeek(w.week.id).everPrinted, true);
  assert.throws(() => svc.deleteWeek(w.week.id), /printed/);
});

test('first week can start from chosen numbers, and the next week carries on from them', () => {
  const svc = fresh();
  const w = svc.getWeek(svc.newWeek('2026-11-20', { dfStart: 480, invStart: 400 }));
  assert.strictEqual(w.week.date, '2026-11-20');
  assert.deepStrictEqual(w.invoices.filter((i) => i.series === 'DF').map((i) => i.number), [480, 481, 482, 483, 484, 485, 486, 487, 488]);
  assert.deepStrictEqual(w.invoices.filter((i) => i.series === 'INV').map((i) => i.number), [400, 401, 402, 403, 404, 405, 406, 407, 408]);
  const plan = svc.nextWeekPlan();
  assert.strictEqual(plan.dfStart, 489);
  assert.strictEqual(plan.invStart, 409);
});

test('a chosen starting number cannot reuse numbers already in the app', () => {
  const svc = fresh();
  svc.newWeek(); // DF 503-511
  assert.throws(() => svc.newWeek(undefined, { dfStart: 511 }), /DF must start at 512/);
  assert.throws(() => svc.newWeek(undefined, { invStart: 'abc' }), /whole number/);
  const w = svc.getWeek(svc.newWeek(undefined, { dfStart: 600 }));
  assert.strictEqual(Math.min(...w.invoices.filter((i) => i.series === 'DF').map((i) => i.number)), 600);
  assert.strictEqual(Math.min(...w.invoices.filter((i) => i.series === 'INV').map((i) => i.number)), 363);
});

test('getWeek gives last week\'s quantity per dorm and item, and recently ordered items', () => {
  const svc = fresh();
  const brin = prod(svc, 'Veg-Brin').id;
  const pdt = prod(svc, 'Veg-PDT').id;
  const w1 = svc.getWeek(svc.newWeek());
  assert.deepStrictEqual(w1.lastQty, {});                       // no previous week yet
  const df1 = w1.invoices.find((i) => i.series === 'DF' && i.dorm_no === 2);
  const inv1 = w1.invoices.find((i) => i.series === 'INV' && i.dorm_no === 2);
  svc.setQty(df1.id, brin, 12.5);
  svc.setQty(inv1.id, pdt, 40);
  const w2 = svc.getWeek(svc.newWeek());
  assert.strictEqual(w2.lastQty[`${df1.dorm_id}:${brin}`], 12.5);
  assert.strictEqual(w2.lastQty[`${inv1.dorm_id}:${pdt}`], 40);
  assert.strictEqual(Object.keys(w2.lastQty).length, 2);
  assert.deepStrictEqual(w2.recent.sort(), [brin, pdt].sort());
  // the hint is never saved: this week's invoices are still empty
  assert.ok(w2.invoices.every((i) => i.lines.length === 0));
});

test('copyLastWeek fills only empty boxes of unprinted invoices, at this week\'s prices', () => {
  const svc = fresh();
  const brin = prod(svc, 'Veg-Brin').id;   // DF, Rs 60
  const voem = prod(svc, 'Veg-Voem').id;   // DF
  const pdt = prod(svc, 'Veg-PDT').id;     // INV, Rs 50
  const w1id = svc.newWeek();
  assert.throws(() => svc.copyLastWeek(w1id), /no previous week/);
  const w1 = svc.getWeek(w1id);
  for (const inv of w1.invoices) {
    if (inv.series === 'DF') { svc.setQty(inv.id, brin, 10); svc.setQty(inv.id, voem, 2); } else svc.setQty(inv.id, pdt, 20);
  }
  const w2id = svc.newWeek();
  svc.setWeekPrice(w2id, brin, 70);
  let w2 = svc.getWeek(w2id);
  const belleDf = w2.invoices.find((i) => i.series === 'DF' && i.dorm_no === 1);
  const chebelDf = w2.invoices.find((i) => i.series === 'DF' && i.dorm_no === 7);
  const chebelInv = w2.invoices.find((i) => i.series === 'INV' && i.dorm_no === 7);
  svc.setQty(belleDf.id, brin, 3);                     // already typed: must be kept
  svc.setQty(chebelInv.id, pdt, 5);
  svc.markPrinted([chebelInv.id, chebelDf.id]);        // printed: must not change
  // 9 dorms x 3 boxes = 27, minus Belle-Vue's typed box, minus Chebel's 3 printed boxes (one already typed)
  const r = svc.copyLastWeek(w2id);
  assert.deepStrictEqual(r, { copied: 27 - 1 - 3, from: w1.week.date });
  w2 = svc.getWeek(w2id);
  const line = (invId, p) => w2.invoices.find((i) => i.id === invId).lines.find((l) => l.product_id === p);
  assert.strictEqual(line(belleDf.id, brin).qty, 3);                   // not overwritten
  assert.strictEqual(line(belleDf.id, voem).qty, 2);                   // empty box filled
  assert.strictEqual(w2.invoices.find((i) => i.id === chebelDf.id).lines.length, 0);
  assert.strictEqual(line(chebelInv.id, pdt).qty, 5);
  const coro = w2.invoices.find((i) => i.series === 'DF' && i.dorm_no === 6);
  assert.strictEqual(line(coro.id, brin).unit_price, 70);              // this week's price
  assert.strictEqual(coro.total, 10 * 70 + 2 * prod(svc, 'Veg-Voem').price);
  // running it again copies nothing
  assert.strictEqual(svc.copyLastWeek(w2id).copied, 0);
});

test('products are listed A to Z, ignoring capitals and accents, with numbers in order', () => {
  const svc = fresh();
  svc.saveProduct({ code: 'T10', name: "Pomme D'Amour 10", series: 'DF', price: 1 });
  svc.saveProduct({ code: 'T2', name: "pomme d'amour 2", series: 'DF', price: 1 });
  svc.saveProduct({ code: 'TE', name: 'Épinard', series: 'DF', price: 1 });
  const names = svc.listProducts().map((p) => p.name);
  const at = (n) => names.indexOf(n);
  assert.ok(at("pomme d'amour 2") < at("Pomme D'Amour 10"));
  assert.ok(at('Du Thym') < at('Épinard') && at('Épinard') < at('Giraumon'));
  assert.ok(at('Onions') > at('Margoze') && at('Onions') < at('Patisson'));   // DF and INV mixed, by name
});

// ---------- controlled corrections (Part 3) ----------
function printedWeekWithOrders(svc) {
  const brin = prod(svc, 'Veg-Brin').id;   // DF, Rs 60
  const pdt = prod(svc, 'Veg-PDT').id;     // INV, Rs 50
  const w = svc.getWeek(svc.newWeek());    // 27.11.2026
  const df = w.invoices.find((i) => i.series === 'DF' && i.dorm_no === 3);
  const inv = w.invoices.find((i) => i.series === 'INV' && i.dorm_no === 3);
  svc.setQty(df.id, brin, 10);             // 600
  svc.setQty(inv.id, pdt, 20);             // 1000
  svc.markPrinted([df.id, inv.id]);
  return { w, df, inv, brin, pdt };
}

test('correcting a printed invoice needs a reason, and saves a snapshot of it before the change', () => {
  const svc = fresh();
  const { w, df, brin } = printedWeekWithOrders(svc);
  const voem = prod(svc, 'Veg-Voem').id;
  const edit = [{ invoice_id: df.id, lines: [{ product_id: brin, qty: 12, unit_price: 60 }, { product_id: voem, qty: 2, unit_price: 155 }] }];
  assert.throws(() => svc.correctInvoices(edit, '  '), /what needs correcting/);
  assert.strictEqual(svc.getWeek(w.week.id).invoices.find((i) => i.id === df.id).total, 600);   // nothing saved

  const r = svc.correctInvoices(edit, 'Cook counted 12 kg, and 2 Voem were missing');
  assert.deepStrictEqual(r.map((x) => [x.number, x.changed, x.before_total, x.after_total]), [[505, true, 600, 1030]]);
  const log = svc.getLog(w.week.id).find((c) => c.action === 'corrected');
  const detail = JSON.parse(log.detail);
  assert.strictEqual(detail.reason, 'Cook counted 12 kg, and 2 Voem were missing');
  assert.deepStrictEqual(detail.before, { lines: [{ product_id: brin, code: 'Veg-Brin', name: 'Bringelle', unit: 'Kg', qty: 10, unit_price: 60 }], total: 600 });
  assert.strictEqual(detail.after.total, 1030);

  const after = svc.getWeek(w.week.id).invoices.find((i) => i.id === df.id);
  assert.strictEqual(after.total, 1030);
  assert.strictEqual(after.original_total, 600);
  assert.ok(after.revised_at);
  assert.ok(after.printed_at);                         // still printed (and locked for normal typing)
});

test('a correction never changes invoice numbers, and an unchanged invoice is not logged', () => {
  const svc = fresh();
  const { w, df, inv, brin, pdt } = printedWeekWithOrders(svc);
  const numbersBefore = svc.getWeek(w.week.id).invoices.map((i) => `${i.id}:${i.series}-${i.number}`);
  const r = svc.correctInvoices([
    { invoice_id: df.id, lines: [{ product_id: brin, qty: 10, unit_price: 60 }] },          // same as before
    { invoice_id: inv.id, lines: [{ product_id: pdt, qty: 18, unit_price: 52 }] },
  ], 'price was 52');
  assert.deepStrictEqual(r.map((x) => x.changed), [false, true]);
  const W = svc.getWeek(w.week.id);
  assert.deepStrictEqual(W.invoices.map((i) => `${i.id}:${i.series}-${i.number}`), numbersBefore);
  assert.strictEqual(svc.getLog(w.week.id).filter((c) => c.action === 'corrected').length, 1);
  assert.strictEqual(W.invoices.find((i) => i.id === inv.id).total, 936);
  assert.strictEqual(svc.nextWeekPlan().dfStart, 512);   // numbering carries on as before
  assert.throws(() => svc.correctInvoices([{ invoice_id: inv.id, lines: [{ product_id: brin, qty: 1, unit_price: 60 }] }], 'x'), /DF invoices/);
});

test('editing is blocked in a month marked as paid', () => {
  const svc = fresh();
  const { w, df, brin } = printedWeekWithOrders(svc);
  svc.setPayment('2026-11', { paid_date: '2026-12-05', amount: 1600, reference: 'CHQ 1' });
  const msg = /November is marked as paid\. Undo paid on the Monthly page first\./;
  assert.throws(() => svc.correctInvoices([{ invoice_id: df.id, lines: [] }], 'mistake'), msg);
  assert.throws(() => svc.unlockWeek(w.week.id, 'mistake'), msg);
  assert.throws(() => svc.setWeekPrice(w.week.id, brin, 70), msg);
  const draft = w.invoices.find((i) => i.series === 'DF' && i.dorm_no === 1);
  assert.throws(() => svc.setQty(draft.id, brin, 1), msg);
  svc.setPayment('2026-11', null);                         // undo paid: allowed again
  assert.strictEqual(svc.correctInvoices([{ invoice_id: df.id, lines: [] }], 'nothing delivered')[0].after_total, 0);
});

test('the monthly page knows when an invoice changed after the statement was printed', () => {
  const svc = fresh();
  const { df, brin } = printedWeekWithOrders(svc);
  assert.deepStrictEqual(svc.monthly('2026-11').statement, { printed_at: null, changed_after: false });
  svc.logStatement('2026-11', 'pdf');
  assert.strictEqual(svc.monthly('2026-11').statement.changed_after, false);
  svc.correctInvoices([{ invoice_id: df.id, lines: [{ product_id: brin, qty: 9, unit_price: 60 }] }], 'one kg short');
  assert.strictEqual(svc.monthly('2026-11').statement.changed_after, true);
  svc.logStatement('2026-11', 'print');                    // reprinted: up to date again
  assert.strictEqual(svc.monthly('2026-11').statement.changed_after, false);
});

test('the months list knows the weeks of each month and when its statement was last printed', () => {
  const svc = fresh();
  svc.newWeek(); svc.newWeek();                                  // 27.11 and 04.12
  let nov = svc.listMonths().find((m) => m.month === '2026-11');
  assert.deepStrictEqual(nov.week_dates, ['2026-11-27']);
  assert.strictEqual(nov.statement_printed_at, null);
  svc.logStatement('2026-11');
  const log = svc.getLog(svc.listWeeks()[1].id);                 // statement entries have no invoice
  assert.strictEqual(log.length, 0);
  nov = svc.listMonths().find((m) => m.month === '2026-11');
  assert.ok(nov.statement_printed_at);
  assert.strictEqual(svc.listMonths().find((m) => m.month === '2026-12').statement_printed_at, null);
  assert.strictEqual(svc.monthly('2026-11').statement.printed_at, nov.statement_printed_at);
});

// ---------- receipt format ----------
const formats = require('../main/formats');
const schema = require('../main/schema');
const settingsRows = (store) => Object.fromEntries(store.all('SELECT key, value FROM settings').map((r) => [r.key, JSON.parse(r.value)]));

test('first run saves the default receipt and statement format (the current Modern blue design)', () => {
  const store = openNodeSqlite();
  const svc = createService(store);
  const rows = settingsRows(store);
  assert.deepStrictEqual(rows.receipt_format, formats.DEFAULT_RECEIPT);
  assert.deepStrictEqual(rows.statement_format, formats.DEFAULT_STATEMENT);
  for (const k of formats.OLD_KEYS) assert.ok(!(k in rows), `old key ${k} is not saved`);
  const f = svc.getSettings().receipt_format;
  assert.strictEqual(f.template, 'modern');
  assert.strictEqual(f.color, '#14a9e8');
  assert.strictEqual(f.paper, 'A4');
  assert.strictEqual(f.copies, 'original_copy');
  assert.deepStrictEqual(f.signatures, ['Driver Signature', 'Received By Cook', 'Signature', 'Signature']);
  assert.deepStrictEqual(f.columns.map((c) => c.key), ['no', 'code', 'desc', 'qty', 'uom', 'price', 'amount']);
  assert.ok(f.columns.every((c) => c.on));
});

test('old receipt settings are moved into receipt_format on first run, then removed', () => {
  const store = openNodeSqlite();
  store.exec(schema);
  const old = {
    company_name: 'DAILY FRESHER LTD', customer_name: 'GAMMA CONSTRUCTION LTD', last_df: 600, last_inv: 400, last_date: '2026-11-20',
    color: '#2F7D4A', note: 'No returns.', acknowledgment: 'Received in good order.', signature_labels: ['Driver', 'Cook', 'Manager'],
    footer_text: 'Thank you', show_footer: false, show_part_payment: false, print_copy: false,
  };
  for (const [k, v] of Object.entries(old)) store.run('INSERT INTO settings (key, value) VALUES (?, ?)', [k, JSON.stringify(v)]);
  const svc = createService(store);
  const f = svc.getSettings().receipt_format;
  assert.strictEqual(f.color, '#2f7d4a');
  assert.strictEqual(f.note, 'No returns.');
  assert.strictEqual(f.acknowledgment, 'Received in good order.');
  assert.deepStrictEqual(f.signatures, ['Driver', 'Cook', 'Manager']);
  assert.strictEqual(f.footer, 'Thank you');
  assert.strictEqual(f.show.footer, false);
  assert.strictEqual(f.show.part_payment, false);
  assert.strictEqual(f.copies, 'original');
  assert.strictEqual(f.template, 'modern');          // everything else stays as it was
  assert.strictEqual(f.paper, 'A4');
  assert.strictEqual(f.show.badge, true);
  assert.strictEqual(svc.getSettings().statement_format.color, '#2f7d4a');
  const rows = settingsRows(store);
  for (const k of formats.OLD_KEYS) assert.ok(!(k in rows), `old key ${k} removed`);
  assert.strictEqual(rows.company_name, 'DAILY FRESHER LTD');   // other settings untouched
  assert.strictEqual(svc.nextWeekPlan().dfStart, 601);
  // opening again changes nothing
  createService(store);
  assert.deepStrictEqual(settingsRows(store).receipt_format, rows.receipt_format);
});

test('saving a receipt format checks it', () => {
  const svc = fresh();
  const f = svc.getSettings().receipt_format;
  assert.throws(() => svc.saveSettings({ receipt_format: { ...f, logo: 'data:text/html;base64,AAAA' } }), /PNG or JPG/);
  assert.throws(() => svc.saveSettings({ receipt_format: { ...f, signatures: ['1', '2', '3', '4', '5', '6', '7'] } }), /6 signature/);
  const cols = f.columns.map((c) => ({ ...c, on: false })).reverse();
  const saved = svc.saveSettings({ receipt_format: { ...f, template: 'fancy', paper: 'A5', columns: cols, signatures: [], title: 'Invoice' } }).receipt_format;
  assert.strictEqual(saved.template, 'modern');
  assert.strictEqual(saved.paper, 'A5');
  assert.deepStrictEqual(saved.signatures, []);
  assert.strictEqual(saved.title, 'Invoice');
  assert.deepStrictEqual(saved.columns.map((c) => c.key), ['amount', 'price', 'uom', 'qty', 'desc', 'code', 'no']);
  assert.deepStrictEqual(saved.columns.filter((c) => c.on).map((c) => c.key), ['amount', 'desc']);   // always shown
  const png = 'data:image/png;base64,iVBORw0KGgo=';
  assert.strictEqual(svc.saveSettings({ receipt_format: { ...saved, logo: png } }).receipt_format.logo, png);
});
