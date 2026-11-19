// "Products & Prices": the list of items, their codes, units, invoice type and starting price.

window.Views = window.Views || {};

Views.products = {
  filter: 'ALL',
  search: '',

  async render(main) {
    const S = App.state;
    const list = S.products
      .filter((p) => Views.products.filter === 'ALL' || p.series === Views.products.filter)
      .filter((p) => !Views.products.search || `${p.code} ${p.name}`.toLowerCase().includes(Views.products.search.toLowerCase()));
    const unitOpts = '<datalist id="units"><option>Kg</option><option>Pcs</option><option>Bundle</option><option>Box</option></datalist>';
    const row = (p) => `<tr data-id="${p.id}" class="${p.active ? '' : 'muted'}">
      <td><input class="inp" name="code" value="${U.esc(p.code)}"></td>
      <td><input class="inp" name="name" value="${U.esc(p.name)}"></td>
      <td style="width:110px"><input class="inp" name="unit" list="units" value="${U.esc(p.unit)}"></td>
      <td style="width:150px"><select class="inp" name="series">
        <option value="DF" ${p.series === 'DF' ? 'selected' : ''}>DF · Vegetables</option>
        <option value="INV" ${p.series === 'INV' ? 'selected' : ''}>INV · Onions/Potatoes</option></select></td>
      <td style="width:120px"><input class="inp r" name="price" value="${p.price.toFixed(2)}" inputmode="decimal"></td>
      <td class="c" style="width:70px"><input type="checkbox" name="active" ${p.active ? 'checked' : ''}></td>
      <td style="width:80px"><button class="btn sm danger" data-del="${p.id}">Delete</button></td></tr>`;

    main.innerHTML = `${unitOpts}
<div class="top"><div><h2>Products &amp; Prices</h2>
  <div class="sub">Changes save automatically. The price here is the starting price for the next new week —
  this week's prices are changed on the This Week grid.</div></div>
  <div class="actions"><button class="btn p big" id="add">＋ Add item</button></div></div>
<div class="toolbar" style="margin-bottom:12px">
  <div class="tabs" style="margin:0">${['ALL', 'DF', 'INV'].map((f) => `<button data-f="${f}" class="${Views.products.filter === f ? 'on' : ''}">
    ${{ ALL: 'All', DF: 'DF · Vegetables', INV: 'INV · Onions & Potatoes' }[f]}</button>`).join('')}</div>
  <input class="inp" id="search" placeholder="Search code or name…" style="width:260px" value="${U.esc(Views.products.search)}">
</div>
<div class="table-wrap"><table id="ptable"><thead><tr><th>Item code</th><th>Description</th><th>Unit</th><th>Invoice</th>
  <th class="r">Price (Rs)</th><th class="c">Active</th><th></th></tr></thead>
  <tbody>${list.map(row).join('') || '<tr><td colspan="7" class="muted c" style="padding:24px">No items match.</td></tr>'}</tbody></table></div>`;

    U.$$('[data-f]').forEach((b) => { b.onclick = () => { Views.products.filter = b.dataset.f; Views.products.render(main); }; });
    const search = U.$('#search');
    search.oninput = () => { Views.products.search = search.value; Views.products.render(main).then(() => { const s = U.$('#search'); s.focus(); s.setSelectionRange(s.value.length, s.value.length); }); };

    U.$('#ptable').addEventListener('change', async (e) => {
      const tr = e.target.closest('tr[data-id]');
      if (!tr) return;
      const get = (n) => U.$(`[name="${n}"]`, tr);
      const price = U.num(get('price').value);
      if (Number.isNaN(price)) { U.toast('Please type a price, like 85 or 85.50', 'err'); return; }
      const p = { id: Number(tr.dataset.id), code: get('code').value, name: get('name').value, unit: get('unit').value,
        series: get('series').value, price, active: get('active').checked };
      const ok = await App.run(() => API.saveProduct(p), 'Saved.');
      await App.refresh();
      if (ok === undefined) Views.products.render(main);
      else tr.classList.toggle('muted', !p.active);
    });
    U.$('#ptable').addEventListener('click', async (e) => {
      const b = e.target.closest('[data-del]');
      if (!b) return;
      const p = App.state.products.find((x) => x.id === Number(b.dataset.del));
      if (!await U.confirm(`Delete ${p.name}?`, 'If it is already on invoices it will just be hidden (made inactive), so old invoices stay correct.', 'Delete', true)) return;
      const r = await App.run(() => API.deleteProduct(p.id));
      if (r) U.toast(r.deactivated ? `${p.name} is on old invoices, so it was made inactive.` : `${p.name} deleted.`, 'ok');
      await App.refresh();
      Views.products.render(main);
    });

    U.$('#add').onclick = async () => {
      const v = await U.modal({
        title: 'Add an item',
        text: 'Type <b>DF</b> for vegetables or <b>INV</b> for onions &amp; potatoes.',
        fields: [
          { name: 'code', label: 'Item code (e.g. Veg-Bet)' }, { name: 'name', label: 'Description' },
          { name: 'unit', label: 'Unit (Kg, Pcs, Bundle…)', value: 'Kg' }, { name: 'series', label: 'Invoice (DF or INV)', value: 'DF' },
          { name: 'price', label: 'Price (Rs)', value: '0' },
        ],
        ok: 'Add',
      });
      if (!v) return;
      const price = U.num(v.price);
      const series = v.series.trim().toUpperCase();
      if (await App.run(() => API.saveProduct({ ...v, series, price: Number.isNaN(price) ? -1 : price }), `${v.name} added.`) !== undefined) {
        await App.refresh();
        Views.products.render(main);
      }
    };
  },
};
