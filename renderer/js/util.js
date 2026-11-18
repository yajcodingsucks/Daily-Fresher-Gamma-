// Small helpers shared by every screen.

const U = {
  esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  },
  money(n) {
    return Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  },
  qty(n) {
    if (!n) return '';
    return String(Math.round(n * 1000) / 1000);
  },
  // "17,9" or "17.9" -> 17.9 ; "" -> 0 ; "abc" -> NaN
  num(s) {
    const t = String(s ?? '').trim().replace(',', '.');
    if (t === '') return 0;
    return /^\d*\.?\d+$|^\d+\.$/.test(t) ? Number(t) : NaN;
  },
  date(iso) {
    if (!iso) return '';
    const [y, m, d] = iso.slice(0, 10).split('-');
    return `${d}.${m}.${y}`;
  },
  // "2026-11-20T04:42:00.000Z" -> "20.11 · 08:42" (local time)
  stamp(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    const p = (n) => String(n).padStart(2, '0');
    return `${p(d.getDate())}.${p(d.getMonth() + 1)} · ${p(d.getHours())}:${p(d.getMinutes())}`;
  },
  // local calendar date of a timestamp, as DD.MM.YYYY
  dayOf(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`;
  },
  monthName(ym) {
    const [y, m] = ym.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, 1)).toLocaleString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  },
  today() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  },
  invNo(series, n) { return `${series}-${n}`; },
  // A→Z by description, ignoring capitals and accents; "Pomme D'Amour 2" before "Pomme D'Amour 10".
  byName(a, b) { return String(a).localeCompare(String(b), 'fr', { sensitivity: 'base', numeric: true }); },
  // Products A→Z by description.
  byProduct(a, b) { return U.byName(a.name, b.name) || a.id - b.id; },
  $(sel, root = document) { return root.querySelector(sel); },
  $$(sel, root = document) { return [...root.querySelectorAll(sel)]; },

  toast(msg, kind = '') {
    const el = document.createElement('div');
    el.className = `toast ${kind}`;
    el.textContent = msg;
    U.$('#toasts').appendChild(el);
    setTimeout(() => el.remove(), kind === 'err' ? 6000 : 3000);
  },

  // A simple pop-up. fields: [{name, label, type, value}] ; resolves to values object, or null if cancelled.
  // text: short HTML shown in a paragraph; body: any extra HTML (lists, tables) shown under it.
  modal({ title, text = '', body = '', fields = [], ok = 'OK', cancel = 'Cancel', danger = false, wide = false }) {
    return new Promise((resolve) => {
      const box = U.$('#modal');
      box.innerHTML = `<div class="box ${wide ? 'wide' : ''}">
        <h3>${U.esc(title)}</h3>${text ? `<p>${text}</p>` : ''}${body}
        ${fields.map((f) => `<div class="field"><label>${U.esc(f.label)}</label>
          ${f.type === 'textarea'
            ? `<textarea class="inp" name="${f.name}">${U.esc(f.value ?? '')}</textarea>`
            : `<input class="inp" name="${f.name}" type="${f.type || 'text'}" value="${U.esc(f.value ?? '')}">`}</div>`).join('')}
        <div class="btns">${cancel ? `<button class="btn" data-x="0">${U.esc(cancel)}</button>` : ''}
          <button class="btn p ${danger ? 'danger' : ''}" data-x="1">${U.esc(ok)}</button></div></div>`;
      box.classList.remove('hidden');
      const first = box.querySelector('input,textarea');
      if (first) first.focus();
      const done = (yes) => {
        const vals = {};
        U.$$('[name]', box).forEach((i) => { vals[i.name] = i.value; });
        box.classList.add('hidden');
        box.innerHTML = '';
        document.removeEventListener('keydown', onKey);
        resolve(yes ? vals : null);
      };
      const onKey = (e) => {
        if (e.key === 'Escape') done(false);
        if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA') done(true);
      };
      document.addEventListener('keydown', onKey);
      box.querySelectorAll('[data-x]').forEach((b) => b.addEventListener('click', () => done(b.dataset.x === '1')));
    });
  },
  // A pop-up with one big button per choice. options: [{ label, value }]; resolves to the value, or null.
  choose(title, text, options) {
    return new Promise((resolve) => {
      const box = U.$('#modal');
      box.innerHTML = `<div class="box"><h3>${U.esc(title)}</h3>${text ? `<p>${text}</p>` : ''}
        <div class="choices">${options.map((o, i) => `<button class="btn ${i === 0 ? 'p' : ''}" data-i="${i}">${U.esc(o.label)}</button>`).join('')}</div>
        <div class="btns"><button class="btn" data-i="-1">Cancel</button></div></div>`;
      box.classList.remove('hidden');
      const done = (i) => {
        box.classList.add('hidden');
        box.innerHTML = '';
        document.removeEventListener('keydown', onKey);
        resolve(i >= 0 ? options[i].value : null);
      };
      const onKey = (e) => { if (e.key === 'Escape') done(-1); };
      document.addEventListener('keydown', onKey);
      box.querySelectorAll('[data-i]').forEach((b) => b.addEventListener('click', () => done(Number(b.dataset.i))));
      box.querySelector('[data-i="0"]').focus();
    });
  },
  confirm(title, text, ok = 'Yes', danger = false) {
    return U.modal({ title, text, ok, danger }).then((v) => !!v);
  },
};
