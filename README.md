<div align="center">

# <img width="32" height="32" alt="music-player" src="https://github.com/user-attachments/assets/bd15fa19-0f9c-4786-94f6-b7182c254451" /> ZvukApp — Multi-Tab Browser UI

**Универсальная интерактивная панель инструментов для Windows на PowerShell**

Быстрый доступ к вашим скриптам, утилитам и программам из единого меню —
с поддержкой ярлыков, иконок, приватных инструментов и контекстного меню.

![version](https://img.shields.io/badge/version-v0.0.8A-green?style=flat-square)
![platform](https://img.shields.io/badge/platform-Windows%2010%2F11-0078D4?style=flat-square&logo=windows)
![license](https://img.shields.io/badge/license-ICS-green?style=flat-square)
![status](https://img.shields.io/badge/status-release-green?style=flat-square)

</div>

---

<div align="center">

Обновлённая версия Electron-приложения **ZvukApp** с браузерной панелью навигации и поддержкой вкладок.

> Данная версия является <span style="color: #ffa42c">**авторской версией приложения ZvukApp 0.0.6**</span>, авторская версия разработана: https://github.com/davidusPLAY228 <br>
> P.S: Первоначальный владелец приложения: https://github.com/Bassbarlow/

</div
---
<br>

# Что нового:
### 🧭 Панель навигации (как в браузере)

Сверху окна добавлена панель с кнопками:

| Кнопка | Действие | Горячая клавиша |
|---|---|---|
| ← | Назад | `Alt+←` |
| → | Вперёд | `Alt+→` |
| ⟳ | Перезагрузить страницу | `F5` / `Ctrl+R` |
| 🏠 | Домашняя страница (zvuk.com) | — |
| Адресная строка | Ввод URL или поискового запроса | `Ctrl+L` |

Особенности:
- Адресная строка автоматически обновляется при навигации
- Во время загрузки адресная строка показывает анимацию (пульсирующий градиент)
- Кнопки «Назад» / «Вперёд» автоматически блокируются, когда соответствующего перехода нет

### 📑 Вкладки

- **Новая вкладка** — кнопка `+` или `Ctrl+T`
- **Закрыть вкладку** — крестик на вкладке, средний клик по вкладке, или `Ctrl+W`
- **Переключение вкладок** — клик по вкладке или `Ctrl+Tab` / `Ctrl+Shift+Tab`
- Каждая вкладка показывает favicon и заголовок страницы
- Активная вкладка подсвечивается
- Если закрыть последнюю вкладку — автоматически создаётся новая с домашней страницей

### 🔗 Открытие ссылок в новых вкладках

- Ссылки с `target="_blank"` открываются в новой вкладке (а не в системном браузере)
- `window.open()` тоже открывает новую вкладку
- Каждая вкладка имеет изолированную сессию

## Установка

1. Скачайте исходный код приложения (или приложение для установки, но оно всегда переносит приложение по пути: `C:\Users\RobotComp.ru\AppData\Local\ZvukApp`, или `C:\Users\RobotComp.ru\AppData\Local\zvuk_app`)
2. Откройте папку с приложением.
3. Нажмите ***ПКМ*** по файлу `ZvukApp.exe`
4. Выберите пункт `Отправить -> Рабочий стол (Создать ярлык)`
5. Используйте ярлык на рабочем столе для запуска


## Архитектура

```
┌───────────────────────────────────────────────────┐
│  BrowserWindow (главное окно Electron)            │
│  ├─ webPreferences.webviewTag = true              │
│  └─ loadFile('index.html')                        │
├───────────────────────────────────────────────────┤
│  index.html (UI браузера)                         │
│  ┌────────────────────────────────────────────┐   │
│  │ #navbar: [←] [→] [⟳] [url-bar] [🏠]       │   │
│  ├────────────────────────────────────────────┤   │
│  │ #tabstrip: [tab1] [tab2] [tab3] [+]        │   │
│  ├────────────────────────────────────────────┤   │
│  │ #webviews-container                        │   │
│  │   <webview src="https://zvuk.com/">        │   │
│  │   <webview src="..." style="display:none"> |   │
│  └────────────────────────────────────────────┘   │
└───────────────────────────────────────────────────┘
```

Каждая вкладка = отдельный `<webview>` элемент с собственной сессией, историей
навигации и контекстом. Активная вкладка показывается (`display: flex`), остальные
скрыты, но сохраняют своё состояние.

## Горячие клавиши

| Комбинация | Действие |
|---|---|
| `Ctrl+T` | Новая вкладка |
| `Ctrl+W` | Закрыть активную вкладку |
| `Ctrl+Tab` | Следующая вкладка |
| `Ctrl+Shift+Tab` | Предыдущая вкладка |
| `Ctrl+L` | Фокус на адресную строку |
| `Ctrl+R` / `F5` | Перезагрузить |
| `Alt+←` | Назад |
| `Alt+→` | Вперёд |
| `Enter` в адресной строке | Перейти по URL или искать в Google |
| `Esc` в адресной строке | Вернуть текущий URL |

## Сборка дистрибутива

Без изменений — используйте оригинальные команды:
```bash
npm run make       # собрать установщик
npm run package    # упаковать без создания установщика
npm run app:dist   # electron-builder
```
# Что делать, если я хочу на Linux?

1. Установить нужные makers

```bash
npm install --save-dev \
  @electron-forge/maker-deb \
  @electron-forge/maker-rpm \
  @electron-forge/maker-zip
```

2. Поправьте forge.config.js:
```js

module.exports = {
  packagerConfig: {
    // ВАЖНО для macOS: иконка должна быть .icns, не .ico
    icon: process.platform === 'darwin' ? './assets/icons/music-player' : './assets/icons/music-player',
    asar: true,
    // Для macOS — подпись (если есть developer ID), иначе закомментируйте
    // osxSign: { identity: 'Developer ID Application: ...' },
  },
  makers: [
    // ─── Windows (то, что у вас уже работает) ───────────────
    {
      name: '@electron-forge/maker-squirrel',
      config: { name: 'ZvukApp' },
    },

    // ─── macOS: .dmg ─────────────────────────────────────────
    {
      name: '@electron-forge/maker-dmg',
      config: {
        format: 'ULFO',
        name: 'ZvukApp',
        icon: './assets/icons/music-player.icns',   // нужен .icns, не .ico!
      },
    },

    // ─── Linux: .deb (Ubuntu/Debian/Mint) ────────────────────
    {
      name: '@electron-forge/maker-deb',
      config: {
        options: {
          name: 'zvukapp',
          productName: 'ZvukApp',
          maintainer: 'davidusPLAY@yandex.ru',
          homepage: 'https://github.com/davidusPLAY228',
          icon: './assets/icons/music-player 512x512.png',          // для deb нужен .png (минимум 512×512)
          categories: ['AudioVideo', 'Audio', 'Player'],
          mimeType: ['x-scheme-handler/zvuk'],
          requires: ['libgtk-3-0', 'libnotify4', 'libnss3', 'libxss1', 'libxtst6'],
        },
      },
    },

    // ─── Linux: .rpm (Fedora/RHEL/openSUSE) ──────────────────
    {
      name: '@electron-forge/maker-rpm',
      config: {
        options: {
          name: 'zvukapp',
          productName: 'ZvukApp',
          license: 'MIT',
          icon: './assets/icons/music-player.png',
          categories: ['AudioVideo', 'Audio', 'Player'],
          requires: ['gtk3', 'libnotify', 'nss', 'libXScrnSaver', 'libXtst'],
        },
      },
    },

    // ─── Linux: .AppImage (универсальный, без установки) ─────
    {
      name: '@electron-forge/maker-appimage',
      config: {
        name: 'ZvukApp',
        icon: './assets/icons/music-player.png',
        categories: ['AudioVideo'],
      },
    },
  ],
};

```

## Комнданды сборки:

```bash
# Только windows (x32 и x64)
npm run make:both

# Только windows x32
npm run make:x32

# Только windows x64
npm run make:x64

# Все настроенные makers для windows платформы
npx electron-forge make

# ─── Конкретные платформы ──────────────────────────────────
# macOS (.dmg)
npx electron-forge make --platform darwin --arch=x64
npx electron-forge make --platform darwin --arch=arm64   # Apple Silicon (M1/M2/M3)

# Linux .deb, .rpm, .AppImage
npx electron-forge make --platform linux --arch=x64

# Универсальная сборка Linux (сделает все makers для Linux сразу)
npx electron-forge make --platform linux
```

## Makers для других систем:
```bash
@electron-forge/maker-squirrel   (Windows .exe)
@electron-forge/maker-zip        (просто архив)
@electron-forge/maker-deb        (Linux .deb) 
@electron-forge/maker-rpm        (Linux .rpm) 
@electron-forge/maker-dmg        (macOS .dmg)  
@electron-forge/maker-pkg        (macOS .pkg)
@electron-forge/maker-wix        (Windows .msi)
@electron-forge/maker-snap       (Linux Snap)
@electron-forge/maker-flatpak    (Linux Flatpak)
```
</div>
