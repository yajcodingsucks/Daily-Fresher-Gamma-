// "Monthly": one statement per month for the customer. First a list of months (with payment and
// statement status), then a statement page with a live preview, printing and payment.

window.Views = window.Views || {};

Views.monthly = {
  month: null, // month shown on the statement page (null = the list of months)
  year: null,  // year shown on the list

  async render(main) {
    if (Views.monthly.month) return Views.monthly.renderStatement(main);
    return Views.monthly.renderList(main);
  },

  short(month) { return U.monthName(month).split(' ')[0]; },

  // ---------- months list ----------
  async renderList(main) {
    const S = App.state.settings;
    const months = await API.listMonths();
    if (!months.length) {
      main.innerHTML = `<div class="top"><div><h2>Monthly statements</h2>
        <div class="sub">One statement per month for ${U.esc(S.customer_name)}</div></div></div><div class="card muted">No weeks yet.</div>`;
      return;
    }
    const thisYear = U.today().slice(0, 4);
    const years = [...new Set(months.map((m) => m.month.slice(0, 4)))].sort().reverse();
    if (!Views.monthly.year || !years.includes(Views.monthly.year)) Views.monthly.year = years.includes(thisYear) ? thisYear : years[0];
    const year = Views.monthly.year;
    const list = months.filter((m) => m.month.startsWith(year));

    // Waiting for payment: every unpaid month, whatever the year.
    const unpaid = months.filter((m) => !m.payment && m.total > 0);
    const waiting = unpaid.reduce((s, m) => s + m.total, 0);
    const paidThisYear = list.filter((m) => m.payment);
    const received = paidThisYear.reduce((s, m) => s + m.payment.amount, 0);
    // This month so far: weeks made / delivery days in the month (same weekday as the deliveries).
    const curMonth = U.today().slice(0, 7);
    const cur = months.find((m) => m.month === curMonth);
    const anyDate = (cur && cur.week_dates[0]) || (months[0].week_dates.slice(-1)[0]);
    const expected = Views.monthly.deliveryDays(curMonth, anyDate);

    const rows = list.map((m) => `<tr>
      <td><b>${U.monthName(m.month)}</b><div class="small muted">Weeks: ${m.week_dates.map((d) => U.date(d).slice(0, 5)).join(' · ')}</div></td>
      <td class="c">${m.weeks}</td>
      <td class="r">${U.money(m.df_total)}</td><td class="r">${U.money(m.inv_total)}</td>
      <td class="r"><b>${U.money(m.total)}</b></td>
      <td>${m.payment ? `<span class="pill ok">Paid</span><div class="small muted">Paid ${U.date(m.payment.paid_date)}${m.payment.reference ? ` · ${U.esc(m.payment.reference)}` : ''}</div>`
        : '<span class="pill wait">Unpaid</span><div class="small muted">Not received yet</div>'}</td>
      <td>${m.statement_printed_at ? `Printed ${U.dayOf(m.statement_printed_at)}` : '<span class="muted">Not printed yet</span>'}</td>
      <td class="r"><button class="btn sm ${m.payment ? '' : 'p'}" data-m="${m.month}">📄 View statement</button></td></tr>`).join('');

    main.innerHTML = `
<div class="top">
  <div><h2>Monthly statements</h2><div class="sub">One statement per month for ${U.esc(S.customer_name)}</div></div>
  <div class="actions"><select class="inp" id="year" style="width:120px">${years.map((y) => `<option ${y === year ? 'selected' : ''}>${y}</option>`).join('')}</select></div>
</div>
<div class="stats">
  <div class="card stat-gold"><span>Waiting for payment</span><b>Rs ${U.money(waiting)}</b>
    <div class="small">${unpaid.length ? unpaid.map((m) => U.monthName(m.month)).join(' · ') : 'Nothing outstanding'}</div></div>
  <div class="card"><span>Received in ${year}</span><b>Rs ${U.money(received)}</b>
    <div class="small muted">${paidThisYear.length} month${paidThisYear.length === 1 ? '' : 's'} paid</div></div>
  <div class="card"><span>This month so far</span><b>Rs ${U.money(cur ? cur.total : 0)}</b>
    <div class="small muted">${U.monthName(curMonth)} · ${cur ? cur.weeks : 0} of ${expected} weeks</div></div>
</div>
<div class="table-wrap"><table class="months"><thead><tr><th>Month</th><th class="c">Weeks</th><th class="r">Vegetables (DF)</th>
  <th class="r">Pot. &amp; Onions (INV)</th><th class="r">Total (Rs)</th><th>Payment</th><th>Statement</th><th></th></tr></thead>
  <tbody>${rows || `<tr><td colspan="8" class="muted c" style="padding:24px">No weeks in ${year}.</td></tr>`}</tbody></table></div>`;

    U.$('#year').onchange = (e) => { Views.monthly.year = e.target.value; Views.monthly.render(main); };
    U.$$('[data-m]').forEach((b) => { b.onclick = () => { Views.monthly.month = b.dataset.m; Views.monthly.render(main); }; });
  },

  // Number of days in `month` that fall on the same weekday as `sampleDate` (the delivery day).
  deliveryDays(month, sampleDate) {
    if (!sampleDate) return 0;
    const dow = new Date(sampleDate + 'T00:00:00Z').getUTCDay();
    const [y, m] = month.split('-').map(Number);
    const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
    let n = 0;
    for (let d = 1; d <= days; d++) if (new Date(Date.UTC(y, m - 1, d)).getUTCDay() === dow) n++;
    return n;
  },

  // ---------- statement page ----------
  async renderStatement(main) {
    const S = App.state.settings;
    const M = await API.monthly(Views.monthly.month);
    const pay = M.payment;
    const name = U.monthName(M.month);
    const nums = (key) => M.weeks.flatMap((w) => w.rows.map((r) => r[key] && r[key].number)).filter(Boolean);
    const range = (s, key) => { const n = nums(key); return n.length ? `${s}-${Math.min(...n)} → ${s}-${Math.max(...n)}` : ''; };
    const diff = pay ? Math.round((pay.amount - M.total) * 100) / 100 : 0;

    main.innerHTML = `
<div class="crumb"><a id="toList">Monthly</a> › ${name}</div>
<div class="top">
  <div><h2>Statement · ${name} ${pay ? '<span class="pill ok">Paid</span>' : '<span class="pill wait">Unpaid</span>'}</h2>
    <div class="sub">${M.weeks.length} week${M.weeks.length === 1 ? '' : 's'} &nbsp;·&nbsp; ${range('DF', 'df')} &nbsp;·&nbsp; ${range('INV', 'inv')}
      &nbsp;·&nbsp; ${M.statement.printed_at ? `Printed ${U.dayOf(M.statement.printed_at)}` : 'Not printed yet'}</div></div>
  <div class="actions"><button class="btn" id="back">← Back to months</button></div>
</div>
${M.statement.changed_after ? '<div class="warnbox">⚠ An invoice changed after the statement was printed, so reprint the statement.</div>' : ''}
<div class="stmt-layout">
  <div class="preview" id="pv"><iframe id="frame" title="Statement preview"></iframe></div>
  <div class="stmt-side">
    <div class="card"><h3>Print</h3>
      <button class="btn p" id="print" style="width:100%;margin-bottom:8px">🖨 Print statement</button>
      <button class="btn" id="pdf" style="width:100%;margin-bottom:8px">📄 Save as PDF</button>
      <button class="btn" id="printInv" style="width:100%">🖨 Print all invoices of this month</button>
    </div>
    <div class="card"><h3>Totals</h3>
      <div class="kv"><span>Vegetables (DF)</span><b>Rs ${U.money(M.df_total)}</b></div>
      <div class="kv"><span>Pot. &amp; Onions (INV)</span><b>Rs ${U.money(M.inv_total)}</b></div>
      <div class="kv total"><span>Month total</span><b>Rs ${U.money(M.total)}</b></div>
    </div>
    <div class="card"><h3>Payment</h3>
      ${pay ? `<div class="paidbox ${diff ? 'short' : ''}">
          <b>${diff ? `Paid Rs ${U.money(pay.amount)}, ${diff < 0 ? 'short' : 'over'} by Rs ${U.money(Math.abs(diff))}` : '✓ Paid in full'}</b>
          <div>${U.date(pay.paid_date)}${pay.reference ? ` · ${U.esc(pay.reference)}` : ''}</div></div>
        <button class="btn danger" id="unpay" style="width:100%;margin-top:10px">Undo paid</button>`
    : `<p class="small muted" style="margin-top:0">Not received yet. Rs ${U.money(M.total)} due.</p>
        <button class="btn p" id="pay" style="width:100%">✓ Mark as paid</button>`}
    </div>
  </div>
</div>`;

    U.$('#toList').onclick = U.$('#back').onclick = () => { Views.monthly.month = null; Views.monthly.render(main); };

    // Live preview: the statement exactly as it prints, laid out on A4 pages for the screen.
    const html = Statement.build(S, M);
    const frame = U.$('#frame');
    let pages = 1;
    frame.onload = () => {
      const doc = frame.contentDocument;
      if (!doc || !doc.body) return;
      // Estimate printed pages from the content height: A4 minus the 11 mm top and bottom margins.
      const M11 = 42;
      const PAGE_H = 1123 - 2 * M11;
      const p2 = doc.querySelector('.p2');
      // before page 2 (its margin excluded); without page 2, down to the end of the last block
      const end = p2 ? p2.offsetTop - M11 : Math.max(...[...doc.body.children].map((el) => el.offsetTop + el.offsetHeight));
      const content1 = end - M11;
      const content2 = p2 ? p2.scrollHeight - 2 * M11 - 18 : 0;                  // page 2 without its padding / border
      pages = Math.max(1, Math.ceil(content1 / PAGE_H)) + (p2 ? Math.max(1, Math.ceil(content2 / PAGE_H)) : 0);
      U.$('#print').textContent = `🖨 Print statement (${pages} page${pages === 1 ? '' : 's'})`;
      Views.monthly.fit();
    };
    frame.srcdoc = html.replace('</head>', `<style>${Views.monthly.previewCss}</style></head>`);
    window.onresize = Views.monthly.fit;

    const out = async (mode) => {
      const r = await App.run(() => API.print(html, mode, `Statement ${name}.pdf`));
      if (r && r.done) {
        await App.run(() => API.logStatement(M.month));
        U.toast(mode === 'pdf' ? 'PDF saved.' : 'Sent to printer.', 'ok');
        Views.monthly.render(main);
      }
    };
    U.$('#print').onclick = () => out('print');
    U.$('#pdf').onclick = () => out('pdf');
    U.$('#printInv').onclick = () => Views.monthly.printInvoices(M);

    if (U.$('#pay')) U.$('#pay').onclick = async () => {
      const v = await U.modal({
        title: `Payment for ${name}`,
        fields: [
          { name: 'paid_date', label: 'Date received', type: 'date', value: U.today() },
          { name: 'amount', label: 'Amount (Rs)', value: M.total.toFixed(2) },
          { name: 'reference', label: 'Cheque no / reference' },
        ],
        ok: 'Save payment',
      });
      if (!v) return;
      const amount = U.num(v.amount);
      if (await App.run(() => API.setPayment(M.month, { ...v, amount: Number.isNaN(amount) ? 0 : amount }), 'Payment saved.') !== undefined) Views.monthly.render(main);
    };
    if (U.$('#unpay')) U.$('#unpay').onclick = async () => {
      if (!await U.confirm('Undo payment?', `${name} will show as unpaid again.`, 'Undo', true)) return;
      if (await App.run(() => API.setPayment(M.month, null), 'Payment removed.') !== undefined) Views.monthly.render(main);
    };
  },

  // Screen-only styles for the preview: A4-wide sheet with the print margins, page 2 on its own sheet.
  previewCss: `@media screen {
    html { background: #dfe7ed; overflow: hidden; }
    body { width: 210mm; min-height: 297mm; margin: 0 auto; padding: 11mm 14mm; background: #fff; }
    .p2 { margin: 11mm -14mm 0; padding: 11mm 14mm; border-top: 18px solid #dfe7ed; }
  }`,

  // Scale the A4 preview to the width of its box; the box scrolls to show page 2.
  fit() {
    const pv = U.$('#pv');
    const frame = U.$('#frame');
    if (!pv || !frame || !frame.contentDocument || !frame.contentDocument.body) return;
    const h = frame.contentDocument.documentElement.scrollHeight;
    const scale = Math.min(1, (pv.clientWidth - 40) / 794);
    frame.style.height = `${h}px`;
    frame.style.transform = `scale(${scale})`;
    frame.style.marginBottom = `${(scale - 1) * h}px`;
    frame.style.marginLeft = frame.style.marginRight = `${((scale - 1) * 794) / 2}px`;
  },

  // Every invoice of the month, Original + Copy: by date, then dorm, DF before INV. Reprint only:
  // printed_at and everything else stay as they are.
  async printInvoices(M) {
    const S = App.state.settings;
    const weeks = await Promise.all(M.weeks.map((w) => API.getWeek(w.id)));
    weeks.sort((a, b) => (a.week.date < b.week.date ? -1 : 1));
    const labels = ['ORIGINAL', 'COPY'];
    let count = 0;
    const pages = weeks.map((W) => [...W.invoices]
      .filter((i) => i.lines.length)
      .sort((a, b) => (a.dorm_no - b.dorm_no) || (a.series === 'DF' ? -1 : 1))
      .map((inv) => { count++; return labels.map((l) => Receipt.page(S, W.week, inv, W.products, l)).join(''); }).join('')).join('');
    if (!count) { U.toast('There are no invoices with items this month.', 'err'); return; }
    const ok = await U.confirm(`Print all invoices of ${U.monthName(M.month)}?`,
      `${count} invoices from ${weeks.length} week${weeks.length === 1 ? '' : 's'}, Original + Copy: <b>${count * 2} pages</b>.<br>
       This is a reprint: nothing saved is changed.`, `🖨 Print ${count * 2} pages`);
    if (!ok) return;
    const r = await App.run(() => API.print(Receipt.doc(S, pages, `Invoices ${U.monthName(M.month)}`), 'print', `Invoices ${U.monthName(M.month)}.pdf`, Receipt.paper(S)));
    if (r && r.done) U.toast('Sent to printer.', 'ok');
  },
};
