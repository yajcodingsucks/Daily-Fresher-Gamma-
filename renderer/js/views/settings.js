// "Settings", in tabs: company, customer & numbering, dormitories, receipt format (with a live
// preview), statement format (with a live preview), backups.

window.Views = window.Views || {};

Views.settings = {
  tab: 'company',
  TABS: [
    ['company', 'Company'], ['customer', 'Customer & numbering'], ['dorms', 'Dormitories'],
    ['receipt', 'Receipt format'], ['statement', 'Statement format'], ['backups', 'Backups'], ['help', 'Help'],
  ],
  COLORS: ['#14a9e8', '#0b5c8a', '#2f7d4a', '#7a3db8', '#c0392b', '#333333'],
  TEMPLATES: [
    { key: 'modern', name: 'Modern blue', desc: 'The current design' },
    { key: 'classic', name: 'Classic (Excel)', desc: 'Like the Excel receipt' },
    { key: 'simple', name: 'Simple B&W', desc: 'Black and white, thin lines' },
  ],
  SHOW: [
    ['badge', 'ORIGINAL/COPY badge'], ['emails', 'Emails'], ['brn', 'BRN'], ['delivery', 'Delivery box'],
    ['vehicle', 'Vehicle No'], ['row_numbers', 'Row numbers'], ['part_payment', 'Part Payment'],
    ['amount_words', 'Amount in words'], ['signatures', 'Signatures'], ['acknowledgment', 'Acknowledgment'],
    ['footer', 'Footer'], ['watermark', 'COPY watermark'],
  ],

  NAME_OPTIONS: [['none', 'No name'], ['blank', 'Blank line to write name'], ['cook', "Cook's name (from dorm)"]],
  POSITIONS: [
    ['row', 'One row'], ['two', '2 per row'], ['excel', 'Excel style'],
    ['left', 'Stacked left'], ['right', 'Stacked right'], ['bottom', 'Bottom of page'],
  ],

  sub: 'design',     // Receipt format sub-tab: design | sigs
  draft: null,       // receipt format being edited
  sdraft: null,      // statement format being edited
  dirty: false,      // unsaved changes on the open tab
  pvLabel: 'ORIGINAL',
  pvSeries: 'DF',
  sample: null,      // invoices shown in the receipt preview
  drag: null,        // { list, from } while dragging a column or signature line

  clone: (x) => JSON.parse(JSON.stringify(x)),

  // Called before leaving the tab or the screen. Asks when there are unsaved changes.
  async canLeave() {
    const V = Views.settings;
    if (V.dirty) {
      const name = (V.TABS.find(([k]) => k === V.tab) || [, 'this tab'])[1];
      const ok = await U.confirm('Leave without saving?',
        `Your changes to <b>${U.esc(name)}</b> are not saved yet. If you leave now they are lost.`, 'Leave without saving', true);
      if (!ok) return false;
    }
    V.dirty = false;
    V.draft = null;
    V.sdraft = null;
    return true;
  },

  async render(main) {
    const V = Views.settings;
    window.onresize = null;
    main.innerHTML = `
<div class="top"><div><h2>Settings</h2><div class="sub" id="setSub"></div></div><div class="actions" id="setActions"></div></div>
<div class="tabs set-tabs">${V.TABS.map(([k, label]) => `<button data-tab="${k}" class="${k === V.tab ? 'on' : ''}">${U.esc(label)}</button>`).join('')}</div>
<div id="tabBody"></div>`;
    U.$$('[data-tab]').forEach((b) => {
      b.onclick = async () => {
        if (b.dataset.tab === V.tab || !(await V.canLeave())) return;
        V.tab = b.dataset.tab;
        V.render(main);
      };
    });
    await V[`tab_${V.tab}`](main, U.$('#tabBody'));
  },

  setTop(sub, actions = '') {
    U.$('#setSub').innerHTML = sub;
    U.$('#setActions').innerHTML = actions;
  },

  markDirty() {
    const V = Views.settings;
    V.dirty = true;
    const b = U.$('#saveBtn');
    if (b) b.disabled = false;
    const n = U.$('#unsaved');
    if (n) n.classList.remove('hidden');
  },
  saveButtons(label, reset = false) {
    return `<span class="pill wait hidden" id="unsaved">● Unsaved changes</span>
      ${reset ? '<button class="btn" id="reset">↺ Reset to default</button>' : ''}
      <button class="btn p big" id="saveBtn" disabled>${label}</button>`;
  },

  // ---------- Company / Customer & numbering ----------
  field(key, label, type = 'text') {
    const S = App.state.settings;
    return `<div class="field"><label>${label}</label>
      <input class="inp" data-k="${key}" type="${type}" value="${U.esc(S[key])}"></div>`;
  },
  bindSimple(main, body) {
    const V = Views.settings;
    body.addEventListener('input', () => V.markDirty());
    U.$('#saveBtn').onclick = async () => {
      const patch = {};
      U.$$('[data-k]', body).forEach((i) => { patch[i.dataset.k] = i.value; });
      if (await App.run(() => API.saveSettings(patch), 'Settings saved.') !== undefined) {
        V.dirty = false;
        await App.refresh();
        V.render(main);
      }
    };
  },

  async tab_company(main, body) {
    const V = Views.settings;
    V.setTop('Your details, printed at the top of every invoice and statement.', V.saveButtons('✓ Save settings'));
    body.innerHTML = `<div class="card set-card"><h3>Company</h3>
      ${V.field('company_name', 'Company name')}${V.field('company_tagline', 'Tagline')}${V.field('company_address', 'Address')}
      <div class="row2">${V.field('company_phone', 'Phone')}${V.field('company_brn', 'BRN')}</div>
      ${V.field('company_emails', 'Emails (comma between)')}
      <p class="small muted">The logo, colours and wording of the receipt are on <b>Receipt format</b>.</p></div>`;
    V.bindSimple(main, body);
  },

  async tab_customer(main, body) {
    const V = Views.settings;
    const hasWeeks = App.state.weeks.length > 0;
    V.setTop('Who the invoices are for, and where the invoice numbers continue from.', V.saveButtons('✓ Save settings'));
    body.innerHTML = `<div class="card set-card"><h3>Customer &amp; numbering</h3>
      ${V.field('customer_name', 'Customer')}
      <div class="row2">${V.field('last_df', 'Last DF number', 'number')}${V.field('last_inv', 'Last INV number', 'number')}</div>
      ${V.field('last_date', 'Last delivery date', 'date')}
      <p class="small muted" style="margin-top:-4px">${hasWeeks
        ? 'Numbering already continues from the weeks in the app. These only matter if you need to jump forward.'
        : 'The first week will be 7 days after this date, starting from the next numbers.'}</p></div>`;
    V.bindSimple(main, body);
  },

  // ---------- Dormitories ----------
  async tab_dorms(main, body) {
    const V = Views.settings;
    V.setTop('Changes save automatically and apply to new weeks.', '<button class="btn p" id="addDorm">＋ Add dormitory</button>');
    body.innerHTML = `<div class="card"><h3>Dormitories</h3>
    <table id="dorms"><thead><tr><th style="width:70px">No</th><th>Name on receipt</th><th>Name on statement</th><th>Usual vehicle</th><th>Cook's name</th><th class="c">Active</th></tr></thead>
    <tbody>${App.state.dorms.map((d) => `<tr data-id="${d.id}">
      <td><input class="inp" name="no" value="${d.no}"></td><td><input class="inp" name="name" value="${U.esc(d.name)}"></td>
      <td><input class="inp" name="statement_name" value="${U.esc(d.statement_name)}"></td>
      <td><input class="inp" name="vehicle" value="${U.esc(d.vehicle)}"></td>
      <td><input class="inp" name="cook_name" value="${U.esc(d.cook_name || '')}" placeholder="—"></td>
      <td class="c"><input type="checkbox" name="active" ${d.active ? 'checked' : ''}></td></tr>`).join('')}</tbody></table></div>`;

    U.$('#dorms').addEventListener('change', async (e) => {
      const tr = e.target.closest('tr[data-id]');
      const get = (n) => U.$(`[name="${n}"]`, tr);
      const d = { id: Number(tr.dataset.id), no: Number(get('no').value), name: get('name').value,
        statement_name: get('statement_name').value, vehicle: get('vehicle').value, cook_name: get('cook_name').value, active: get('active').checked };
      const ok = await App.run(() => API.saveDorm(d), 'Dormitory saved.');
      await App.refresh();
      if (ok === undefined) V.render(main);
    });
    U.$('#addDorm').onclick = async () => {
      const next = Math.max(0, ...App.state.dorms.map((d) => d.no)) + 1;
      const v = await U.modal({ title: 'Add a dormitory', fields: [
        { name: 'no', label: 'No', value: String(next) }, { name: 'name', label: 'Name on receipt' },
        { name: 'statement_name', label: 'Name on statement (optional)' }, { name: 'vehicle', label: 'Usual vehicle' }], ok: 'Add' });
      if (!v) return;
      if (await App.run(() => API.saveDorm({ ...v, no: Number(v.no) }), 'Dormitory added.') !== undefined) { await App.refresh(); V.render(main); }
    };
  },

  // ---------- Backups ----------
  async tab_backups(main, body) {
    const V = Views.settings;
    const info = await API.dataInfo();
    V.setTop('Where your data is kept, and copies to fall back on.');
    body.innerHTML = `<div class="card set-card"><h3>Data &amp; backups</h3>
    <p class="small muted" style="margin-top:0;word-break:break-all">Saved in:<br>${U.esc(info.dbPath)}</p>
    <p class="small muted">A backup is made every time the app opens and closes (last 60 kept).</p>
    <div class="set-btns"><button class="btn" id="backup">💾 Backup now</button>
    <button class="btn" id="folder">📂 Open data folder</button>
    <button class="btn danger" id="restore">Restore a backup…</button></div></div>`;
    U.$('#backup').onclick = async () => { const f2 = await App.run(() => API.backupNow()); if (f2) U.toast('Backup saved.', 'ok'); };
    U.$('#folder').onclick = () => App.run(() => API.openDataFolder());
    U.$('#restore').onclick = () => App.run(() => API.restoreBackup());
  },

  // ---------- Help → Check the app ----------
  // What to look at (or send) when the app misbehaves on a laptop: versions, Windows, data folder, error log.
  async tab_help(main, body) {
    const V = Views.settings;
    V.setTop('If something goes wrong on a laptop, check the app here and send the details.',
      '<button class="btn" id="copyCheck">📋 Copy details</button><button class="btn p" id="runCheck">🩺 Check again</button>');
    body.innerHTML = '<div class="card set-card help-card"><h3>Check the app</h3><div id="checkOut" class="muted">Checking…</div></div>';
    let text = '';
    const run = async () => {
      U.$('#checkOut').innerHTML = '<span class="muted">Checking…</span>';
      const c = await App.run(() => API.appCheck());
      if (!c) { U.$('#checkOut').innerHTML = '<div class="iw bad">The check could not run.</div>'; return; }
      const e = U.esc;
      const kb = (n) => (n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
      const h = c.health || {};
      const rows = [
        ['App version', `${c.app}${c.packaged ? '' : ' (development, npm start)'}`],
        ['Electron', `${c.electron} · Chrome ${c.chrome} · Node ${c.node}`],
        ['Windows', c.windows],
        ['Computer', `${c.cpu} · ${c.cores} cores · ${c.memoryGb} GB memory · ${c.machine} (app built for ${c.appArch})`],
        ['Graphics', c.graphics],
        ['Data folder', c.dataDir],
        ['Database', `${kb(c.dbSize)}, last saved ${c.dbSaved ? `${U.dayOf(c.dbSaved)} ${U.stamp(c.dbSaved).split(' · ')[1]}` : '—'}`],
        ['Database check', h.ok ? `✓ OK — ${h.weeks} weeks (${h.first ? `${U.date(h.first)} → ${U.date(h.last)}` : 'none'}), ${h.invoices} invoices, ${h.products} items, ${h.dorms} dorms`
          : `✗ ${h.error || h.integrity || 'problem'}`],
        ['Backups', `${c.backups} in ${c.backupDir}${c.lastBackup ? ` · newest ${c.lastBackup}` : ''}`],
        ['Error log', c.errorLogSize ? `${c.errorLog} (${kb(c.errorLogSize)})` : 'No errors logged ✓'],
        ['App file', c.exe],
      ];
      text = rows.map(([k, v]) => `${k}: ${v}`).join('\n') + (c.errorLogTail ? `\n\nEnd of error.log:\n${c.errorLogTail}` : '');
      U.$('#checkOut').innerHTML = `<table class="kvtable">${rows.map(([k, v]) => `<tr><th>${e(k)}</th><td class="${/^✗/.test(v) ? 'bad-t' : ''}">${e(v)}</td></tr>`).join('')}</table>
        <div class="set-btns" style="margin-top:12px"><button class="btn" id="openLog" ${c.errorLogSize ? '' : 'disabled'}>📄 Open error log</button>
          <button class="btn" id="openData">📂 Open data folder</button></div>
        ${c.errorLogTail ? `<details class="logtail"><summary>Last lines of error.log</summary><pre>${e(c.errorLogTail)}</pre></details>` : ''}`;
      U.$('#openLog').onclick = () => App.run(() => API.openErrorLog());
      U.$('#openData').onclick = () => App.run(() => API.openDataFolder());
    };
    U.$('#runCheck').onclick = run;
    U.$('#copyCheck').onclick = async () => {
      try { await navigator.clipboard.writeText(text); U.toast('Details copied. Paste them in a message or email.', 'ok'); } catch (err) { U.toast(`Could not copy: ${err.message}`, 'err'); }
    };
    await run();
  },

  // ---------- shared by Receipt format and Statement format ----------
  swatches(color) {
    const V = Views.settings;
    return `<div class="swatches">${V.COLORS.map((c) => `<span class="swatch ${color === c ? 'on' : ''}" data-c="${c}" style="background:${c}" title="${c}"></span>`).join('')}
      <input type="color" id="color" value="${U.esc(color)}" title="Choose any colour"></div>`;
  },
  seg(obj, key, options) {
    return `<div class="seg" data-set="${key}">${options.map(([v, l]) => `<button data-v="${v}" class="${obj[key] === v ? 'on' : ''}">${l}</button>`).join('')}</div>`;
  },
  // Scale a page preview to the width of its box.
  fitFrame(w, h) {
    const pv = U.$('#pv');
    const frame = U.$('#frame');
    if (!pv || !frame) return;
    const scale = Math.min(1, (pv.clientWidth - 40) / w);
    frame.style.width = `${w}px`;
    frame.style.height = `${h}px`;
    frame.style.transform = `scale(${scale})`;
    frame.style.marginBottom = `${(scale - 1) * h}px`;
    frame.style.marginLeft = frame.style.marginRight = `${((scale - 1) * w) / 2}px`;
  },

  // ---------- Receipt format ----------
  async tab_receipt(main, body) {
    const V = Views.settings;
    if (!V.draft) V.draft = V.clone(App.state.settings.receipt_format);
    V.setTop('How invoices look on paper. Every print uses it, old invoices too.', V.saveButtons('✓ Save receipt format', true));
    body.innerHTML = `<div class="fmt-layout">
  <div class="fmt-opts" id="opts"></div>
  <div class="fmt-pv">
    <div class="fmt-bar">
      <div class="seg" id="pvLabel"><button data-v="ORIGINAL">Original</button><button data-v="COPY">Copy</button></div>
      <div class="seg" id="pvSeries"><button data-v="DF">DF</button><button data-v="INV">INV</button></div>
      <span class="small muted" id="pvInfo"></span>
      <button class="btn" id="testPrint">🖨 Test print</button>
    </div>
    <div class="preview" id="pv"><iframe id="frame" title="Receipt preview"></iframe></div>
  </div>
</div>`;
    await V.loadSample();
    V.drawOpts();
    V.preview();
    V.bindReceipt(main);
    window.onresize = () => V.fitFrame(...Receipt.pagePx(V.draft));
  },

  // The preview shows a real invoice from the latest week (the one with the most items),
  // or a made-up one when there are no weeks yet.
  async loadSample() {
    const V = Views.settings;
    const st = App.state;
    const W = st.weeks.length ? await API.getWeek(st.weeks[0].id) : null;
    const products = W ? W.products : st.products;
    const pick = (series) => {
      const best = W && W.invoices.filter((i) => i.series === series && i.lines.length)
        .sort((a, b) => b.lines.length - a.lines.length)[0];
      if (best) return { inv: best, real: true };
      const ps = products.filter((p) => p.series === series && p.active).slice(0, series === 'DF' ? 12 : 2);
      const lines = ps.map((p, i) => ({ product_id: p.id, qty: (i % 5) + 2, unit_price: p.price || 50 }));
      const total = Math.round(lines.reduce((t, l) => t + l.qty * l.unit_price, 0) * 100) / 100;
      const d = st.dorms[0] || { name: 'Dormitory', no: 1, vehicle: '' };
      return { real: false, inv: { series, number: series === 'DF' ? st.plan.dfStart : st.plan.invStart, dorm_name: d.name,
        dorm_no: d.no, vehicle: d.vehicle, lines, total, part_payment: 0, balance: total } };
    };
    V.sample = { week: W ? W.week : { date: st.plan.date }, products, DF: pick('DF'), INV: pick('INV') };
  },

  previewHtml(script) {
    const V = Views.settings;
    const S = { ...App.state.settings, receipt_format: V.draft };
    // the cook's name a print made now would show
    const inv = { ...V.sample[V.pvSeries].inv };
    const dorm = App.state.dorms.find((d) => d.no === inv.dorm_no);
    inv.cook_name = dorm ? dorm.cook_name || '' : '';
    return Receipt.build(S, V.sample.week, [inv], V.sample.products, [V.pvLabel], { script });
  },

  preview() {
    const V = Views.settings;
    const frame = U.$('#frame');
    if (!frame) return;
    const { inv, real } = V.sample[V.pvSeries];
    U.$('#pvInfo').textContent = `${inv.series}-${inv.number} · ${inv.dorm_name} · ${inv.lines.length} item${inv.lines.length === 1 ? '' : 's'}${real ? '' : ' (example)'}`;
    U.$$('#pvLabel button').forEach((b) => b.classList.toggle('on', b.dataset.v === V.pvLabel));
    U.$$('#pvSeries button').forEach((b) => b.classList.toggle('on', b.dataset.v === V.pvSeries));
    Receipt.show(frame, V.previewHtml(false));
    V.fitFrame(...Receipt.pagePx(V.draft));
  },
  schedulePreview() {
    const V = Views.settings;
    clearTimeout(V.pvTimer);
    V.pvTimer = setTimeout(() => V.preview(), 40);
  },

  drawOpts() {
    const V = Views.settings;
    const f = V.draft;
    const opts = U.$('#opts');
    const keep = opts.scrollTop;
    const colOn = (k) => f.columns.find((c) => c.key === k).on;
    const isOn = (k) => (k === 'row_numbers' ? colOn('no') : f.show[k]);
    const always = ['desc', 'amount'];
    const design = `
<section class="card fsec"><h3>Layout</h3>
  <div class="tpls">${V.TEMPLATES.map((t) => `<button class="tpl ${f.template === t.key ? 'on' : ''}" data-tpl="${t.key}">
    <span class="thumb ${t.key}" style="--c:${t.key === 'simple' ? '#222' : f.color}"><i class="h"></i><i class="l"></i><i class="t"></i><i class="t"></i><i class="t"></i><i class="s"></i></span>
    <b>${t.name}</b><small>${t.desc}</small></button>`).join('')}</div>
</section>
<section class="card fsec"><h3>Colour &amp; logo</h3>
  <div class="field"><label>Colour</label>${V.swatches(f.color)}
    ${f.template === 'simple' ? '<p class="small muted" style="margin:6px 0 0">Simple B&amp;W prints in black only, so the colour is not used.</p>' : ''}</div>
  <div class="field"><label>Logo</label>
    <div class="logo-row">${f.logo ? `<img class="logo-thumb" src="${f.logo}" alt="Logo">` : '<span class="logo-none">No logo</span>'}
      <button class="btn sm" id="logoPick">${f.logo ? 'Change…' : '⬆ Upload logo…'}</button>
      ${f.logo ? '<button class="btn sm danger" id="logoRemove">Remove</button>' : ''}
      <input type="file" id="logoFile" accept="image/png,image/jpeg" hidden></div>
    <p class="small muted" style="margin:6px 0 0">PNG or JPG, up to 1 MB. Shown top-left (top-centre on Classic).</p></div>
  <div class="field"><label>Text size</label>${V.seg(f, 'text_size', [['small', 'Small'], ['normal', 'Normal'], ['large', 'Large']])}</div>
</section>
<section class="card fsec"><h3>Show on receipt</h3>
  <div class="chips">${V.SHOW.map(([k, l]) => `<button class="chip ${isOn(k) ? 'on' : ''}" data-show="${k}">${isOn(k) ? '✓ ' : ''}${l}</button>`).join('')}</div>
</section>
<section class="card fsec"><h3>Table columns</h3>
  <p class="small muted" style="margin-top:-6px">Untick to hide. Drag <b>⋮⋮</b> to change the order.</p>
  <div class="dlist" data-list="columns">${f.columns.map((c, i) => `<div class="drow" data-i="${i}"><span class="grip" title="Drag to move">⋮⋮</span>
    <label><input type="checkbox" data-col="${c.key}" ${c.on ? 'checked' : ''} ${always.includes(c.key) ? 'disabled' : ''}> ${Receipt.COLUMNS[c.key].label}</label>
    ${always.includes(c.key) ? '<span class="small muted">always shown</span>' : ''}</div>`).join('')}</div>
</section>
<section class="card fsec"><h3>Wording</h3>
  <div class="field"><label>Title</label><input class="inp" data-w="title" value="${U.esc(f.title)}" placeholder="Sales Invoice"></div>
  <div class="field"><label>Note</label><textarea class="inp" data-w="note">${U.esc(f.note)}</textarea></div>
  <div class="field"><label>Acknowledgment</label><input class="inp" data-w="acknowledgment" value="${U.esc(f.acknowledgment)}"></div>
  <div class="field"><label>Footer</label><input class="inp" data-w="footer" value="${U.esc(f.footer)}"></div>
</section>
<section class="card fsec"><h3>Paper &amp; printing</h3>
  <div class="field"><label>Paper</label>${V.seg(f, 'paper', [['A4', 'A4'], ['A5', 'A5'], ['Letter', 'Letter']])}</div>
  <div class="field"><label>Margins</label>${V.seg(f, 'margins', [['narrow', 'Narrow'], ['normal', 'Normal'], ['wide', 'Wide']])}</div>
  <div class="field"><label>Copies</label>${V.seg(f, 'copies', [['original', 'Original only'], ['original_copy', 'Original + Copy']])}</div>
  <div class="field"><label>Empty rows</label>${V.seg(f, 'empty_rows', [['none', 'None'], ['fill15', 'Fill to 15 rows']])}</div>
</section>`;

    const sigs = `
${f.show.signatures ? '' : `<div class="warnbox small">Signatures are switched off under <b>Design → Show on receipt</b>, so none are printed.
  <button class="btn sm" id="sigsOn">Switch on</button></div>`}
<section class="card fsec"><h3>Signature lines <span class="small muted">${f.signatures.length} of 6</span></h3>
  <p class="small muted" style="margin-top:-6px">Drag <b>⠿</b> to change the order. The name is printed above the line.</p>
  <div class="dlist" data-list="signatures">${f.signatures.map((l, i) => `<div class="drow sigrow" data-i="${i}"><span class="grip" title="Drag to move">⠿</span>
    <div class="sigf"><input class="inp" data-sig="${i}" value="${U.esc(l.label)}" placeholder="Label under the line">
      <select class="inp" data-signame="${i}">${V.NAME_OPTIONS.map(([v, t]) => `<option value="${v}" ${l.name === v ? 'selected' : ''}>${t}</option>`).join('')}</select></div>
    <button class="btn sm" data-sigdel="${i}" title="Remove this line">✕</button></div>`).join('')
    || '<p class="small muted">No signature lines.</p>'}</div>
  <button class="btn sm" id="sigAdd" ${f.signatures.length >= 6 ? 'disabled' : ''}>＋ Add signature line</button>
</section>
<section class="card fsec"><h3>Position</h3>
  <div class="poss">${V.POSITIONS.map(([k, label]) => `<button class="pos ${f.sig_position === k ? 'on' : ''}" data-pos="${k}">
    <span class="pthumb p-${k}"><i></i><i></i><i></i></span><b>${label}</b></button>`).join('')}</div>
  <p class="small muted" style="margin:8px 0 0">${{
    row: 'All lines side by side under the totals.',
    two: 'Two lines per row, like the first version of the app.',
    excel: 'The first two on one line, the others stacked under them on the right, like the Excel receipt.',
    left: 'One under the other, on the left.',
    right: 'One under the other, on the right.',
    bottom: 'In one row at the bottom of the page, whatever the length of the invoice.',
  }[f.sig_position]} The acknowledgment line stays under them.</p>
</section>
<section class="card fsec"><h3>Cook names</h3>
  <p class="small muted" style="margin-top:-6px">Printed on a <b>Cook's name</b> line. Saved straight away (also on the Dormitories tab).
    Printed invoices keep the name they were printed with.</p>
  ${App.state.dorms.map((d) => `<div class="cook-row ${d.active ? '' : 'muted'}"><label for="cook${d.id}">${d.no}. ${U.esc(d.name)}</label>
    <input class="inp" id="cook${d.id}" data-cook="${d.id}" value="${U.esc(d.cook_name || '')}" placeholder="No name yet"></div>`).join('')}
</section>`;

    opts.innerHTML = `<div class="seg fmt-sub"><button data-sub="design" class="${V.sub === 'design' ? 'on' : ''}">Design</button>
      <button data-sub="sigs" class="${V.sub === 'sigs' ? 'on' : ''}">Signatures</button></div>
${V.sub === 'sigs' ? sigs : design}`;
    opts.scrollTop = keep;
  },

  bindReceipt(main) {
    const V = Views.settings;
    const opts = U.$('#opts');
    const f = () => V.draft;
    const changed = (redraw) => { V.markDirty(); if (redraw) V.drawOpts(); V.schedulePreview(); };

    opts.addEventListener('click', (e) => {
      const t = e.target;
      const sub = t.closest('[data-sub]');
      if (sub) { V.sub = sub.dataset.sub; opts.scrollTop = 0; V.drawOpts(); return undefined; }
      const pos = t.closest('[data-pos]');
      if (pos) { f().sig_position = pos.dataset.pos; return changed(true); }
      if (t.id === 'sigsOn') { f().show.signatures = true; return changed(true); }
      const tpl = t.closest('[data-tpl]');
      if (tpl) { f().template = tpl.dataset.tpl; return changed(true); }
      const sw = t.closest('.swatch');
      if (sw) { f().color = sw.dataset.c; return changed(true); }
      const segBtn = t.closest('[data-set] button');
      if (segBtn) { f()[segBtn.parentElement.dataset.set] = segBtn.dataset.v; return changed(true); }
      const chip = t.closest('[data-show]');
      if (chip) {
        const k = chip.dataset.show;
        if (k === 'row_numbers') { const c = f().columns.find((x) => x.key === 'no'); c.on = !c.on; } else f().show[k] = !f().show[k];
        return changed(true);
      }
      const del = t.closest('[data-sigdel]');
      if (del) { f().signatures.splice(Number(del.dataset.sigdel), 1); return changed(true); }
      if (t.id === 'sigAdd') {
        if (f().signatures.length >= 6) return undefined;
        f().signatures.push({ label: 'Signature', name: 'none' });
        changed(true);
        const inputs = U.$$('[data-sig]');
        const last = inputs[inputs.length - 1];
        if (last) { last.focus(); last.select(); }
        return undefined;
      }
      if (t.id === 'logoPick') return U.$('#logoFile').click();
      if (t.id === 'logoRemove') { f().logo = ''; return changed(true); }
      return undefined;
    });
    opts.addEventListener('input', (e) => {
      const t = e.target;
      if (t.id === 'color') {
        f().color = t.value.toLowerCase();
        U.$$('.swatch').forEach((x) => x.classList.toggle('on', x.dataset.c === f().color));
        U.$$('.thumb.modern, .thumb.classic').forEach((x) => x.style.setProperty('--c', f().color));
        return changed(false);
      }
      if (t.dataset.w) { f()[t.dataset.w] = t.value; return changed(false); }
      if (t.dataset.sig !== undefined) { f().signatures[Number(t.dataset.sig)].label = t.value; return changed(false); }
      return undefined;
    });
    opts.addEventListener('change', (e) => {
      const t = e.target;
      if (t.dataset.col) { f().columns.find((c) => c.key === t.dataset.col).on = t.checked; changed(true); }
      if (t.dataset.signame !== undefined) { f().signatures[Number(t.dataset.signame)].name = t.value; changed(false); }
      if (t.dataset.cook) V.saveCook(Number(t.dataset.cook), t.value);
      if (t.id === 'logoFile' && t.files[0]) V.readLogo(t.files[0]).then((url) => { if (url) { f().logo = url; changed(true); } });
    });
    V.bindDrag(opts, (list, from, to) => {
      const arr = f()[list];
      const [item] = arr.splice(from, 1);
      arr.splice(to, 0, item);
      changed(true);
    });

    U.$$('#pvLabel button').forEach((b) => { b.onclick = () => { V.pvLabel = b.dataset.v; V.preview(); }; });
    U.$$('#pvSeries button').forEach((b) => { b.onclick = () => { V.pvSeries = b.dataset.v; V.preview(); }; });

    U.$('#testPrint').onclick = async () => {
      const { inv } = V.sample[V.pvSeries];
      const mode = await U.choose('Test print',
        `Prints the preview (${inv.series}-${inv.number}, ${V.pvLabel === 'COPY' ? 'Copy' : 'Original'}) on ${f().paper} paper,
         with your changes even if they are not saved yet. Nothing is marked as printed.`,
        [{ label: '🖨 Print…', value: 'print' }, { label: '📄 Save as PDF', value: 'pdf' }]);
      if (!mode) return;
      const r = await App.run(() => API.print(V.previewHtml(true), mode, `Test receipt ${f().paper}.pdf`, f().paper));
      if (r && r.done) U.toast(mode === 'pdf' ? 'PDF saved.' : 'Sent to printer.', 'ok');
    };
    U.$('#reset').onclick = async () => {
      const ok = await U.confirm('Reset the receipt format?',
        'This puts back the original Modern blue design: colour, wording, signature lines, columns and paper. The logo is removed.<br>Nothing is saved until you click <b>Save receipt format</b>.', 'Reset');
      if (!ok) return;
      V.draft = V.clone(App.state.formatDefaults.receipt);
      changed(true);
    };
    U.$('#saveBtn').onclick = async () => {
      if (await App.run(() => API.saveSettings({ receipt_format: V.draft }), 'Receipt format saved.') === undefined) return;
      V.dirty = false;
      V.draft = null;
      await App.refresh();
      V.render(main);
    };
  },

  // Cook names are dorm details, so they save at once (not with the receipt format).
  async saveCook(dormId, name) {
    const d = App.state.dorms.find((x) => x.id === dormId);
    if (!d) return;
    if (await App.run(() => API.saveDorm({ ...d, cook_name: name }), name.trim() ? `Cook's name saved for ${d.name}.` : `Cook's name removed for ${d.name}.`) === undefined) return;
    const dorms = await API.listDorms();
    App.state.dorms = dorms;
    Views.settings.schedulePreview();
  },

  // Drag-and-drop to reorder the rows of a .dlist (only by the ⋮⋮ grip, so typing in a row still works).
  bindDrag(root, move) {
    const V = Views.settings;
    const clear = () => U.$$('.drow', root).forEach((r) => { r.classList.remove('dragging', 'over-top', 'over-bottom'); r.draggable = false; });
    root.addEventListener('mousedown', (e) => { const g = e.target.closest('.grip'); if (g) g.parentElement.draggable = true; });
    root.addEventListener('mouseup', () => { if (!V.drag) clear(); });
    root.addEventListener('dragstart', (e) => {
      const row = e.target.closest && e.target.closest('.drow');
      if (!row) return;
      V.drag = { list: row.parentElement.dataset.list, from: Number(row.dataset.i) };
      if (e.dataTransfer) { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', ''); }
      row.classList.add('dragging');
    });
    const target = (e) => {
      const row = e.target.closest && e.target.closest('.drow');
      if (!row || !V.drag || row.parentElement.dataset.list !== V.drag.list) return null;
      const r = row.getBoundingClientRect();
      return { row, after: e.clientY > r.top + r.height / 2 };
    };
    root.addEventListener('dragover', (e) => {
      const t = target(e);
      if (!t) return;
      e.preventDefault();
      U.$$('.drow', root).forEach((r) => r.classList.remove('over-top', 'over-bottom'));
      t.row.classList.add(t.after ? 'over-bottom' : 'over-top');
    });
    root.addEventListener('drop', (e) => {
      const t = target(e);
      if (!t) return;
      e.preventDefault();
      const { list, from } = V.drag;
      let to = Number(t.row.dataset.i) + (t.after ? 1 : 0);
      if (to > from) to -= 1;
      V.drag = null;
      clear();
      if (to !== from) move(list, from, to);
    });
    root.addEventListener('dragend', () => { V.drag = null; clear(); });
  },

  // Read a PNG/JPG logo as a data URL; very large pictures are made smaller so printing stays quick.
  async readLogo(file) {
    if (!/^image\/(png|jpeg)$/.test(file.type)) { U.toast('Please choose a PNG or JPG picture.', 'err'); return null; }
    if (file.size > 1024 * 1024) { U.toast('That picture is larger than 1 MB. Please choose a smaller one.', 'err'); return null; }
    const url = await new Promise((resolve) => { const r = new FileReader(); r.onload = () => resolve(r.result); r.readAsDataURL(file); });
    const img = new Image();
    const ok = await new Promise((resolve) => { img.onload = () => resolve(true); img.onerror = () => resolve(false); img.src = url; });
    if (!ok) { U.toast('That picture could not be opened.', 'err'); return null; }
    const MAX = 900;
    if (img.width <= MAX && img.height <= MAX) return url;
    const k = MAX / Math.max(img.width, img.height);
    const c = document.createElement('canvas');
    c.width = Math.round(img.width * k);
    c.height = Math.round(img.height * k);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL(file.type, 0.92);
  },

  // ---------- Statement format ----------
  async tab_statement(main, body) {
    const V = Views.settings;
    if (!V.sdraft) V.sdraft = V.clone(App.state.settings.statement_format);
    V.setTop('How the monthly statement looks on paper.', V.saveButtons('✓ Save statement format', true));
    const months = await API.listMonths();
    V.stMonth = months.length ? await API.monthly(months[0].month) : null;
    body.innerHTML = `<div class="fmt-layout">
  <div class="fmt-opts" id="opts"></div>
  <div class="fmt-pv">
    <div class="fmt-bar"><span class="small muted" id="pvInfo">${V.stMonth ? `Preview: ${U.monthName(V.stMonth.month)} (the latest month)` : ''}</span></div>
    <div class="preview" id="pv">${V.stMonth ? '<iframe id="frame" title="Statement preview"></iframe>'
      : '<div class="empty card" style="margin:40px auto">The preview appears once there is a week with invoices.</div>'}</div>
  </div>
</div>`;
    V.drawStatementOpts();
    V.statementPreview();
    V.bindStatement(main);
    window.onresize = () => V.fitStatement();
  },

  drawStatementOpts() {
    const V = Views.settings;
    const f = V.sdraft;
    const hasLogo = !!App.state.settings.receipt_format.logo;
    const tog = (key, label, disabled = false) => `<label class="toggle ${disabled ? 'muted' : ''}"><input type="checkbox" data-st="${key}" ${f[key] ? 'checked' : ''} ${disabled ? 'disabled' : ''}> ${label}</label>`;
    U.$('#opts').innerHTML = `
<section class="card fsec"><h3>Colour &amp; logo</h3>
  <div class="field"><label>Colour</label>${V.swatches(f.color)}</div>
  ${tog('logo', 'Show the logo', !hasLogo)}
  <p class="small muted" style="margin:0">${hasLogo ? 'The same logo as on the receipts.' : 'Upload a logo on <b>Receipt format</b> first.'}</p>
</section>
<section class="card fsec"><h3>Wording</h3>
  <div class="field"><label>Title</label><input class="inp" data-sw="title" value="${U.esc(f.title)}" placeholder="Monthly Statement"></div>
  <div class="field"><label>Footer</label><input class="inp" data-sw="footer" value="${U.esc(f.footer)}" placeholder="(none)"></div>
</section>
<section class="card fsec"><h3>Show on statement</h3>
  ${tog('show_summary', 'Summary by dormitory (page 2)')}
  ${tog('show_payment', 'Amount due and payment received boxes')}
</section>`;
  },

  statementPreview() {
    const V = Views.settings;
    const frame = U.$('#frame');
    if (!frame || !V.stMonth) return;
    const S = { ...App.state.settings, statement_format: V.sdraft };
    frame.onload = () => V.fitStatement();
    frame.srcdoc = Statement.build(S, V.stMonth).replace('</head>', `<style>${Views.monthly.previewCss}</style></head>`);
  },
  fitStatement() {
    const frame = U.$('#frame');
    if (!frame || !frame.contentDocument || !frame.contentDocument.body) return;
    Views.settings.fitFrame(794, frame.contentDocument.documentElement.scrollHeight);
  },

  bindStatement(main) {
    const V = Views.settings;
    const opts = U.$('#opts');
    const changed = (redraw) => {
      V.markDirty();
      if (redraw) V.drawStatementOpts();
      clearTimeout(V.pvTimer);
      V.pvTimer = setTimeout(() => V.statementPreview(), 40);
    };
    opts.addEventListener('click', (e) => {
      const sw = e.target.closest('.swatch');
      if (sw) { V.sdraft.color = sw.dataset.c; changed(true); }
    });
    opts.addEventListener('input', (e) => {
      const t = e.target;
      if (t.id === 'color') {
        V.sdraft.color = t.value.toLowerCase();
        U.$$('.swatch').forEach((x) => x.classList.toggle('on', x.dataset.c === V.sdraft.color));
        changed(false);
      } else if (t.dataset.sw) { V.sdraft[t.dataset.sw] = t.value; changed(false); }
    });
    opts.addEventListener('change', (e) => {
      if (e.target.dataset.st) { V.sdraft[e.target.dataset.st] = e.target.checked; changed(false); }
    });
    U.$('#reset').onclick = async () => {
      const ok = await U.confirm('Reset the statement format?',
        'This puts back the original colour, title, and both pages. Nothing is saved until you click <b>Save statement format</b>.', 'Reset');
      if (!ok) return;
      V.sdraft = V.clone(App.state.formatDefaults.statement);
      changed(true);
    };
    U.$('#saveBtn').onclick = async () => {
      if (await App.run(() => API.saveSettings({ statement_format: V.sdraft }), 'Statement format saved.') === undefined) return;
      V.dirty = false;
      V.sdraft = null;
      await App.refresh();
      V.render(main);
    };
  },
};
