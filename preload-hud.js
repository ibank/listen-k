const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('listenkHud', {
  cancel: () => ipcRenderer.invoke('hud-cancel'),
  confirm: () => ipcRenderer.invoke('hud-confirm'),
  onState: (cb) => ipcRenderer.on('hud-state', (_e, state) => cb(state)),
});
