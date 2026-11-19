// "History": every week so far. Open one to see its details, view, reprint or correct it.

window.Views = window.Views || {};

Views.history = {
  weekId: null, // week shown on the "Week details" page (null = the list of weeks)
  edit: null,   // { weekId, dormId } while correcting one dorm's invoices

  async render(main) {
    main.onclick = null;
    main.onchange = null;
    if (Views.history.imp) return Views.history.renderImport(main);
    if (Views.history.edit) return Views.history.renderEdit(main);
    if (Views.history.weekId) return Views.history.renderWeek(main);
    const weeks = await API.listWeeks();
    const missing = await API.missingWeeks();
    const and = (list) => (list.length > 1 ? `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}` : list[0]);
    const missingRows = missing.map((m) => {
      const month = U.monthName(m.month).split(' ')[0];
      return `<div class="warnbox missing"><span>⚠ <b>Missing week${m.dates.length === 1 ? '' : 's'} in ${month}:</b>
        ${and(m.dates.map(U.date))} — the ${month} statement will be incomplete until ${m.dates.length === 1 ? 'it is' : 'they are'} added.</span>
        <button class="btn sm" data-add="${m.dates[m.dates.length - 1]}">＋ Add ${U.date(m.dates[m.dates.length - 1]).slice(0, 5)}</button></div>`;
    }).join('');
    const rows = weeks.map((w) => {
      const status = w.past ? Views.history.pastPill(w.past)
        : w.printed === 0 ? '<span class="pill wait">Draft</span>'
          : w.printed === w.invoices ? '<span class="pill ok">Printed</span>'
            : `<span class="pill lock">${w.printed}/${w.invoices} printed</span>`;
      return `<tr><td><b>${U.date(w.date)}</b></td><td>DF-${w.df_from} → ${w.df_to}</td><td>INV-${w.inv_from} → ${w.inv_to}</td>
        <td class="r">${U.money(w.df_total)}</td><td class="r">${U.money(w.inv_total)}</td>
        <td class="r"><b>${U.money(w.df_total + w.inv_total)}</b></td><td class="c">${status}</td>
        <td class="r"><button class="btn sm" data-w="${w.id}">Open</button></td></tr>`;
    }).join('');
    main.innerHTML = `
<div class="top"><div><h2>History</h2><div class="sub">${weeks.length} week${weeks.length === 1 ? '' : 's'} saved</div></div>
  <div class="actions"><input class="inp" id="find" placeholder="Find invoice, e.g. DF-505" style="width:240px">
    <button class="btn p" id="addPast">＋ Add a past week</button></div></div>
${missingRows}
<div class="table-wrap"><table><thead><tr><th>Week</th><th>DF numbers</th><th>INV numbers</th><th class="r">Vegetables (Rs)</th>
  <th class="r">Pot. &amp; Onions (Rs)</th><th class="r">Total (Rs)</th><th class="c">Status</th><th></th></tr></thead>
  <tbody>${rows || '<tr><td colspan="8" class="muted c" style="padding:24px">No weeks yet.</td></tr>'}</tbody></table></div>`;

    U.$$('[data-w]').forEach((b) => { b.onclick = () => { Views.history.weekId = Number(b.dataset.w); App.go('history'); }; });
    const firstMissing = missing.length ? missing[missing.length - 1].dates.slice(-1)[0] : '';
    U.$('#addPast').onclick = () => Views.history.addPastDialog(firstMissing);
    U.$$('[data-add]').forEach((b) => { b.onclick = () => Views.history.addPastDialog(b.dataset.add); });
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

  // "＋ Add a past week": Import from Excel, or Type it in (date + first numbers, checked live).
  addPastDialog(date = '', tab = 'type') {
    const box = U.$('#modal');
    const state = { date, dfStart: '', invStart: '', edited: false, check: null };
    const close = () => { box.classList.add('hidden'); box.innerHTML = ''; document.removeEventListener('keydown', onKey); };
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', onKey);
    const draw = () => {
      box.innerHTML = `<div class="box wide pastdlg">
        <h3>Add a past week</h3>
        <div class="tabs past-tabs"><button data-t="excel" class="${tab === 'excel' ? 'on' : ''}">📥 Import from Excel</button>
          <button data-t="type" class="${tab === 'type' ? 'on' : ''}">⌨️ Type it in</button></div>
        <div id="pastBody"></div>
        <div class="btns"><button class="btn" data-x="0">Cancel</button>
          ${tab === 'type' ? '<button class="btn p" id="pastNext" disabled>Next: enter quantities →</button>' : ''}</div></div>`;
      box.classList.remove('hidden');
      U.$$('[data-t]', box).forEach((b) => { b.onclick = () => { tab = b.dataset.t; draw(); }; });
      U.$('[data-x="0"]', box).onclick = close;
      if (tab === 'excel') Views.history.excelTab(U.$('#pastBody', box), close);
      else typeTab();
    };
    const typeTab = () => {
      U.$('#pastBody', box).innerHTML = `<p class="small muted" style="margin-top:0">For a week that was invoiced before the app (or missed):
        the app makes one DF and one INV invoice per dormitory with the numbers you choose, then you type the quantities on the usual grid.</p>
        <div class="row3"><div class="field"><label>Week date</label><input class="inp" type="date" id="pDate" value="${U.esc(state.date)}"></div>
          <div class="field"><label>First DF number</label><input class="inp" id="pDf" inputmode="numeric" value="${U.esc(state.dfStart)}"></div>
          <div class="field"><label>First INV number</label><input class="inp" id="pInv" inputmode="numeric" value="${U.esc(state.invStart)}"></div></div>
        <div id="pCheck" class="pcheck"></div>`;
      const run = async () => {
        state.date = U.$('#pDate').value;
        const c = await API.checkPastWeek({ date: state.date, dfStart: state.edited ? state.dfStart : '', invStart: state.edited ? state.invStart : '' });
        if (U.$('#pDate') === null) return;
        if (!state.edited && c.df && c.inv) { U.$('#pDf').value = state.dfStart = String(c.df.from); U.$('#pInv').value = state.invStart = String(c.inv.from); }
        state.check = c;
        U.$('#pCheck').innerHTML = Views.history.pastCheckHtml(c);
        U.$('#pastNext').disabled = !c.ok;
      };
      U.$('#pDate').oninput = run;
      for (const [id, key] of [['#pDf', 'dfStart'], ['#pInv', 'invStart']]) {
        U.$(id).oninput = (e) => { state[key] = e.target.value.trim(); state.edited = true; run(); };
      }
      U.$('#pastNext').onclick = async () => {
        if (!state.check || !state.check.ok) return;
        const id = await App.run(() => API.addPastWeek({ date: state.date, dfStart: Number(state.dfStart), invStart: Number(state.invStart), entering: true }));
        if (!id) return;
        close();
        await App.refresh();
        App.weekId = id;
        App.back = { weekId: id };
        App.go('week');
      };
      run();
    };
    draw();
  },

  // "Will create DF-485 → DF-493 and INV-336 → INV-344 for 9 dorms" and where the date sits.
  pastCheckHtml(c) {
    if (!c.valid) return '<div class="pc-line bad">Choose the week date.</div>';
    const range = (s, r) => (r && r.valid ? `${s}-${r.from} → ${s}-${r.to}` : `${s}-?`);
    const clashes = [...((c.df || {}).clashes || []).map((n) => `DF-${n}`), ...((c.inv || {}).clashes || []).map((n) => `INV-${n}`)];
    const numbersOk = c.df && c.inv && c.df.valid && c.inv.valid && !clashes.length;
    let out = `<div class="pc-line ${numbersOk ? 'good' : 'bad'}">${numbersOk ? '✓' : '✗'} Will create ${range('DF', c.df)} and ${range('INV', c.inv)}
      for ${c.dorms} dorm${c.dorms === 1 ? '' : 's'}${clashes.length ? ` — already used: ${clashes.join(', ')}` : numbersOk ? ' — all free' : ''}</div>`;
    const n = c.neighbours || {};
    const side = (gap, w, word) => (w ? `${gap} days ${word} ${U.date(w.date)}${gap % 7 === 0 ? (gap > 7 ? ` (${gap / 7 - 1} week${gap / 7 - 1 === 1 ? '' : 's'} still missing in between)` : '') : ' — not on the weekly rhythm'}` : '');
    const parts = [side(n.nextGap, n.next, 'before'), side(n.prevGap, n.prev, 'after')].filter(Boolean);
    if (parts.length && !c.exists) {
      out += `<div class="pc-line ${n.onRhythm ? 'good' : 'warn'}">${n.onRhythm ? '✓' : '⚠'} ${parts.join(' · ')}</div>`;
    }
    for (const p of c.problems.filter((x) => !/already used|whole number/.test(x))) out += `<div class="pc-line bad">✗ ${U.esc(p)}</div>`;
    return out;
  },

  // ---------- Import from Excel ----------
  excelTab(body, close) {
    body.innerHTML = `<p style="margin-top:0">Choose an Excel receipt file like <b>Receipt Format02.xlsx</b>: one sheet per dormitory for DF and for INV.</p>
      <ul class="small muted" style="margin:0 0 14px;padding-left:18px;line-height:1.6">
        <li>The app reads every sheet and shows a check before anything is saved.</li>
        <li>Spaces in codes and numbers, units and amounts are tidied automatically (amounts are always qty × price).</li>
        <li>Unknown items, odd prices or quantities and unknown sheets ask you to decide with one click.</li></ul>
      <button class="btn p big" id="pickExcel">📂 Choose Excel file…</button>`;
    U.$('#pickExcel').onclick = async () => {
      const r = await App.run(() => API.openExcel());
      if (!r) return;
      close();
      Views.history.imp = { draft: r.draft, check: r.check, open: [] };
      Views.history.weekId = null;
      Views.history.edit = null;
      App.go('history');
    };
  },

  imp: null,   // { draft, check, open: [row keys] } while checking an Excel file before importing

  // Apply one change to the draft (an edit or a one-click decision) and check it again.
  async impChange(fn) {
    const I = Views.history.imp;
    fn(I.draft);
    const check = await App.run(() => API.checkImport(I.draft));
    if (!check || Views.history.imp !== I) return;
    I.check = check;
    const main = U.$('#main');
    const keep = main.scrollTop;
    Views.history.renderImport(main);
    main.scrollTop = keep;
  },

  // "Check before importing": nothing is saved until Import is clicked.
  renderImport(main) {
    const I = Views.history.imp;
    const C = I.check;
    const D = I.draft;
    const e = U.esc;
    const dmy = (d) => (d ? U.date(d) : '—');
    const date = C.week.date;
    const sheetOf = (i) => (i === null || i === undefined ? null : C.sheets[i]);
    const opt = (o) => `<button class="btn sm opt" data-opt='${e(JSON.stringify({ sheet: o.sheet ?? null, line: o.line ?? null, set: o.set }))}'>${e(o.label)}</button>`;
    const warnHtml = (w) => `<div class="iw warn"><span>⚠ ${e(w.text)}</span><span class="iw-opts">
      ${w.kind === 'dorm' ? `<select class="inp sm" data-dormsel="${w.options[0].sheet}"><option value="">Pick the dorm…</option>
        ${App.state.dorms.map((d) => `<option value="${d.id}">${d.no}. ${e(d.name)}</option>`).join('')}</select>` : ''}
      ${w.kind === 'map' ? Views.history.mapSelect(w.sheet, w.line, w.series, null) : ''}
      ${w.options.map(opt).join('')}</span></div>`;
    // The Check column: ✓ OK, or each problem (red) and each decision (one click) for this dorm's sheets.
    const checkCell = (row) => {
      const list = [row.DF, row.INV, ...row.other].map(sheetOf).filter(Boolean);
      const fixes = list.reduce((t, s) => t + s.fixes.length, 0);
      const tag = (s) => (list.length > 1 ? `<b>${e(s.numberText || s.name.trim())}:</b> ` : '');
      const errs = list.flatMap((s) => s.errors.map((x) => `<div class="iw bad">✗ ${tag(s)}${e(x)}</div>`));
      const warns = list.flatMap((s) => s.warnings.map(warnHtml));
      const fixChip = fixes ? `<span class="ic fix" title="${e(list.flatMap((s) => s.fixes).join('\n'))}">✓ ${fixes} auto-fix${fixes === 1 ? '' : 'es'}</span>` : '';
      if (!errs.length && !warns.length) return `<span class="ic good">✓ OK</span> ${fixChip}`;
      return `${errs.join('')}${warns.join('')}${fixChip}`;
    };
    const rowKey = (row) => `${row.dorm_id || 'x'}:${row.DF}:${row.INV}:${row.other.join(',')}`;
    const rows = C.rows.map((row) => {
      const df = sheetOf(row.DF); const iv = sheetOf(row.INV);
      const key = rowKey(row);
      const open = I.open.includes(key);
      const other = row.other.map(sheetOf);
      return `<tr class="irow ${open ? 'open' : ''}" data-key="${e(key)}">
        <td class="c">${row.no ? `<b>${row.no}</b>` : '<span class="muted">?</span>'}</td>
        <td>${e(row.name)}${row.dorm_id ? '' : ' <span class="pill wait">not a dorm</span>'}</td>
        <td>${df ? e(df.numberText) : other.map((s) => e(s.numberText || '?')).join(' ')}</td><td class="r">${df ? U.money(df.total) : ''}</td>
        <td>${iv ? e(iv.numberText) : ''}</td><td class="r">${iv ? U.money(iv.total) : ''}</td>
        <td class="r"><b>${U.money(row.total + other.reduce((t, s) => t + s.total, 0))}</b></td>
        <td class="icheck">${checkCell(row)} <span class="muted small more">${open ? '▲ hide lines' : '▼ lines'}</span></td></tr>
        ${open ? `<tr class="idetail"><td colspan="8">${[row.DF, row.INV, ...row.other].filter((x) => x !== null).map((i) => Views.history.sheetPanel(D.sheets[i], C.sheets[i], warnHtml)).join('')}</td></tr>` : ''}`;
    }).join('');
    const skipped = C.sheets.filter((s) => s.skip);
    const numbers = (r, s) => (r.count ? `${s}-${r.from} → ${s}-${r.to}` : '—');
    const usedTxt = (r) => (r.count ? (r.used.length ? `<span class="bad-t">${r.used.join(', ')} already used</span>` : `${r.count} invoices · none already used`) : '');
    const W = C.week;
    const rhythm = !date ? '' : [W.next && `${W.nextGap} days before ${dmy(W.next)}`, W.prev && `${W.prevGap} days after ${dmy(W.prev)}`].filter(Boolean).join(' · ') || 'no other weeks yet';
    const label = date ? `✓ Import week of ${dmy(date)}` : '✓ Import';

    main.innerHTML = `
<div class="crumb"><a id="toList">History</a> › Import from Excel</div>
<div class="top">
  <div><h2>Check before importing</h2>
    <div class="sub">📄 ${e(C.file)} · ${C.sheetCount} sheet${C.sheetCount === 1 ? '' : 's'} read${C.hiddenSheets.length ? ` (${C.hiddenSheets.length} hidden sheet${C.hiddenSheets.length === 1 ? '' : 's'} left out)` : ''} · nothing is saved until you import</div></div>
  <div class="actions"><button class="btn" id="impCancel">Cancel</button>
    <button class="btn p big" id="impGo" ${C.canImport ? '' : 'disabled'}>${label}</button></div>
</div>
${C.blocking.length ? `<div class="iblock"><b>Fix ${C.blocking.length === 1 ? 'this' : `these ${C.blocking.length} problems`} before importing:</b><ul>${C.blocking.slice(0, 8).map((x) => `<li>${e(x)}</li>`).join('')}${C.blocking.length > 8 ? `<li>… and ${C.blocking.length - 8} more (see the Check column)</li>` : ''}</ul></div>`
    : C.warnings ? `<div class="warnbox">⚠ <b>${C.warnings} warning${C.warnings === 1 ? ' needs' : 's need'} a decision</b> — one click each, in the Check column. Click a row to see and edit its lines.</div>`
      : `<div class="iready">✓ Ready to import: ${C.df.count + C.inv.count} invoices, Rs ${U.money(C.df.total + C.inv.total)}. ${C.fixes} automatic fix${C.fixes === 1 ? '' : 'es'} applied.</div>`}
${W.warnings.map(warnHtml).join('')}
<div class="stats istats">
  <div class="card"><span>Week date</span><input class="inp" type="date" id="impDate" value="${e(date || '')}">
    <div class="small muted">${e(rhythm)}${W.date && W.fileDate && W.date !== W.fileDate ? ` · file says ${dmy(W.fileDate)}` : ''}</div></div>
  <div class="card"><span>DF numbers</span><b>${numbers(C.df, 'DF')}</b><div class="small muted">${usedTxt(C.df)}</div></div>
  <div class="card"><span>INV numbers</span><b>${numbers(C.inv, 'INV')}</b><div class="small muted">${usedTxt(C.inv)}</div></div>
  <div class="card"><span>Vegetables (DF)</span><b>Rs ${U.money(C.df.total)}</b></div>
  <div class="card"><span>Pot. &amp; Onions (INV)</span><b>Rs ${U.money(C.inv.total)}</b></div>
</div>
<div class="table-wrap"><table class="imp"><thead><tr><th class="c">No</th><th>Dormitory</th><th>DF No</th><th class="r">Vegetables (Rs)</th>
  <th>INV No</th><th class="r">Pot. &amp; Onions (Rs)</th><th class="r">Total (Rs)</th><th>Check</th></tr></thead>
  <tbody>${rows || '<tr><td colspan="8" class="muted c" style="padding:20px">Every sheet is skipped.</td></tr>'}</tbody>
  <tfoot><tr class="total"><td></td><td>WEEK TOTAL</td><td></td><td class="r">${U.money(C.df.total)}</td><td></td><td class="r">${U.money(C.inv.total)}</td>
    <td class="r">${U.money(C.df.total + C.inv.total)}</td><td></td></tr></tfoot></table></div>
${skipped.length ? `<div class="card iskipped"><b>Skipped sheets</b> (not imported): ${skipped.map((s) => `<span class="chip">${e(s.name.trim())} <a class="link" data-unskip="${s.idx}">undo</a></span>`).join(' ')}</div>` : ''}`;

    const leave = () => { Views.history.imp = null; Views.history.weekId = null; App.go('history'); };
    U.$('#toList').onclick = U.$('#impCancel').onclick = async () => {
      if (await U.confirm('Leave without importing?', 'Nothing from this file has been saved.', 'Leave')) leave();
    };
    U.$('#impDate').onchange = (ev) => Views.history.impChange((d) => { d.date = ev.target.value || null; d.dateOk = ev.target.value || null; });
    U.$('#impGo').onclick = () => Views.history.doImport();
    main.querySelectorAll('[data-unskip]').forEach((a) => { a.onclick = () => Views.history.impChange((d) => { d.sheets[Number(a.dataset.unskip)].skip = false; }); });
    Views.history.bindImport(main);
  },

  // The item a line maps to: the items of that series, or a new item.
  mapSelect(sheet, line, series, current) {
    const list = App.state.products.filter((p) => !series || p.series === series);
    return `<select class="inp sm" data-mapsel="${sheet}.${line}"><option value="">${current ? '' : 'Choose the item…'}</option>
      ${list.map((p) => `<option value="${p.id}" ${current === p.id ? 'selected' : ''}>${U.esc(p.name)} (${U.esc(p.code)})</option>`).join('')}
      <option value="new">＋ Create a new item</option></select>`;
  },

  // Everything read from one sheet, editable: number, date, dorm, skip, and each line.
  sheetPanel(s, r, warnHtml) {
    const e = U.esc;
    const lines = s.lines.map((l) => {
      const out = r.lines.find((x) => x.idx === l.idx);
      const current = l.product_id || (l.newItem ? 'new' : null);
      return `<tr class="${l.remove ? 'removed' : ''} ${out && out.wrongSeries ? 'wrong' : ''}">
        <td><code>${e(l.codeRaw)}</code></td>
        <td>${l.remove ? e(l.desc) : l.newItem ? `<span class="pill imported">new</span> ${e(l.newItem.name)} <a class="link" data-unnew="${s.idx}.${l.idx}">change</a>`
          : Views.history.mapSelect(s.idx, l.idx, r.series, current)}</td>
        <td class="c">${l.remove ? '' : `<input class="inp sm num" data-qty="${s.idx}.${l.idx}" value="${l.qty ?? ''}">`}</td>
        <td>${e(out ? out.unit : l.unitRaw)}</td>
        <td class="r">${l.remove ? '' : `<input class="inp sm num" data-price="${s.idx}.${l.idx}" value="${l.price ?? ''}">`}</td>
        <td class="r">${out ? U.money(out.amount) : ''}${out && out.notes.length ? `<div class="small was">${e(out.notes.join(' · '))}</div>` : ''}</td>
        <td class="c">${l.remove ? `<a class="link" data-restore="${s.idx}.${l.idx}">undo</a>` : `<button class="icon-btn" data-remove="${s.idx}.${l.idx}" title="Leave this line out">✕</button>`}</td></tr>`;
    }).join('');
    return `<div class="ipanel">
      <div class="ip-head"><b>Sheet "${e(s.name.trim())}"</b>
        <label>Number <input class="inp sm" data-num="${s.idx}" value="${e(s.numberText || '')}" style="width:100px"></label>
        <label>Date <input class="inp sm" type="date" data-sdate="${s.idx}" value="${e(s.date || '')}"></label>
        <label>Dorm <select class="inp sm" data-sdorm="${s.idx}"><option value="">—</option>${App.state.dorms.map((d) => `<option value="${d.id}" ${s.dorm_id === d.id ? 'selected' : ''}>${d.no}. ${e(d.name)}</option>`).join('')}</select></label>
        <span class="muted small">${s.dorm_line ? `Dormitory line: ${e(s.dorm_line)}` : ''}${s.excelTotal !== null && s.excelTotal !== undefined ? ` · Excel total ${U.money(s.excelTotal)} (not used)` : ''}</span>
        <button class="btn sm danger" data-skip="${s.idx}">Skip this sheet</button></div>
      ${r.fixes.length ? `<div class="ifixes">${r.fixes.map((x) => `<span>✓ ${e(x)}</span>`).join('')}</div>` : ''}
      <table class="ilines"><thead><tr><th>Code in Excel</th><th>Item</th><th class="c">Qty</th><th>Unit</th><th class="r">Price (Rs)</th><th class="r">Amount (Rs)</th><th></th></tr></thead>
        <tbody>${lines || '<tr><td colspan="7" class="muted">No item lines.</td></tr>'}</tbody>
        <tfoot><tr><td colspan="5" class="r">${e(r.numberText || '')} total</td><td class="r"><b>${U.money(r.total)}</b></td><td></td></tr></tfoot></table></div>`;
  },

  bindImport(main) {
    const H = Views.history;
    const line = (d, key) => { const [si, li] = key.split('.').map(Number); return d.sheets[si].lines.find((x) => x.idx === li); };
    const num = (v) => { const n = U.num(v); return Number.isNaN(n) ? null : n; };
    main.onclick = (ev) => {
      const t = ev.target;
      const o = t.closest('[data-opt]');
      if (o) {
        const { sheet, line: li, set } = JSON.parse(o.dataset.opt);
        return H.impChange((d) => {
          const target = sheet === null ? d : li === null ? d.sheets[sheet] : d.sheets[sheet].lines.find((x) => x.idx === li);
          Object.assign(target, set);
        });
      }
      if (t.dataset.skip !== undefined) return H.impChange((d) => { d.sheets[Number(t.dataset.skip)].skip = true; });
      if (t.dataset.remove) return H.impChange((d) => { line(d, t.dataset.remove).remove = true; });
      if (t.dataset.restore) return H.impChange((d) => { line(d, t.dataset.restore).remove = false; });
      if (t.dataset.unnew) return H.impChange((d) => { const l = line(d, t.dataset.unnew); l.newItem = null; l.mapSource = null; });
      const tr = t.closest('tr.irow');
      if (tr && !t.closest('button,select,input,a')) {
        const key = tr.dataset.key;
        H.imp.open = H.imp.open.includes(key) ? H.imp.open.filter((k) => k !== key) : [...H.imp.open, key];
        const keep = main.scrollTop;
        H.renderImport(main);
        main.scrollTop = keep;
      }
      return undefined;
    };
    main.onchange = (ev) => {
      const t = ev.target;
      const d = t.dataset;
      if (d.num !== undefined) return H.impChange((x) => { x.sheets[Number(d.num)].numberText = t.value.trim(); });
      if (d.sdate !== undefined) return H.impChange((x) => { const s = x.sheets[Number(d.sdate)]; s.date = t.value || null; s.useWeekDate = false; });
      if (d.sdorm !== undefined || d.dormsel !== undefined) {
        const i = Number(d.sdorm ?? d.dormsel);
        return H.impChange((x) => { x.sheets[i].dorm_id = t.value ? Number(t.value) : null; x.sheets[i].dormChosen = !!t.value; x.sheets[i].dormConflict = null; });
      }
      if (d.qty) return H.impChange((x) => { const l = line(x, d.qty); l.qty = num(t.value); l.keepQty = false; });
      if (d.price) return H.impChange((x) => { const l = line(x, d.price); l.price = num(t.value); l.keepPrice = false; });
      if (d.mapsel) {
        return H.impChange((x) => {
          const l = line(x, d.mapsel);
          if (t.value === 'new') { l.product_id = null; l.newItem = { code: l.codeRaw.replace(/\s+/g, ''), name: l.desc || l.codeRaw, unit: 'Kg' }; l.mapSource = 'new'; } else { l.product_id = t.value ? Number(t.value) : null; l.newItem = null; l.mapSource = t.value ? 'chosen' : null; }
        });
      }
      return undefined;
    };
  },

  async doImport() {
    const I = Views.history.imp;
    const C = I.check;
    const n = C.df.count + C.inv.count;
    const ok = await U.confirm(`Import the week of ${U.date(C.week.date)}?`,
      `${n} invoices (${C.df.count} DF, ${C.inv.count} INV), Rs ${U.money(C.df.total + C.inv.total)}.<br>
       They are saved as <b>Imported</b> and locked like printed invoices. This week's prices come from the file; current prices do not change.`,
      '✓ Import');
    if (!ok) return;
    const r = await App.run(() => API.importWeek(I.draft), `Week of ${U.date(C.week.date)} imported.`);
    if (!r) return;
    Views.history.imp = null;
    await App.refresh();
    Views.history.weekId = r.weekId;
    App.go('history');
  },

  // On the week page: how a past week was added (file, fixes, item mappings, skipped sheets).
  pastSummary(p) {
    if (!p) return '';
    const e = U.esc;
    if (p.mode !== 'excel') {
      return `<div class="isummary">⌨️ <b>Typed in as a past week</b> on ${U.dayOf(p.at)}${p.entering ? ' — still being entered' : p.finished_at ? `, finished ${U.dayOf(p.finished_at)}` : ''}.</div>`;
    }
    return `<div class="isummary">📥 <b>Imported from ${e(p.file)}</b> on ${U.dayOf(p.at)} · ${p.imported} of ${p.sheets} sheets ·
      ${p.autofixes} automatic fix${p.autofixes === 1 ? '' : 'es'}
      ${p.mappings && p.mappings.length ? `<div>Item codes matched by hand: ${p.mappings.map((m) => `${e(m.from)} → ${e(m.to)} <span class="muted">(${e(m.invoice)})</span>`).join(' · ')}</div>` : ''}
      ${p.created && p.created.length ? `<div>New items created: ${p.created.map(e).join(', ')}</div>` : ''}
      ${p.skipped && p.skipped.length ? `<div>Skipped sheets: ${p.skipped.map(e).join(', ')}</div>` : ''}</div>`;
  },

  // Badge of a past week: added by typing or from Excel, locked like printed weeks once finished.
  pastPill(p) {
    if (p.entering) return '<span class="pill wait" title="Quantities are being typed in. Finish it on its grid.">✎ Entering past week</span>';
    return `<span class="pill imported" title="${p.mode === 'excel' ? `Imported from ${U.esc(p.file || 'Excel')}` : 'Typed in as a past week'}">📥 Imported</span>`;
  },
  // printed_at of an imported invoice is just the week date (no time).
  isImported: (inv) => !!inv.printed_at && inv.printed_at.length === 10,

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
    const printPill = W.past ? Views.history.pastPill(W.past) : !printedN ? '<span class="pill wait">Draft</span>'
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
${Views.history.pastSummary(W.past)}
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
        : invs.every(Views.history.isImported) ? '<span class="pill imported">📥 Imported</span>'
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
