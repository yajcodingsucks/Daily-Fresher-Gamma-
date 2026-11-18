// Starts the screens and switches between them.


const App = {
  state: null,      // settings, dorms, products, weeks, plan
  view: 'week',
  weekId: null,     // week shown on This Week / Invoices
  tab: 'DF',        // DF or INV on the week grid
  sel: { series: 'DF', dormNo: 1 },  // selected invoice on the Invoices screen

  async refresh() {
    App.state = await API.bootstrap();
    document.documentElement.style.setProperty('--blue', App.state.settings.color || '#14a9e8');
    document.documentElement.style.setProperty('--dark', Receipt.darken(App.state.settings.color || '#14a9e8'));
    if (App.weekId && !App.state.weeks.some((w) => w.id === App.weekId)) App.weekId = null;
    if (!App.weekId && App.state.weeks.length) App.weekId = App.state.weeks[0].id;
  },

  // back: set when a screen was opened from History ({ weekId }): the invoice preview then shows
  // "Back to History week", the week grid shows the old-week banner, and History stays highlighted.
  back: null,

  async go(view) {
    App.view = view;
    const nav = App.back && (view === 'week' || view === 'invoice') ? 'history' : view;
    U.$$('#nav a').forEach((a) => a.classList.toggle('on', a.dataset.view === nav));
    const main = U.$('#main');
    try {
      await Views[view].render(main);
    } catch (err) {
      console.error(err);
      main.innerHTML = `<div class="warnbox">Something went wrong: ${U.esc(err.message)}</div>`;
    }
  },

  // Run an action, show its error nicely, and return its result (or undefined on error).
  async run(fn, okMsg) {
    try {
      const out = await fn();
      if (okMsg) U.toast(okMsg, 'ok');
      return out;
    } catch (err) {
      U.toast(err.message, 'err');
      return undefined;
    }
  },

  // Print or save invoices. invoices: from getWeek(); labels: ['ORIGINAL','COPY'] etc.
  // reprint: true for reprints from History, which never change printed_at or anything else.
  async printInvoices(W, invoices, labels, mode = 'print', { reprint = false } = {}) {
    if (!invoices.length) { U.toast('Nothing to print: these invoices have no items.', 'err'); return false; }
    const html = Receipt.build(App.state.settings, W.week, invoices, W.products, labels);
    const name = invoices.length === 1
      ? `${invoices[0].series}-${invoices[0].number}.pdf`
      : `Invoices ${U.date(W.week.date)}.pdf`;
    const res = await App.run(() => API.print(html, mode, name));
    if (!res || !res.done) return false;
    if (!reprint && labels.includes('ORIGINAL')) {
      const ids = invoices.filter((i) => !i.printed_at).map((i) => i.id);
      if (ids.length) await App.run(() => API.markPrinted(ids));
    }
    U.toast(mode === 'pdf' ? 'PDF saved.' : 'Sent to printer.', 'ok');
    return true;
  },

  // The side menu: This Week and Invoices always show the latest week (old weeks are reached
  // through History), and History always starts at its list of weeks.
  navClick(view) {
    App.back = null;
    if ((view === 'week' || view === 'invoice') && App.state && App.state.weeks.length) App.weekId = App.state.weeks[0].id;
    if (view === 'history') { Views.history.weekId = null; Views.history.edit = null; }
    App.go(view);
  },

  // Whole-app text size, remembered in settings.
  ZOOMS: [0.8, 0.9, 1, 1.1, 1.2, 1.3, 1.4],
  applyZoom() {
    const z = Number(App.state.settings.text_scale) || 1;
    if (window.bridge.setZoom) window.bridge.setZoom(z);
    U.$$('#textSize button').forEach((b) => b.classList.toggle('on', b.dataset.z === '0' && z === 1));
    U.$('#textSize').title = `Text size ${Math.round(z * 100)}%`;
  },
  async stepZoom(dir) {
    const cur = Number(App.state.settings.text_scale) || 1;
    let i = App.ZOOMS.reduce((best, z, k) => (Math.abs(z - cur) < Math.abs(App.ZOOMS[best] - cur) ? k : best), 2);
    i = dir === 0 ? 2 : Math.min(App.ZOOMS.length - 1, Math.max(0, i + dir));
    const z = App.ZOOMS[i];
    const s = await App.run(() => API.saveSettings({ text_scale: z }));
    if (s) { App.state.settings = s; App.applyZoom(); U.toast(`Text size ${Math.round(z * 100)}%`); }
  },

  async init() {
    U.$$('#nav a').forEach((a) => a.addEventListener('click', () => App.navClick(a.dataset.view)));
    U.$$('#textSize button').forEach((b) => b.addEventListener('click', () => App.stepZoom(Number(b.dataset.z))));
    try {
      await App.refresh();
      App.applyZoom();
      const info = await API.dataInfo();
      U.$('#sideFoot').innerHTML = `v${U.esc(info.version)}<br>Data saved on this laptop`;
    } catch (err) {
      U.$('#main').innerHTML = `<div class="warnbox">Could not open the database: ${U.esc(err.message)}</div>`;
      return;
    }
    App.go('week');
  },
};

window.addEventListener('DOMContentLoaded', App.init);
