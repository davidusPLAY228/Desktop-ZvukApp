/**
 * ZvukApp — preload главного окна
 * Безопасный мост между renderer-ом и main-процессом.
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('zvukApp', {
  /**
   * Приём команды от плеера → нужно forwarding в активный <webview>.
   * payload: { command: string, payload?: any }
   */
  onCommand: (callback) => {
    const handler = (_e, payload) => callback(payload);
    ipcRenderer.on('zvuk:command', handler);
    return () => ipcRenderer.removeListener('zvuk:command', handler);
  },

  /**
   * Отправить состояние трека в main-процесс (форвардится в окно плеера).
   * state: { title, artist, coverUrl, isPlaying, position, duration, volume, isLiked, ... }
   */
  sendState: (state) => ipcRenderer.send('zvuk:state', state),
});
