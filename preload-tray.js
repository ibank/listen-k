const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('listenkTray', {
  cmd: (payload) => ipcRenderer.invoke('tray-cmd', payload || {}),
  onSnapshot: (cb) => ipcRenderer.on('tray-snapshot', (_e, data) => cb(data || {})),
});
