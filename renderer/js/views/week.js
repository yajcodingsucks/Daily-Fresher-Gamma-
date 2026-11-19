// "This Week": one grid with every vegetable down the side and every dorm across the top.

window.Views = window.Views || {};

Views.week = {
  hideEmpty: false,

  async render(main) {
    const S = App.state;
    if (!S.weeks.length) return Views.week.renderEmpty(main);
    const W = await API.getWeek(App.weekId);
    App.W = W;
    const tab = App.tab;
    const dfs = W.invoices.filter((i) => i.series === 'DF');
    const invs = W.invoices.filter((i) => i.series === 'INV');
    const range = (list) => list.length ? `${list[0].series}-${list[0].number} → ${list[0].series}-${list[list.length - 1].number}` : '';
    const printed = W.invoices.filter((i) => i.printed_at).length;
    const status = printed === 0 ? '<span class="pill wait">Draft</span>'
      : printed === W.invoices.length ? '<span class="pill ok">Printed</span>'
        : `<span class="pill lock">Printed ${printed} of ${W.invoices.length}</span>`;
    const sumOf = (list) => list.reduce((s, i) => s + i.total, 0);

    main.innerHTML = `
<div class="top">
  <div>
    <h2><button class="icon-btn" id="prevW" ${W.prev ? '' : 'disabled'} title="Previous week">‹</button>
      Week of ${U.date(W.week.date)}
      <button class="icon-btn" id="nextW" ${W.next ? '' : 'disabled'} title="Next week">›</button> ${status}</h2>
    <div class="sub">${range(dfs)} &nbsp;·&nbsp; ${range(invs)} &nbsp;·&nbsp; numbers and date filled in automatically</div>
  </div>
  <div class="actions">
    ${W.isLatest ? '<button class="btn" id="newW">＋ Start next week</button>' : ''}
    <button class="btn" id="preview">👁 Preview invoices</button>
    <button class="btn" id="pdfAll">📄 Save all as PDF</button>
    <button class="btn p big" id="printAll">🖨 Print all${S.settings.print_copy ? ' (Original + Copy)' : ''}</button>
  </div>
</div>
${printed ? `<div class="lockbox"><span>🔒 Printed invoices are locked so they can't be changed by accident.</span>
  <button class="btn sm" id="unlock">Unlock to correct</button></div>` : ''}
<div class="toolbar">
  <div class="tabs">
    <button data-tab="DF" class="${tab === 'DF' ? 'on' : ''}">DF · Vegetables<span class="count">Rs ${U.money(sumOf(dfs))}</span></button>
    <button data-tab="INV" class="${tab === 'INV' ? 'on' : ''}">INV · Onions &amp; Potatoes<span class="count">Rs ${U.money(sumOf(invs))}</span></button>
  </div>
  <div>
    <label class="check"><input type="checkbox" id="hideEmpty" ${Views.week.hideEmpty ? 'checked' : ''}> Hide items nobody ordered</label>
    ${W.isLatest && !W.everPrinted ? '<button class="btn sm danger" id="delW" style="margin-left:10px">Delete this week</button>' : ''}
  </div>
</div>
<div id="warnings"></div>
<div class="table-wrap grid-wrap"><table class="grid" id="grid"></table></div>`;

    Views.week.renderGrid();
    Views.week.bind(main);
  },

  renderGrid() {
    const W = App.W;
    const tab = App.tab;
    const invs = W.invoices.filter((i) => i.series === tab).sort((a, b) => a.dorm_no - b.dorm_no);
    const qty = new Map();
    for (const inv of invs) for (const l of inv.lines) qty.set(`${inv.id}:${l.product_id}`, l.qty);
    let prods = W.products.filter((p) => p.series === tab);
    if (Views.week.hideEmpty) prods = prods.filter((p) => invs.some((i) => qty.has(`${i.id}:${p.id}`)));
    const seriesLocked = invs.some((i) => i.printed_at);

    const head = `<thead><tr><th style="min-width:150px">Item</th><th class="r">Price (Rs)</th>
      ${invs.map((i) => `<th class="dorm" data-open="${i.dorm_no}" title="${U.esc(i.dorm_name)} — click to view invoice"><b>${i.dorm_no}</b><small>${U.esc(Views.week.short(i.dorm_name))}</small>
        <small>${i.series}-${i.number}${i.printed_at ? ' 🔒' : ''}</small></th>`).join('')}
      <th class="r">Total qty</th></tr></thead>`;

    const body = prods.map((p, r) => {
      const price = W.prices[p.id] ?? p.price;
      const prev = W.prevPrices[p.id];
      const chg = prev === undefined || prev === price ? ''
        : `<span class="chg ${price > prev ? 'up' : 'down'}">${price > prev ? '▲' : '▼'} was ${U.money(prev)}</span>`;
      const cells = invs.map((inv, c) => {
        const q = qty.get(`${inv.id}:${p.id}`);
        return `<td class="c"><input class="q ${q ? 'has' : ''}" data-inv="${inv.id}" data-p="${p.id}" data-r="${r}" data-c="${c}"
          value="${U.qty(q)}" ${inv.printed_at ? 'disabled' : ''} inputmode="decimal"></td>`;
      }).join('');
      const rowQty = invs.reduce((s, inv) => s + (qty.get(`${inv.id}:${p.id}`) || 0), 0);
      return `<tr><td class="item"><b>${U.esc(p.name)}</b><small>${U.esc(p.code)} · ${U.esc(p.unit)}${p.active ? '' : ' · inactive'}</small></td>
        <td class="r"><input class="price" data-p="${p.id}" value="${price.toFixed(2)}" ${seriesLocked ? 'disabled' : ''} inputmode="decimal">${chg}</td>
        ${cells}<td class="r" id="rq-${p.id}">${U.qty(rowQty) || '<span class="muted">–</span>'}</td></tr>`;
    }).join('') || `<tr><td colspan="${invs.length + 3}" class="muted c" style="padding:30px">No items. Add them in Products &amp; Prices.</td></tr>`;

    const extra = `
      <tr class="extra"><td class="muted">Vehicle</td><td></td>${invs.map((i) => `<td><input class="veh" data-inv="${i.id}" data-dorm="${i.dorm_id}"
        value="${U.esc(i.vehicle)}" ${i.printed_at ? 'disabled' : ''}></td>`).join('')}<td></td></tr>
      <tr class="extra"><td class="muted">Invoice</td><td></td>${invs.map((i) => `<td class="c"><button class="btn sm" data-open="${i.dorm_no}">View</button></td>`).join('')}<td></td></tr>`;
    const foot = `<tfoot><tr class="total"><td>Total (Rs)</td><td></td>${invs.map((i) => `<td class="c">${U.money(i.total)}</td>`).join('')}
        <td class="r">${U.money(invs.reduce((s, i) => s + i.total, 0))}</td></tr></tfoot>`;

    U.$('#grid').innerHTML = head + `<tbody>${body}${extra}</tbody>` + foot;
    Views.week.renderWarnings();
  },

  short(name) {
    return name.replace('Long Mountain', 'L. Mountain').replace('Bangladesh', 'Bangl.').replace('Nepalese', 'Nepal.');
  },

  warnings() {
    const W = App.W;
    const out = [];
    const flagged = new Set();
    const byId = new Map(W.products.map((p) => [p.id, p]));
    for (const inv of W.invoices) {
      const label = `${inv.dorm_name} (${inv.series}-${inv.number})`;
      if (!inv.lines.length) out.push({ series: inv.series, text: `${label} has no items yet.` });
      for (const l of inv.lines) {
        const p = byId.get(l.product_id);
        const usual = W.usual[`${inv.dorm_id}:${l.product_id}`];
        if (usual && l.qty > usual * 3) {
          out.push({ series: inv.series, text: `${label}: ${U.qty(l.qty)} ${p.unit} of ${p.name} — usually about ${U.qty(usual)}.` });
          flagged.add(`${inv.id}:${l.product_id}`);
        }
        if (!l.unit_price) {
          out.push({ series: inv.series, text: `${p.name} has no price this week.` });
          flagged.add(`price:${l.product_id}`);
        }
      }
    }
    const seen = new Set();
    return { list: out.filter((w) => !seen.has(w.text) && seen.add(w.text)), flagged };
  },

  renderWarnings() {
    const { list, flagged } = Views.week.warnings();
    const here = list.filter((w) => w.series === App.tab);
    const other = list.length - here.length;
    U.$$('#grid .q').forEach((i) => i.classList.toggle('warn', flagged.has(`${i.dataset.inv}:${i.dataset.p}`)));
    U.$$('#grid .price').forEach((i) => i.classList.toggle('warn', flagged.has(`price:${i.dataset.p}`)));
    const box = U.$('#warnings');
    if (!here.length && !other) { box.innerHTML = ''; return; }
    const shown = here.slice(0, 6);
    box.innerHTML = `<div class="warnbox">⚠ Check before printing:
      <ul>${shown.map((w) => `<li>${U.esc(w.text)}</li>`).join('')}
      ${here.length > shown.length ? `<li>…and ${here.length - shown.length} more</li>` : ''}
      ${other ? `<li>${other} more on the ${App.tab === 'DF' ? 'INV' : 'DF'} tab</li>` : ''}</ul></div>`;
  },

  // After a save: reload the week and refresh totals without losing the cursor position.
  async reload() {
    App.W = await API.getWeek(App.weekId);
    const W = App.W;
    const tab = App.tab;
    const invs = W.invoices.filter((i) => i.series === tab).sort((a, b) => a.dorm_no - b.dorm_no);
    const totals = U.$$('#grid tfoot tr.total td');
    invs.forEach((inv, k) => { totals[k + 2].textContent = U.money(inv.total); });
    totals[totals.length - 1].textContent = U.money(invs.reduce((s, i) => s + i.total, 0));
    for (const p of W.products.filter((x) => x.series === tab)) {
      const cell = U.$(`#rq-${p.id}`);
      if (!cell) continue;
      const q = invs.reduce((s, inv) => s + ((inv.lines.find((l) => l.product_id === p.id) || {}).qty || 0), 0);
      cell.innerHTML = U.qty(q) || '<span class="muted">–</span>';
    }
    const sum = (s) => W.invoices.filter((i) => i.series === s).reduce((a, i) => a + i.total, 0);
    U.$('[data-tab="DF"] .count').textContent = `Rs ${U.money(sum('DF'))}`;
    U.$('[data-tab="INV"] .count').textContent = `Rs ${U.money(sum('INV'))}`;
    Views.week.renderWarnings();
  },

  bind(main) {
    const W = App.W;
    U.$('#prevW').onclick = () => { App.weekId = W.prev.id; App.go('week'); };
    U.$('#nextW').onclick = () => { App.weekId = W.next.id; App.go('week'); };
    U.$$('[data-tab]', main).forEach((b) => { b.onclick = () => { App.tab = b.dataset.tab; App.go('week'); }; });
    U.$('#hideEmpty').onchange = (e) => { Views.week.hideEmpty = e.target.checked; Views.week.renderGrid(); };
    U.$('#preview').onclick = () => { App.sel.series = App.tab; App.go('invoice'); };
    if (U.$('#newW')) U.$('#newW').onclick = Views.week.startNext;
    if (U.$('#delW')) U.$('#delW').onclick = Views.week.deleteWeek;
    if (U.$('#unlock')) U.$('#unlock').onclick = Views.week.unlock;
    U.$('#printAll').onclick = () => Views.week.printAll('print');
    U.$('#pdfAll').onclick = () => Views.week.printAll('pdf');

    const grid = U.$('#grid');
    grid.addEventListener('click', (e) => {
      const b = e.target.closest('[data-open]');
      if (b) { App.sel = { series: App.tab, dormNo: Number(b.dataset.open) }; App.go('invoice'); }
    });
    grid.addEventListener('focusin', (e) => { if (e.target.matches('.q,.price')) e.target.select(); });
    grid.addEventListener('keydown', (e) => {
      const t = e.target;
      if (!t.matches('.q')) return;
      const move = { Enter: 1, ArrowDown: 1, ArrowUp: -1 }[e.key];
      if (!move) return;
      e.preventDefault();
      const next = U.$(`.q[data-r="${Number(t.dataset.r) + move}"][data-c="${t.dataset.c}"]`, grid);
      if (next && !next.disabled) next.focus(); else t.blur();
    });
    grid.addEventListener('change', async (e) => {
      const t = e.target;
      if (t.matches('.q')) {
        const v = U.num(t.value);
        if (Number.isNaN(v) || v < 0) { U.toast('Please type a number, like 12 or 12.5', 'err'); t.value = ''; return; }
        const ok = await App.run(() => API.setQty(Number(t.dataset.inv), Number(t.dataset.p), v));
        if (ok === undefined) return Views.week.reload().then(() => Views.week.renderGrid());
        t.value = U.qty(v);
        t.classList.toggle('has', v > 0);
        await Views.week.reload();
      } else if (t.matches('.price')) {
        const v = U.num(t.value);
        if (Number.isNaN(v) || v < 0) { U.toast('Please type a price, like 85 or 85.50', 'err'); return Views.week.renderGrid(); }
        const ok = await App.run(() => API.setWeekPrice(App.weekId, Number(t.dataset.p), v));
        await Views.week.reload();
        if (ok !== undefined) { t.value = v.toFixed(2); App.state = await API.bootstrap(); }
        Views.week.renderGrid();
      } else if (t.matches('.veh')) {
        // Same vehicle for the dorm's DF and INV invoice.
        const dormId = Number(t.dataset.dorm);
        for (const inv of App.W.invoices.filter((i) => i.dorm_id === dormId && !i.printed_at)) {
          await App.run(() => API.setInvoiceFields(inv.id, { vehicle: t.value }));
        }
        await Views.week.reload();
      }
    });
  },

  async printAll(mode) {
    const W = App.W;
    const ordered = [...W.invoices].sort((a, b) => (a.dorm_no - b.dorm_no) || (a.series === 'DF' ? -1 : 1));
    const withItems = ordered.filter((i) => i.lines.length);
    const empty = ordered.filter((i) => !i.lines.length);
    if (empty.length) {
      const ok = await U.confirm('Some invoices are empty',
        `${empty.map((i) => `${i.series}-${i.number} (${U.esc(i.dorm_name)})`).join(', ')} have no items and will not be printed. Continue?`, 'Print the rest');
      if (!ok) return;
    }
    const labels = App.state.settings.print_copy ? ['ORIGINAL', 'COPY'] : ['ORIGINAL'];
    if (await App.printInvoices(W, withItems, labels, mode)) { await App.refresh(); App.go('week'); }
  },

  async startNext() {
    const plan = await API.nextWeekPlan();
    const last = plan.dfStart + plan.dormCount - 1;
    const lastI = plan.invStart + plan.dormCount - 1;
    const v = await U.modal({
      title: 'Start a new week',
      text: `This creates ${plan.dormCount * 2} invoices: <b>DF-${plan.dfStart} → DF-${last}</b> and <b>INV-${plan.invStart} → INV-${lastI}</b>.<br>
        The date is 7 days after the last week. Change it only if the delivery day moved.`,
      fields: [{ name: 'date', label: 'Delivery date', type: 'date', value: plan.date }],
      ok: 'Start week',
    });
    if (!v) return;
    const id = await App.run(() => API.newWeek(v.date), 'New week started.');
    if (id) { App.weekId = id; await App.refresh(); App.weekId = id; App.tab = 'DF'; App.go('week'); }
  },

  async deleteWeek() {
    const ok = await U.confirm('Delete this week?', 'All quantities typed for this week will be removed and its invoice numbers will be used again next time.', 'Delete', true);
    if (!ok) return;
    if (await App.run(() => API.deleteWeek(App.weekId), 'Week deleted.')) { App.weekId = null; await App.refresh(); App.go('week'); }
  },

  async unlock() {
    const v = await U.modal({
      title: 'Unlock printed invoices',
      text: 'Only do this to correct a mistake. The reason is saved with the invoices, and you will need to print them again.',
      fields: [{ name: 'reason', label: 'What needs correcting?', type: 'textarea' }],
      ok: 'Unlock',
    });
    if (!v) return;
    if (await App.run(() => API.unlockWeek(App.weekId, v.reason), 'Week unlocked.')) { await App.refresh(); App.go('week'); }
  },

  renderEmpty(main) {
    const p = App.state.plan;
    main.innerHTML = `<div class="empty"><div class="card">
      <h2 style="margin-top:0">Start your first week</h2>
      <p class="muted">The numbers carry on from your last Excel invoices. You can change the starting numbers in Settings.</p>
      <div class="plan"><div><span>Date</span><b>${U.date(p.date)}</b></div>
        <div><span>DF</span><b>${p.dfStart} → ${p.dfStart + p.dormCount - 1}</b></div>
        <div><span>INV</span><b>${p.invStart} → ${p.invStart + p.dormCount - 1}</b></div></div>
      <button class="btn p big" id="first">Start week of ${U.date(p.date)}</button></div></div>`;
    U.$('#first').onclick = Views.week.startNext;
  },
};
