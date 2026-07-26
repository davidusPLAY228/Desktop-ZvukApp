/**
 * Audio Controller — preload
 * Безопасный мост между renderer-ом плеера и main-процессом.
 * Контекстно-изолированный (contextBridge), не засоряет window.
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('playerAPI', {
  // —— Команды от плеера → main
  closePlayer:   ()                 => ipcRenderer.send('player:close'),
  minimizePlayer:()                 => ipcRenderer.send('player:minimize'),
  togglePlay:    ()                 => ipcRenderer.send('player:toggle-play'),
  next:          ()                 => ipcRenderer.send('player:next'),
  prev:          ()                 => ipcRenderer.send('player:prev'),
  toggleLike:    ()                 => ipcRenderer.send('player:toggle-like'),
  toggleShuffle: ()                 => ipcRenderer.send('player:toggle-shuffle'),
  toggleRepeat:  ()                 => ipcRenderer.send('player:toggle-repeat'),
  openQueue:     ()                 => ipcRenderer.send('player:open-queue'),
  toggleHifi:    ()                 => ipcRenderer.send('player:toggle-hifi'),
  seek:          (percent)          => ipcRenderer.send('player:seek', percent),
  setVolume:     (percent)          => ipcRenderer.send('player:set-volume', percent),

  // —— События от main → плеер (обновление UI)
  onState:       (callback) => {
    const handler = (_e, state) => callback(state);
    ipcRenderer.on('player:state', handler);
    return () => ipcRenderer.removeListener('player:state', handler);
  },
});
