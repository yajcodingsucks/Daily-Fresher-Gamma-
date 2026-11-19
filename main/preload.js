// The safe bridge between the screens and the main process. Only these functions are visible to the screens.

const { contextBridge, ipcRenderer, webFrame } = require('electron');

contextBridge.exposeInMainWorld('bridge', {
  call: (method, ...args) => ipcRenderer.invoke('api', method, ...args),
  print: (html, mode, fileName, paper) => ipcRenderer.invoke('print', html, mode, fileName, paper),
  dataInfo: () => ipcRenderer.invoke('dataInfo'),
  openExcel: () => ipcRenderer.invoke('openExcel'),
  appCheck: () => ipcRenderer.invoke('appCheck'),
  openErrorLog: () => ipcRenderer.invoke('openErrorLog'),
  backupNow: () => ipcRenderer.invoke('backupNow'),
  restoreBackup: () => ipcRenderer.invoke('restoreBackup'),
  openDataFolder: () => ipcRenderer.invoke('openDataFolder'),
  // Scales the whole app like browser zoom (A− A A+ in the sidebar).
  setZoom: (factor) => webFrame.setZoomFactor(Number(factor) || 1),
});
