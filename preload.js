const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('listenk', {
  onToggleRecord: (cb) => ipcRenderer.on('toggle-record', cb),
  onCancelRecord: (cb) => ipcRenderer.on('cancel-record', cb),
  transcribe: (payload) => ipcRenderer.invoke('transcribe', payload),
  paste: (text) => ipcRenderer.invoke('paste-text', text),
  setState: (state) => ipcRenderer.invoke('set-state', state),
  getStatus: () => ipcRenderer.invoke('get-status'),
  openSettingsPane: (pane) => ipcRenderer.invoke('open-settings-pane', pane),
  requestMic: () => ipcRenderer.invoke('request-mic'),
  openUrl: (url) => ipcRenderer.invoke('open-url', url),
  showInFinder: (p) => ipcRenderer.invoke('show-in-finder', p),
  clipboardWrite: (text) => ipcRenderer.invoke('clipboard-write', text),
  getHotkey: () => ipcRenderer.invoke('get-hotkey'),
  setHotkey: (mode) => ipcRenderer.invoke('set-hotkey', mode),
  onStreamPartial: (cb) => ipcRenderer.on('stream-partial', (_e, text) => cb(text)),
  onStreamFinal: (cb) => ipcRenderer.on('stream-final', (_e, text) => cb(text)),
  onStreamError: (cb) => ipcRenderer.on('stream-error', (_e, msg) => cb(msg)),
  onToast: (cb) => ipcRenderer.on('toast', (_e, msg) => cb(msg)),
});
