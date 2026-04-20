const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('typeless', {
  onToggleRecord: (cb) => ipcRenderer.on('toggle-record', cb),
  onCancelRecord: (cb) => ipcRenderer.on('cancel-record', cb),
  transcribe: (payload) => ipcRenderer.invoke('transcribe', payload),
  paste: (text) => ipcRenderer.invoke('paste-text', text),
  setState: (state) => ipcRenderer.invoke('set-state', state),
});
