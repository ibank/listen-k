const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('listenkHud', {
  cancel: () => ipcRenderer.invoke('hud-cancel'),
  confirm: () => ipcRenderer.invoke('hud-confirm'),
  onState: (cb) => ipcRenderer.on('hud-state', (_e, state) => cb(state)),
  onPartial: (cb) => ipcRenderer.on('hud-partial', (_e, text) => cb(text)),
  onReset: (cb) => ipcRenderer.on('hud-reset', () => cb()),
  onContext: (cb) => ipcRenderer.on('hud-context', (_e, ctx) => cb(ctx)),
});
