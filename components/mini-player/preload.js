const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('miniPlayer', {
  command(command, value) { ipcRenderer.send('player:command', { command, value }); },
  close() { ipcRenderer.send('player:close'); },
  requestState() { ipcRenderer.send('player:request-state'); },
  onState(callback) { const listener = (_event, state) => callback(state); ipcRenderer.on('player:state', listener); return () => ipcRenderer.removeListener('player:state', listener); },
  onDebug(callback) { const listener = (_event, data) => callback(data); ipcRenderer.on('player:debug', listener); return () => ipcRenderer.removeListener('player:debug', listener); },
});
