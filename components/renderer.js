/**
 * ZvukApp — renderer process
 * Управляет вкладками и панелью навигации.
 *
 * Архитектура:
 *   - Каждая вкладка = один <webview> элемент
 *   - Активная вкладка показывается (display: flex), остальные скрыты
 *   - Состояние кнопок "Назад/Вперёд" синхронизируется с активным webview
 *   - Ссылки с target="_blank" или средний клик открываются в новой вкладке
 */

const HOME_URL = 'https://zvuk.com/';

// ============ DOM-элементы ============
const btnBack      = document.getElementById('btn-back');
const btnForward   = document.getElementById('btn-forward');
const btnReload    = document.getElementById('btn-reload');
const btnHome      = document.getElementById('btn-home');
const btnNewTab    = document.getElementById('btn-new-tab');
const urlBar       = document.getElementById('url-bar');
const tabsContainer = document.getElementById('tabs-container');
const webviewsContainer = document.getElementById('webviews-container');

// ============ Состояние ============
let tabs = [];          // массив объектов { id, tabEl, webview, title, url, favicon }
let activeTabId = null;
let tabIdCounter = 0;

// ============ Утилиты ============
function normalizeUrl(input) {
  const s = input.trim();
  if (!s) return null;
  // Если это URL с протоколом
  if (/^https?:\/\//i.test(s)) return s;
  // Если похоже на домен (содержит точку, без пробелов)
  if (/^[\w-]+(\.[\w-]+)+(\/.*)?$/.test(s)) {
    return 'https://' + s;
  }
  // Иначе — поиск в Google
  return 'https://www.google.com/search?q=' + encodeURIComponent(s);
}

function getHostname(url) {
  try {
    return new URL(url).hostname;
  } catch (_) {
    return url;
  }
}

// ============ Создание вкладки ============
function createTab(url = HOME_URL, activate = true) {
  const id = ++tabIdCounter;

  // --- DOM вкладки ---
  const tabEl = document.createElement('div');
  tabEl.className = 'tab';
  tabEl.dataset.tabId = id;

  const faviconEl = document.createElement('span');
  faviconEl.className = 'tab-favicon-placeholder';
  faviconEl.textContent = '◉';

  const titleEl = document.createElement('span');
  titleEl.className = 'tab-title';
  titleEl.textContent = 'Новая вкладка';

  const closeBtn = document.createElement('button');
  closeBtn.className = 'tab-close';
  closeBtn.title = 'Закрыть вкладку (Ctrl+W)';
  closeBtn.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>';

  tabEl.appendChild(faviconEl);
  tabEl.appendChild(titleEl);
  tabEl.appendChild(closeBtn);
  tabsContainer.appendChild(tabEl);

  // --- Webview ---
  const webview = document.createElement('webview');
  webview.dataset.tabId = id;
  webview.setAttribute('src', url);
  webview.setAttribute('allowpopups', '');
  webview.setAttribute('webpreferences', 'contextIsolation=yes, nodeIntegration=no');
  webviewsContainer.appendChild(webview);

  // --- Объект состояния ---
  const tabObj = { id, tabEl, webview, title: 'Новая вкладка', url, favicon: null, webviewReady: false };
  tabs.push(tabObj);

  // --- События вкладки ---
  tabEl.addEventListener('click', (e) => {
    if (e.target.closest('.tab-close')) return;
    activateTab(id);
  });
  closeBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    closeTab(id);
  });
  tabEl.addEventListener('auxclick', (e) => {
    // Средний клик — закрыть вкладку
    if (e.button === 1) {
      e.preventDefault();
      closeTab(id);
    }
  });

  // --- События webview ---
  attachWebviewEvents(tabObj);

  if (activate) {
    activateTab(id);
  }

  return tabObj;
}

// ============ Активация вкладки ============
function activateTab(id) {
  activeTabId = id;
  tabs.forEach(t => {
    const isActive = (t.id === id);
    t.tabEl.classList.toggle('active', isActive);
    t.webview.classList.toggle('active', isActive);
  });
  syncNavbar();
}

// ============ Закрытие вкладки ============
function closeTab(id) {
  const idx = tabs.findIndex(t => t.id === id);
  if (idx === -1) return;

  const tab = tabs[idx];
  tab.tabEl.remove();
  tab.webview.remove();
  tabs.splice(idx, 1);

  if (tabs.length === 0) {
    // Если закрыли последнюю — создаём новую домашнюю
    createTab(HOME_URL);
    return;
  }

  if (activeTabId === id) {
    const next = tabs[Math.min(idx, tabs.length - 1)];
    activateTab(next.id);
  }
}

// ============ Получение активной вкладки ============
function getActiveTab() {
  return tabs.find(t => t.id === activeTabId);
}

// ============ Синхронизация кнопок и адресной строки ============
function syncNavbar() {
  const tab = getActiveTab();
  if (!tab) return;

  // Кнопки назад/вперёд
  const canBack = tab.webview.canGoBack?.() ?? false;
  const canFwd  = tab.webview.canGoForward?.() ?? false;
  btnBack.disabled = !canBack;
  btnForward.disabled = !canFwd;

  // Адресная строка (только если не в фокусе — не перебивать ввод пользователя)
  if (document.activeElement !== urlBar) {
    urlBar.value = tab.url || '';
  }
}

// ============ События webview ============
function attachWebviewEvents(tab) {
  const wv = tab.webview;

  // DOM webview готов — можно вызывать executeJavaScript
  wv.addEventListener('dom-ready', () => {
    tab.webviewReady = true;
  });

  // Навигация началась — guest-процесс может перезагружаться
  wv.addEventListener('did-start-loading', () => {
    tab.webviewReady = false;
    if (tab.id === activeTabId) {
      urlBar.classList.add('loading');
    }
    updateTabTitle(tab, 'Загрузка...');
  });

  // Навигация завершилась
  wv.addEventListener('did-stop-loading', () => {
    if (tab.id === activeTabId) {
      urlBar.classList.remove('loading');
      syncNavbar();
    }
    try {
      tab.url = wv.getURL();
      if (tab.id === activeTabId && document.activeElement !== urlBar) {
        urlBar.value = tab.url;
      }
      // Авто-открытие DevTools webview для отладки zvuk.com
      // Включается флагом window.__openWebviewDevTools = true в DevTools главного окна
      if (window.__openWebviewDevTools && tab.url.indexOf('zvuk.com') >= 0) {
        try {
          if (!tab.__devToolsOpened) {
            wv.openDevTools();
            tab.__devToolsOpened = true;
            console.log('[Bridge] Открыто DevTools для webview (zvuk.com)');
          }
        } catch (e) {
          console.warn('[Bridge] Не удалось открыть DevTools webview:', e);
        }
      }
    } catch (_) {}
  });

  // Заголовок страницы
  wv.addEventListener('page-title-updated', (e) => {
    updateTabTitle(tab, e.title || 'Без названия');
  });

  // Favicon
  wv.addEventListener('page-favicon-updated', (e) => {
    if (e.favicons && e.favicons.length > 0) {
      setTabFavicon(tab, e.favicons[0]);
    }
  });

  // Кнопки навигации изменились
  wv.addEventListener('navigation-state-changed', () => {
    if (tab.id === activeTabId) syncNavbar();
  });

  // === ОТКРЫТИЕ В НОВОМ ОКНЕ / НОВОЙ ВКЛАДКЕ ===
  // Срабатывает для target="_blank", window.open(), среднего клика по ссылке
  wv.addEventListener('new-window', (e) => {
    e.preventDefault?.();
    if (e.url) {
      createTab(e.url, true);
    }
  });

  // Современное событие Electron для новых окон (начиная с Electron 22+)
  wv.addEventListener('will-navigate', (e) => {
    // Средний клик обрабатывается через 'new-window', тут просто обновляем URL при навигации
    if (tab.id === activeTabId && document.activeElement !== urlBar) {
      urlBar.value = e.url;
    }
  });

  // Внутренние ссылки — обновляем адресную строку
  wv.addEventListener('did-navigate', (e) => {
    tab.url = e.url;
    if (tab.id === activeTabId && document.activeElement !== urlBar) {
      urlBar.value = e.url;
    }
    syncNavbar();
  });

  wv.addEventListener('did-navigate-in-page', (e) => {
    tab.url = e.url;
    if (tab.id === activeTabId && document.activeElement !== urlBar) {
      urlBar.value = e.url;
    }
  });
}

// ============ Обновление заголовка вкладки ============
function updateTabTitle(tab, title) {
  tab.title = title;
  const titleEl = tab.tabEl.querySelector('.tab-title');
  if (titleEl) titleEl.textContent = title || 'Без названия';
}

// ============ Установка favicon вкладки ============
function setTabFavicon(tab, faviconUrl) {
  tab.favicon = faviconUrl;
  const oldEl = tab.tabEl.querySelector('.tab-favicon, .tab-favicon-placeholder');
  if (!oldEl) return;

  const img = document.createElement('img');
  img.className = 'tab-favicon';
  img.src = faviconUrl;
  img.onerror = () => {
    // Если иконка не загрузилась — возвращаем placeholder
    img.remove();
    const ph = document.createElement('span');
    ph.className = 'tab-favicon-placeholder';
    ph.textContent = '◉';
    if (oldEl.parentNode) oldEl.parentNode.replaceChild(ph, oldEl);
  };
  if (oldEl.parentNode) oldEl.parentNode.replaceChild(img, oldEl);
}

// ============ Обработчики кнопок навигации ============
btnBack.addEventListener('click', () => {
  const tab = getActiveTab();
  if (tab && tab.webview.canGoBack?.()) {
    tab.webview.goBack();
  }
});

btnForward.addEventListener('click', () => {
  const tab = getActiveTab();
  if (tab && tab.webview.canGoForward?.()) {
    tab.webview.goForward();
  }
});

btnReload.addEventListener('click', () => {
  const tab = getActiveTab();
  if (tab) tab.webview.reload();
});

btnHome.addEventListener('click', () => {
  const tab = getActiveTab();
  if (tab) tab.webview.loadURL(HOME_URL);
});

btnNewTab.addEventListener('click', () => {
  createTab(HOME_URL, true);
});

// ============ Адресная строка ============
urlBar.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    const url = normalizeUrl(urlBar.value);
    if (!url) return;
    const tab = getActiveTab();
    if (tab) {
      tab.webview.loadURL(url);
      urlBar.blur();
    }
  }
  if (e.key === 'Escape') {
    const tab = getActiveTab();
    if (tab) urlBar.value = tab.url || '';
    urlBar.blur();
  }
});

urlBar.addEventListener('focus', () => {
  urlBar.select();
});

// ============ Горячие клавиши ============
document.addEventListener('keydown', (e) => {
  const ctrl = e.ctrlKey || e.metaKey;

  // Ctrl+T — новая вкладка
  if (ctrl && e.key.toLowerCase() === 't') {
    e.preventDefault();
    createTab(HOME_URL, true);
    setTimeout(() => urlBar.focus(), 50);
    return;
  }

  // Ctrl+W — закрыть вкладку
  if (ctrl && e.key.toLowerCase() === 'w') {
    e.preventDefault();
    if (activeTabId !== null) closeTab(activeTabId);
    return;
  }

  // Ctrl+Tab — следующая вкладка
  if (ctrl && e.key === 'Tab') {
    e.preventDefault();
    if (tabs.length < 2) return;
    const idx = tabs.findIndex(t => t.id === activeTabId);
    const next = tabs[(idx + (e.shiftKey ? -1 : 1) + tabs.length) % tabs.length];
    activateTab(next.id);
    return;
  }

  // F5 / Ctrl+R — перезагрузка
  if (e.key === 'F5' || (ctrl && e.key.toLowerCase() === 'r')) {
    e.preventDefault();
    const tab = getActiveTab();
    if (tab) tab.webview.reload();
    return;
  }

  // Alt+Left / Alt+Right — назад/вперёд
  if (e.altKey && e.key === 'ArrowLeft') {
    e.preventDefault();
    btnBack.click();
    return;
  }
  if (e.altKey && e.key === 'ArrowRight') {
    e.preventDefault();
    btnForward.click();
    return;
  }

  // Ctrl+L — фокус на адресную строку
  if (ctrl && e.key.toLowerCase() === 'l') {
    e.preventDefault();
    urlBar.focus();
    urlBar.select();
    return;
  }
});

// ============ Инициализация — открываем домашнюю страницу ============
window.addEventListener('DOMContentLoaded', () => {
  createTab(HOME_URL, true);
});
// ============================================================
// ============ МОСТ ПЛЕЕР ↔ ZVUK.COM (через webview) =========
// ============================================================
//
// Архитектура моста:
//   1. main.js присылает команду → zvuk:command
//   2. renderer forwarding-ает её в активный <webview> через executeJavaScript
//   3. Параллельно renderer каждые 1.5с опрашивает webview
//   4. Состояние отправляется обратно в main → окно плеера
//
// Стратегия:
//   • zvuk.com НЕ использует <audio>/<video>/<input range> — плеер построен
//     на React-компонентах с кастомными div-кнопками и div-слайдерами.
//   • Поэтому мы ОДИН раз «дискаверим» DOM-карту плеера (DISCOVERY_SCRIPT),
//     кэшируем найденные элементы по уникальным селекторам,
//     и потом переиспользуем их для команд и чтения состояния.
//   • Источник метаданных (title/artist/cover) — navigator.mediaSession
//     (это работает на zvuk.com, проверено).
//   • Источник прогресса/громкости — DOM-элементы zvuk.com.
//   • Если дискавери ничего не нашёл — fallback на keyboard events.

// ============ Кэш обнаруженных элементов (перезаполняется при reload) ============
let zvukMap = null;       // { playBtn, nextBtn, prevBtn, likeBtn, shuffleBtn, repeatBtn, hifiBtn,
                          //   volumeSlider, volumeFill, progressTrack, progressFill,
                          //   currentTimeEl, totalTimeEl, isPlayingClass }
let zvukMapUrl = '';      // URL для которого построена карта (чтобы перестроить при navigation)
let zvukDiscoveryAttempts = 0;

// ============ Дискавери-скрипт: находит все элементы плеера zvuk.com ============
const ZVUK_DISCOVERY_SCRIPT = `(function() {
  var result = {
    found: false,
    playBtn: null, nextBtn: null, prevBtn: null,
    likeBtn: null, shuffleBtn: null, repeatBtn: null, hifiBtn: null,
    volumeSlider: null, volumeFill: null,
    progressTrack: null, progressFill: null,
    currentTimeEl: null, totalTimeEl: null,
    isPlayingClass: '',
    progressPercent: null,  // если fill через ::before — процент из CSS background
    volumePercent: null,     // громкость через CSS ::before/transform (аналог progressPercent)
    playBtnSvgInfo: null,    // SVG-данные play-кнопки для определения play/pause
    likeBtnActiveInfo: null, // цвет/fill/SVG like-кнопки для определения в лубимых
    debug: { bottomBtnCount: 0, allBtnCount: 0 },
    // ОТЛАДКА: все кликабельные элементы нижней панели с полным описанием
    allBottomEls: [],
    // ОТЛАДКА: все короткие плоские div-ы в нижней панели (потенциальные слайдеры)
    allFlatBars: [],
    // ОТЛАДКА: все тексты вида "M:SS"
    allTimeTexts: []
  };

  if (location.hostname.indexOf('zvuk.com') < 0) return result;

  try {

  // ---------- Утилиты: сериализация элемента в стабильный дескриптор ----------
  function describe(el) {
    if (!el) return null;
    var parts = [];
    var cur = el;
    while (cur && cur.nodeType === 1 && cur !== document.documentElement) {
      var part = cur.tagName.toLowerCase();
      if (cur.id) { part += '#' + cur.id; parts.unshift(part); break; }
      var cls = (typeof cur.className === 'string' ? cur.className : '').trim();
      if (cls) {
        var firstCls = cls.split(/\\s+/).filter(function(c) { return c.length > 3; })[0];
        if (firstCls) part += '.' + firstCls;
      }
      var parent = cur.parentElement;
      if (parent) {
        var siblings = Array.prototype.filter.call(parent.children, function(c) { return c.tagName === cur.tagName; });
        if (siblings.length > 1) {
          var idx = siblings.indexOf(cur) + 1;
          part += ':nth-of-type(' + idx + ')';
        }
      }
      parts.unshift(part);
      cur = cur.parentElement;
    }
    var selector = parts.join(' > ');
    var r = el.getBoundingClientRect();
    return {
      selector: selector,
      tag: el.tagName,
      cls: (typeof el.className === 'string' ? el.className : '').slice(0, 100),
      label: el.getAttribute('aria-label') || '',
      title: el.getAttribute('title') || '',
      text: (el.textContent || '').trim().slice(0, 25),
      w: Math.round(r.width),
      h: Math.round(r.height),
      left: Math.round(r.left),
      top: Math.round(r.top),
    };
  }

  // ---------- 1. Кнопки в нижней панели ----------
  // Широкий фильтр: от 12 до 80 px (могут быть мелкие 16px иконки), позиция — нижние 50% экрана
  var allClickable = Array.from(document.querySelectorAll('button, [role="button"], a, div, span, svg'))
    .filter(function(e) {
      var r = e.getBoundingClientRect();
      if (r.width < 12 || r.width > 80) return false;
      if (r.height < 12 || r.height > 80) return false;
      if (r.top < window.innerHeight * 0.5) return false;
      if (r.top > window.innerHeight + 100) return false;
      var cs = getComputedStyle(e);
      var isClickable = cs.cursor === 'pointer' || e.tagName === 'BUTTON' ||
                        e.getAttribute('role') === 'button' || !!e.onclick ||
                        e.tagName === 'SVG';
      return isClickable;
    });

  result.debug.bottomBtnCount = allClickable.length;
  result.debug.allBtnCount = document.querySelectorAll('button').length;

  // ОТЛАДКА: записываем ВСЕ кликабельные элементы с полным описанием
  result.allBottomEls = allClickable.slice(0, 50).map(function(el) {
    var r = el.getBoundingClientRect();
    var svg = el.querySelector && el.querySelector('svg');
    var svgUse = svg && svg.querySelector('use');
    return {
      tag: el.tagName,
      cls: (typeof el.className === 'string' ? el.className : '').slice(0, 150),
      label: el.getAttribute('aria-label') || '',
      title: el.getAttribute('title') || '',
      text: (el.textContent || '').trim().slice(0, 25),
      dataTest: el.getAttribute('data-test') || el.getAttribute('data-testid') || '',
      w: Math.round(r.width), h: Math.round(r.height),
      left: Math.round(r.left), top: Math.round(r.top),
      svgHref: svgUse ? (svgUse.getAttribute('href') || svgUse.getAttribute('xlink:href') || '') : ''
    };
  });

  // ---------- 2. Классифицируем кнопки по aria-label / text / class ----------
  var RU = {
    play:    ['играть','воспроизвести','слушать','play'],
    pause:   ['пауза','приостановить','pause','стоп'],
    next:    ['следующ','вперёд','вперед','next','forward'],
    prev:    ['предыдущ','назад','previous','prev','backward'],
    like:    ['нравит','любим','лайк','like','favorite','favourite','heart','сердце',
              // zvuk.com специфичные:
              'btnadd','addtocollection','animatedaddtocollectionicon'],
    shuffle: ['случай','перемешать','shuffle','random'],
    repeat:  ['повтор','repeat','loop','цикл'],
    hifi:    ['hifi','hi-fi','качество','quality','sq','hq'],
  };

  // Классы которые НЕ должны считаться play/pause (это обложка/открытие плеера сайта)
  // zvuk.com: Cover_playButton__aRn_B PlayButton_button__f5eC3 — на карточках плейлистов/альбомов,
  // клик открывает полноэкранный плеер или переключает на плейлист, а НЕ ставит на паузу.
  var PLAY_EXCLUDE = [
    'coverbutton', 'cover_playbutton', 'miniplayerbutton', 'coverimage',
    'playbutton',  'play_button',     'openplayer',       'expandplayer'
  ];

  function matchLabels(el, words) {
    var a = (el.getAttribute('aria-label') || '').toLowerCase();
    var t = (el.getAttribute('title') || '').toLowerCase();
    var tx = (el.textContent || '').trim().toLowerCase();
    var cls = (typeof el.className === 'string' ? el.className : '').toLowerCase();
    for (var i = 0; i < words.length; i++) {
      var w = words[i];
      if (a.indexOf(w) >= 0) return true;
      if (t.indexOf(w) >= 0) return true;
      if (tx === w) return true;
      if (cls.indexOf(w) >= 0) return true;
    }
    return false;
  }

  function isExcluded(el, excludeWords) {
    var cls = (typeof el.className === 'string' ? el.className : '').toLowerCase();
    for (var i = 0; i < excludeWords.length; i++) {
      if (cls.indexOf(excludeWords[i]) >= 0) return true;
    }
    return false;
  }

  // ---------- 2. ТАКСОНОМИЯ ПО ПОЗИЦИИ (мини-плеер transport) — ПЕРВЫЙ ШАГ ----------
  // zvuk.com: в нижней панели 3 кнопки 38x38 с классом styles_btn__uPjUi
  // (но НЕ styles_btnAdd__ — это like): [prev] [play/pause] [next].
  // Берём их ПЕРВЫМИ — это надёжнее, чем aria-label, т.к. кнопки без aria-label.
  // Так же исключаем coverButton/playButton (на обложках) — они открывают плеер сайта.
  var transportBtns = allClickable.filter(function(e) {
    if (e.tagName !== 'BUTTON') return false;
    var r = e.getBoundingClientRect();
    if (r.width  < 30 || r.width  > 50) return false;
    if (r.height < 30 || r.height > 50) return false;
    var cls = (typeof e.className === 'string' ? e.className : '').toLowerCase();
    // Только мини-плеер transport: styles_btn__uPjUi (строго styles_btn__, не просто btn_)
    if (cls.indexOf('styles_btn__') < 0) return false;
    // Исключаем like (styles_btnAdd), coverButton, playButton (открывает плеер сайта)
    if (/styles_btnadd|coverbutton|cover_playbutton|btnadd|miniplayerbutton|playbutton|play_button/.test(cls)) return false;
    return r.top > window.innerHeight * 0.5;
  });
  if (transportBtns.length >= 3) {
    transportBtns.sort(function(a, b) {
      return a.getBoundingClientRect().left - b.getBoundingClientRect().left;
    });
    // Берём первые 3: [prev][play/pause][next]
    if (!result.prevBtn) result.prevBtn = describe(transportBtns[0]);
    if (!result.playBtn) result.playBtn = describe(transportBtns[1]);
    if (!result.nextBtn) result.nextBtn = describe(transportBtns[2]);
  } else if (transportBtns.length === 2) {
    // На маленьком экране prev может быть скрыт — [play][next]
    transportBtns.sort(function(a, b) {
      return a.getBoundingClientRect().left - b.getBoundingClientRect().left;
    });
    if (!result.playBtn) result.playBtn = describe(transportBtns[0]);
    if (!result.nextBtn) result.nextBtn = describe(transportBtns[1]);
  }

  // ---------- 2b. Классификация по aria-label / text / class (FALLBACK) ----------
  for (var i = 0; i < allClickable.length; i++) {
    var el = allClickable[i];
    // play/pause: исключаем coverButton / playButton / cover_playButton и подобные
    if (!result.playBtn && !isExcluded(el, PLAY_EXCLUDE) &&
        (matchLabels(el, RU.play) || matchLabels(el, RU.pause))) {
      result.playBtn = describe(el);
    }
    if (!result.nextBtn && matchLabels(el, RU.next)) {
      result.nextBtn = describe(el);
    }
    if (!result.prevBtn && matchLabels(el, RU.prev)) {
      result.prevBtn = describe(el);
    }
    if (!result.likeBtn && matchLabels(el, RU.like)) {
      result.likeBtn = describe(el);
    }
    if (!result.shuffleBtn && matchLabels(el, RU.shuffle)) {
      result.shuffleBtn = describe(el);
    }
    if (!result.repeatBtn && matchLabels(el, RU.repeat)) {
      result.repeatBtn = describe(el);
    }
    if (!result.hifiBtn && matchLabels(el, RU.hifi)) {
      result.hifiBtn = describe(el);
    }
  }

  // ---------- 2c. Like-кнопка: захват SVG и стиля для определения в лубимых ----------
  if (result.likeBtn) {
    try {
      var likeEl = document.querySelector(result.likeBtn.selector);
      if (likeEl) {
        var likeSvg = likeEl.querySelector('svg');
        var likeInfo = { svgPaths: [], color: '', svgFill: '', hasFilledHeart: false };
        if (likeSvg) {
          var likePaths = likeSvg.querySelectorAll('path, circle, rect');
          for (var lp = 0; lp < likePaths.length; lp++) {
            var pEl = likePaths[lp];
            var dAttr = pEl.getAttribute('d') || '';
            var fillAttr = pEl.getAttribute('fill') || '';
            var strokeAttr = pEl.getAttribute('stroke') || '';
            likeInfo.svgPaths.push({ d: dAttr.slice(0, 200), fill: fillAttr, stroke: strokeAttr });
            // Заполненное сердце = liked (fill не none/transparent/currentColor)
            if (fillAttr && fillAttr !== 'none' && fillAttr !== 'transparent' && fillAttr !== 'currentColor') {
              likeInfo.hasFilledHeart = true;
            }
          }
          // Computed fill стиля SVG paths (zvuk.com: pink fill when liked)
          var svgPathsCs = likeSvg.querySelectorAll('path');
          for (var lci = 0; lci < svgPathsCs.length; lci++) {
            var pCs = getComputedStyle(svgPathsCs[lci]);
            if (pCs.fill && pCs.fill !== 'none' && pCs.fill !== 'rgb(0, 0, 0)') {
              likeInfo.svgFill = pCs.fill;
              likeInfo.hasFilledHeart = true;
            }
          }
        }
        likeInfo.color = getComputedStyle(likeEl).color || '';
        result.likeBtnActiveInfo = likeInfo;
      }
    } catch(e) {}
  }

  // ---------- 3. Если play всё ещё не найден — берём центральную кнопку ----------
  if (!result.playBtn && allClickable.length > 0) {
    var screenCx = window.innerWidth / 2;
    // Берём только не-исключённые элементы (не coverButton/playButton)
    var candidates = allClickable.filter(function(e) { return !isExcluded(e, PLAY_EXCLUDE); })
      .slice().sort(function(a, b) {
        var ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
        var da = Math.abs((ra.left + ra.width/2) - screenCx);
        var db = Math.abs((rb.left + rb.width/2) - screenCx);
        return da - db;
      });
    if (candidates.length > 0) {
      var c = candidates[0];
      var cr = c.getBoundingClientRect();
      if (cr.top > window.innerHeight * 0.7) {
        result.playBtn = describe(c);
      }
    }
  }

  // ---------- 4. Если next/prev не найдены — берём соседей play/pause ----------
  if (result.playBtn && result.playBtn.selector) {
    try {
      var playEl = document.querySelector(result.playBtn.selector);
      if (playEl) {
        var container = playEl.parentElement;
        for (var lvl = 0; lvl < 3 && container; lvl++) {
          var sib = Array.prototype.filter.call(container.children, function(c) {
            var r = c.getBoundingClientRect();
            return r.width > 10 && r.height > 10;
          });
          if (sib.length >= 3) break;
          container = container.parentElement;
        }
        if (container) {
          var sibBtns = Array.prototype.filter.call(container.children, function(c) {
            var r = c.getBoundingClientRect();
            return r.width > 10 && r.height > 10 && r.top > window.innerHeight * 0.55;
          });
          if (sibBtns.length >= 3) {
            sibBtns.sort(function(a, b) {
              return a.getBoundingClientRect().left - b.getBoundingClientRect().left;
            });
            var playIdx = sibBtns.indexOf(playEl);
            if (playIdx > 0 && !result.prevBtn) {
              result.prevBtn = describe(sibBtns[playIdx - 1]);
            }
            if (playIdx >= 0 && playIdx < sibBtns.length - 1 && !result.nextBtn) {
              result.nextBtn = describe(sibBtns[playIdx + 1]);
            }
          }
        }
      }
    } catch(e) {}
  }

  // ---------- 5. Прогресс-бар: широкий плоский div в нижней панели ----------
  // Расширяем фильтры: от 80px до всего экрана, высота 2-20px, позиция — нижние 50%
  var progressCandidates = Array.from(document.querySelectorAll('div, span, button, [role="slider"], [role="progressbar"]'))
    .filter(function(e) {
      var r = e.getBoundingClientRect();
      if (r.top < window.innerHeight * 0.5) return false;
      if (r.width < 80 || r.width > window.innerWidth) return false;
      if (r.height < 2 || r.height > 20) return false;
      var cls = (typeof e.className === 'string' ? e.className : '').toLowerCase();
      if (/progress|track|bar|seek|time|player|range|fill/i.test(cls)) return true;
      if (e.getAttribute('role') === 'slider' || e.getAttribute('role') === 'progressbar') return true;
      // Или содержит дочерний элемент (fill) ширина которого < 100% родителя
      var child = e.firstElementChild;
      while (child) {
        var cr = child.getBoundingClientRect();
        if (cr.height > 0 && cr.height <= r.height + 4 && cr.width < r.width && cr.width > 0) {
          return true;
        }
        child = child.nextElementSibling;
      }
      return false;
    });

  // ОТЛАДКА: записываем ВСЕ плоские div-ы с их классами и позициями
  result.allFlatBars = progressCandidates.slice(0, 30).map(function(el) {
    var r = el.getBoundingClientRect();
    var child = el.firstElementChild;
    var childW = 0;
    while (child) {
      var cr = child.getBoundingClientRect();
      if (cr.height > 0 && cr.width < r.width && cr.width > 0) {
        childW = Math.round(cr.width); break;
      }
      child = child.nextElementSibling;
    }
    return {
      tag: el.tagName,
      cls: (typeof el.className === 'string' ? el.className : '').slice(0, 150),
      role: el.getAttribute('role') || '',
      w: Math.round(r.width), h: Math.round(r.height),
      left: Math.round(r.left), top: Math.round(r.top),
      childW: childW,
      ariaValNow: el.getAttribute('aria-valuenow') || el.getAttribute('aria-valuemax') || ''
    };
  });

  if (progressCandidates.length > 0) {
    progressCandidates.sort(function(a, b) {
      return b.getBoundingClientRect().width - a.getBoundingClientRect().width;
    });
    result.progressTrack = describe(progressCandidates[0]);
    var trackEl = progressCandidates[0];
    // Ищем fill — это либо дочерний div, либо ::before через getComputedStyle
    var fill = trackEl.firstElementChild;
    while (fill) {
      var fr = fill.getBoundingClientRect();
      if (fr.height > 0 && fr.width > 0 && fr.width < trackEl.getBoundingClientRect().width) {
        result.progressFill = describe(fill);
        break;
      }
      fill = fill.nextElementSibling;
    }
    // Если дочерний fill не найден — пытаемся прочитать прогресс через CSS
    // (zvuk.com использует ::before с background или width в %)
    if (!result.progressFill) {
      try {
        var cs = getComputedStyle(trackEl, '::before');
        // background-image: linear-gradient(to right, color X%, transparent X%)
        var bg = cs.background || cs.backgroundImage;
        var match = bg && bg.match(/(\d+(?:\.\d+)?)%/);
        if (match) {
          // Сохраняем прогресс-процент в отдельном поле для чтения состояния
          result.progressPercent = parseFloat(match[1]);
        }
      } catch(e) {}
    }
  }

  // ---------- 6. Слайдер громкости: короткий div с классом slider (zvuk.com) ----------
  // На zvuk.com: <div class="styles_slider__UiVsZ"> (50x21) с дочерним sliderThumb (44x21)
  //              и рядом <button class="styles_button__YrzXQ"> (16x16) — mute
  // Также ищем через sliderThumb (дочерний div), или через соседство с mute-кнопкой
  var volumeCandidates = Array.from(document.querySelectorAll('div, span'))
    .filter(function(e) {
      var r = e.getBoundingClientRect();
      if (r.top < window.innerHeight * 0.5) return false;
      if (r.width < 30 || r.width > 200) return false;
      if (r.height < 12 || r.height > 30) return false;  // zvuk slider ~21px высотой
      var cls = (typeof e.className === 'string' ? e.className : '').toLowerCase();
      // zvuk.com: styles_slider / styles_sliderThumb / styles_sliderPointer
      if (/slider|volume|vol|sound|mute|громк|звук/i.test(cls)) return true;
      // Проверяем есть ли дочерний элемент с slider/thumb в классе
      var child = e.firstElementChild;
      while (child) {
        var childCls = (typeof child.className === 'string' ? child.className : '').toLowerCase();
        if (/slider|thumb|pointer/i.test(childCls)) return true;
        child = child.nextElementSibling;
      }
      return false;
    });
  // Дополнительно: исключаем прогресс-бар (он шире и плоский)
  volumeCandidates = volumeCandidates.filter(function(e) {
    var cls = (typeof e.className === 'string' ? e.className : '').toLowerCase();
    if (/styles_bar|progressbar/.test(cls)) return false;
    var r = e.getBoundingClientRect();
    if (r.width > 200) return false;  // прогресс-бар шире
    return true;
  });
  if (volumeCandidates.length > 0) {
    // Сортируем: приоритет — элементы с styles_slider в классе, потом по left
    volumeCandidates.sort(function(a, b) {
      var aCls = (typeof a.className === 'string' ? a.className : '').toLowerCase();
      var bCls = (typeof b.className === 'string' ? b.className : '').toLowerCase();
      var aSlider = aCls.indexOf('slider') >= 0 ? 0 : 1;
      var bSlider = bCls.indexOf('slider') >= 0 ? 0 : 1;
      if (aSlider !== bSlider) return aSlider - bSlider;
      return a.getBoundingClientRect().left - b.getBoundingClientRect().left;
    });
    result.volumeSlider = describe(volumeCandidates[0]);
    var volEl = volumeCandidates[0];
    // Ищем fill — это thumb (styles_sliderThumb) или pointer
    var volFill = volEl.firstElementChild;
    while (volFill) {
      var vfr = volFill.getBoundingClientRect();
      if (vfr.height > 0 && vfr.width > 0 && vfr.width < volEl.getBoundingClientRect().width) {
        result.volumeFill = describe(volFill);
        break;
      }
      volFill = volFill.nextElementSibling;
    }
  }

  // ---------- 6b. Громкость через CSS ::before/transform (если fill не найден) ----------
  if (result.volumeSlider && !result.volumeFill) {
    try {
      var volEl2 = document.querySelector(result.volumeSlider.selector);
      if (volEl2) {
        // 1) CSS ::before с background gradient (как progressPercent)
        var csVolBefore = getComputedStyle(volEl2, '::before');
        var bgVol = csVolBefore.background || csVolBefore.backgroundImage || '';
        var volMatch = bgVol && bgVol.match(/(\d+(?:\.\d+)?)%/);
        if (volMatch) result.volumePercent = parseFloat(volMatch[1]);
        // 2) CSS ::after
        if (!result.volumePercent) {
          var csVolAfter = getComputedStyle(volEl2, '::after');
          var bgVolAfter = csVolAfter.background || csVolAfter.backgroundImage || '';
          var volMatchAfter = bgVolAfter && bgVolAfter.match(/(\d+(?:\.\d+)?)%/);
          if (volMatchAfter) result.volumePercent = parseFloat(volMatchAfter[1]);
        }
        // 3) sliderThumb позиция через left / transform
        if (!result.volumePercent) {
          var thumb = volEl2.querySelector('[class*="sliderThumb"], [class*="sliderPointer"], [class*="Thumb"], [class*="Pointer"]');
          if (thumb) {
            var thumbCs = getComputedStyle(thumb);
            var thumbLeft = thumbCs.left || '0';
            var thumbTransform = thumbCs.transform || '';
            // left: X%
            var leftMatch = thumbLeft.match(/^([-\d.]+)%$/);
            if (leftMatch) result.volumePercent = parseFloat(leftMatch[1]);
            // transform: translateX(X%)
            if (!result.volumePercent) {
              var txMatch = thumbTransform.match(/translateX\(([-\d.]+)%\)/);
              if (txMatch) result.volumePercent = parseFloat(txMatch[1]);
            }
            // transform: matrix(...) → extract translateX px → % of slider width
            if (!result.volumePercent) {
              var matMatch = thumbTransform.match(/matrix\(([^)]+)\)/);
              if (matMatch) {
                var matVals = matMatch[1].split(/\s*,\s*/);
                if (matVals.length >= 6) {
                  var txPx = parseFloat(matVals[4]) || 0;
                  var volRect = volEl2.getBoundingClientRect();
                  if (volRect.width > 0) result.volumePercent = Math.round((txPx / volRect.width) * 100);
                }
              }
            }
          }
        }
      }
    } catch(e) {}
  }
  // ---------- 6c. Громкость: ::before на fill-елементе (если fill найден, но ширина фиксирована) ----------
  if (result.volumeSlider && result.volumeFill && !result.volumePercent) {
    try {
      var fillEl3 = document.querySelector(result.volumeFill.selector);
      if (fillEl3) {
        var csFillBefore = getComputedStyle(fillEl3, '::before');
        var bgFill = csFillBefore.background || csFillBefore.backgroundImage || '';
        var fillMatch = bgFill && bgFill.match(/(\d+(?:\.\d+)?)%/);
        if (fillMatch) result.volumePercent = parseFloat(fillMatch[1]);
      }
    } catch(e) {}
  }

  // ---------- 7. Тексты времени: "1:23" и "3:45" ----------
  // Снимаем ограничение по позиции — время может быть и в боковой панели
  var timeEls = Array.from(document.querySelectorAll('span, div, time, p'))
    .filter(function(e) {
      var r = e.getBoundingClientRect();
      if (r.top < window.innerHeight * 0.4) return false;
      if (r.width < 20 || r.width > 80) return false;
      var t = (e.textContent || '').trim();
      return /^\\d{1,2}:\\d{2}$/.test(t) && t.length < 6;
    });

  // ОТЛАДКА: все тексты времени
  result.allTimeTexts = timeEls.slice(0, 20).map(function(el) {
    var r = el.getBoundingClientRect();
    return {
      text: (el.textContent || '').trim(),
      cls: (typeof el.className === 'string' ? el.className : '').slice(0, 100),
      left: Math.round(r.left), top: Math.round(r.top),
      w: Math.round(r.width)
    };
  });

  if (timeEls.length >= 2) {
    timeEls.sort(function(a, b) {
      return a.getBoundingClientRect().left - b.getBoundingClientRect().left;
    });
    // Ищем пару рядом (расстояние < 50px) — это currentTime + totalTime
    var curEl = timeEls[0], totEl = null;
    for (var i = 1; i < timeEls.length; i++) {
      var prevR = curEl.getBoundingClientRect();
      var curR = timeEls[i].getBoundingClientRect();
      if (curR.left - (prevR.left + prevR.width) < 50) {
        totEl = timeEls[i]; break;
      }
    }
    if (!totEl) totEl = timeEls[timeEls.length - 1];
    result.currentTimeEl = describe(curEl);
    result.totalTimeEl  = describe(totEl);
  } else if (timeEls.length === 1) {
    // Один элемент — это duration (нет текущего времени)
    result.totalTimeEl = describe(timeEls[0]);
  }

  // ---------- 8. Класс play-кнопки + SVG (для определения play/pause) ----------
  if (result.playBtn) {
    try {
      var pe = document.querySelector(result.playBtn.selector);
      if (pe) {
        result.isPlayingClass = (typeof pe.className === 'string' ? pe.className : '').slice(0, 200);
        // Захват SVG: <use> href и <path> d-атрибуты — для точного определения play/pause
        var svg = pe.querySelector('svg');
        if (svg) {
          var useEl = svg.querySelector('use');
          result.playBtnSvgInfo = {
            useHref: useEl ? (useEl.getAttribute('href') || useEl.getAttribute('xlink:href') || '') : '',
            paths: Array.from(svg.querySelectorAll('path')).map(function(p) {
              return p.getAttribute('d') || '';
            }).filter(function(d) { return d.length > 5; }).slice(0, 4),
            viewBox: svg.getAttribute('viewBox') || '',
            innerHtml: (svg.innerHTML || '').slice(0, 500)
          };
        }
      }
    } catch(e) {}
  }

  result.found = !!(result.playBtn || result.progressTrack || result.nextBtn);

  } catch(e) {
    // Любая непредвиденная ошибка во время сканирования DOM zvuk.com —
    // не даём ей всплыть наружу (это ломало бы GUEST_VIEW_MANAGER_CALL в консоли main-процесса).
    // Просто возвращаем то, что успели найти.
  }

  return result;
})()`;


// ============ Скрипт чтения состояния (выполняется в webview) ============
// Принимает кэшированную карту map как аргумент.
const ZVUK_STATE_SCRIPT_FN = `(function(map) {
  var result = {
    isZvuk: false,
    title: '',
    artist: '',
    coverUrl: '',
    position: 0,
    duration: 0,
    isPlaying: false,
    volume: null,
    isLiked: false,
    shuffled: false,
    repeated: false,
    hifi: false
  };

  try {
    result.isZvuk = window.location.hostname.indexOf('zvuk.com') >= 0;
    if (!result.isZvuk) return result;
  } catch(e) { return result; }

  // 1) Media Session API — метаданные трека
  try {
    if (navigator.mediaSession && navigator.mediaSession.metadata) {
      var m = navigator.mediaSession.metadata;
      if (m.title)  result.title  = m.title;
      if (m.artist) result.artist = m.artist;
      if (m.artwork && m.artwork.length > 0) {
        var best = m.artwork[0];
        for (var i = 0; i < m.artwork.length; i++) {
          if (!best.size || (m.artwork[i].size && m.artwork[i].size.indexOf('512') >= 0)) {
            best = m.artwork[i];
          }
        }
        result.coverUrl = best.src || '';
      }
    }
    // MediaSession playbackState — предварительное значение,
    // будет переписано SVG-детекцией ниже если карта доступна.
    // Не используем как окончательное — часто устаревает на zvuk.com.
    if (navigator.mediaSession) {
      result._msIsPlaying = (navigator.mediaSession.playbackState === 'playing');
      // Используем как fallback: только если нет карты и нет <audio>
      result.isPlaying = result._msIsPlaying;
    }
  } catch(e) {}

  // 2) Media Session positionState
  try {
    if (navigator.mediaSession && navigator.mediaSession.getPositionState) {
      var ps = navigator.mediaSession.getPositionState();
      if (ps && ps.duration > 0) {
        result.position = ps.position || 0;
        result.duration = ps.duration || 0;
      }
    }
  } catch(e) {}

  // 3) <audio> / <video>
  try {
    if (!result.duration) {
      var a = document.querySelector('audio, video');
      if (a) {
        result.position  = a.currentTime || 0;
        result.duration  = a.duration || 0;
        result.isPlaying = !a.paused && !a.ended;
        result.volume    = Math.round((a.volume || 0) * 100);
      }
    }
  } catch(e) {}

  // 4) Прогресс и время из DOM (через кэш карты)
  if (map) {
    try {
      // Сначала time-тексты (точнее всего)
      if (map.currentTimeEl && map.currentTimeEl.selector) {
        var curEl = document.querySelector(map.currentTimeEl.selector);
        if (curEl) {
          var t = (curEl.textContent || '').trim();
          var mm = t.match(/^(\\d{1,2}):(\\d{2})$/);
          if (mm) result.position = parseInt(mm[1]) * 60 + parseInt(mm[2]);
        }
      }
      if (map.totalTimeEl && map.totalTimeEl.selector) {
        var totEl = document.querySelector(map.totalTimeEl.selector);
        if (totEl) {
          var t2 = (totEl.textContent || '').trim();
          var mm2 = t2.match(/^(\\d{1,2}):(\\d{2})$/);
          if (mm2) result.duration = parseInt(mm2[1]) * 60 + parseInt(mm2[2]);
        }
      }
      // Если time-тексты дали и position, и duration — отлично, выходим
      // Иначе пробуем прогресс через fill (child div)
      if (!result.duration || !result.position) {
        if (map.progressTrack && map.progressTrack.selector &&
            map.progressFill && map.progressFill.selector) {
          var trEl = document.querySelector(map.progressTrack.selector);
          var flEl = document.querySelector(map.progressFill.selector);
          if (trEl && flEl) {
            var tr = trEl.getBoundingClientRect();
            var fl = flEl.getBoundingClientRect();
            if (tr.width > 0 && fl.width > 0 && fl.width <= tr.width) {
              if (result.duration > 0) {
                // duration известна из totalTime — вычислим position
                result.position = (fl.width / tr.width) * result.duration;
              } else {
                // duration неизвестна — вернём position как процент
                if (!result.position) result.position = (fl.width / tr.width) * 100;
                if (!result.duration) result.duration = 100;
              }
            }
          }
        }
      }
      // Если у нас есть duration из time-текстов, и есть кэшированный progressPercent —
      // вычислим position из процента (zvuk.com: fill через ::before CSS background)
      if (result.duration > 0 && result.duration !== 100 &&
          map.progressPercent !== null && map.progressPercent !== undefined &&
          (!result.position || result.position === 0)) {
        result.position = (map.progressPercent / 100) * result.duration;
      }
      // Если есть только progressPercent (без duration) — вернём как процент
      if ((!result.duration || result.duration === 0) &&
          map.progressPercent !== null && map.progressPercent !== undefined) {
        result.position = map.progressPercent;
        result.duration = 100;
      }
      // Громкость — несколько методов (CSS, DOM, fallback)
      // 1) volumePercent из CSS ::before/transform (захвачено в дискавери)
      if (map.volumePercent !== null && map.volumePercent !== undefined) {
        result.volume = Math.round(map.volumePercent);
      }
      // 2) Live CSS ::before (читаем прячо теперь для актуального значения)
      if (result.volume === null && map.volumeSlider && map.volumeSlider.selector) {
        try {
          var liveVolEl = document.querySelector(map.volumeSlider.selector);
          if (liveVolEl) {
            var csBefore = getComputedStyle(liveVolEl, '::before');
            var bgLive = csBefore.background || csBefore.backgroundImage || '';
            var liveMatch = bgLive && bgLive.match(/(\d+(?:\.\d+)?)%/);
            if (liveMatch) result.volume = Math.round(parseFloat(liveMatch[1]));
          }
        } catch(e) {}
      }
      // 3) volumeFill дочерний елемент с пропорциональной шириной
      if (result.volume === null && map.volumeSlider && map.volumeSlider.selector &&
          map.volumeFill && map.volumeFill.selector) {
        var vsEl = document.querySelector(map.volumeSlider.selector);
        var vfEl = document.querySelector(map.volumeFill.selector);
        if (vsEl && vfEl) {
          var vsr = vsEl.getBoundingClientRect();
          var vfr = vfEl.getBoundingClientRect();
          if (vsr.width > 0 && vfr.width > 0 && vfr.width <= vsr.width) {
            result.volume = Math.round((vfr.width / vsr.width) * 100);
          }
        }
      }
      // 4) Thumb position: left/transform → процент громкости
      //    Enhanced: try cached selector first, then LIVE search (zvuk.com changes CSS hashes)
      if (result.volume === null) {
        var volSliderEl = null;
        // 4a) Cached selector (if still valid)
        if (map.volumeSlider && map.volumeSlider.selector) {
          volSliderEl = document.querySelector(map.volumeSlider.selector);
        }
        // 4b) LIVE fallback: search for volume slider in bottom panel by class
        if (!volSliderEl) {
          var liveSliders = Array.from(document.querySelectorAll('div, span'))
            .filter(function(el) {
              var r = el.getBoundingClientRect();
              if (r.top < window.innerHeight * 0.5) return false;
              if (r.width < 30 || r.width > 200) return false;
              if (r.height < 12 || r.height > 30) return false;
              var cls = (typeof el.className === 'string' ? el.className : '').toLowerCase();
              return /slider|volume|vol/.test(cls);
            });
          // Prefer elements with 'slider' in class
          liveSliders.sort(function(a, b) {
            var aCls = (typeof a.className === 'string' ? a.className : '').toLowerCase();
            var bCls = (typeof b.className === 'string' ? b.className : '').toLowerCase();
            var aP = aCls.indexOf('slider') >= 0 ? 0 : 1;
            var bP = bCls.indexOf('slider') >= 0 ? 0 : 1;
            if (aP !== bP) return aP - bP;
            return a.getBoundingClientRect().left - b.getBoundingClientRect().left;
          });
          if (liveSliders.length > 0) volSliderEl = liveSliders[0];
        }
        if (volSliderEl) {
          // Find thumb: first via known class names, then via child element search
          var thumbEl = volSliderEl.querySelector('[class*="sliderThumb"], [class*="sliderPointer"], [class*="Thumb"], [class*="Pointer"]');
          // If thumb not found via classes — take the most likely child
          // (zvuk.com thumb may be a direct child div without marker class)
          if (!thumbEl) {
            var thumbCandidates = Array.from(volSliderEl.children).filter(function(ch) {
              var r = ch.getBoundingClientRect();
              return r.height > 0 && r.width > 0;
            });
            if (thumbCandidates.length === 1) {
              thumbEl = thumbCandidates[0];
            }
          }
          if (thumbEl) {
            try {
              var tCs = getComputedStyle(thumbEl);
              var tLeft = tCs.left || '0';
              var tTransform = tCs.transform || '';
              // left: X%
              var leftPct = tLeft.match(/^([-\d.]+)%$/);
              if (leftPct) result.volume = Math.round(parseFloat(leftPct[1]));
              // transform: translateX(X%)
              if (result.volume === null) {
                var txPct = tTransform.match(/translateX\(([\-\d.]+)%\)/);
                if (txPct) result.volume = Math.round(parseFloat(txPct[1]));
              }
              // transform: matrix(...)
              if (result.volume === null && tTransform.indexOf('matrix') >= 0) {
                var mVals = tTransform.replace('matrix(', '').replace(')', '').split(/\s*,\s*/);
                if (mVals.length >= 6) {
                  var txPx = parseFloat(mVals[4]) || 0;
                  var volRect = volSliderEl.getBoundingClientRect();
                  if (volRect.width > 0) result.volume = Math.round((txPx / volRect.width) * 100);
                }
              }
              // Fallback: thumb left edge position relative to slider width
              if (result.volume === null) {
                var thR = thumbEl.getBoundingClientRect();
                var slR = volSliderEl.getBoundingClientRect();
                if (slR.width > 0 && thR.width > 0 && thR.width < slR.width) {
                  result.volume = Math.round(((thR.left - slR.left) / slR.width) * 100);
                }
              }
            } catch(e) {}
          }
          // 4c) LIVE CSS ::before on slider (if thumb didn't help)
          if (result.volume === null) {
            try {
              var csLiveBefore = getComputedStyle(volSliderEl, '::before');
              var bgLive = csLiveBefore.background || csLiveBefore.backgroundImage || '';
              var liveMatch = bgLive && bgLive.match(/(\d+(?:\.\d+)?%)/);
              if (liveMatch) result.volume = Math.round(parseFloat(liveMatch[1]));
            } catch(e) {}
          }
        }
      }
      // isPlaying: SVG-based detection — ALWAYS overrides MediaSession on zvuk.com
      // Priority: SVG <use> → SVG path d → CSS class → (MediaSession as fallback only)
      var _svgIsPlayingDetected = false;
      if (map.playBtn && map.playBtn.selector) {
        var pe = document.querySelector(map.playBtn.selector);
        if (pe) {
          var svgDetected = false;
          // 1) SVG <use> href: "pause" → playing, "play" → paused
          var svg = pe.querySelector('svg');
          if (svg) {
            var useEl = svg.querySelector('use');
            if (useEl) {
              var currentHref = useEl.getAttribute('href') || useEl.getAttribute('xlink:href') || '';
              if (/pause/i.test(currentHref)) { result.isPlaying = true; svgDetected = true; _svgIsPlayingDetected = true; }
              else if (/play/i.test(currentHref) && !/pause/i.test(currentHref)) { result.isPlaying = false; svgDetected = true; _svgIsPlayingDetected = true; }
            }
            // 2) SVG path d-атрибуты: pause icon (rectangles) vs play icon (triangle)
            if (!svgDetected) {
              var paths = svg.querySelectorAll('path');
              var allD = '';
              for (var pi = 0; pi < paths.length; pi++) {
                allD += (paths[pi].getAttribute('d') || '').trim() + ' ';
              }
              // Pause icon: содержит v14 + h4, но НЕ содержит "l" (line-to) → isPlaying
              if (allD.indexOf('v14') >= 0 && allD.indexOf('h4') >= 0 && allD.indexOf('l') < 0) {
                result.isPlaying = true; svgDetected = true; _svgIsPlayingDetected = true;
              }
              // Play icon: содержит треугольник с "l" (line-to) → isPaused
              else if (allD.indexOf('l11') >= 0 || allD.indexOf('l-7') >= 0 || /v14l/i.test(allD)) {
                result.isPlaying = false; svgDetected = true; _svgIsPlayingDetected = true;
              }
            }
          }
          // 3) Fallback: CSS-класс (прежний метод, менее надёжный на zvuk.com)
          if (!svgDetected) {
            var curCls = (typeof pe.className === 'string' ? pe.className : '');
            if (/pause|playing|active/i.test(curCls)) {
              result.isPlaying = true; _svgIsPlayingDetected = true;
            } else if (/play/i.test(curCls) && !/pause|playing/i.test(curCls)) {
              result.isPlaying = false; _svgIsPlayingDetected = true;
            }
          }
        }
      }
      // If SVG/CSS-class detection didn't produce a result — use MediaSession fallback
      if (!_svgIsPlayingDetected && result._msIsPlaying !== undefined) {
        result.isPlaying = result._msIsPlaying;
      }
      // Like/Shuffle/Repeat/Hifi — по классу кнопки
      function isActive(btn) {
        if (!btn || !btn.selector) return false;
        var el = document.querySelector(btn.selector);
        if (!el) return false;
        var cls = (typeof el.className === 'string' ? el.className : '').toLowerCase();
        var aria = (el.getAttribute('aria-pressed') || el.getAttribute('aria-checked') || '').toLowerCase();
        return /active|selected|pressed|checked|on|true/.test(cls + ' ' + aria);
      }
      // Like — комплексная проверка (SVG fill, цвет, класс)
      // Поле isLiked — совпадает с именованием в player.js
      result.isLiked = false;
      if (map.likeBtn && map.likeBtn.selector) {
        var likeEl = document.querySelector(map.likeBtn.selector);
        if (likeEl) {
          // 1) SVG: заполненное сердце (fill ≠ none/transparent/currentColor) = liked
          var likeSvg = likeEl.querySelector('svg');
          if (likeSvg) {
            var likePaths = likeSvg.querySelectorAll('path, circle, rect');
            for (var lpi = 0; lpi < likePaths.length; lpi++) {
              var pFill = likePaths[lpi].getAttribute('fill');
              if (pFill && pFill !== 'none' && pFill !== 'transparent' && pFill !== 'currentColor') {
                result.isLiked = true; break;
              }
            }
            // Computed fill (zvuk.com: pink fill when liked)
            if (!result.isLiked) {
              for (var lci = 0; lci < likePaths.length; lci++) {
                var pCs = getComputedStyle(likePaths[lci]);
                if (pCs.fill && pCs.fill !== 'none' && pCs.fill !== 'rgb(0, 0, 0)') {
                  result.isLiked = true; break;
                }
              }
            }
          }
          // 2) Цвет кнопки: розовый/красный = liked (zvuk.com: heart turns pink)
          if (!result.isLiked) {
            var likeColor = getComputedStyle(likeEl).color;
            if (likeColor && /rgb\s*\(\s*(?:2[0-5]\d|1\d\d|255)/.test(likeColor)) {
              result.isLiked = true;
            }
          }
          // 3) Fallback: класс и aria (прежний метод, дополнены zvuk-специфичные классы)
          if (!result.isLiked) {
            var lCls = (typeof likeEl.className === 'string' ? likeEl.className : '').toLowerCase();
            var lAria = (likeEl.getAttribute('aria-pressed') || likeEl.getAttribute('aria-checked') || '').toLowerCase();
            if (/active|selected|pressed|checked|on|true|added|incollection|isliked/.test(lCls + ' ' + lAria)) {
              result.isLiked = true;
            }
          }
        }
      }
      result.shuffled = isActive(map.shuffleBtn);
      result.repeated = isActive(map.repeatBtn);
      result.hifi    = isActive(map.hifiBtn);

      // ---- isPlaying: SVG-детекция имеет ПРИОРИТЕТ над MediaSession ----
      // Если SVG-детекция или CSS-класс дали результат — переписываем
      // _msIsPlaying (устаревающий mediaSession playbackState).
      // Это делается AFTER isPlaying-блока выше, чтобы SVG всегда выигрывал.
      // (Код выше уже установлен result.isPlaying через SVG, если map.playBtn найден.)
    } catch(e) {}
  }

  // 5) Fallback: тексты "1:23 / 3:45" в DOM
  if (!result.duration) {
    try {
      var allText = Array.from(document.querySelectorAll('span, div, time, p'))
        .map(function(e) { return (e.textContent || '').trim(); })
        .filter(function(t) {
          return t && /^\\d{1,2}:\\d{2}\\s*[\\/\\-]\\s*\\d{1,2}:\\d{2}$/.test(t);
        });
      if (allText.length > 0) {
        var match = allText[0].match(/^(\\d{1,2}):(\\d{2})\\s*[\\/\\-]\\s*(\\d{1,2}):(\\d{2})$/);
        if (match) {
          result.position = parseInt(match[1]) * 60 + parseInt(match[2]);
          result.duration = parseInt(match[3]) * 60 + parseInt(match[4]);
        }
      }
    } catch(e) {}
  }

  return result;
})`;


// ============ Универсальная защита: ни один инжектируемый скрипт ============
// не должен выбрасывать необработанную ошибку наружу — иначе Electron
// логирует это как 'GUEST_VIEW_MANAGER_CALL: Script failed to execute'.
// Оборачиваем ЛЮБОЙ код, который отправляем в webview.executeJavaScript(),
// в try/catch на самом верхнем уровне, независимо от того, что происходит внутри.
function safeGuestScript(code) {
  return '(function(){ try { return (' + code + '); } ' +
         'catch(e) { try { console.error("[ZvukApp bridge] guest script error:", e && e.message); } catch(_e) {} return null; } })()';
}

// ============ Скрипты команд ============
function buildCommandScript(command, payload) {
  var mapJson = JSON.stringify(zvukMap || {});

  switch (command) {

    case 'toggle-play':
      return `(function(map) {
        // 1) Клик по кэшированной playBtn (если она не coverButton/playButton)
        if (map && map.playBtn && map.playBtn.selector) {
          var el = document.querySelector(map.playBtn.selector);
          if (el) {
            var cls = (typeof el.className === 'string' ? el.className : '').toLowerCase();
            // Защита: если в кэше оказалась coverButton/playButton (открывает плеер сайта) — не кликаем
            if (cls.indexOf('coverbutton')   < 0 &&
                cls.indexOf('cover_playbutton') < 0 &&
                cls.indexOf('playbutton')    < 0 &&
                cls.indexOf('play_button')   < 0 &&
                cls.indexOf('miniplayerbutton') < 0 &&
                cls.indexOf('openplayer')    < 0 &&
                cls.indexOf('expandplayer')  < 0) {
              el.click(); return 'clicked-playBtn';
            }
          }
        }
        // 2) Fallback: кнопка по aria-label (исключая coverButton/playButton)
        var btns = Array.from(document.querySelectorAll('button, [role="button"]'));
        for (var i = 0; i < btns.length; i++) {
          var cls2 = (typeof btns[i].className === 'string' ? btns[i].className : '').toLowerCase();
          if (cls2.indexOf('coverbutton') >= 0 || cls2.indexOf('cover_playbutton') >= 0 ||
              cls2.indexOf('playbutton')  >= 0 || cls2.indexOf('play_button')   >= 0 ||
              cls2.indexOf('miniplayerbutton') >= 0 || cls2.indexOf('openplayer') >= 0 ||
              cls2.indexOf('expandplayer') >= 0) continue;
          var a = (btns[i].getAttribute('aria-label') || '').toLowerCase();
          var t = (btns[i].textContent || '').trim().toLowerCase();
          if (a.indexOf('play') >= 0 || a.indexOf('pause') >= 0 ||
              a.indexOf('\\u0438\\u0433\\u0440\\u0430\\u0442') >= 0 ||
              a.indexOf('\\u043f\\u0430\\u0443\\u0437') >= 0 ||
              t === 'play' || t === 'pause') {
            btns[i].click(); return 'clicked-aria';
          }
        }
        // 3) Last resort: Space (часто не работает на zvuk.com)
        try { document.activeElement.blur(); } catch(e) {}
        document.dispatchEvent(new KeyboardEvent('keydown', {
          key: ' ', code: 'Space', keyCode: 32, which: 32,
          bubbles: true, cancelable: true
        }));
        document.dispatchEvent(new KeyboardEvent('keyup', {
          key: ' ', code: 'Space', keyCode: 32, which: 32,
          bubbles: true, cancelable: true
        }));
        return 'sent-space';
      })(${mapJson})`;

    case 'open-player':
      // Кнопка «Очередь» в мини-плеере → открыть полноэкранный плеер zvuk.com.
      // Раньше этот эффект был у кнопки паузы (баг: кликала по Cover_playButton).
      // Теперь кликаем по Cover_playButton / PlayButton_button целенаправленно.
      return `(function() {
        // 1) Найти Cover_playButton / PlayButton_button (на обложках плейлистов/альбомов)
        //    Это кнопки с классом, содержащим 'playbutton' или 'cover_playbutton'.
        //    ИСКЛЮЧАЕМ мини-плеер transport (styles_btn__) — они ставят на паузу, а не открывают плеер.
        var candidates = Array.from(document.querySelectorAll('button, [role="button"], a, div'));
        // Сначала ищем видимые (не скрытые) кандидаты
        var visible = candidates.filter(function(el) {
          var r = el.getBoundingClientRect();
          if (r.width < 24 || r.height < 24) return false;
          var cs = getComputedStyle(el);
          if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') return false;
          var cls = (typeof el.className === 'string' ? el.className : '').toLowerCase();
          // Должен быть playbutton / cover_playbutton / openplayer / expandplayer
          if (cls.indexOf('playbutton')        < 0 &&
              cls.indexOf('cover_playbutton')  < 0 &&
              cls.indexOf('play_button')       < 0 &&
              cls.indexOf('openplayer')        < 0 &&
              cls.indexOf('expandplayer')      < 0) return false;
          // НЕ мини-плеер transport (styles_btn__uPjUi — это пауза, не открытие плеера)
          if (cls.indexOf('styles_btn__') >= 0 && cls.indexOf('styles_btnadd') < 0) return false;
          return true;
        });
        if (visible.length > 0) {
          // Сортируем: предпочтение элементам в верхней части экрана (на обложке плейлиста/альбома)
          visible.sort(function(a, b) {
            return a.getBoundingClientRect().top - b.getBoundingClientRect().top;
          });
          visible[0].click();
          return 'clicked-coverPlayButton';
        }
        // 2) Fallback: любая видима кнопка с aria-label 'open' / 'открыть' / 'expand'
        var btns = Array.from(document.querySelectorAll('button, [role="button"]'));
        for (var i = 0; i < btns.length; i++) {
          var a = (btns[i].getAttribute('aria-label') || '').toLowerCase();
          if (a.indexOf('open') >= 0 || a.indexOf('expand') >= 0 ||
              a.indexOf('\\u043e\\u0442\\u043a\\u0440\\u044b\\u0442') >= 0 ||
              a.indexOf('\\u0440\\u0430\\u0437\\u0432\\u0435\\u0440\\u043d') >= 0) {
            var r = btns[i].getBoundingClientRect();
            if (r.width < 20 || r.height < 20) continue;
            btns[i].click();
            return 'clicked-aria-open';
          }
        }
        return 'no-cover-play-button';
      })()`;

    case 'next':
      return `(function(map) {
        if (map && map.nextBtn && map.nextBtn.selector) {
          var el = document.querySelector(map.nextBtn.selector);
          if (el) { el.click(); return 'clicked-nextBtn'; }
        }
        var btns = Array.from(document.querySelectorAll('button, [role="button"]'));
        for (var i = 0; i < btns.length; i++) {
          var a = (btns[i].getAttribute('aria-label') || '').toLowerCase();
          if (a.indexOf('next') >= 0 || a.indexOf('\\u0441\\u043b\\u0435\\u0434\\u0443\\u044e\\u0449') >= 0 ||
              a.indexOf('\\u0432\\u043f\\u0435\\u0440\\u0451\\u0434') >= 0) {
            btns[i].click(); return 'clicked-aria';
          }
        }
        document.dispatchEvent(new KeyboardEvent('keydown', {
          key: 'ArrowRight', code: 'ArrowRight', keyCode: 39, which: 39,
          ctrlKey: true, bubbles: true, cancelable: true
        }));
        return 'sent-arrow';
      })(${mapJson})`;

    case 'prev':
      return `(function(map) {
        if (map && map.prevBtn && map.prevBtn.selector) {
          var el = document.querySelector(map.prevBtn.selector);
          if (el) { el.click(); return 'clicked-prevBtn'; }
        }
        var btns = Array.from(document.querySelectorAll('button, [role="button"]'));
        for (var i = 0; i < btns.length; i++) {
          var a = (btns[i].getAttribute('aria-label') || '').toLowerCase();
          if (a.indexOf('previous') >= 0 || a.indexOf('\\u043f\\u0440\\u0435\\u0434\\u044b\\u0434\\u0443\\u0449') >= 0 ||
              a.indexOf('\\u043d\\u0430\\u0437\\u0430\\u0434') >= 0) {
            btns[i].click(); return 'clicked-aria';
          }
        }
        document.dispatchEvent(new KeyboardEvent('keydown', {
          key: 'ArrowLeft', code: 'ArrowLeft', keyCode: 37, which: 37,
          ctrlKey: true, bubbles: true, cancelable: true
        }));
        return 'sent-arrow';
      })(${mapJson})`;

    case 'seek': {
      var pct = Math.max(0, Math.min(100, Number(payload) || 0));
      return `(function(map, pct) {
        // 1) <audio>/<video>
        var a = document.querySelector('audio, video');
        if (a && a.duration && isFinite(a.duration)) {
          a.currentTime = (a.duration * pct) / 100;
          return 'media-seeked';
        }
        // 2) zvuk.com progress bar (styles_bar__pzPRq) — клик в нужную X-позицию
        if (map && map.progressTrack && map.progressTrack.selector) {
          var track = document.querySelector(map.progressTrack.selector);
          if (track) {
            var r = track.getBoundingClientRect();
            var x = r.left + (r.width * pct) / 100;
            var y = r.top + r.height / 2;

            // zvuk.com (React) слушает pointer events, не click
            // Полная симуляция: pointerdown → pointermove → pointerup + click
            function fireAt(el, type, cx, cy, isDown) {
              try {
                var pe = new PointerEvent(type, {
                  bubbles: true, cancelable: true,
                  clientX: cx, clientY: cy,
                  button: 0, buttons: type === 'pointerup' ? 0 : 1,
                  pointerType: 'mouse', pointerId: 1
                });
                el.dispatchEvent(pe);
              } catch(e) {}
              var me = new MouseEvent(
                type === 'pointerdown' ? 'mousedown' :
                type === 'pointermove' ? 'mousemove' : 'mouseup',
                { bubbles: true, cancelable: true, clientX: cx, clientY: cy, button: 0,
                  buttons: type === 'pointerup' ? 0 : 1 }
              );
              el.dispatchEvent(me);
            }

            // Сначала pointerdown в центре трека (для drag-seek), потом move к target
            fireAt(track, 'pointerdown', r.left + r.width/2, y);
            fireAt(track, 'pointermove', x, y);
            fireAt(track, 'pointerup', x, y);
            // Click для простых listenerов
            track.dispatchEvent(new MouseEvent('click', {
              bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0
            }));
            // Также на fill (если есть)
            if (map.progressFill && map.progressFill.selector) {
              var fill = document.querySelector(map.progressFill.selector);
              if (fill) {
                fireAt(fill, 'pointerdown', x, y);
                fireAt(fill, 'pointerup', x, y);
                fill.dispatchEvent(new MouseEvent('click', {
                  bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0
                }));
              }
            }
            return 'clicked-progress';
          }
        }
        // 3) Fallback: range input
        var ranges = Array.from(document.querySelectorAll('input[type="range"], [role="slider"]'));
        ranges.sort(function(a, b) {
          return b.getBoundingClientRect().width - a.getBoundingClientRect().width;
        });
        for (var i = 0; i < ranges.length; i++) {
          var rr = ranges[i].getBoundingClientRect();
          if (rr.width < 100) break;
          var min = Number(ranges[i].getAttribute('aria-valuemin') || ranges[i].min || 0);
          var max = Number(ranges[i].getAttribute('aria-valuemax') || ranges[i].max || 100);
          var newVal = min + ((max - min) * pct) / 100;
          if (ranges[i].tagName === 'INPUT') ranges[i].value = newVal;
          else ranges[i].setAttribute('aria-valuenow', String(newVal));
          ranges[i].dispatchEvent(new Event('input', { bubbles: true }));
          ranges[i].dispatchEvent(new Event('change', { bubbles: true }));
          return 'range-seeked';
        }
        return 'no-progress-found';
      })(${mapJson}, ${pct})`;
    }

    case 'set-volume': {
      var volPct = Math.max(0, Math.min(100, Number(payload) || 0));
      return `(function(map, pct) {
        // 1) <audio>/<video> (если есть)
        var a = document.querySelector('audio, video');
        if (a) { a.volume = pct / 100; return 'media-volume'; }

        // 2) zvuk.com slider (styles_slider__UiVsZ) — нужно перетащить thumb
        if (map && map.volumeSlider && map.volumeSlider.selector) {
          var slider = document.querySelector(map.volumeSlider.selector);
          if (slider) {
            var r = slider.getBoundingClientRect();
            var targetX = r.left + (r.width * pct) / 100;
            var y = r.top + r.height / 2;

            // zvuk.com использует pointer events (React), не mouse events
            // Сначала найдём thumb (pointer) — обычно он центрирован на текущей позиции
            var thumb = slider.querySelector('[class*="sliderPointer"], [class*="sliderThumb"]');
            var thumbStartX = thumb ? thumb.getBoundingClientRect().left + thumb.getBoundingClientRect().width/2 : r.left + r.width/2;

            // Симулируем drag: pointerdown на thumb → pointermove к targetX → pointerup
            function fire(type, x, y) {
              var evt = new PointerEvent(type, {
                bubbles: true, cancelable: true,
                clientX: x, clientY: y,
                button: 0, buttons: type === 'pointerup' ? 0 : 1,
                pointerType: 'mouse', pointerId: 1
              });
              (thumb || slider).dispatchEvent(evt);
              // Также mouse event для старых слушателей
              var me = new MouseEvent(
                type === 'pointerdown' ? 'mousedown' :
                type === 'pointermove' ? 'mousemove' : 'mouseup',
                { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0,
                  buttons: type === 'pointerup' ? 0 : 1 }
              );
              (thumb || slider).dispatchEvent(me);
            }

            // 1. Press on thumb
            fire('pointerdown', thumbStartX, y);
            // 2. Move to target
            fire('pointermove', targetX, y);
            // 3. Release at target
            fire('pointerup', targetX, y);
            // 4. Click as backup
            fire('click', targetX, y);

            return 'drag-volumeSlider';
          }
        }

        // 3) Fallback: input[type="range"]
        var sliders = Array.from(document.querySelectorAll('input[type="range"]'));
        for (var i = 0; i < sliders.length; i++) {
          var s = sliders[i];
          var rect = s.getBoundingClientRect();
          if (rect.width < 100 && rect.width > 30) {
            var min = Number(s.min || 0);
            var max = Number(s.max || 100);
            s.value = min + ((max - min) * pct) / 100;
            s.dispatchEvent(new Event('input', { bubbles: true }));
            s.dispatchEvent(new Event('change', { bubbles: true }));
            return 'range-volume';
          }
        }
        return 'no-volume-source';
      })(${mapJson}, ${volPct})`;
    }

    case 'toggle-like':
      return `(function(map) {
        // 1) Кэшированная likeBtn
        if (map && map.likeBtn && map.likeBtn.selector) {
          var el = document.querySelector(map.likeBtn.selector);
          if (el) { el.click(); return 'clicked-likeBtn'; }
        }
        // 2) Fallback: ищем кнопку с классом btnAdd / addToCollection / AnimatedAddToCollectionIcon
        var btns = Array.from(document.querySelectorAll('button, [role="button"], div, span'));
        for (var i = 0; i < btns.length; i++) {
          var a = (btns[i].getAttribute('aria-label') || '').toLowerCase();
          var cls = (typeof btns[i].className === 'string' ? btns[i].className : '').toLowerCase();
          // zvuk.com специфично: btnAdd, AnimatedAddToCollectionIcon
          if (a.indexOf('like') >= 0 || a.indexOf('\\u043d\\u0440\\u0430\\u0432') >= 0 ||
              a.indexOf('favorite') >= 0 ||
              /heart|like|fav|btnadd|addtocollection|animatedaddtocollectionicon/.test(cls)) {
            var r = btns[i].getBoundingClientRect();
            if (r.top > window.innerHeight * 0.55) {
              btns[i].click(); return 'clicked-fallback';
            }
          }
        }
        return 'not-found';
      })(${mapJson})`;

    case 'toggle-shuffle':
      return `(function(map) {
        if (map && map.shuffleBtn && map.shuffleBtn.selector) {
          var el = document.querySelector(map.shuffleBtn.selector);
          if (el) { el.click(); return 'clicked-shuffleBtn'; }
        }
        var btns = Array.from(document.querySelectorAll('button, [role="button"], div, span'));
        for (var i = 0; i < btns.length; i++) {
          var a = (btns[i].getAttribute('aria-label') || '').toLowerCase();
          if (a.indexOf('shuffle') >= 0 || a.indexOf('\\u0441\\u043b\\u0443\\u0447\\u0430\\u0439') >= 0) {
            var r = btns[i].getBoundingClientRect();
            if (r.top > window.innerHeight * 0.55) {
              btns[i].click(); return 'clicked-fallback';
            }
          }
        }
        return 'not-found';
      })(${mapJson})`;

    case 'toggle-repeat':
      return `(function(map) {
        if (map && map.repeatBtn && map.repeatBtn.selector) {
          var el = document.querySelector(map.repeatBtn.selector);
          if (el) { el.click(); return 'clicked-repeatBtn'; }
        }
        var btns = Array.from(document.querySelectorAll('button, [role="button"], div, span'));
        for (var i = 0; i < btns.length; i++) {
          var a = (btns[i].getAttribute('aria-label') || '').toLowerCase();
          if (a.indexOf('repeat') >= 0 || a.indexOf('loop') >= 0 ||
              a.indexOf('\\u043f\\u043e\\u0432\\u0442\\u043e\\u0440') >= 0) {
            var r = btns[i].getBoundingClientRect();
            if (r.top > window.innerHeight * 0.55) {
              btns[i].click(); return 'clicked-fallback';
            }
          }
        }
        return 'not-found';
      })(${mapJson})`;

    case 'toggle-hifi':
      return `(function(map) {
        if (map && map.hifiBtn && map.hifiBtn.selector) {
          var el = document.querySelector(map.hifiBtn.selector);
          if (el) { el.click(); return 'clicked-hifiBtn'; }
        }
        var btns = Array.from(document.querySelectorAll('button, [role="button"], div, span'));
        for (var i = 0; i < btns.length; i++) {
          var t = (btns[i].textContent || '').trim().toLowerCase();
          var a = (btns[i].getAttribute('aria-label') || '').toLowerCase();
          if (t.indexOf('hifi') >= 0 || t.indexOf('hi-fi') >= 0 ||
              a.indexOf('hifi') >= 0 || a.indexOf('hi-fi') >= 0 ||
              a.indexOf('quality') >= 0) {
            var r = btns[i].getBoundingClientRect();
            if (r.top > window.innerHeight * 0.55) {
              btns[i].click(); return 'clicked-fallback';
            }
          }
        }
        return 'not-found';
      })(${mapJson})`;

    default:
      return null;
  }
}


// ============ Приём команд от main ============
if (window.zvukApp && window.zvukApp.onCommand) {
  window.zvukApp.onCommand(function(cmd) {
    var tab = getActiveTab();
    if (!tab || !tab.webview) {
      console.warn('[Bridge] Нет активной вкладки');
      return;
    }

    // Не отправляем команды, пока webview не fired dom-ready
    if (!tab.webviewReady) return;

    try {
      var url = tab.webview.getURL();
      if (url.indexOf('zvuk.com') < 0) {
        console.warn('[Bridge] Активная вкладка не на zvuk.com:', url);
        return;
      }
    } catch(e) {
      console.warn('[Bridge] Не удалось получить URL вкладки');
      return;
    }

    var script = buildCommandScript(cmd.command, cmd.payload);
    if (!script) {
      console.log('[Bridge] Команда не реализована:', cmd.command);
      return;
    }

    try {
      tab.webview.executeJavaScript(safeGuestScript(script), true)
        .then(function(result) {
          console.log('[Bridge] Команда', cmd.command, '→', result);
              // After play/pause — force fast re-poll to catch isPlaying change quickly
              if (cmd.command === 'toggle-play' || cmd.command === 'next' || cmd.command === 'prev') {
                for (var fastI = 1; fastI <= 3; fastI++) {
                  setTimeout(function() { pollPlayerState(); }, 200 * fastI);
                }
              }
        })
        .catch(function(err) {
          console.warn('[Bridge] executeJavaScript failed:', err);
        });
    } catch (err) {
      console.warn('[Bridge] error forwarding command:', err);
    }
  });
}


// ============ Запуск дискавери карты плеера ============
function runDiscovery(tab, verbose) {
  try {
    tab.webview.executeJavaScript(safeGuestScript(ZVUK_DISCOVERY_SCRIPT), true)
      .then(function(map) {
        if (!map || !map.found) {
          zvukDiscoveryAttempts++;
          if (zvukDiscoveryAttempts <= 3 || verbose) {
            console.log('[Bridge] Discovery: ничего не найдено (попытка ' + zvukDiscoveryAttempts + ')');
            if (map && map.debug) {
              console.log('[Bridge]   bottomBtnCount=' + map.debug.bottomBtnCount +
                          ' allBtnCount=' + map.debug.allBtnCount);
            }
          }
          return;
        }
        var prevMap = zvukMap;
        zvukMap = map;
        try { zvukMapUrl = tab.webview.getURL(); } catch(e) {}

        // Краткий лог при каждом дискавери
        var summary = {
          play:    !!(map.playBtn && map.playBtn.selector),
          next:    !!(map.nextBtn && map.nextBtn.selector),
          prev:    !!(map.prevBtn && map.prevBtn.selector),
          like:    !!(map.likeBtn && map.likeBtn.selector),
          shuffle: !!(map.shuffleBtn && map.shuffleBtn.selector),
          repeat:  !!(map.repeatBtn && map.repeatBtn.selector),
          hifi:    !!(map.hifiBtn && map.hifiBtn.selector),
          volume:  !!(map.volumeSlider && map.volumeSlider.selector),
          progress:!!(map.progressTrack && map.progressTrack.selector),
          curTime: !!(map.currentTimeEl && map.currentTimeEl.selector),
          totTime: !!(map.totalTimeEl && map.totalTimeEl.selector),
          debug:   map.debug
        };

        // Если карта изменилась существенно (или первый раз / verbose) — подробный лог
        var mapChanged = !prevMap ||
          JSON.stringify({play:!!(prevMap.playBtn&&prevMap.playBtn.selector),
                          next:!!(prevMap.nextBtn&&prevMap.nextBtn.selector),
                          like:!!(prevMap.likeBtn&&prevMap.likeBtn.selector),
                          hifi:!!(prevMap.hifiBtn&&prevMap.hifiBtn.selector),
                          volume:!!(prevMap.volumeSlider&&prevMap.volumeSlider.selector),
                          progress:!!(prevMap.progressTrack&&prevMap.progressTrack.selector)}) !==
          JSON.stringify({play:summary.play,next:summary.next,like:summary.like,
                          hifi:summary.hifi,volume:summary.volume,progress:summary.progress});

        if (mapChanged || verbose) {
          console.log('[Bridge] Discovery: OK', summary);
          // Подробный дамп — все кликабельные элементы нижней панели
          if (map.allBottomEls && map.allBottomEls.length > 0) {
            console.log('[Bridge] === ALL BOTTOM ELEMENTS (' + map.allBottomEls.length + ') ===');
            map.allBottomEls.forEach(function(e, i) {
              console.log('[Bridge] ' + (i+1) + '. ' + e.tag +
                ' w=' + e.w + ' h=' + e.h +
                ' L=' + e.left + ' T=' + e.top +
                ' label="' + e.label + '" text="' + e.text + '"' +
                ' dataTest="' + e.dataTest + '"' +
                ' svgHref="' + e.svgHref + '"' +
                ' cls="' + e.cls + '"');
            });
          }
          if (map.allFlatBars && map.allFlatBars.length > 0) {
            console.log('[Bridge] === ALL FLAT BARS (potential progress/volume) ===');
            map.allFlatBars.forEach(function(e, i) {
              console.log('[Bridge] ' + (i+1) + '. ' + e.tag +
                ' w=' + e.w + ' h=' + e.h +
                ' L=' + e.left + ' T=' + e.top +
                ' childW=' + e.childW +
                ' role="' + e.role + '" ariaValNow="' + e.ariaValNow + '"' +
                ' cls="' + e.cls + '"');
            });
          }
          if (map.allTimeTexts && map.allTimeTexts.length > 0) {
            console.log('[Bridge] === ALL TIME TEXTS ===');
            map.allTimeTexts.forEach(function(e, i) {
              console.log('[Bridge] ' + (i+1) + '. "' + e.text + '"' +
                ' L=' + e.left + ' T=' + e.top + ' w=' + e.w +
                ' cls="' + e.cls + '"');
            });
          }
        }
      })
      .catch(function(err) {
        // Тихо — страница ещё грузится
      });
  } catch (_) {}
}


// ============ Периодический опрос состояния трека ============
var lastStateStr = '';
var pollCount = 0;
var lastDiscoveryAt = 0;
// Глобальный флаг: в консоли главного окна введи  window.__forceVerboseDiscovery = true
// чтобы следующий дискавери вывел полный дамп элементов
window.__forceVerboseDiscovery = false;

function pollPlayerState() {
  var tab = getActiveTab();
  if (!tab || !tab.webview) return;

  // Не вызываем executeJavaScript, пока webview не fired dom-ready —
  // иначе получаем GUEST_VIEW_MANAGER_CALL: Script failed to execute
  if (!tab.webviewReady) return;

  var url = '';
  try {
    url = tab.webview.getURL();
    if (url.indexOf('zvuk.com') < 0) return;
  } catch(e) { return; }

  // Перезапускаем дискавери:
  //  • сразу если карты нет или URL изменился
  //  • каждые ~10 сек (pollCount % 7 === 0 при интервале 1.5с ≈ 10.5с) — zvuk.com
  //    может перерисовывать DOM при смене трека, кэш устаревает
  //  • по флагу window.__forceVerboseDiscovery (для отладки пользователем)
  var now = Date.now();
  var needDiscovery = !zvukMap ||
                      zvukMapUrl !== url ||
                      (pollCount % 7 === 0 && now - lastDiscoveryAt > 8000) ||
                      window.__forceVerboseDiscovery;
  if (needDiscovery) {
    var verbose = window.__forceVerboseDiscovery;
    window.__forceVerboseDiscovery = false;
    lastDiscoveryAt = now;
    runDiscovery(tab, verbose);
  }

  try {
    // Скрипт состояния: IIFE с пред-инъекцией map
    var script = '(function(){var map=' + JSON.stringify(zvukMap || null) + ';' +
                 'return ' + ZVUK_STATE_SCRIPT_FN + '(map);' +
                 '})()';
    tab.webview.executeJavaScript(safeGuestScript(script), true)
      .then(function(state) {
        if (!state) return;
        pollCount++;
        if (pollCount % 4 === 1) {
          console.log('[Bridge] State poll #' + pollCount + ':',
            'isZvuk=' + state.isZvuk,
            'title=' + (state.title || '—'),
            'artist=' + (state.artist || '—'),
            'isPlaying=' + state.isPlaying,
            'pos=' + Math.floor(state.position || 0) +
              (state.duration === 100 ? '%' : 's'),
            'dur=' + Math.floor(state.duration || 0) +
              (state.duration === 100 ? '%' : 's'),
            'vol=' + (state.volume !== null ? state.volume + '%' : '—'),
            'cover=' + (state.coverUrl ? 'yes' : 'no'));
        }
        var stateStr = JSON.stringify(state);
        if (stateStr === lastStateStr) return;
        lastStateStr = stateStr;
        if (window.zvukApp && window.zvukApp.sendState) {
          window.zvukApp.sendState(state);
        }
      })
      .catch(function(err) {
        // Тихо — страница ещё грузится или это не zvuk.com
      });
  } catch (_) {}
}


function initZvukPlayerBridge() {
  console.log('[Bridge] Инициализация моста плеер↔zvuk.com (v2 с авто-обнаружением)');
  setInterval(pollPlayerState, 800);
}

initZvukPlayerBridge();
