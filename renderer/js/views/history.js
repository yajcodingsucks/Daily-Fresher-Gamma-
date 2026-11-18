// "History": every week so far. Open one to see its details, view, reprint or correct it.

window.Views = window.Views || {};

Views.history = {
  weekId: null, // week shown on the "Week details" page (null = the list of weeks)

  async render(main) {
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

  labelsFor() { return App.state.settings.print_copy ? ['ORIGINAL', 'COPY'] : ['ORIGINAL']; },

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
    const invs = [d.DF, d.INV].filter((i) => i && i.lines.length);
    const printed = invs.filter((i) => i.printed_at).map((i) => i.printed_at).sort();
    if (!invs.length) return '<span class="muted">No items</span>';
    if (!printed.length) return '<span class="muted">Not printed</span>';
    return `Printed ${U.stamp(printed[0])}${printed.length < invs.length ? ' <span class="muted">(1 of 2)</span>' : ''}`;
  },

  editButton() { return ''; },
};
