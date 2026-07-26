const { app, BrowserWindow, Menu, Tray, ipcMain } = require('electron');
const { updateElectronApp, UpdateSourceType } = require('update-electron-app');
const path = require('path');

updateElectronApp(); // additional configuration options available

const APP_VERSION = 'v0.0.9';

let isQuiting = false;
let win = null;          // главное окно (браузер с вкладками)
let playerWin = null;    // окно мини-плеера
let tray = null;
const gotTheLock = app.requestSingleInstanceLock();

app.on('before-quit', function () {
  isQuiting = true;
});

// ============ Создание иконки трея ============
// ВЫНОСИМ в отдельную функцию и вызываем ДО создания окна,
// чтобы tray был доступен во всех обработчиках win.on('...')
function createTray() {
  if (tray) return; // уже создан

  try {
    // Иконку ищем в двух местах:
    //  1) В dev-режиме:   <project>/assets/icons/music-player.ico
    //  2) В собранном .exe: resources/music-player.ico (extraResource в forge.config.js)
    let iconPath;
    const devIconPath = path.join(__dirname, 'assets/icons/music-player.ico');
    const prodIconPath = process.resourcesPath
      ? path.join(process.resourcesPath, 'music-player.ico')
      : null;

    if (prodIconPath && require('fs').existsSync(prodIconPath)) {
      iconPath = prodIconPath;
    } else if (require('fs').existsSync(devIconPath)) {
      iconPath = devIconPath;
    } else {
      // Fallback: иконка в корне проекта (старое расположение)
      const legacyIconPath = path.join(__dirname, 'music-player.ico');
      if (require('fs').existsSync(legacyIconPath)) {
        iconPath = legacyIconPath;
      } else {
        iconPath = devIconPath; // пусть будет — будет понятная ошибка в логе
      }
    }

    console.log('[Tray] Загрузка иконки из:', iconPath);
    tray = new Tray(iconPath);
    tray.setToolTip('ZvukApp — нажмите, чтобы открыть');

    const contextMenu = buildTrayMenu();
    tray.setContextMenu(contextMenu);

    // Один клик по иконке трея — открыть главное окно
    tray.on('click', function () {
      if (win) {
        if (win.isMinimized()) win.restore();
        win.show();
        win.focus();
      }
    });

    // Двойной клик по иконке трея — тоже открыть главное окно
    tray.on('double-click', function () {
      if (win) {
        if (win.isMinimized()) win.restore();
        win.show();
        win.focus();
      }
    });

    console.log('[Tray] Иконка трея успешно создана');
  } catch (err) {
    console.error('[Tray] Не удалось создать иконку трея:', err);
    tray = null;
  }
}

// ============ Динамическое меню трея ============
// Перестраиваем меню каждый раз, чтобы менять надпись «Показать/Скрыть плеер»
function buildTrayMenu() {
  const playerVisible = !!(playerWin && playerWin.isVisible());
  return Menu.buildFromTemplate([
    {
      label: 'Открыть окно',
      click: function () {
        if (!win) return;
        if (win.isMinimized()) win.restore();
        win.show();
        win.focus();
      },
    },
    {
      id: 'show-player',
      label: playerVisible ? 'Скрыть плеер' : 'Показать плеер',
      click: function () {
        togglePlayerWindow();
      },
    },
    { type: 'separator' },
    {
      label: 'Выход',
      click: function () {
        isQuiting = true;
        app.quit();
      },
    },
  ]);
}

function refreshTrayMenu() {
  if (!tray) return;
  tray.setContextMenu(buildTrayMenu());
}

// ============ Показ уведомления ============
function showBalloon(title, content) {
  if (!tray) {
    console.warn('[Tray] Не могу показать уведомление — tray не инициализирован');
    return;
  }
  try {
    tray.displayBalloon({
      iconType: 'info',
      title: title,
      content: content,
    });
    console.log('[Tray] Уведомление показано:', title);
  } catch (err) {
    console.error('[Tray] Ошибка при показе уведомления:', err);
  }
}

// ============ Создание главного окна ============
const createWindow = () => {
  // ВАЖНО: создаём tray ДО окна, чтобы он был доступен в обработчиках
  createTray();

  win = new BrowserWindow({
    width: 1600,
    height: 900,
    minWidth: 600,
    minHeight: 400,
    title: `ZvukApp (${APP_VERSION}) - Авторский билд от Haciba9020`,
    icon: path.join(__dirname, 'assets/icons/music-player.ico'),
    webPreferences: {
      webviewTag: true,
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'components/preload.js'),
    },
  });


  Menu.setApplicationMenu(null);

  win.on('page-title-updated', (evt) => {
    evt.preventDefault();
    win.setTitle(`ZvukApp (${APP_VERSION}) - Авторский билд от Haciba9020`);
  });

  // ГЛАВНОЕ: loadFile указывает на components/index.html
  win.loadFile(path.join(__dirname, 'components/index.html'));

  // ============ Поведение при сворачивании (кнопка "-") ============
  win.on('minimize', function () {
    // ничего не делаем — окно остаётся на панели задач
  });

  // ============ Поведение при закрытии (кнопка "X") ============
  win.on('close', function (event) {
    if (!isQuiting) {
      event.preventDefault();
      win.hide();
      showBalloon(
        `ZvukApp ${APP_VERSION}`,
        'Приложение свёрнуто в трей. Музыка продолжает играть.'
      );
    }
  });
};

// ============ Создание окна плеера ============
function createPlayerWindow() {
  if (playerWin) return playerWin;

  playerWin = new BrowserWindow({
    width: 480,
    height: 180,
    minWidth: 380,
    minHeight: 160,
    maxWidth: 720,
    maxHeight: 220,
    resizable: true,
    frame: false,                  // без рамок — рисуем свои кнопки
    transparent: true,             // для скругления углов
    show: false,                   // покажем через togglePlayerWindow()
    skipTaskbar: true,             // не дублируем в панели задач
    alwaysOnTop: false,
    title: 'ZvukApp Player',
    icon: path.join(__dirname, 'assets/icons/music-player.ico'),
    parent: win || undefined,      // дочернее к главному (если оно есть)
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'components/audio-controller/player-preload.js'),
    },
  });

  playerWin.loadFile(path.join(__dirname, 'components/audio-controller/player.html'));

  // Крестик плеера = скрыть (не закрывать)
  playerWin.on('close', (event) => {
    if (!isQuiting) {
      event.preventDefault();
      playerWin.hide();
      refreshTrayMenu();
    }
  });

  playerWin.on('hide', () => {
    refreshTrayMenu();
  });

  playerWin.on('show', () => {
    refreshTrayMenu();
  });

  return playerWin;
}

// ============ Показать/скрыть плеер ============
function togglePlayerWindow() {
  if (!playerWin) {
    playerWin = createPlayerWindow();
  }

  if (playerWin.isVisible()) {
    playerWin.hide();
  } else {
    playerWin.show();
    playerWin.focus();
  }
  refreshTrayMenu();
}

// ============ IPC: команды от плеера ============
ipcMain.on('player:close', () => {
  if (playerWin) playerWin.hide();
  refreshTrayMenu();
});

ipcMain.on('player:minimize', () => {
  if (playerWin) playerWin.minimize();
});

ipcMain.on('player:toggle-play',    () => sendToZvukPlayer('toggle-play'));
ipcMain.on('player:next',           () => sendToZvukPlayer('next'));
ipcMain.on('player:prev',           () => sendToZvukPlayer('prev'));
ipcMain.on('player:toggle-like',    () => sendToZvukPlayer('toggle-like'));
ipcMain.on('player:toggle-shuffle', () => sendToZvukPlayer('toggle-shuffle'));
ipcMain.on('player:toggle-repeat',  () => sendToZvukPlayer('toggle-repeat'));
ipcMain.on('player:open-queue',     () => {
  // Кнопка «Очередь» в мини-плеере → открыть полноэкранный плеер zvuk.com
  // (клик по Cover_playButton на обложке). Раньше этот эффект был у паузы —
  // теперь он здесь, где ему и место.
  sendToZvukPlayer('open-player');
  // Также показать главное окно, чтобы пользователь видел открывшийся плеер сайта
  if (win) {
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  }
});
ipcMain.on('player:toggle-hifi', () => sendToZvukPlayer('toggle-hifi'));
ipcMain.on('player:seek', (_e, percent)        => sendToZvukPlayer('seek', percent));
ipcMain.on('player:set-volume', (_e, percent)  => sendToZvukPlayer('set-volume', percent));

// ============ Мост к активному webview zvuk.com ============
// В renderer-е главного окна есть webview. Через IPC 'zvuk:command' рендерер
// получает команды и forwarding-ает их в активный <webview> через executeJavaScript.
function sendToZvukPlayer(command, payload) {
  if (!win) return;
  // renderer сам найдёт активный webview и вызовет нужный код
  win.webContents.send('zvuk:command', { command, payload });
}

// ============ Приём состояния трека от renderer-а → форвард в плеер ============
ipcMain.on('zvuk:state', (_e, state) => {
  if (playerWin && !playerWin.isDestroyed()) {
    playerWin.webContents.send('player:state', state);
  }
});

// ============ Запуск ============
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', (event, commandLine, workingDirectory) => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
    }
  });

  app.whenReady().then(() => {
    createWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
      } else {
        win.show();
        win.focus();
      }
    });
  });
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    if (!isQuiting) {
      return;
    }
    app.quit();
  }
});
