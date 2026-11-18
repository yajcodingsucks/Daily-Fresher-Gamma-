// "Monthly": the statement for Gamma Construction, and whether each month has been paid.

window.Views = window.Views || {};

Views.monthly = {
  month: null,

  async render(main) {
    const months = await API.listMonths();
    if (!months.length) { main.innerHTML = '<div class="top"><h2>Monthly</h2></div><div class="card muted">No weeks yet.</div>'; return; }
    if (!Views.monthly.month || !months.some((m) => m.month === Views.monthly.month)) Views.monthly.month = months[0].month;
    const M = await API.monthly(Views.monthly.month);
    const S = App.state.settings;
    const pay = M.payment;
    const diff = pay ? Math.round((pay.amount - M.total) * 100) / 100 : 0;

    const weekRows = M.weeks.map((w) => w.rows.map((r, k) => `<tr>
        ${k === 0 ? `<td rowspan="${w.rows.length}" style="vertical-align:top"><b>${U.date(w.date)}</b></td>` : ''}
        <td>${U.esc(r.dorm)}</td><td class="c">${r.df ? `DF-${r.df.number}` : ''}</td><td class="r">${r.df ? U.money(r.df.total) : ''}</td>
        <td class="c">${r.inv ? `INV-${r.inv.number}` : ''}</td><td class="r">${r.inv ? U.money(r.inv.total) : ''}</td>
        <td class="r"><b>${U.money((r.df ? r.df.total : 0) + (r.inv ? r.inv.total : 0))}</b></td></tr>`).join('')
      + `<tr class="total"><td></td><td>Week total</td><td></td><td class="r">${U.money(w.df_total)}</td><td></td>
         <td class="r">${U.money(w.inv_total)}</td><td class="r">${U.money(w.total)}</td></tr>`).join('');

    main.innerHTML = `
<div class="top">
  <div><h2>${U.monthName(M.month)} ${pay ? '<span class="pill ok">Paid</span>' : '<span class="pill wait">Unpaid</span>'}</h2>
    <div class="sub">Weeks: ${M.weeks.map((w) => U.date(w.date).slice(0, 5)).join(' · ')}
      &nbsp;·&nbsp; ${M.statement.printed_at ? `Statement last printed ${U.stamp(M.statement.printed_at)}` : 'Statement not printed yet'}</div></div>
  <div class="actions">
    <select class="inp" id="pick" style="width:180px">${months.map((m) => `<option value="${m.month}" ${m.month === M.month ? 'selected' : ''}>${U.monthName(m.month)}</option>`).join('')}</select>
    <button class="btn" id="pdf">📄 Save statement PDF</button>
    <button class="btn" id="print">🖨 Print statement</button>
    ${pay ? '<button class="btn danger" id="unpay">Undo paid</button>' : '<button class="btn p big" id="pay">✓ Mark as paid</button>'}
  </div>
</div>
${M.statement.changed_after ? '<div class="warnbox">⚠ An invoice changed after the statement was printed, so reprint the statement.</div>' : ''}
<div class="stats">
  <div class="card"><span>Vegetables (DF)</span><b>Rs ${U.money(M.df_total)}</b></div>
  <div class="card"><span>Potatoes &amp; Onions (INV)</span><b>Rs ${U.money(M.inv_total)}</b></div>
  <div class="card"><span>Month total</span><b>Rs ${U.money(M.total)}</b></div>
  <div class="card"><span>Payment</span><b style="font-size:16px">${pay ? `Rs ${U.money(pay.amount)} on ${U.date(pay.paid_date)}${pay.reference ? `<br><span class="small muted" style="text-transform:none">${U.esc(pay.reference)}</span>` : ''}` : 'Not received yet'}</b>
    ${pay && diff ? `<div class="small" style="color:var(--bad);margin-top:4px">${diff < 0 ? 'Short by' : 'Over by'} Rs ${U.money(Math.abs(diff))}</div>` : ''}</div>
</div>
<div style="display:grid;grid-template-columns:2fr 1fr;gap:16px;align-items:start">
  <div class="table-wrap"><table><thead><tr><th>Week</th><th>Dormitory</th><th class="c">DF No</th><th class="r">Vegetables</th>
    <th class="c">INV No</th><th class="r">Pot. &amp; Onions</th><th class="r">Total</th></tr></thead><tbody>${weekRows}</tbody>
    <tfoot><tr class="total"><td colspan="3">MONTH TOTAL</td><td class="r">${U.money(M.df_total)}</td><td></td>
      <td class="r">${U.money(M.inv_total)}</td><td class="r">${U.money(M.total)}</td></tr></tfoot></table></div>
  <div>
    <div class="table-wrap" style="margin-bottom:16px"><table><thead><tr><th>By dormitory</th><th class="r">Total (Rs)</th></tr></thead>
      <tbody>${M.summary.map((r) => `<tr><td>${U.esc(r.dorm)}</td><td class="r">${U.money(r.total)}</td></tr>`).join('')}</tbody></table></div>
    <div class="table-wrap"><table><thead><tr><th>Month</th><th class="r">Total</th><th class="c">Status</th></tr></thead>
      <tbody>${months.map((m) => `<tr><td>${U.monthName(m.month)}</td><td class="r">${U.money(m.total)}</td>
        <td class="c">${m.payment ? '<span class="pill ok">Paid</span>' : '<span class="pill wait">Unpaid</span>'}</td></tr>`).join('')}</tbody></table></div>
  </div>
</div>`;

    U.$('#pick').onchange = (e) => { Views.monthly.month = e.target.value; Views.monthly.render(main); };
    const out = async (mode) => {
      const html = Statement.build(S, M);
      const r = await App.run(() => API.print(html, mode, `Statement ${U.monthName(M.month)}.pdf`));
      if (r && r.done) {
        await App.run(() => API.logStatement(M.month, mode));
        U.toast(mode === 'pdf' ? 'PDF saved.' : 'Sent to printer.', 'ok');
        Views.monthly.render(main);
      }
    };
    U.$('#pdf').onclick = () => out('pdf');
    U.$('#print').onclick = () => out('print');
    if (U.$('#pay')) U.$('#pay').onclick = async () => {
      const v = await U.modal({
        title: `Payment for ${U.monthName(M.month)}`,
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
      if (!await U.confirm('Undo payment?', `${U.monthName(M.month)} will show as unpaid again.`, 'Undo', true)) return;
      if (await App.run(() => API.setPayment(M.month, null)) !== undefined) Views.monthly.render(main);
    };
  },
};
