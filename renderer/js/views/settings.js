// "Settings": company details, customer, dormitories, numbering, receipt format, backups.

window.Views = window.Views || {};

Views.settings = {
  async render(main) {
    const S = App.state.settings;
    const info = await API.dataInfo();
    const colors = ['#14a9e8', '#0b5c8a', '#2f7d4a', '#7a3db8', '#333333'];
    const f = (key, label, type = 'text') => `<div class="field"><label>${label}</label>
      ${type === 'textarea' ? `<textarea class="inp" data-k="${key}">${U.esc(S[key])}</textarea>`
        : `<input class="inp" data-k="${key}" type="${type}" value="${U.esc(S[key])}">`}</div>`;
    const t = (key, label) => `<label class="toggle"><input type="checkbox" data-k="${key}" ${S[key] ? 'checked' : ''}> ${label}</label>`;
    const hasWeeks = App.state.weeks.length > 0;

    main.innerHTML = `
<div class="top"><div><h2>Settings</h2><div class="sub">Change the receipt format and details any time. New prints use the new settings.</div></div>
  <div class="actions"><button class="btn p big" id="save">✓ Save settings</button></div></div>
<div class="grid3">
  <div class="card"><h3>Company</h3>
    ${f('company_name', 'Company name')}${f('company_tagline', 'Tagline')}${f('company_address', 'Address')}
    ${f('company_phone', 'Phone')}${f('company_emails', 'Emails (comma between)')}${f('company_brn', 'BRN')}</div>
  <div class="card"><h3>Customer &amp; numbering</h3>
    ${f('customer_name', 'Customer')}
    <div class="row2">${f('last_df', 'Last DF number', 'number')}${f('last_inv', 'Last INV number', 'number')}</div>
    ${f('last_date', 'Last delivery date', 'date')}
    <p class="small muted" style="margin-top:-4px">${hasWeeks
      ? 'Numbering already continues from the weeks in the app. These only matter if you need to jump forward.'
      : 'The first week will be 7 days after this date, starting from the next numbers.'}</p></div>
  <div class="card"><h3>Receipt format</h3>
    <div class="field"><label>Main colour</label><div class="swatches">
      ${colors.map((c) => `<span class="swatch ${S.color === c ? 'on' : ''}" data-c="${c}" style="background:${c}"></span>`).join('')}
      <input type="color" id="color" value="${U.esc(S.color)}" style="width:40px;height:32px;border:none;background:none"></div></div>
    ${f('note', 'Note', 'textarea')}${f('acknowledgment', 'Acknowledgment line')}
    <div class="field"><label>Signature labels</label><div class="row2">
      ${(S.signature_labels || []).map((l, i) => `<input class="inp" data-sig="${i}" value="${U.esc(l)}">`).join('')}</div></div>
    ${f('footer_text', 'Footer line')}
    ${t('print_copy', 'Print a COPY with each Original')}${t('show_part_payment', 'Show Part Payment row')}${t('show_footer', 'Show footer line')}
  </div>
</div>
<div style="display:grid;grid-template-columns:2fr 1fr;gap:18px;margin-top:18px;align-items:start">
  <div class="card"><h3>Dormitories</h3>
    <table id="dorms"><thead><tr><th style="width:60px">No</th><th>Name on receipt</th><th>Name on statement</th><th>Usual vehicle</th><th class="c">Active</th></tr></thead>
    <tbody>${App.state.dorms.map((d) => `<tr data-id="${d.id}">
      <td><input class="inp" name="no" value="${d.no}"></td><td><input class="inp" name="name" value="${U.esc(d.name)}"></td>
      <td><input class="inp" name="statement_name" value="${U.esc(d.statement_name)}"></td>
      <td><input class="inp" name="vehicle" value="${U.esc(d.vehicle)}"></td>
      <td class="c"><input type="checkbox" name="active" ${d.active ? 'checked' : ''}></td></tr>`).join('')}</tbody></table>
    <p class="small muted">Changes save automatically and apply to new weeks. <button class="btn sm" id="addDorm">＋ Add dormitory</button></p></div>
  <div class="card"><h3>Data &amp; backups</h3>
    <p class="small muted" style="margin-top:0;word-break:break-all">Saved in:<br>${U.esc(info.dbPath)}</p>
    <p class="small muted">A backup is made every time the app opens and closes (last 60 kept).</p>
    <button class="btn" id="backup" style="width:100%;margin-bottom:8px">💾 Backup now</button>
    <button class="btn" id="folder" style="width:100%;margin-bottom:8px">📂 Open data folder</button>
    <button class="btn danger" id="restore" style="width:100%">Restore a backup…</button></div>
</div>`;

    let color = S.color;
    U.$$('.swatch').forEach((sw) => { sw.onclick = () => { color = sw.dataset.c; U.$('#color').value = color; U.$$('.swatch').forEach((x) => x.classList.toggle('on', x === sw)); }; });
    U.$('#color').oninput = (e) => { color = e.target.value; U.$$('.swatch').forEach((x) => x.classList.remove('on')); };

    U.$('#save').onclick = async () => {
      const patch = { color, signature_labels: U.$$('[data-sig]').map((i) => i.value) };
      U.$$('[data-k]').forEach((i) => { patch[i.dataset.k] = i.type === 'checkbox' ? i.checked : i.value; });
      if (await App.run(() => API.saveSettings(patch), 'Settings saved.') !== undefined) { await App.refresh(); Views.settings.render(main); }
    };

    U.$('#dorms').addEventListener('change', async (e) => {
      const tr = e.target.closest('tr[data-id]');
      const get = (n) => U.$(`[name="${n}"]`, tr);
      const d = { id: Number(tr.dataset.id), no: Number(get('no').value), name: get('name').value,
        statement_name: get('statement_name').value, vehicle: get('vehicle').value, active: get('active').checked };
      const ok = await App.run(() => API.saveDorm(d), 'Dormitory saved.');
      await App.refresh();
      if (ok === undefined) Views.settings.render(main);
    });
    U.$('#addDorm').onclick = async () => {
      const next = Math.max(0, ...App.state.dorms.map((d) => d.no)) + 1;
      const v = await U.modal({ title: 'Add a dormitory', fields: [
        { name: 'no', label: 'No', value: String(next) }, { name: 'name', label: 'Name on receipt' },
        { name: 'statement_name', label: 'Name on statement (optional)' }, { name: 'vehicle', label: 'Usual vehicle' }], ok: 'Add' });
      if (!v) return;
      if (await App.run(() => API.saveDorm({ ...v, no: Number(v.no) }), 'Dormitory added.') !== undefined) { await App.refresh(); Views.settings.render(main); }
    };

    U.$('#backup').onclick = async () => { const f2 = await App.run(() => API.backupNow()); if (f2) U.toast('Backup saved.', 'ok'); };
    U.$('#folder').onclick = () => App.run(() => API.openDataFolder());
    U.$('#restore').onclick = () => App.run(() => API.restoreBackup());
  },
};
