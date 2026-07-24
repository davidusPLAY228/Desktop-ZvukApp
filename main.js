const { app, BrowserWindow, Menu, Tray } = require('electron');
const { updateElectronApp, UpdateSourceType } = require('update-electron-app');
const path = require('path');

updateElectronApp(); // additional configuration options available

let isQuiting = false;
let win = null;
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
    //  1) В dev-режиме:   <project>/music-player.ico
    //  2) В собранном .exe: resources/music-player.ico (extraResource в forge.config.js)
    //     В этом случае process.resourcesPath указывает на папку resources/.
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
      // Fallback: иконка внутри asar (Electron умеет читать .ico из asar,
      // но иногда Windows API возвращает пустую иконку — поэтому мы и
      // используем extraResource выше)
      iconPath = devIconPath;
    }

    console.log('[Tray] Загрузка иконки из:', iconPath);
    tray = new Tray(iconPath);
    tray.setToolTip('ZvukApp — нажмите, чтобы открыть');

    const contextMenu = Menu.buildFromTemplate([
      {
        label: 'Открыть окно',
        click: function () {
          if (!win) return;
          if (win.isMinimized()) win.restore();
          win.show();
          win.focus();
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
    tray.setContextMenu(contextMenu);

    // Один клик по иконке трея — открыть окно
    tray.on('click', function () {
      if (!win) return;
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
    });

    // Двойной клик по иконке трея — тоже открыть окно
    tray.on('double-click', function () {
      if (!win) return;
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
    });

    console.log('[Tray] Иконка трея успешно создана');
  } catch (err) {
    console.error('[Tray] Не удалось создать иконку трея:', err);
    tray = null;
  }
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

const createWindow = () => {
  console.log(process.env.CERT_PASS);

  // ВАЖНО: создаём tray ДО окна, чтобы он был доступен в обработчиках
  createTray();

  win = new BrowserWindow({
    width: 1600,
    height: 900,
    minWidth: 600,
    minHeight: 400,
    title: 'ZvukApp (v0.0.7A) - Авторский билд от Haciba9020',
    icon: path.join(__dirname, 'assets/icons/music-player.ico'),
    webPreferences: {
      webviewTag: true,
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  Menu.setApplicationMenu(null);

  win.on('page-title-updated', (evt) => {
    evt.preventDefault();
    win.setTitle('ZvukApp (v0.0.7A) - Авторский билд от Haciba9020');
  });

  win.loadFile('index.html');

  // ============ Поведение при сворачивании (кнопка "-") ============
  win.on('minimize', function () {
    // showBalloon(
    //   'ZvukApp v0.0.7A',
    //   'Приложение свёрнуто. Музыка продолжит играть.'
    // );
  });

  // ============ Поведение при закрытии (кнопка "X") ============
  win.on('close', function (event) {
    if (!isQuiting) {
      event.preventDefault();
      win.hide();
      showBalloon(
        'ZvukApp v0.0.7A',
        'Приложение свёрнуто в трей. Музыка продолжает играть.'
      );
    }
  });
};

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
