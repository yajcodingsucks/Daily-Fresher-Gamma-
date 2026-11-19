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

  async go(view) {
    App.view = view;
    U.$$('#nav a').forEach((a) => a.classList.toggle('on', a.dataset.view === view));
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
  async printInvoices(W, invoices, labels, mode = 'print') {
    if (!invoices.length) { U.toast('Nothing to print: these invoices have no items.', 'err'); return false; }
    const html = Receipt.build(App.state.settings, W.week, invoices, W.products, labels);
    const name = invoices.length === 1
      ? `${invoices[0].series}-${invoices[0].number}.pdf`
      : `Invoices ${U.date(W.week.date)}.pdf`;
    const res = await App.run(() => API.print(html, mode, name));
    if (!res || !res.done) return false;
    if (labels.includes('ORIGINAL')) {
      const ids = invoices.filter((i) => !i.printed_at).map((i) => i.id);
      if (ids.length) await App.run(() => API.markPrinted(ids));
    }
    U.toast(mode === 'pdf' ? 'PDF saved.' : 'Sent to printer.', 'ok');
    return true;
  },

  async init() {
    U.$$('#nav a').forEach((a) => a.addEventListener('click', () => App.go(a.dataset.view)));
    try {
      await App.refresh();
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
