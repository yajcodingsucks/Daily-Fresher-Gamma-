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
