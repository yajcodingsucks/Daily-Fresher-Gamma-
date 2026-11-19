// Talks to the main process. Every call returns the data, or throws with a friendly message.

const API = {
  async call(method, ...args) {
    const r = await window.bridge.call(method, ...args);
    if (!r.ok) throw new Error(r.error);
    return r.data;
  },
  async raw(name, ...args) {
    const r = await window.bridge[name](...args);
    if (!r.ok) throw new Error(r.error);
    return r.data;
  },
};

// Shortcuts so screens can write API.getWeek(id) etc.
[
  'bootstrap', 'getSettings', 'saveSettings', 'listDorms', 'saveDorm', 'listProducts', 'saveProduct', 'deleteProduct',
  'nextWeekPlan', 'newWeek', 'deleteWeek', 'listWeeks', 'getWeek', 'setQty', 'setWeekPrice', 'setInvoiceFields',
  'markPrinted', 'unlockWeek', 'getLog', 'listMonths', 'monthly', 'setPayment',
].forEach((m) => { API[m] = (...a) => API.call(m, ...a); });

API.print = (html, mode, fileName) => API.raw('print', html, mode, fileName);
API.dataInfo = () => API.raw('dataInfo');
API.backupNow = () => API.raw('backupNow');
API.restoreBackup = () => API.raw('restoreBackup');
API.openDataFolder = () => API.raw('openDataFolder');
