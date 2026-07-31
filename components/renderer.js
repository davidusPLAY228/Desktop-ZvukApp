const HOME_URL = 'https://zvuk.com/';
const POLL_MS = 800;
const $ = (id) => document.getElementById(id);
const [btnBack, btnForward, btnReload, btnHome, btnNewTab, urlBar, tabsContainer, webviewsContainer] = ['btn-back','btn-forward','btn-reload','btn-home','btn-new-tab','url-bar','tabs-container','webviews-container'].map($);
let tabs = [], activeTabId = null, tabId = 0;
let playerTabId = null;
let pollTimer = null;
let coverCache = { original: null, cached: null };

const currentTab = () => tabs.find((tab) => tab.id === activeTabId);
const zvukTabs = () => tabs.filter((tab) => {
  try { return tab.ready && /(^|\.)zvuk\.com$/i.test(new URL(tab.webview.getURL()).hostname); } catch (_) { return false; }
});

function sync() {
  const tab = currentTab();
  if (!tab) return;
  btnBack.disabled = !tab.webview.canGoBack();
  btnForward.disabled = !tab.webview.canGoForward();
  if (document.activeElement !== urlBar) urlBar.value = tab.url;
}

function activate(id) {
  activeTabId = id;
  tabs.forEach((tab) => {
    const isActive = tab.id === id;
    tab.element.classList.toggle('active', isActive);
    tab.webview.classList.toggle('active', isActive);
  });
  sync();
}

function addTab(url = HOME_URL, select = true) {
  const id = ++tabId;
  const element = document.createElement('div');
  const title = document.createElement('span');
  const close = document.createElement('button');
  element.className = 'tab';
  title.className = 'tab-title';
  title.textContent = 'Новая вкладка';
  close.className = 'tab-close';
  close.textContent = '×';
  element.append(title, close);
  tabsContainer.append(element);

  const webview = document.createElement('webview');
  webview.src = url;
  webview.setAttribute('allowpopups', '');
  webview.setAttribute('webpreferences', 'contextIsolation=yes,nodeIntegration=no');
  webviewsContainer.append(webview);

  const tab = { id, element, title, close, webview, url, ready: false };
  tabs.push(tab);

  element.onclick = (event) => { if (!event.target.closest('.tab-close')) activate(id); };
  close.onclick = (event) => { event.stopPropagation(); removeTab(id); };

  webview.addEventListener('dom-ready', () => {
    console.log('[Zvuk bridge] dom-ready for tab', tab.id, webview.getURL());
    tab.ready = true;
    if (/(^|\.)zvuk\.com$/i.test(new URL(webview.getURL()).hostname)) poll();
  });
  webview.addEventListener('did-start-loading', () => {
    console.log('[Zvuk bridge] did-start-loading for tab', tab.id);
    // Для zvuk.com (SPA) не сбрасываем ready при навигации
    let isZvuk = false;
    try {
      isZvuk = /(^|\.)zvuk\.com$/i.test(new URL(webview.getURL()).hostname);
    } catch (_) {
      // webview.getURL() может быть пустым при начальной загрузке
    }
    if (!isZvuk) {
      tab.ready = false;
    }
  });
  webview.addEventListener('did-fail-load', () => {
    console.log('[Zvuk bridge] did-fail-load for tab', tab.id);
    if (tab.id === playerTabId) playerTabId = null;
    sendState({ available: false, authenticated: false, error: 'network' });
  });
  webview.addEventListener('page-title-updated', (event) => { title.textContent = event.title || 'Zvuk'; });
  webview.addEventListener('did-navigate', (event) => {
    console.log('[Zvuk bridge] did-navigate for tab', tab.id, event.url);
    tab.url = event.url;
    sync();
    poll();
  });
  webview.addEventListener('did-navigate-in-page', (event) => {
    console.log('[Zvuk bridge] did-navigate-in-page for tab', tab.id, event.url);
    tab.url = event.url;
    sync();
    // Не сбрасываем ready при навигации внутри SPA
    if (tab.ready) poll();
  });
  webview.addEventListener('new-window', (event) => { event.preventDefault(); if (event.url) addTab(event.url, true); });
  webview.addEventListener('console-message', (event) => {
    console.log('[Webview]', event.message);
  });

  if (select) activate(id);
}

function removeTab(id) {
  const index = tabs.findIndex((tab) => tab.id === id);
  if (index < 0) return;
  const [tab] = tabs.splice(index, 1);
  if (playerTabId === id) playerTabId = null;
  tab.element.remove();
  tab.webview.remove();
  if (!tabs.length) return addTab();
  if (activeTabId === id) activate(tabs[Math.min(index, tabs.length - 1)].id);
}

btnBack.onclick = () => { const tab = currentTab(); if (tab?.webview.canGoBack()) tab.webview.goBack(); };
btnForward.onclick = () => { const tab = currentTab(); if (tab?.webview.canGoForward()) tab.webview.goForward(); };
btnReload.onclick = () => currentTab()?.webview.reload();
btnHome.onclick = () => currentTab()?.webview.loadURL(HOME_URL);
btnNewTab.onclick = () => addTab();
urlBar.onkeydown = (event) => {
  if (event.key !== 'Enter') return;
  const raw = urlBar.value.trim();
  if (!raw) return;
  currentTab()?.webview.loadURL(/^https?:\/\//.test(raw) ? raw : raw.includes('.') ? `https://${raw}` : `https://www.google.com/search?q=${encodeURIComponent(raw)}`);
};
document.onkeydown = (event) => {
  const ctrl = event.ctrlKey || event.metaKey;
  if (ctrl && event.key.toLowerCase() === 'l') { event.preventDefault(); urlBar.select(); urlBar.focus(); }
  if (ctrl && event.key.toLowerCase() === 't') { event.preventDefault(); addTab(); }
};

function sendState(state) { window.zvukApp.sendState(state); }

async function inspectTab(tab) {
  try {
    const url = tab.webview.getURL();
    console.log('[Zvuk bridge] inspecting tab', tab.id, url);
    const script = buildZvukGuestScript(null);
    console.log('[Zvuk bridge] generated script (first 500 chars):', script.substring(0, 500));
    const state = await tab.webview.executeJavaScript(script, true);
    console.log('[Zvuk bridge] state from tab', tab.id, {
      available: state.available,
      hasPlayer: state.hasPlayer,
      title: state.title,
      artist: state.artist,
      isPlaying: state.isPlaying,
      isFavorite: state.isFavorite,
      debug: state._debug,
      favoriteDebug: {
        reveal: state._debug.favoriteReveal,
        outlineHidden: state._debug.favoriteOutlineHidden,
        fillVisible: state._debug.favoriteFillVisible,
        ariaPressed: state._debug.favoriteAriaPressed,
        activeClass: state._debug.favoriteActiveClass,
        fullDebug: state._debug.favorite
      }
    });
    return { tab, state };
  } catch (error) {
    console.warn('[Zvuk bridge] inspect failed', tab.id, error);
    return null;
  }
}

async function findPlayerTab() {
  const candidates = zvukTabs();
  if (!candidates.length) return null;

  const preferred = candidates.find((tab) => tab.id === playerTabId);
  const ordered = preferred ? [preferred, ...candidates.filter((tab) => tab.id !== playerTabId)] : candidates;

  const checks = await Promise.all(ordered.map(inspectTab));
  const withPlayer = checks.find((item) => item?.state?.hasPlayer);
  if (withPlayer) {
    playerTabId = withPlayer.tab.id;
    return withPlayer;
  }

  const withTrack = checks.find((item) => item?.state?.title || item?.state?.authenticated);
  if (withTrack) {
    playerTabId = withTrack.tab.id;
    return withTrack;
  }

  return checks[0] || null;
}

async function poll() {
  try {
    const zvukTabsCount = zvukTabs().length;
    console.log('[Zvuk bridge] poll: zvuk tabs count:', zvukTabsCount);
    const found = await findPlayerTab();
    if (!found) {
      console.log('[Zvuk bridge] poll: no player tab found');
      sendState({ available: zvukTabsCount > 0, authenticated: false, hasPlayer: false });
      return;
    }
    console.log('[Zvuk bridge] poll: player found', { hasPlayer: found.state.hasPlayer, title: found.state.title });
    console.log('[Zvuk bridge] FULL STATE:', JSON.stringify(found.state, null, 2));

    // Кэширование обложки: кэш привязывается к конкретному оригинальному URL.
    // Если кэширование не удалось — используем CDN-URL напрямую, чтобы не
    // подставлять чужую (старую) обложку для нового трека.
    if (found.state.coverUrl) {
      if (found.state.coverUrl !== coverCache.original) {
        coverCache.original = found.state.coverUrl;
        coverCache.cached = null; // сбрасываем до успешного кэширования
        try {
          const cachedPath = await window.zvukApp.cacheCover(found.state.coverUrl);
          if (cachedPath) {
            coverCache.cached = cachedPath;
            console.log('[Cover cache] Кэшировано:', cachedPath);
            found.state.coverUrl = cachedPath;
          }
        } catch (error) {
          console.error('[Cover cache] Ошибка кэширования, используется CDN:', error);
        }
      } else if (coverCache.cached) {
        found.state.coverUrl = coverCache.cached;
      }
    }

    sendState(found.state);
  } catch (error) {
    console.error('[Zvuk bridge] poll error:', error);
    sendState({ available: false, authenticated: false, error: 'network' });
  }
}

async function runCommand({ command, value }) {
  let tab = tabs.find((item) => item.id === playerTabId);
  if (!tab) tab = (await findPlayerTab())?.tab;
  if (!tab) throw new Error('Плеер Zvuk не найден. Откройте zvuk.com и включите воспроизведение.');

  // Ждём, пока вкладка загрузится, если она не готова (макс 5 сек)
  if (!tab.ready) {
    console.log('[Zvuk bridge] tab not ready, waiting...');
    const startTime = Date.now();
    await new Promise((resolve, reject) => {
      const checkReady = () => {
        if (tab.ready) {
          console.log('[Zvuk bridge] tab ready after', Date.now() - startTime, 'ms');
          resolve();
        } else if (Date.now() - startTime > 5000) {
          reject(new Error('Таймаут ожидания загрузки страницы'));
        } else {
          setTimeout(checkReady, 100);
        }
      };
      checkReady();
    });
  }

  console.log('[Zvuk bridge] executing command', command, 'on tab', tab.id);
  const result = await tab.webview.executeJavaScript(buildZvukGuestScript(command, value), true);
  console.log('[Zvuk bridge] command result:', result);
  window.zvukApp.reportDebug({ command, ok: true, result, tabId: tab.id });
  setTimeout(poll, 150);
  return result;
}

window.zvukApp.onCommand(async (payload) => {
  const { command, value } = payload || {};
  try {
    await runCommand({ command, value });
    console.info('[Zvuk bridge] command OK', command);
  } catch (error) {
    console.error('[Zvuk bridge] command', command, error);
    window.zvukApp.reportDebug({ command, ok: false, error: error.message });
    sendState({ available: true, authenticated: false, error: 'command' });
  }
});

window.zvukApp.onPollNow(() => poll());

window.addEventListener('DOMContentLoaded', () => {
  addTab();
  pollTimer = setInterval(poll, POLL_MS);
});
