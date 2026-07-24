const { app, BrowserWindow, Menu, Tray } = require('electron');
const { updateElectronApp, UpdateSourceType } = require('update-electron-app');

updateElectronApp(); // additional configuration options available

let isQuiting = false;
let win = null;
let tray = null;
const gotTheLock = app.requestSingleInstanceLock();

app.on('before-quit', function () {
  isQuiting = true;
});

const createWindow = () => {
  console.log(process.env.CERT_PASS);

  win = new BrowserWindow({
    width: 1600,
    height: 900,
    minWidth: 600,
    minHeight: 400,
    title: 'ZvukApp (v0.0.7A) - Авторский билд от Haciba9020',
    icon: './music-player.ico',
    // ВАЖНО: webview тег должен быть включён явно
    webPreferences: {
      webviewTag: true,
      contextIsolation: true,
      nodeIntegration: false,
      preload: __dirname + '/preload.js',
    },
  });

  // Убираем стандартное меню Electron (File / Edit / View / ...)
  // — у нас своя панель навигации
  Menu.setApplicationMenu(null);

  win.on('page-title-updated', (evt) => {
    evt.preventDefault();
    win.setTitle('ZvukApp (v0.0.7A) - Авторский билд от Haciba9020');
  });

  // Загружаем наш UI (не сайт напрямую — UI подгружает сайт во webview)
  win.loadFile('index.html');

  // ============ Поведение при сворачивании (кнопка "-") ============
  // НЕ вызываем preventDefault() и НЕ вызываем win.hide() —
  // тогда окно сворачивается в таскбар как обычное приложение
  // (остаётся видно на панели задач).
  // Только показываем всплывающее уведомление через трей.
  win.on('minimize', function () {
    // try {
    //   tray.displayBalloon({
    //     iconType: 'info',
    //     title: 'ZvukApp v0.0.7A',
    //     content: 'Приложение свёрнуто. Музыка продолжит играть.',
    //   });
    // } catch (_) {}
  });

  // ============ Поведение при закрытии (кнопка "X") ============
  // Скрываем окно в трей вместо полного выхода — приложение
  // остаётся работать, музыка продолжает играть.
  // Полный выход — только через пункт "Выход" в меню трея.
  win.on('close', function (event) {
    if (!isQuiting) {
      event.preventDefault();
      win.hide();
      try {
        tray.displayBalloon({
          iconType: 'info',
          title: 'ZvukApp v0.0.7A',
          content: 'Приложение свёрнуто. Музыка продолжит играть.',
        });
      } catch (_) {}
    }
  });

  // ============ Tray (иконка в области уведомлений) ============
  // Создаётся один раз при первом создании окна.
  if (!tray) {
    tray = new Tray('./music-player.ico'); // .ico работает на Windows; .png — на Linux/Mac
    tray.setToolTip('ZvukApp — нажмите, чтобы открыть');

    const contextMenu = Menu.buildFromTemplate([
      {
        label: 'Открыть окно',
        click: function () {
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
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
    });

    // Двойной клик по иконке трея — тоже открыть окно
    tray.on('double-click', function () {
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
    });
  }
};

if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', (event, commandLine, workingDirectory) => {
    // Someone tried to start a second instance, focus our window.
    if (win) {
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
    }
  });

  // Create myWindow, load the rest of the application, etc.
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

// На Windows и Linux закрытие всех окон обычно завершает приложение.
// Но у нас есть трей — поэтому при закрытии окна просто скрываем его,
// и приложение продолжает работать в фоне.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    // Если пользователь не выбрал "Выход" в меню трея — не выходим
    if (!isQuiting) {
      return;
    }
    app.quit();
  }
});
