// "History": every week so far. Open one to see its details, view, reprint or correct it.

window.Views = window.Views || {};

Views.history = {
  weekId: null, // week shown on the "Week details" page (null = the list of weeks)
  edit: null,   // { weekId, dormId } while correcting one dorm's invoices

  async render(main) {
    if (Views.history.edit) return Views.history.renderEdit(main);
    if (Views.history.weekId) return Views.history.renderWeek(main);
    const weeks = await API.listWeeks();
    const rows = weeks.map((w) => {
      const status = w.printed === 0 ? '<span class="pill wait">Draft</span>'
        : w.printed === w.invoices ? '<span class="pill ok">Printed</span>'
          : `<span class="pill lock">${w.printed}/${w.invoices} printed</span>`;
      return `<tr><td><b>${U.date(w.date)}</b></td><td>DF-${w.df_from} → ${w.df_to}</td><td>INV-${w.inv_from} → ${w.inv_to}</td>
        <td class="r">${U.money(w.df_total)}</td><td class="r">${U.money(w.inv_total)}</td>
        <td class="r"><b>${U.money(w.df_total + w.inv_total)}</b></td><td class="c">${status}</td>
        <td class="r"><button class="btn sm" data-w="${w.id}">Open</button></td></tr>`;
    }).join('');
    main.innerHTML = `
<div class="top"><div><h2>History</h2><div class="sub">${weeks.length} week${weeks.length === 1 ? '' : 's'} saved</div></div>
  <div class="actions"><input class="inp" id="find" placeholder="Find invoice, e.g. DF-505" style="width:240px"></div></div>
<div class="table-wrap"><table><thead><tr><th>Week</th><th>DF numbers</th><th>INV numbers</th><th class="r">Vegetables (Rs)</th>
  <th class="r">Pot. &amp; Onions (Rs)</th><th class="r">Total (Rs)</th><th class="c">Status</th><th></th></tr></thead>
  <tbody>${rows || '<tr><td colspan="8" class="muted c" style="padding:24px">No weeks yet.</td></tr>'}</tbody></table></div>`;

    U.$$('[data-w]').forEach((b) => { b.onclick = () => { Views.history.weekId = Number(b.dataset.w); App.go('history'); }; });
    U.$('#find').onkeydown = (e) => {
      if (e.key !== 'Enter') return;
      const m = e.target.value.trim().toUpperCase().match(/^(DF|INV)\s*-?\s*(\d+)$/);
      if (!m) { U.toast('Type it like DF-505 or INV-360', 'err'); return; }
      const [, series, num] = m;
      const n = Number(num);
      const w = weeks.find((x) => (series === 'DF' ? x.df_from <= n && n <= x.df_to : x.inv_from <= n && n <= x.inv_to));
      if (!w) { U.toast(`${series}-${n} was not made in this app.`, 'err'); return; }
      Views.history.openInvoice(w.id, { series, number: n });
    };
  },

  // Invoice preview for an old week, with "Back to History week".
  openInvoice(weekId, sel) {
    App.weekId = weekId;
    App.sel = { series: sel.series, dormNo: sel.dormNo || 1, number: sel.number || null };
    App.back = { weekId };
    App.go('invoice');
  },

  labelsFor() { return Receipt.labels(App.state.settings); },

  // Reprint: choose Original + Copy / Original only / Copy only. Never changes printed_at.
  async reprint(W, invoices, what) {
    const list = invoices.filter((i) => i.lines.length);
    if (!list.length) { U.toast('Nothing to reprint: no items on these invoices.', 'err'); return; }
    const n = list.length;
    const labels = await U.choose(`Reprint ${what}`, `${n} invoice${n === 1 ? '' : 's'}. Reprinting does not change anything saved.`, [
      { label: `Original + Copy (${n * 2} pages)`, value: ['ORIGINAL', 'COPY'] },
      { label: `Original only (${n} page${n === 1 ? '' : 's'})`, value: ['ORIGINAL'] },
      { label: `Copy only (${n} page${n === 1 ? '' : 's'})`, value: ['COPY'] },
    ]);
    if (labels) await App.printInvoices(W, list, labels, 'print', { reprint: true });
  },

  async pdf(W, invoices) {
    const list = invoices.filter((i) => i.lines.length);
    if (!list.length) { U.toast('Nothing to save: no items on these invoices.', 'err'); return; }
    await App.printInvoices(W, list, Views.history.labelsFor(), 'pdf', { reprint: true });
  },

  // "Week details": one row per dorm, with view / reprint / PDF / edit.
  async renderWeek(main) {
    const W = await API.getWeek(Views.history.weekId);
    App.W = W;
    const D = Views.week.dorms(W);
    const date = U.date(W.week.date);
    const sum = (s) => W.invoices.filter((i) => i.series === s).reduce((t, i) => t + i.total, 0);
    const withItems = W.invoices.filter((i) => i.lines.length);
    const printedN = withItems.filter((i) => i.printed_at).length;
    const printPill = !printedN ? '<span class="pill wait">Draft</span>'
      : printedN === withItems.length ? '<span class="pill ok">Printed</span>'
        : `<span class="pill lock">Printed ${printedN} of ${withItems.length}</span>`;
    const month = U.monthName(W.week.date.slice(0, 7)).split(' ')[0];
    const paidPill = W.paid ? `<span class="pill ok">${month} · Paid</span>` : `<span class="pill wait">${month} · Unpaid</span>`;
    const vehicles = [...new Set(withItems.map((i) => i.vehicle).filter(Boolean))];
    const range = (s) => {
      const nums = W.invoices.filter((i) => i.series === s).map((i) => i.number);
      return nums.length ? `${s}-${Math.min(...nums)} → ${s}-${Math.max(...nums)}` : '';
    };

    const rows = D.map((d) => {
      const df = d.DF; const iv = d.INV;
      const total = (df ? df.total : 0) + (iv ? iv.total : 0);
      return `<tr data-dorm="${d.dorm_id}">
        <td class="c"><b>${d.no}</b></td><td>${U.esc(d.name)}</td>
        <td>${df ? `DF-${df.number}` : ''}</td><td class="r">${df && df.lines.length ? U.money(df.total) : '<span class="muted">–</span>'}</td>
        <td>${iv ? `INV-${iv.number}` : ''}</td><td class="r">${iv && iv.lines.length ? U.money(iv.total) : '<span class="muted">–</span>'}</td>
        <td class="r"><b>${U.money(total)}</b></td>
        <td>${Views.history.statusCell(d)}</td>
        <td class="r nowrap">
          <button class="btn sm" data-act="view" title="View the invoice">👁 View</button>
          <button class="btn sm" data-act="reprint" title="Reprint this dorm's DF and INV">🖨 Reprint</button>
          <button class="btn sm" data-act="pdf" title="Save this dorm's DF and INV as PDF">📄 PDF</button>
          ${Views.history.editButton(W, d)}
        </td></tr>`;
    }).join('');

    main.innerHTML = `
<div class="crumb"><a id="toList">History</a> › Week of ${date}</div>
<div class="top">
  <div>
    <h2>Week of ${date} ${printPill} ${paidPill}</h2>
    <div class="sub">${range('DF')} &nbsp;·&nbsp; ${range('INV')}</div>
  </div>
  <div class="actions">
    <button class="btn" id="backList">← Back to History</button>
    <button class="btn" id="correct" ${W.paid ? 'disabled title="This month is marked as paid"' : ''}>✏️ Correct this week</button>
    <button class="btn" id="pdfAll">📄 Save all as PDF</button>
    <button class="btn p" id="reprintAll">🖨 Reprint all</button>
  </div>
</div>
<div class="stats">
  <div class="card"><span>Vegetables (DF)</span><b>Rs ${U.money(sum('DF'))}</b></div>
  <div class="card"><span>Potatoes &amp; Onions (INV)</span><b>Rs ${U.money(sum('INV'))}</b></div>
  <div class="card"><span>Week total</span><b>Rs ${U.money(sum('DF') + sum('INV'))}</b></div>
  <div class="card"><span>Vehicles used</span><b>${vehicles.length}</b>
    <div class="small muted">${vehicles.map(U.esc).join(' · ') || '–'}</div></div>
</div>
${W.paid ? `<div class="lockbox"><span>🔒 ${month} is marked as paid, so this week cannot be changed. Undo paid on the Monthly page first.</span></div>` : ''}
<div class="table-wrap"><table class="hist-week"><thead><tr><th class="c">No</th><th>Dormitory</th><th>DF No</th><th class="r">Vegetables (Rs)</th>
  <th>INV No</th><th class="r">Pot. &amp; Onions (Rs)</th><th class="r">Total (Rs)</th><th>Status</th><th></th></tr></thead>
  <tbody>${rows}</tbody>
  <tfoot><tr class="total"><td></td><td>WEEK TOTAL</td><td></td><td class="r">${U.money(sum('DF'))}</td><td></td>
    <td class="r">${U.money(sum('INV'))}</td><td class="r">${U.money(sum('DF') + sum('INV'))}</td><td></td><td></td></tr></tfoot>
</table></div>`;

    const toList = () => { Views.history.weekId = null; App.go('history'); };
    U.$('#toList').onclick = toList;
    U.$('#backList').onclick = toList;
    U.$('#correct').onclick = () => { App.weekId = W.week.id; App.back = { weekId: W.week.id }; App.go('week'); };
    U.$('#pdfAll').onclick = () => Views.history.pdf(W, Views.history.ordered(W.invoices));
    U.$('#reprintAll').onclick = () => Views.history.reprint(W, Views.history.ordered(W.invoices), `week of ${date}`);
    U.$('.hist-week tbody').addEventListener('click', (e) => {
      const b = e.target.closest('[data-act]');
      if (!b) return;
      const d = D.find((x) => x.dorm_id === Number(b.closest('tr').dataset.dorm));
      const pair = [d.DF, d.INV].filter(Boolean);
      const act = b.dataset.act;
      if (act === 'view') {
        const series = d.DF && d.DF.lines.length ? 'DF' : d.INV && d.INV.lines.length ? 'INV' : 'DF';
        Views.history.openInvoice(W.week.id, { series, dormNo: d.no });
      } else if (act === 'reprint') Views.history.reprint(W, pair, `${d.name}`);
      else if (act === 'pdf') Views.history.pdf(W, pair);
      else if (act === 'edit') Views.history.startEdit(W, d);
      else if (act === 'changes') Views.history.showChanges(W, d);
    });
  },

  ordered(invoices) {
    return [...invoices].sort((a, b) => (a.dorm_no - b.dorm_no) || (a.series === 'DF' ? -1 : 1));
  },

  statusCell(d) {
    const all = [d.DF, d.INV].filter(Boolean);
    const invs = all.filter((i) => i.lines.length);
    const printed = invs.filter((i) => i.printed_at).map((i) => i.printed_at).sort();
    const corrected = all.filter((i) => i.corrections && i.corrections.length);
    let out = !invs.length ? '<span class="muted">No items</span>'
      : !printed.length ? '<span class="muted">Not printed</span>'
        : `Printed ${U.stamp(printed[0])}${printed.length < invs.length ? ' <span class="muted">(1 of 2)</span>' : ''}`;
    if (corrected.length) {
      out += `<div class="corr"><span class="pill corrected">Corrected</span>
        ${corrected.map((i) => `<span class="small">${i.series}-${i.number}: was Rs ${U.money(i.original_total)} → now Rs ${U.money(i.total)}</span>`).join('')}
        <a class="link" data-act="changes">See changes</a></div>`;
    }
    return out;
  },

  editButton(W) {
    return `<button class="btn sm" data-act="edit" ${W.paid ? 'disabled title="This month is marked as paid. Undo paid on the Monthly page first."' : 'title="Correct this dorm\'s DF and INV invoices"'}>✏️ Edit</button>`;
  },

  startEdit(W, d) {
    Views.history.edit = { weekId: W.week.id, dormId: d.dorm_id };
    App.go('history');
  },

  // Every correction of this dorm's invoices: date, reason, and item by item old → new.
  showChanges(W, d) {
    const fmt = (l) => (l ? `${U.qty(l.qty)} ${U.esc(l.unit)} × Rs ${U.money(l.unit_price)}` : '<span class="muted">–</span>');
    const blocks = [d.DF, d.INV].filter((i) => i && i.corrections.length).map((inv) => inv.corrections.map((c) => {
      const before = new Map(((c.before || {}).lines || []).map((l) => [l.product_id, l]));
      const after = new Map(((c.after || {}).lines || []).map((l) => [l.product_id, l]));
      const ids = [...new Set([...before.keys(), ...after.keys()])];
      const rows = ids.map((id) => [before.get(id), after.get(id)])
        .filter(([b, a]) => !b || !a || b.qty !== a.qty || b.unit_price !== a.unit_price)
        .sort(([b1, a1], [b2, a2]) => U.byName((b1 || a1).name, (b2 || a2).name))
        .map(([b, a]) => `<tr><td>${U.esc((b || a).name)}</td><td>${fmt(b)}</td><td>→</td><td><b>${fmt(a)}</b></td></tr>`).join('');
      return `<div class="change">
        <div class="change-head"><b>${inv.series}-${inv.number}</b> · corrected ${U.dayOf(c.at)} ${U.stamp(c.at).split(' · ')[1] || ''}
          · Rs ${U.money((c.before || {}).total)} → Rs ${U.money((c.after || {}).total)}</div>
        <div class="small">Reason: <i>${U.esc(c.reason || '')}</i></div>
        <table class="changes"><thead><tr><th>Item</th><th>Before</th><th></th><th>After</th></tr></thead><tbody>${rows}</tbody></table>
      </div>`;
    }).join('')).join('');
    U.modal({ title: `Changes · ${d.name}`, body: `<div class="changes-list">${blocks}</div>`, ok: 'Close', cancel: '', wide: true });
  },

  // Correct one dorm's DF and INV invoices: items, price, qty. Saved together, with a reason if printed.
  async renderEdit(main) {
    const { weekId, dormId } = Views.history.edit;
    const W = await API.getWeek(weekId);
    const d = Views.week.dorms(W).find((x) => x.dorm_id === dormId);
    const date = U.date(W.week.date);
    const month = U.monthName(W.week.date.slice(0, 7)).split(' ')[0];
    const invs = [d.INV, d.DF].filter(Boolean);                         // onions & potatoes first, like the grid
    const anyPrinted = invs.some((i) => i.printed_at || (i.corrections && i.corrections.length));
    const kind = { DF: 'DF · Vegetables', INV: 'INV · Onions & Potatoes' };

    const section = (inv) => {
      const lines = new Map(inv.lines.map((l) => [l.product_id, l]));
      const prods = W.products.filter((p) => p.series === inv.series).sort(U.byProduct);
      const rows = prods.map((p) => {
        const l = lines.get(p.id);
        const price = l ? l.unit_price : (W.prices[p.id] ?? p.price);
        return `<tr class="row-${inv.series}" data-inv="${inv.id}" data-p="${p.id}">
          <td class="item col-item"><b>${U.esc(p.name)}</b><small>${U.esc(p.code)}</small></td><td>${U.esc(p.unit)}</td>
          <td class="r"><input class="price ep" value="${price.toFixed(2)}" inputmode="decimal" ${W.paid ? 'disabled' : ''}></td>
          <td class="c"><input class="q ${inv.series.toLowerCase()} eq ${l ? 'has' : ''}" value="${l ? U.qty(l.qty) : ''}"
            data-was="${l ? U.qty(l.qty) : ''}" inputmode="decimal" autocomplete="off" ${W.paid ? 'disabled' : ''}></td>
          <td class="r amt"></td></tr>`;
      }).join('');
      const status = inv.printed_at ? `Printed ${U.stamp(inv.printed_at)}` : 'Not printed';
      return `<tr class="sec sec-${inv.series}"><td colspan="5">${kind[inv.series]} &nbsp;·&nbsp; ${inv.series}-${inv.number} &nbsp;·&nbsp; ${status}</td></tr>
        ${rows}
        <tr class="sumrow" data-sum="${inv.id}"><td colspan="4">${inv.series}-${inv.number} total</td><td class="r"><b></b>
          <div class="small was" data-orig="${inv.original_total ?? inv.total}"></div></td></tr>`;
    };

    main.innerHTML = `
<div class="crumb"><a id="toList">History</a> › <a id="toWeek">Week of ${date}</a> › Edit ${d.no} · ${U.esc(d.name)}</div>
<div class="top">
  <div><h2>Correct ${U.esc(d.name)}</h2>
    <div class="sub">Week of ${date} · ${invs.map((i) => `${i.series}-${i.number}`).join(' · ')} · invoice numbers stay the same</div></div>
  <div class="actions">
    <button class="btn" id="cancel">Cancel</button>
    <button class="btn p big" id="save" ${W.paid ? 'disabled' : ''}>✓ Save correction</button>
  </div>
</div>
${W.paid ? `<div class="lockbox"><span>🔒 ${month} is marked as paid. Undo paid on the Monthly page first.</span></div>`
    : anyPrinted ? '<div class="oldweek"><span>These invoices were printed. Your reason is saved with a copy of the invoice as it was, and reprints will show "Revised".</span></div>' : ''}
<div class="edit-layout">
  <div class="table-wrap"><table class="grid edit-grid"><thead><tr><th class="col-item">Item</th><th>Unit</th><th class="r">Price (Rs)</th>
    <th class="c">Qty</th><th class="r">Amount (Rs)</th></tr></thead><tbody>${invs.map(section).join('')}</tbody></table></div>
  <div class="card edit-side">
    <h3>What needs correcting?</h3>
    <textarea class="inp" id="reason" rows="5" placeholder="${anyPrinted ? 'Required, e.g. Cook counted 12 kg, not 10' : 'Optional for invoices that were not printed'}" ${W.paid ? 'disabled' : ''}></textarea>
    <div id="editTotals" class="edit-totals"></div>
  </div>
</div>`;

    const back = () => { Views.history.edit = null; Views.history.weekId = weekId; App.go('history'); };
    U.$('#toList').onclick = () => { Views.history.edit = null; Views.history.weekId = null; App.go('history'); };
    U.$('#toWeek').onclick = back;
    U.$('#cancel').onclick = back;

    const grid = U.$('.edit-grid');
    const recalc = () => {
      const totals = {};
      for (const tr of U.$$('tr[data-p]', grid)) {
        const q = U.num(U.$('.eq', tr).value);
        const p = U.num(U.$('.ep', tr).value);
        const amt = q > 0 && p >= 0 ? Math.round(q * p * 100) / 100 : 0;
        U.$('.amt', tr).textContent = amt ? U.money(amt) : '';
        totals[tr.dataset.inv] = (totals[tr.dataset.inv] || 0) + amt;
        U.$('.eq', tr).classList.toggle('has', q > 0);
      }
      const out = [];
      for (const inv of invs) {
        const t = Math.round((totals[inv.id] || 0) * 100) / 100;
        const row = U.$(`[data-sum="${inv.id}"]`, grid);
        U.$('b', row).textContent = U.money(t);
        const orig = Number(U.$('.was', row).dataset.orig);
        U.$('.was', row).textContent = Math.abs(orig - t) > 0.004 ? `was Rs ${U.money(orig)} → now Rs ${U.money(t)}` : '';
        out.push(`<div><span>${inv.series}-${inv.number}</span><b>Rs ${U.money(t)}</b>${Math.abs(inv.total - t) > 0.004
          ? `<small>saved now: Rs ${U.money(inv.total)}</small>` : ''}</div>`);
      }
      U.$('#editTotals').innerHTML = out.join('');
    };
    recalc();
    grid.addEventListener('input', recalc);
    grid.addEventListener('focusin', (e) => { if (e.target.matches('input')) e.target.select(); });
    grid.addEventListener('keydown', (e) => {
      if (!e.target.matches('.eq') || !['Enter', 'ArrowDown', 'ArrowUp'].includes(e.key)) return;
      e.preventDefault();
      const all = U.$$('.eq', grid);
      const next = all[all.indexOf(e.target) + (e.key === 'ArrowUp' ? -1 : 1)];
      if (next) next.focus();
    });

    U.$('#save').onclick = async () => {
      const edits = [];
      for (const inv of invs) {
        const lines = [];
        for (const tr of U.$$(`tr[data-inv="${inv.id}"]`, grid)) {
          const q = U.num(U.$('.eq', tr).value);
          const p = U.num(U.$('.ep', tr).value);
          if (Number.isNaN(q) || Number.isNaN(p)) { U.toast('Please type numbers only, like 12 or 12.5', 'err'); U.$('.eq', tr).focus(); return; }
          if (q > 0) lines.push({ product_id: Number(tr.dataset.p), qty: q, unit_price: p });
        }
        edits.push({ invoice_id: inv.id, lines });
      }
      const reason = U.$('#reason').value;
      const r = await App.run(() => API.correctInvoices(edits, reason));
      if (!r) { if (anyPrinted && !reason.trim()) U.$('#reason').focus(); return; }
      const changed = r.filter((x) => x.changed);
      U.toast(changed.length ? `Saved. ${changed.map((x) => `${x.series}-${x.number}`).join(' and ')} ${changed.some((x) => x.corrected) ? 'corrected' : 'updated'}.`
        : 'Nothing changed.', 'ok');
      back();
    };
  },
};
