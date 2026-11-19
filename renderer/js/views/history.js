// "History": every week so far. Open one to view or reprint it.

window.Views = window.Views || {};

Views.history = {
  async render(main) {
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

    U.$$('[data-w]').forEach((b) => { b.onclick = () => { App.weekId = Number(b.dataset.w); App.go('week'); }; });
    U.$('#find').onkeydown = (e) => {
      if (e.key !== 'Enter') return;
      const m = e.target.value.trim().toUpperCase().match(/^(DF|INV)\s*-?\s*(\d+)$/);
      if (!m) { U.toast('Type it like DF-505 or INV-360', 'err'); return; }
      const [, series, num] = m;
      const n = Number(num);
      const w = weeks.find((x) => (series === 'DF' ? x.df_from <= n && n <= x.df_to : x.inv_from <= n && n <= x.inv_to));
      if (!w) { U.toast(`${series}-${n} was not made in this app.`, 'err'); return; }
      App.weekId = w.id;
      App.sel = { series, dormNo: App.sel.dormNo, number: n };
      App.go('invoice');
    };
  },
};
