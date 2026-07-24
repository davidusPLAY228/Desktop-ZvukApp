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
  webview.setAttribute('disablewebsecurity', 'false');
  webview.setAttribute('webpreferences', 'contextIsolation=yes, nodeIntegration=no');
  webviewsContainer.appendChild(webview);

  // --- Объект состояния ---
  const tabObj = { id, tabEl, webview, title: 'Новая вкладка', url, favicon: null };
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

  // Навигация началась
  wv.addEventListener('did-start-loading', () => {
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