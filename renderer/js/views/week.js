// "This Week": one grid for the whole week. Onions & potatoes (INV) on top, vegetables (DF) below,
// every dorm across the top, totals and vehicles pinned to the bottom.

window.Views = window.Views || {};

const SECTIONS = [
  { series: 'INV', label: 'INV · Onions & Potatoes' },
  { series: 'DF', label: 'DF · Vegetables' },
];

Views.week = {
  showAll: false, // show items nobody has ordered lately

  async render(main) {
    const S = App.state;
    if (!S.weeks.length) return Views.week.renderEmpty(main);
    const W = await API.getWeek(App.weekId);
    App.W = W;
    const range = (s) => {
      const list = W.invoices.filter((i) => i.series === s).map((i) => i.number);
      return list.length ? `${s}-${Math.min(...list)} → ${s}-${Math.max(...list)}` : '';
    };
    const printed = W.invoices.some((i) => i.printed_at);

    main.innerHTML = `
${W.isLatest ? '' : `<div class="oldweek"><span>✏️ You are editing an old week: <b>${U.date(W.week.date)}</b></span>
  <button class="btn sm" id="backHist">← Back to History</button></div>`}
<div class="top">
  <div>
    <h2>Week of ${U.date(W.week.date)} <span id="wstatus"></span></h2>
    <div class="sub">${range('DF')} &nbsp;·&nbsp; ${range('INV')}</div>
  </div>
  <div class="actions">
    <button class="btn" id="copyLast" ${W.prev && !W.paid ? '' : 'disabled'}
      title="${W.prev ? `Fill empty boxes with the orders of ${U.date(W.prev.date)}` : 'There is no previous week'}">⟲ Copy last week's orders</button>
    <button class="btn" id="preview">👁 Preview</button>
    <button class="btn p big" id="printAll">🖨 Print all</button>
    <div class="more">
      <button class="btn" id="moreBtn">⋯ More</button>
      <div class="menu hidden" id="moreMenu">
        ${W.isLatest ? '<button data-act="next">＋ Start next week</button>' : ''}
        <button data-act="pdf">📄 Save all as PDF</button>
        ${printed && !W.paid ? '<button data-act="unlock">🔓 Unlock printed invoices</button>' : ''}
        ${W.isLatest && !W.everPrinted ? '<button data-act="delete" class="danger">🗑 Delete this week</button>' : ''}
      </div>
    </div>
  </div>
</div>
<div class="legend">
  <span><i class="key inv"></i>INV · Onions &amp; Potatoes</span>
  <span><i class="key df"></i>DF · Vegetables</span>
  <span><i class="hint">12</i> grey number = last week (only a hint, not saved)</span>
  <span>Enter ↓ · Tab → · Shift+Tab ←</span>
  ${W.paid ? `<span>🔒 ${U.monthName(W.week.date.slice(0, 7)).split(' ')[0]} is marked as paid: undo paid on the Monthly page to change it</span>`
    : printed ? '<span>🔒 Printed invoices are locked (⋯ More → Unlock to correct)</span>' : ''}
</div>
<div class="table-wrap grid-wrap"><table class="grid" id="grid"></table></div>`;

    Views.week.renderGrid();
    Views.week.bind(main);
  },

  // One entry per dorm with its DF and INV invoice and how far typing has got.
  dorms(W) {
    const by = new Map();
    for (const inv of W.invoices) {
      if (!by.has(inv.dorm_id)) by.set(inv.dorm_id, { dorm_id: inv.dorm_id, no: inv.dorm_no, name: inv.dorm_name, DF: null, INV: null });
      by.get(inv.dorm_id)[inv.series] = inv;
    }
    return [...by.values()].sort((a, b) => a.no - b.no).map((d) => {
      const df = !!(d.DF && d.DF.lines.length);
      const iv = !!(d.INV && d.INV.lines.length);
      return { ...d, state: df && iv ? 'done' : df || iv ? 'typing' : 'none' };
    });
  },

  badge(state) {
    return { done: '<span class="badge done">✓ Done</span>', typing: '<span class="badge typing">✎ Typing…</span>',
      none: '<span class="badge none">Not started</span>' }[state];
  },

  statusPill(W) {
    const D = Views.week.dorms(W);
    const done = D.filter((d) => d.state === 'done').length;
    const withItems = W.invoices.filter((i) => i.lines.length);
    const allPrinted = withItems.length > 0 && withItems.every((i) => i.printed_at);
    if (W.paid && allPrinted) return '<span class="pill ok">✓ Paid</span>';
    if (allPrinted && W.past) return '<span class="pill imported">📥 Imported</span>';
    if (allPrinted) return '<span class="pill lock">🔒 Printed</span>';
    if (W.past && W.past.entering) return `<span class="pill wait">Entering past week · ${done} of ${D.length} dorms done</span>`;
    if (D.length && done === D.length) return '<span class="pill ok">Ready to print</span>';
    return `<span class="pill wait">Entering orders · ${done} of ${D.length} dorms done</span>`;
  },

  short(name) {
    return name.replace('Long Mountain', 'L. Mountain').replace('Bangladesh', 'Bangl.').replace('Nepalese', 'Nepal.');
  },

  // Which items to show: priced and ordered in the last 4 weeks, or ordered this week.
  // With no order history at all yet (first week), every priced item counts as used.
  isUsed(p, W, qty) {
    if (W.invoices.some((i) => qty.has(`${i.id}:${p.id}`))) return true;
    const priced = (W.prices[p.id] ?? p.price) > 0;
    return priced && (W.recent.length ? W.recent.includes(p.id) : true);
  },

  renderGrid() {
    const W = App.W;
    const D = Views.week.dorms(W);
    const qty = new Map();
    for (const inv of W.invoices) for (const l of inv.lines) qty.set(`${inv.id}:${l.product_id}`, l.qty);
    const cols = D.length + 3;

    let r = 0;
    let hiddenCount = 0;
    let unusedCount = 0;
    const body = SECTIONS.map(({ series, label }) => {
      const all = W.products.filter((p) => p.series === series).sort(U.byProduct);
      const used = all.filter((p) => Views.week.isUsed(p, W, qty));
      unusedCount += all.length - used.length;
      const shown = Views.week.showAll ? all : used;
      hiddenCount += all.length - shown.length;
      const locked = W.paid || W.invoices.some((i) => i.series === series && i.printed_at && i.lines.length);
      const rows = shown.map((p) => {
        const price = W.prices[p.id] ?? p.price;
        const prev = W.prevPrices[p.id];
        const chg = prev === undefined || prev === price ? ''
          : `<span class="chg ${price > prev ? 'up' : 'down'}">${price > prev ? '▲' : '▼'} was ${U.money(prev)}</span>`;
        const row = r++;
        const cells = D.map((d, c) => {
          const inv = d[series];
          if (!inv) return `<td data-c="${c}"></td>`;
          const q = qty.get(`${inv.id}:${p.id}`);
          const hint = W.lastQty[`${d.dorm_id}:${p.id}`];
          return `<td class="c" data-c="${c}"><input class="q ${series.toLowerCase()} ${q ? 'has' : ''}" data-inv="${inv.id}" data-p="${p.id}"
            data-r="${row}" data-c="${c}" value="${U.qty(q)}" placeholder="${hint ? U.qty(hint) : ''}" ${inv.printed_at || W.paid ? 'disabled' : ''}
            inputmode="decimal" autocomplete="off"></td>`;
        }).join('');
        return `<tr class="row-${series}" data-p="${p.id}" data-s="${series}">
          <td class="item col-item"><b>${U.esc(p.name)}</b><small>${U.esc(p.code)} · ${U.esc(p.unit)}${p.active ? '' : ' · inactive'}</small></td>
          <td class="r col-price"><input class="price" data-p="${p.id}" value="${price.toFixed(2)}" ${locked ? 'disabled' : ''} inputmode="decimal">${chg}</td>
          ${cells}<td class="col-total tq"></td></tr>`;
      }).join('');
      return `<tr class="sec sec-${series}"><td colspan="${cols}"><span>${label}</span></td></tr>${rows
        || `<tr><td colspan="${cols}" class="muted"><span class="stick">No ${series} items in use${all.length ? ' (show more below)' : '. Add them in Products &amp; Prices.'}</span></td></tr>`}`;
    }).join('');

    const toggle = Views.week.showAll
      ? (unusedCount ? `<tr class="more-row"><td colspan="${cols}"><span class="stick"><button class="btn sm" id="toggleUnused">Hide unused items</button></span></td></tr>` : '')
      : (hiddenCount ? `<tr class="more-row"><td colspan="${cols}"><span class="stick"><button class="btn sm" id="toggleUnused">＋ Show ${hiddenCount} more item${hiddenCount === 1 ? '' : 's'}</button>
          <span class="muted small">not ordered in the last 4 weeks or no price</span></span></td></tr>` : '');

    const head = `<thead><tr><th class="col-item">Item</th><th class="r col-price">Price (Rs)</th>
      ${D.map((d, c) => `<th class="dorm" data-open="${d.no}" data-c="${c}" title="${U.esc(d.name)} — click to open the invoice">
        <b>${d.no} · ${U.esc(Views.week.short(d.name))}</b>
        <small>${d.DF ? `DF-${d.DF.number}${d.DF.printed_at ? ' 🔒' : ''}` : ''}</small>
        <small>${d.INV ? `INV-${d.INV.number}${d.INV.printed_at ? ' 🔒' : ''}` : ''}</small>
        <span class="bslot">${Views.week.badge(d.state)}</span></th>`).join('')}
      <th class="col-total">Total qty</th></tr></thead>`;

    const vehicle = (d) => (d.DF || d.INV).vehicle;
    const allLocked = (d) => W.paid || [d.DF, d.INV].filter(Boolean).every((i) => i.printed_at);
    const foot = `<tfoot>
      <tr class="ft ft-DF"><td class="col-item">DF total (Rs)</td><td class="col-price"></td>
        ${D.map((d, c) => `<td class="c amt" data-c="${c}" data-ft="DF:${c}"></td>`).join('')}<td class="col-total" data-ft="DF:all"></td></tr>
      <tr class="ft ft-INV"><td class="col-item">INV total (Rs)</td><td class="col-price"></td>
        ${D.map((d, c) => `<td class="c amt" data-c="${c}" data-ft="INV:${c}"></td>`).join('')}<td class="col-total" data-ft="INV:all"></td></tr>
      <tr class="ft ft-veh"><td class="col-item muted">Vehicle</td><td class="col-price"></td>
        ${D.map((d, c) => `<td data-c="${c}"><input class="veh" data-dorm="${d.dorm_id}" value="${U.esc(vehicle(d))}"
          ${allLocked(d) ? 'disabled' : ''} title="Saved on the DF and INV invoice of ${U.esc(d.name)}"></td>`).join('')}<td class="col-total"></td></tr>
    </tfoot>`;

    U.$('#grid').innerHTML = head + `<tbody>${body}${toggle}</tbody>` + foot;
    Views.week.liveTotals();
    Views.week.refreshStatus();
    Views.week.markWarnings();
    Views.week.pin();
  },

  // Sticky offsets that depend on rendered sizes: the Price column sits right after the Item
  // column, and each footer row sits on top of the rows below it.
  pin() {
    const grid = U.$('#grid');
    if (!grid || !grid.tFoot) return;
    const item = U.$('thead .col-item', grid);
    grid.style.setProperty('--item-w', `${item.getBoundingClientRect().width}px`);
    let bottom = 0;
    for (const tr of [...grid.tFoot.rows].reverse()) {
      for (const td of tr.cells) td.style.bottom = `${bottom}px`;
      bottom += tr.getBoundingClientRect().height;
    }
  },

  // Row totals (qty) and footer totals (Rs), worked out from what is typed right now, so they
  // change while typing, before anything is saved.
  liveTotals() {
    const grid = U.$('#grid');
    if (!grid) return;
    const sums = {};
    for (const tr of U.$$('tbody tr[data-p]', grid)) {
      const s = tr.dataset.s;
      const price = U.num(U.$('.price', tr).value);
      let rowQty = 0;
      for (const inp of U.$$('.q', tr)) {
        const v = U.num(inp.value);
        if (!(v > 0)) continue;
        rowQty += v;
        const k = `${s}:${inp.dataset.c}`;
        sums[k] = (sums[k] || 0) + (Number.isNaN(price) ? 0 : Math.round(v * price * 100) / 100);
      }
      U.$('.tq', tr).textContent = rowQty ? U.qty(rowQty) : '–';
    }
    for (const s of ['DF', 'INV']) {
      let all = 0;
      for (const td of U.$$(`[data-ft^="${s}:"]`, grid)) {
        const c = td.dataset.ft.split(':')[1];
        if (c === 'all') continue;
        const v = sums[`${s}:${c}`] || 0;
        all += v;
        td.textContent = v ? U.money(v) : '–';
      }
      U.$(`[data-ft="${s}:all"]`, grid).textContent = U.money(all);
    }
  },

  // Dorm badges and the week status pill, from the saved data.
  refreshStatus() {
    const W = App.W;
    const D = Views.week.dorms(W);
    U.$$('#grid th.dorm').forEach((th, c) => { U.$('.bslot', th).innerHTML = Views.week.badge(D[c].state); });
    const pill = U.$('#wstatus');
    if (pill) pill.innerHTML = Views.week.statusPill(W);
  },

  // Problems worth a second look before printing.
  warnings() {
    const W = App.W;
    const byId = new Map(W.products.map((p) => [p.id, p]));
    const out = { empty: [], prices: [], big: [], noPrice: [], flagged: new Set() };
    const ordered = [...W.invoices].sort((a, b) => (a.dorm_no - b.dorm_no) || (a.series === 'DF' ? -1 : 1));
    const usedIds = new Set();
    for (const inv of ordered) {
      const label = `${inv.dorm_name} (${inv.series}-${inv.number})`;
      if (!inv.lines.length) out.empty.push(label);
      for (const l of inv.lines) {
        usedIds.add(l.product_id);
        const p = byId.get(l.product_id);
        const usual = W.usual[`${inv.dorm_id}:${l.product_id}`];
        if (usual && l.qty > usual * 3) {
          out.big.push(`${label}: ${U.qty(l.qty)} ${p.unit} of ${p.name} — usually about ${U.qty(usual)}`);
          out.flagged.add(`${inv.id}:${l.product_id}`);
        }
      }
    }
    for (const id of usedIds) {
      const p = byId.get(id);
      const now = W.prices[id] ?? p.price;
      const before = W.prevPrices[id];
      if (!now) { out.noPrice.push(`${p.name} has no price this week`); out.flagged.add(`price:${id}`); }
      if (before > 0 && Math.abs(now - before) / before > 0.3) {
        const pct = Math.round(((now - before) / before) * 100);
        out.prices.push(`${p.name}: Rs ${U.money(before)} → Rs ${U.money(now)} (${pct > 0 ? '+' : ''}${pct}%)`);
        out.flagged.add(`price:${id}`);
      }
    }
    return out;
  },

  markWarnings() {
    const { flagged } = Views.week.warnings();
    U.$$('#grid .q').forEach((i) => i.classList.toggle('warn', flagged.has(`${i.dataset.inv}:${i.dataset.p}`)));
    U.$$('#grid .price').forEach((i) => i.classList.toggle('warn', flagged.has(`price:${i.dataset.p}`)));
  },

  // After a save: reload the week and refresh figures without touching the inputs (keeps the cursor).
  async reload() {
    App.W = await API.getWeek(App.weekId);
    Views.week.liveTotals();
    Views.week.refreshStatus();
    Views.week.markWarnings();
  },

  // Next box to move to from (r, c): down/up by dr, or right/left by dc (wrapping to the next/previous row).
  findCell(r, c, dr, dc) {
    const cells = new Map(U.$$('#grid .q').map((i) => [`${i.dataset.r}:${i.dataset.c}`, i]));
    const maxR = Math.max(-1, ...U.$$('#grid .q').map((i) => Number(i.dataset.r)));
    const maxC = Math.max(-1, ...U.$$('#grid .q').map((i) => Number(i.dataset.c)));
    for (let n = 0; n < (maxR + 1) * (maxC + 1); n++) {
      if (dc) {
        c += dc;
        if (c > maxC) { c = 0; r++; }
        if (c < 0) { c = maxC; r--; }
      } else r += dr;
      if (r < 0 || r > maxR) return null;
      const el = cells.get(`${r}:${c}`);
      if (el && !el.disabled) return el;
    }
    return null;
  },

  highlight(inp) {
    const grid = U.$('#grid');
    U.$$('.hl', grid).forEach((e) => e.classList.remove('hl'));
    U.$$('.hc', grid).forEach((e) => e.classList.remove('hc'));
    if (!inp) return;
    inp.closest('tr').classList.add('hl');
    U.$$(`[data-c="${inp.dataset.c}"]:not(input)`, grid).forEach((e) => e.classList.add('hc'));
  },

  bind(main) {
    const W = App.W;
    if (U.$('#backHist')) U.$('#backHist').onclick = () => { App.back = null; Views.history.weekId = W.week.id; App.go('history'); };
    U.$('#copyLast').onclick = Views.week.copyLast;
    U.$('#preview').onclick = () => {
      const first = Views.week.dorms(App.W)[0];
      App.sel = { series: 'DF', dormNo: first ? first.no : 1 };
      App.go('invoice');
    };
    U.$('#printAll').onclick = () => Views.week.printAll('print');

    const menu = U.$('#moreMenu');
    U.$('#moreBtn').onclick = (e) => { e.stopPropagation(); menu.classList.toggle('hidden'); };
    document.onclick = (e) => { if (!e.target.closest('.more')) menu.classList.add('hidden'); };
    menu.onclick = (e) => {
      const b = e.target.closest('[data-act]');
      if (!b) return;
      menu.classList.add('hidden');
      ({ next: Views.week.startNext, pdf: () => Views.week.printAll('pdf'), unlock: Views.week.unlock, delete: Views.week.deleteWeek })[b.dataset.act]();
    };
    window.onresize = () => Views.week.pin();

    const grid = U.$('#grid');
    grid.addEventListener('click', (e) => {
      if (e.target.closest('#toggleUnused')) { Views.week.showAll = !Views.week.showAll; Views.week.renderGrid(); return; }
      const b = e.target.closest('[data-open]');
      if (!b) return;
      const d = Views.week.dorms(App.W).find((x) => x.no === Number(b.dataset.open));
      const series = d && d.DF && !d.DF.lines.length && d.INV && d.INV.lines.length ? 'INV' : 'DF';
      App.sel = { series, dormNo: Number(b.dataset.open) };
      App.go('invoice');
    });
    grid.addEventListener('focusin', (e) => {
      if (e.target.matches('.q,.price')) e.target.select();
      Views.week.highlight(e.target.matches('.q') ? e.target : null);
    });
    grid.addEventListener('focusout', (e) => { if (!e.relatedTarget || !e.relatedTarget.matches('#grid .q')) Views.week.highlight(null); });
    grid.addEventListener('input', (e) => { if (e.target.matches('.q,.price')) Views.week.liveTotals(); });
    grid.addEventListener('keydown', (e) => {
      const t = e.target;
      if (!t.matches('.q')) return;
      let dr = 0; let dc = 0;
      if (e.key === 'Enter' || e.key === 'ArrowDown') dr = 1;
      else if (e.key === 'ArrowUp') dr = -1;
      else if (e.key === 'Tab') dc = e.shiftKey ? -1 : 1;
      else return;
      e.preventDefault();
      const next = Views.week.findCell(Number(t.dataset.r), Number(t.dataset.c), dr, dc);
      if (next) { next.focus(); Views.week.highlight(next); } else t.blur();
    });
    grid.addEventListener('change', async (e) => {
      const t = e.target;
      if (t.matches('.q')) {
        const v = U.num(t.value);
        if (Number.isNaN(v) || v < 0) { U.toast('Please type a number, like 12 or 12.5', 'err'); t.value = ''; Views.week.liveTotals(); return; }
        const ok = await App.run(() => API.setQty(Number(t.dataset.inv), Number(t.dataset.p), v));
        if (ok === undefined) { App.W = await API.getWeek(App.weekId); return Views.week.renderGrid(); }
        t.value = U.qty(v);
        t.classList.toggle('has', v > 0);
        await Views.week.reload();
      } else if (t.matches('.price')) {
        const v = U.num(t.value);
        if (Number.isNaN(v) || v < 0) { U.toast('Please type a price, like 85 or 85.50', 'err'); return Views.week.renderGrid(); }
        const ok = await App.run(() => API.setWeekPrice(App.weekId, Number(t.dataset.p), v));
        App.W = await API.getWeek(App.weekId);
        if (ok !== undefined) App.state = await API.bootstrap();
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

  async copyLast() {
    const W = App.W;
    if (!W.prev) return;
    const ok = await U.confirm('Copy last week\'s orders?',
      `Every <b>empty</b> box gets the quantity ordered in the week of <b>${U.date(W.prev.date)}</b>, at this week's prices.<br>
       Boxes that already have a number, and printed invoices, are not changed.`, 'Copy quantities');
    if (!ok) return;
    const r = await App.run(() => API.copyLastWeek(App.weekId));
    if (!r) return;
    U.toast(r.copied ? `Copied ${r.copied} quantities from ${U.date(r.from)}`
      : `Nothing to copy: every box ordered on ${U.date(r.from)} is already filled.`, 'ok');
    App.go('week');
  },

  // "Print all" first shows what will print and anything worth checking.
  async printAll(mode) {
    const W = App.W;
    const ordered = [...W.invoices].sort((a, b) => (a.dorm_no - b.dorm_no) || (a.series === 'DF' ? -1 : 1));
    const withItems = ordered.filter((i) => i.lines.length);
    if (!withItems.length) { U.toast('Nothing to print yet: every invoice is empty.', 'err'); return; }
    const labels = Receipt.labels(App.state.settings);
    const pages = withItems.length * labels.length;
    const sum = (s) => W.invoices.filter((i) => i.series === s).reduce((t, i) => t + i.total, 0);
    const w = Views.week.warnings();
    const list = (title, items) => (items.length ? `<div class="wtitle">${title}</div><ul>${items.map((x) => `<li>${U.esc(x)}</li>`).join('')}</ul>` : '');
    const warnHtml = list('Empty invoices (will not be printed)', w.empty) + list('Prices changed more than 30% since last week', w.prices)
      + list('Quantities more than 3× the usual', w.big) + list('Items with no price', w.noPrice);
    const body = `
      <div class="check-sum">
        <div><span>Invoices</span><b>${withItems.length}</b><small>${pages} pages (${labels.map((l) => l[0] + l.slice(1).toLowerCase()).join(' + ')})</small></div>
        <div><span>DF total</span><b>Rs ${U.money(sum('DF'))}</b></div>
        <div><span>INV total</span><b>Rs ${U.money(sum('INV'))}</b></div>
        <div class="all"><span>Week total</span><b>Rs ${U.money(sum('DF') + sum('INV'))}</b></div>
      </div>
      ${warnHtml ? `<div class="check-warn">⚠ Check before printing:${warnHtml}</div>` : '<div class="check-ok">✓ Nothing unusual found.</div>'}`;
    const go = await U.modal({
      title: mode === 'pdf' ? 'Save all as PDF' : 'Check before printing',
      body, wide: true, cancel: 'Go back and check',
      ok: mode === 'pdf' ? `📄 Save ${pages} pages as PDF` : `🖨 Print ${pages} pages`,
    });
    if (!go) return;
    if (await App.printInvoices(W, withItems, labels, mode)) { await App.refresh(); App.go('week'); }
  },

  async startNext() {
    const plan = await API.nextWeekPlan();
    const n = plan.dormCount;
    const v = await U.modal({
      title: 'Start a new week',
      text: `This creates ${n * 2} invoices, one DF and one INV for each of the ${n} dormitories.<br>
        The date and numbers carry on from the last week. Change them only if they need to be different.`,
      fields: [
        { name: 'date', label: 'Delivery date', type: 'date', value: plan.date },
        { name: 'df', label: `First DF number (DF-${plan.dfStart} → DF-${plan.dfStart + n - 1})`, type: 'number', value: plan.dfStart },
        { name: 'inv', label: `First INV number (INV-${plan.invStart} → INV-${plan.invStart + n - 1})`, type: 'number', value: plan.invStart },
      ],
      ok: 'Start week',
    });
    if (!v) return;
    const starts = {};
    if (Number(v.df) !== plan.dfStart) starts.dfStart = Number(v.df);
    if (Number(v.inv) !== plan.invStart) starts.invStart = Number(v.inv);
    const id = await App.run(() => API.newWeek(v.date, starts), 'New week started.');
    if (id) { App.weekId = id; await App.refresh(); App.weekId = id; App.go('week'); }
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
      <p class="muted">The numbers carry on from your last Excel invoices. You can change the date and starting numbers in the next step.</p>
      <div class="plan"><div><span>Date</span><b>${U.date(p.date)}</b></div>
        <div><span>DF</span><b>${p.dfStart} → ${p.dfStart + p.dormCount - 1}</b></div>
        <div><span>INV</span><b>${p.invStart} → ${p.invStart + p.dormCount - 1}</b></div></div>
      <button class="btn p big" id="first">Start week of ${U.date(p.date)}</button></div></div>`;
    U.$('#first').onclick = Views.week.startNext;
  },
};
