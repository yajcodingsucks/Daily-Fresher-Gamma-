// The safe bridge between the screens and the main process. Only these functions are visible to the screens.

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('bridge', {
  call: (method, ...args) => ipcRenderer.invoke('api', method, ...args),
  print: (html, mode, fileName) => ipcRenderer.invoke('print', html, mode, fileName),
  dataInfo: () => ipcRenderer.invoke('dataInfo'),
  backupNow: () => ipcRenderer.invoke('backupNow'),
  restoreBackup: () => ipcRenderer.invoke('restoreBackup'),
  openDataFolder: () => ipcRenderer.invoke('openDataFolder'),
});
