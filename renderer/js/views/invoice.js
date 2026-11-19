// "Invoices": pick a dorm, see its invoice exactly as it will print, print Original / Copy.

window.Views = window.Views || {};

Views.invoice = {
  async render(main) {
    if (!App.state.weeks.length) { main.innerHTML = '<div class="empty card">Start a week first on This Week.</div>'; return; }
    const W = await API.getWeek(App.weekId);
    App.W = W;
    const S = App.state.settings;
    const F = S.receipt_format;
    const both = Receipt.labels(S);
    const series = App.sel.series;
    const list = W.invoices.filter((i) => i.series === series).sort((a, b) => a.dorm_no - b.dorm_no);
    const inv = (App.sel.number && list.find((i) => i.number === App.sel.number))
      || list.find((i) => i.dorm_no === App.sel.dormNo) || list[0];
    App.sel.number = null;
    App.sel.dormNo = inv.dorm_no;
    const other = W.invoices.find((i) => i.dorm_id === inv.dorm_id && i.series !== series);
    const locked = !!inv.printed_at;

    main.innerHTML = `
<div class="top">
  <div><h2>${U.esc(inv.dorm_name)} · ${inv.series}-${inv.number}</h2>
    <div class="sub">Week of ${U.date(W.week.date)} · ${locked ? `Printed ${U.date(inv.printed_at)} 🔒` : 'Not printed yet'}</div></div>
  <div class="actions"><button class="btn" id="back">${App.back ? '← Back to History week' : '← Back to week'}</button></div>
</div>
<div class="inv-layout">
  <div class="dorm-list">
    <div class="tabs" style="width:100%"><button data-s="DF" class="${series === 'DF' ? 'on' : ''}" style="flex:1">DF</button>
      <button data-s="INV" class="${series === 'INV' ? 'on' : ''}" style="flex:1">INV</button></div>
    ${list.map((i) => `<button data-d="${i.dorm_no}" class="${i.dorm_no === inv.dorm_no ? 'on' : ''} ${i.lines.length ? '' : 'empty-inv'}">
      <span>${i.dorm_no}. ${U.esc(i.dorm_name)}<br><span class="amt">${i.series}-${i.number}${i.printed_at ? ' 🔒' : ''}</span></span>
      <span class="amt">${i.lines.length ? U.money(i.total) : 'empty'}</span></button>`).join('')}
  </div>
  <div class="preview" id="pv"><iframe id="frame" title="Invoice preview"></iframe></div>
  <div class="inv-side">
    <div class="card">
      <h3>Print</h3>
      <button class="btn p" id="pBoth" style="width:100%;margin-bottom:8px">🖨 ${both.length === 2 ? 'Original + Copy' : 'Print'}</button>
      <button class="btn" id="pOrig" style="width:100%;margin-bottom:8px">Original only</button>
      <button class="btn" id="pCopy" style="width:100%;margin-bottom:8px">Copy only</button>
      <button class="btn" id="pDorm" style="width:100%;margin-bottom:8px">This dorm: DF + INV</button>
      <button class="btn" id="pdf" style="width:100%">📄 Save as PDF</button>
    </div>
    <div class="card">
      <h3>Details</h3>
      <div class="field"><label>Vehicle No</label><input class="inp" id="veh" value="${U.esc(inv.vehicle)}" ${locked ? 'disabled' : ''}></div>
      ${F.show.part_payment ? `<div class="field"><label>Part payment (Rs)</label>
        <input class="inp" id="pp" value="${inv.part_payment ? inv.part_payment.toFixed(2) : ''}" ${locked ? 'disabled' : ''} inputmode="decimal"></div>` : ''}
      <div class="small muted">Quantities are changed on This Week.</div>
    </div>
  </div>
</div>`;

    const frame = U.$('#frame');
    Receipt.show(frame, Receipt.build(S, W.week, [inv], W.products, ['ORIGINAL'], { script: false }));
    const [pw, ph] = Receipt.pagePx(F);
    frame.style.width = `${pw}px`;
    frame.style.height = `${ph}px`;
    const fit = () => {
      const pv = U.$('#pv');
      if (!pv) return;
      const scale = Math.min(1, (pv.clientWidth - 40) / pw);
      frame.style.transform = `scale(${scale})`;
      frame.style.marginBottom = `${(scale - 1) * ph}px`;
      frame.style.marginLeft = frame.style.marginRight = `${((scale - 1) * pw) / 2}px`;
    };
    fit();
    window.onresize = fit;

    U.$('#back').onclick = () => {
      if (App.back) { Views.history.weekId = App.back.weekId; App.back = null; App.go('history'); } else App.go('week');
    };
    U.$$('[data-s]').forEach((b) => { b.onclick = () => { App.sel.series = b.dataset.s; App.go('invoice'); }; });
    U.$$('[data-d]').forEach((b) => { b.onclick = () => { App.sel.dormNo = Number(b.dataset.d); App.go('invoice'); }; });

    const after = async (ok) => { if (ok) { await App.refresh(); App.go('invoice'); } };
    U.$('#pBoth').onclick = async () => after(await App.printInvoices(W, [inv], both));
    U.$('#pOrig').onclick = async () => after(await App.printInvoices(W, [inv], ['ORIGINAL']));
    U.$('#pCopy').onclick = async () => after(await App.printInvoices(W, [inv], ['COPY']));
    U.$('#pdf').onclick = async () => after(await App.printInvoices(W, [inv], both, 'pdf'));
    U.$('#pDorm').onclick = async () => {
      const pair = [inv, other].filter(Boolean).sort((a, b) => (a.series === b.series ? 0 : a.series === 'DF' ? -1 : 1)).filter((i) => i.lines.length);
      after(await App.printInvoices(W, pair, both));
    };

    const veh = U.$('#veh');
    veh.onchange = async () => {
      if (await App.run(() => API.setInvoiceFields(inv.id, { vehicle: veh.value }), 'Vehicle saved.') !== undefined) App.go('invoice');
    };
    const pp = U.$('#pp');
    if (pp) pp.onchange = async () => {
      const v = U.num(pp.value);
      if (Number.isNaN(v)) { U.toast('Please type an amount.', 'err'); return; }
      if (await App.run(() => API.setInvoiceFields(inv.id, { part_payment: v }), 'Part payment saved.') !== undefined) App.go('invoice');
    };
  },
};
