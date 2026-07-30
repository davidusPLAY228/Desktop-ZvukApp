const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('zvukApp', {
  onCommand(callback) { const listener = (_event, command) => callback(command); ipcRenderer.on('zvuk:command', listener); return () => ipcRenderer.removeListener('zvuk:command', listener); },
  onPollNow(callback) { const listener = () => callback(); ipcRenderer.on('zvuk:poll-now', listener); return () => ipcRenderer.removeListener('zvuk:poll-now', listener); },
  sendState(state) { ipcRenderer.send('zvuk:state', state); },
  reportDebug(data) { ipcRenderer.send('zvuk:debug', data); },
});
