const { app, BrowserWindow, Menu, Tray, ipcMain, globalShortcut } = require('electron');
const { updateElectronApp } = require('update-electron-app');
const path = require('path');
const fs = require('fs');
if (require('electron-squirrel-startup')) app.quit();
updateElectronApp();
let win, playerWin, tray, isQuitting = false;
const icon = () => fs.existsSync(path.join(__dirname, 'assets/icons/music-player.ico')) ? path.join(__dirname, 'assets/icons/music-player.ico') : path.join(__dirname, 'music-player.ico');
function showMain() { if (!win) return; if (win.isMinimized()) win.restore(); win.show(); win.focus(); }
function refreshTray() { tray?.setContextMenu(Menu.buildFromTemplate([{ label: 'Открыть окно', click: showMain }, { label: playerWin?.isVisible() ? 'Скрыть мини-плеер' : 'Показать мини-плеер', click: togglePlayer }, { type: 'separator' }, { label: 'Выход', click: () => { isQuitting = true; app.quit(); } }])); }
function createTray() { if (tray) return; tray = new Tray(icon()); tray.setToolTip('ZvukApp'); tray.on('click', showMain); refreshTray(); }
function createWindow() {
  createTray(); win = new BrowserWindow({ width: 1600, height: 900, minWidth: 600, minHeight: 400, title: 'ZvukApp', icon: icon(), webPreferences: { webviewTag: true, contextIsolation: true, nodeIntegration: false, preload: path.join(__dirname, 'components/preload.js'), cache: false } });
  Menu.setApplicationMenu(null); win.loadFile(path.join(__dirname, 'components/index.html'));
  //win.webContents.openDevTools(); // Открыть DevTools для отладки
  win.on('close', (event) => { if (!isQuitting) { event.preventDefault(); win.hide(); } });
}
function createPlayerWindow() {
  if (playerWin && !playerWin.isDestroyed()) return playerWin;
  playerWin = new BrowserWindow({ width: 300, height: 500, minWidth: 300, minHeight: 500, maxWidth: 300, maxHeight: 500, resizable: false, frame: false, show: false, alwaysOnTop: true, skipTaskbar: true, parent: win, backgroundColor: '#101010', icon: icon(), webPreferences: { contextIsolation: true, nodeIntegration: false, preload: path.join(__dirname, 'components/mini-player/preload.js') } });
  playerWin.setAlwaysOnTop(true, 'floating'); playerWin.loadFile(path.join(__dirname, 'components/mini-player/index.html'));
  //playerWin.webContents.openDevTools(); // Открыть DevTools для мини-плеера
  playerWin.on('close', (event) => { if (!isQuitting) { event.preventDefault(); playerWin.hide(); } });
  playerWin.on('show', refreshTray); playerWin.on('hide', refreshTray); return playerWin;
}
function togglePlayer() {
  const player = createPlayerWindow();
  if (player.isVisible()) player.hide();
  else {
    player.show();
    player.focus();
    if (lastPlayerState) player.webContents.send('player:state', lastPlayerState);
  }
  refreshTray();
}
const PLAYER_COMMANDS = new Set(['play', 'pause', 'toggle', 'next', 'prev', 'seek', 'volume', 'shuffle', 'repeat', 'hifi']);
let lastPlayerState = null;

function sendToMain(command, value) {
  if (!win || win.isDestroyed()) {
    console.error('[Player] Главное окно не готово');
    return false;
  }
  win.webContents.send('zvuk:command', { command, value });
  return true;
}

function forwardState(state) {
  lastPlayerState = state;
  if (playerWin && !playerWin.isDestroyed()) playerWin.webContents.send('player:state', state);
}

ipcMain.on('player:command', (_event, payload) => {
  const name = payload?.command;
  const value = payload?.value;
  if (!PLAYER_COMMANDS.has(name)) return console.error('[Player] запрещённая команда', name);
  if (!sendToMain(name, value)) return;
  createPlayerWindow();
});

ipcMain.on('player:close', () => playerWin?.hide());

ipcMain.on('player:request-state', () => {
  if (win && !win.isDestroyed()) win.webContents.send('zvuk:poll-now');
  if (lastPlayerState && playerWin && !playerWin.isDestroyed()) {
    playerWin.webContents.send('player:state', lastPlayerState);
  }
});

ipcMain.on('zvuk:state', (_event, state) => forwardState(state));
ipcMain.on('zvuk:debug', (_event, data) => {
  console.log('[Zvuk bridge]', data);
  if (playerWin && !playerWin.isDestroyed()) playerWin.webContents.send('player:debug', data);
});
function registerShortcuts() {
  const shortcuts = [
    ['MediaPlayPause', () => sendToMain('toggle')],
    ['MediaNextTrack', () => sendToMain('next')],
    ['MediaPreviousTrack', () => sendToMain('prev')],
    ['CommandOrControl+Alt+P', togglePlayer],
  ];
  shortcuts.forEach(([key, handler]) => {
    if (!globalShortcut.register(key, handler)) console.error('[Hotkey] Не зарегистрирована:', key);
  });
}
app.whenReady().then(() => { createWindow(); registerShortcuts(); app.on('activate', showMain); });
app.on('before-quit', () => { isQuitting = true; globalShortcut.unregisterAll(); });
app.on('window-all-closed', () => { if (process.platform !== 'darwin' && isQuitting) app.quit(); });
