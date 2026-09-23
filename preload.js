const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),
  installUpdate: () => ipcRenderer.invoke('install-update'),
  openReleasesPage: () => ipcRenderer.invoke('open-releases-page'),
  openLogsFolder: () => ipcRenderer.invoke('open-logs-folder'),
  getLogs: () => ipcRenderer.invoke('get-logs'),
  clearLogs: () => ipcRenderer.invoke('clear-logs'),

  onUpdateStatus: (cb) => ipcRenderer.on('update-status', (e, data) => cb(data)),
});
