/**
 * Гостевой скрипт для webview zvuk.com.
 * Генерирует JS-строку для executeJavaScript().
 *
 * Архитектура:
 * - Первый вызов: устанавливает постоянную инфраструктуру (перехватчики сети,
 *   MutationObserver, rAF-цикл) в window.__zvuk.
 * - Каждый вызов: читает из window.__zvuk + делает свежий снимок DOM.
 * - Длительность: API > JSON-LD > meta-теги > CSS-оценка
 * - Позиция: длительность × CSS --width / 100
 */

function buildZvukGuestScript(command, value) {
  const cmdLiteral = JSON.stringify(command == null ? null : String(command));
  const valLiteral = JSON.stringify(value == null ? null : value);

  return `(() => {
    "use strict";
    const CMD = ${cmdLiteral};
    const VAL = ${valLiteral};

    const state = {
      available: /(^|\\.)zvuk\\.com$/i.test(location.hostname),
      hasPlayer: false,
      authenticated: false,
      title: '',
      artist: '',
      coverUrl: '',
      isPlaying: false,
      position: 0,
      duration: 0,
      volume: null,
      isShuffle: false,
      isHiFi: false,
      repeatMode: 'off',
      error: null,
      _debug: {},
    };
    if (!state.available) return state;

    // ============================================================
    // Глубокий поиск длительности в JSON-ответах API
    // ============================================================
    function findDurationDeep(obj, depth) {
      if (!depth) depth = 0;
      if (depth > 5 || !obj || typeof obj !== 'object') return 0;
      for (const key of ['duration','durationMs','duration_sec','length','totalTime','trackLength','seconds']) {
        const v = obj[key];
        if (typeof v === 'number' && v > 10 && v < 7200) return Math.round(v);
        if (typeof v === 'number' && key === 'durationMs' && v > 10000) return Math.round(v / 1000);
        if (typeof v === 'string' && /^\\d+$/.test(v)) {
          const n = parseInt(v, 10);
          if (n > 10 && n < 7200) return n;
        }
      }
      for (const key of Object.keys(obj)) {
        const v = obj[key];
        if (typeof v === 'object' && v) {
          const r = findDurationDeep(v, depth + 1);
          if (r) return r;
        }
        if (Array.isArray(v)) {
          for (const item of v) {
            if (typeof item === 'object' && item) {
              const r = findDurationDeep(item, depth + 1);
              if (r) return r;
            }
          }
        }
      }
      return 0;
    }

    // ============================================================
    // Постоянное хранилище (живёт между вызовами executeJavaScript)
    // ============================================================
    if (!window.__zvuk) {
      window.__zvuk = {
        _installed: false,
        _apiDuration: 0,
        _apiDurationAt: 0,
        _lastPct: 0,
        _lastPctAt: 0,
        _lastRafPct: 0,
        _lastRafPctAt: 0,
        _rate: { p0: 0, t0: 0, dur: 0, durAt: 0, count: 0 },
        _trackChanged: false,
        _trackChangeAt: 0,
        _lastTitle: '',
        _seekAt: 0,
        _lastVolume: 70,
        _localShuffle: false,
        _localRepeatMode: 'off',
      };
    }
    const S = window.__zvuk;

    // ============================================================
    // ОДНОКРАТНАЯ НАСТРОЙКА (выполняется только при первом poll)
    // ============================================================
    if (!S._installed) {
      S._installed = true;
      try {
        // --- 1. Перехват fetch ---
        const _origFetch = window.fetch.bind(window);
        window.fetch = function _zvukFetch(input, init) {
          const url =
            (typeof input === 'string' ? input : (input && input.url) ? input.url : '') || '';
          return _origFetch(input, init).then(function _onFetchResponse(response) {
            if (
              url &&
              (url.indexOf('/api/') > -1 ||
               url.indexOf('graphql') > -1 ||
               url.indexOf('/v1/') > -1 ||
               url.indexOf('/v2/') > -1 ||
               url.indexOf('/tracks/') > -1)
            ) {
              response.clone().text().then(function _parseFetchBody(text) {
                try {
                  const data = JSON.parse(text);
                  const dur = findDurationDeep(data);
                  if (dur > 0) {
                    S._apiDuration = dur;
                    S._apiDurationAt = Date.now();
                  }
                } catch (_e) {}
              }).catch(function () {});
            }
            return response;
          }).catch(function (e) { throw e; });
        };

        // --- 2. Перехват XMLHttpRequest ---
        const _origXhrOpen = XMLHttpRequest.prototype.open;
        const _origXhrSend = XMLHttpRequest.prototype.send;
        XMLHttpRequest.prototype.open = function _zvukXhrOpen(m, u) {
          this._zvukUrl = typeof u === 'string' ? u : String(u);
          return _origXhrOpen.apply(this, arguments);
        };
        XMLHttpRequest.prototype.send = function _zvukXhrSend(body) {
          this.addEventListener('load', function _zvukXhrLoad() {
            try {
              if (
                this._zvukUrl &&
                (this._zvukUrl.indexOf('/api/') > -1 ||
                 this._zvukUrl.indexOf('graphql') > -1)
              ) {
                const data = JSON.parse(this.responseText);
                const dur = findDurationDeep(data);
                if (dur > 0) {
                  S._apiDuration = dur;
                  S._apiDurationAt = Date.now();
                }
              }
            } catch (_e) {}
          });
          return _origXhrSend.apply(this, arguments);
        };

        // --- 3. rAF-цикл: отслеживание --width с частотой кадров ---
        (function _zvukRaf() {
          try {
            const inner =
              document.querySelector('[class*="inner__"]') ||
              document.querySelector('[class*="bar__"]');
            if (inner) {
              const raw =
                inner.style.getPropertyValue('--width') ||
                getComputedStyle(inner).getPropertyValue('--width') ||
                (inner.getAttribute('style') || '').match(/--width:\\s*([0-9.]+)/)?.[1] ||
                '0';
              const pct = parseFloat(raw) || 0;
              if (pct > 0) {
                const now = Date.now();
                const prev = S._lastRafPct;

                // Скачок > 5% = перемотка (seek)
                if (prev > 0 && Math.abs(pct - prev) > 5) {
                  S._seekAt = now;
                }

                // Плавный рост = оценка длительности
                if (prev > 0 && pct > prev && (pct - prev) < 10) {
                  if (S._rate.t0 > 0) {
                    const dt = (now - S._rate.t0) / 1000;
                    const dp = pct - S._rate.p0;
                    if (dp > 0.01 && dt > 0.05) {
                      const est = Math.round((dt * 100) / dp);
                      if (est > 10 && est < 7200) {
                        if (S._rate.dur === 0) {
                          S._rate.dur = est;
                        } else {
                          const alpha = Math.min(0.5, 10 / (S._rate.count + 10));
                          S._rate.dur = Math.round(alpha * est + (1 - alpha) * S._rate.dur);
                        }
                        S._rate.durAt = now;
                        S._rate.count++;
                      }
                    }
                  }
                  S._rate.p0 = pct;
                  S._rate.t0 = now;
                }

                S._lastRafPct = pct;
                S._lastRafPctAt = now;
                S._lastPct = pct;
                S._lastPctAt = now;
              }
            }
          } catch (_e) {}
          requestAnimationFrame(_zvukRaf);
        })();

        // --- 4. MutationObserver на заголовке трека ---
        const _titleEl =
          document.querySelector('[class*="infoTitle"]') ||
          document.querySelector('[class*="trackName"]');
        if (_titleEl) {
          new MutationObserver(function _titleWatcher() {
            try {
              const t = (_titleEl.textContent || '').trim();
              if (t && t !== S._lastTitle) {
                S._lastTitle = t;
                S._trackChanged = true;
                S._trackChangeAt = Date.now();
              }
            } catch (_e) {}
          }).observe(_titleEl, { childList: true, subtree: true, characterData: true });
        }

        // --- 5. MutationObserver на style прогресc-бара (--width) ---
        const _widthEl =
          document.querySelector('[class*="inner__"]') ||
          document.querySelector('[class*="bar__"]');
        if (_widthEl) {
          new MutationObserver(function _widthWatcher() {
            try {
              const raw =
                _widthEl.style.getPropertyValue('--width') ||
                (_widthEl.getAttribute('style') || '').match(/--width:\\s*([0-9.]+)/)?.[1] ||
                '0';
              const pct = parseFloat(raw) || 0;
              if (pct > 0) {
                S._lastPct = pct;
                S._lastPctAt = Date.now();
              }
            } catch (_e) {}
          }).observe(_widthEl, { attributes: true, attributeFilter: ['style'] });
        }
      } catch (_e) {
        console.warn('[Zvuk] setup error:', _e);
      }
    }

    // ============================================================
    // СНИМОК DOM (выполняется при каждом poll)
    // ============================================================

    // --- Корень плеера ---
    const findRoot = () => {
      const mini = document.querySelector('[class*="miniPlayerWrapper"]');
      if (mini) return mini;
      const p = document.querySelector('[class*="playerContainer"]');
      if (p && p.querySelector('[class*="controls__"]')) return p;
      const c = document.querySelector('[class*="controls__"]');
      if (c) return c.closest('[class*="player"]') || c.parentElement;
      return null;
    };
    const root = findRoot();
    if (!root) {
      return state;
    }
    state.hasPlayer = true;
    state._debug = { rootClass: root.className || '' };

    const q = (sel) => root.querySelector(sel);
    const dq = (sel) => document.querySelector(sel);

    // --- Название, артист, обложка ---
    const titleEl = q('[class*="infoTitle"]') || dq('[class*="infoTitle"]');
    const artistEl = q('[class*="artistsWrapper"]') || dq('[class*="artistsWrapper"]');
    const coverEl =
      q('[class*="coverButton"] img') ||
      dq('[class*="coverButton"] img, [class*="player"] img');
    const msMeta = navigator.mediaSession?.metadata;

    state.title =
      titleEl?.getAttribute('title') || titleEl?.textContent?.trim() || msMeta?.title || '';
    state.artist =
      artistEl?.getAttribute('title') || artistEl?.textContent?.trim() || msMeta?.artist || '';
    state.coverUrl =
      coverEl?.currentSrc ||
      coverEl?.src ||
      msMeta?.artwork?.[msMeta.artwork.length - 1]?.src ||
      '';

    // --- Кнопки управления ---
    const controls = q('[class*="controls__"]') || dq('[class*="controls__"]');
    const buttons = controls ? [...controls.querySelectorAll('button[class*="btn__"]')] : [];
    const playButton = buttons[1] || null;
    state.isPlaying = (() => {
      if (!playButton) return false;
      const paths = [...playButton.querySelectorAll('path')];
      return paths.some((p) => (p.getAttribute('d') || '').includes('8.25 3.09'));
    })();

    // --- Shuffle / Repeat / HiFi ---
    const btn = (sel) => (q(sel) || dq(sel))?.closest('button');
    // Детекция активного состояния кнопки-переключателя.
    // Возвращает: true / false / null (не удалось определить).
    // На zvuk.com активное состояние обозначено видимым span styles_activeIcon__...
    // (он всегда в DOM, но скрыт через opacity/display/scale, когда выключен).
    const isActive = (b) => {
      if (!b) return null;
      // 1. Модификатор "active" в классе кнопки (например HiFi: ...Active__NjZqr)
      const cls = typeof b.className === 'string' ? b.className : '';
      if (/active/i.test(cls)) return true;
      // 2. ARIA/data-атрибуты переключателя
      const attr = (n) => b.getAttribute(n);
      if (attr('aria-pressed') === 'true' || attr('aria-pressed') === '') return true;
      if (attr('aria-checked') === 'true' || attr('aria-checked') === '') return true;
      if (attr('data-active') === 'true' || attr('data-active') === '') return true;
      // 3. Видимый индикатор активного состояния среди вложенных элементов
      let hasIndicator = false;
      for (const el of b.querySelectorAll('[class*="active" i]')) {
        hasIndicator = true;
        try {
          const cs = getComputedStyle(el);
          if (cs.display === 'none' || cs.visibility === 'hidden') continue;
          if (parseFloat(cs.opacity) <= 0.01) continue;
          const t = (cs.transform || '').toLowerCase();
          if (/scale\\(\\s*0[\\s,\\)]|scale[xy]\\(\\s*0[\\s,\\)]/.test(t)) continue;
          if (parseFloat(cs.width) <= 1 && parseFloat(cs.height) <= 1) continue;
          return true;
        } catch (_e) { continue; }
      }
      return hasIndicator ? false : null;
    };
    const shuffleBtn = btn('[class*="shuffle"]');
    const repeatBtn = btn('[class*="repeat"]');
    const domShuffle = isActive(shuffleBtn);
    const domRepeat = isActive(repeatBtn);
    // DOM-детекция приоритетнее, иначе используем локальный трекинг (по кликам)
    state.isShuffle = domShuffle === null ? S._localShuffle : domShuffle;
    state.repeatMode = (() => {
      if (domRepeat === null) return S._localRepeatMode;
      if (domRepeat === false) return 'off';
      // Repeat включён: пробуем отличить "one" от "all"
      const info = ((repeatBtn && (repeatBtn.getAttribute('aria-label') || repeatBtn.getAttribute('title'))) || '').toLowerCase();
      if (/one|повтор(ить)? ?(1|од)|повторить ?трек/i.test(info)) return 'one';
      const badge = repeatBtn && [...repeatBtn.querySelectorAll('text, [class*="badge" i]')].find((el) => (el.textContent || '').trim() === '1');
      if (badge) return 'one';
      return S._localRepeatMode === 'one' ? 'one' : 'all';
    })();
    // HiFi: активное состояние определяется классом кнопки (HifiButton_hiFiButtonActive__NjZqr).
    // Шаг 3 isActive() не используем — внутри кнопки есть статичные HifiButton_effectActive__...
    // spans, которые не являются надёжным индикатором.
    const hifiBtnEl = btn('[class*="HiFi"], [class*="hiFi"]');
    state.isHiFi =
      !!hifiBtnEl && /active/i.test(typeof hifiBtnEl.className === 'string' ? hifiBtnEl.className : '');
    state._debug.shuffle = { dom: domShuffle, local: S._localShuffle };
    state._debug.repeat = { dom: domRepeat, local: S._localRepeatMode };
    state.authenticated = Boolean(
      state.title || msMeta?.title || document.cookie.includes('auth')
    );

    // --- Volume ---
    const vs =
      q('[class*="miniPlayerControls"] [role="slider"]') ||
      q('[role="slider"]') ||
      dq('[role="slider"]');
    if (vs) {
      const v = Number(vs.getAttribute('aria-valuenow'));
      if (Number.isFinite(v)) state.volume = Math.round(v);
    }

    // ============================================================
    // ДЛИТЕЛЬНОСТЬ: цепочка приоритетов
    // ============================================================
    let duration = 0;
    let durationSource = 'none';

    // 1) Из перехваченного API
    if (S._apiDuration > 0) {
      duration = S._apiDuration;
      durationSource = 'api';
    }

    // 2) JSON-LD (структурированные данные страницы)
    if (!duration) {
      try {
        const scripts = document.querySelectorAll('script[type="application/ld+json"]');
        for (let i = 0; i < scripts.length; i++) {
          const data = JSON.parse(scripts[i].textContent || '{}');
          const items = data['@graph'] || [data];
          for (let j = 0; j < items.length; j++) {
            const item = items[j];
            if (item?.duration) {
              const m = item.duration.match(/^PT(?:(\\d+)H)?(?:(\\d+)M)?(?:(\\d+)S)?$/);
              if (m) {
                duration =
                  (parseInt(m[1] || 0, 10) * 3600) +
                  (parseInt(m[2] || 0, 10) * 60) +
                  parseInt(m[3] || 0, 10);
                if (duration) break;
              }
            }
          }
          if (duration) break;
        }
      } catch (_e) {}
      if (duration > 0) durationSource = 'jsonld';
    }

    // 3) Meta-теги
    if (!duration) {
      try {
        const mEl = dq('meta[property="music:duration"], meta[itemprop="duration"]');
        if (mEl) {
          const c = (mEl.getAttribute('content') || '').trim();
          const m = c.match(/^PT(?:(\\d+)H)?(?:(\\d+)M)?(?:(\\d+)S)?$/);
          if (m) {
            duration =
              (parseInt(m[1] || 0, 10) * 3600) +
              (parseInt(m[2] || 0, 10) * 60) +
              parseInt(m[3] || 0, 10);
          } else {
            duration = parseInt(c, 10) || 0;
          }
        }
      } catch (_e) {}
      if (duration > 0) durationSource = 'meta';
    }

    // 4) CSS-оценка (только если 3+ отсчётов от rAF)
    if (!duration && S._rate.dur > 0 && S._rate.count >= 3) {
      duration = S._rate.dur;
      durationSource = 'css-rate';
    }

    // Media Session override (если вдруг появится)
    try {
      const ps = navigator.mediaSession?.getPositionState?.();
      if (ps?.duration > 0) {
        duration = Math.round(ps.duration);
        durationSource = 'media-session';
        if (ps.position > 0) state.position = Math.round(ps.position);
      }
    } catch (_e) {}

    state.duration = duration;
    state._debug.durationSource = durationSource;
    state._debug.apiDuration = S._apiDuration;
    state._debug.rateDur = S._rate.dur;
    state._debug.rateCount = S._rate.count;

    // ============================================================
    // ПОЗИЦИЯ: длительность × CSS --width
    // ============================================================
    const pct = S._lastPct || 0;
    let position = 0;
    if (duration > 0 && pct > 0) {
      position = Math.round((duration * pct) / 100);
    }

    state.position = position;
    state._debug.pct = pct;
    state._debug.lastPctAt =
      S._lastPctAt ? (Date.now() - S._lastPctAt) + 'ms ago' : 'never';

    // ============================================================
    // ТРИГГЕРЫ (флаги для player.js)
    // ============================================================

    // Смена трека: через MutationObserver + сравнение заголовка
    if (S._trackChanged || (state.title && state.title !== S._lastTitle)) {
      state._debug.trackChanged = true;
      S._lastTitle = state.title;
      S._trackChanged = false;
    }

    // Перемотка: скачок --width > 5% в rAF
    if (S._seekAt > 0 && Date.now() - S._seekAt < 3000) {
      state._debug.seekDetected = true;
      state._debug.seekAge = (Date.now() - S._seekAt) + 'ms';
    }

    // ============================================================
    // КОМАНДЫ (выполняются при CMD !== null)
    // ============================================================
    if (CMD === null) return state;

    const reactClick = (el) => {
      if (!el) throw new Error('zvuk-btn-not-found');
      el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, view: window, buttons: 1, pointerId: 1 }));
      el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window, buttons: 1 }));
      el.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, view: window, buttons: 1, pointerId: 1 }));
      el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window, buttons: 1 }));
      el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window, buttons: 1 }));
      return true;
    };
    const pointerAt = (el, pctVal) => {
      if (!el) throw new Error('zvuk-slider-not-found');
      const box = el.getBoundingClientRect();
      const x = box.left + (box.width * Math.max(0, Math.min(100, Number(pctVal)))) / 100;
      const y = box.top + box.height / 2;
      el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y, buttons: 1 }));
      document.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y, buttons: 1 }));
      document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y, buttons: 1 }));
      return true;
    };
    const progressBar =
      q('[class*="bar__"]') ||
      q('[class*="root__"][class*="progress"]') ||
      dq('[class*="bar__"]');

    switch (CMD) {
      case 'toggle': return reactClick(playButton);
      case 'play': return state.isPlaying || reactClick(playButton);
      case 'pause': return !state.isPlaying || reactClick(playButton);
      case 'prev': return reactClick(buttons[0]);
      case 'next': return reactClick(buttons[2]);
      case 'seek': return pointerAt(progressBar, VAL);
      case 'volume': return pointerAt(vs, VAL);
      case 'volume-up': {
        if (!vs) throw new Error('zvuk-slider-not-found');
        const current = Number(vs.getAttribute('aria-valuenow')) || 0;
        const newVol = Math.min(100, current + 10);
        return pointerAt(vs, newVol);
      }
      case 'volume-down': {
        if (!vs) throw new Error('zvuk-slider-not-found');
        const current = Number(vs.getAttribute('aria-valuenow')) || 0;
        const newVol = Math.max(0, current - 10);
        return pointerAt(vs, newVol);
      }
      case 'mute': {
        if (!vs) throw new Error('zvuk-slider-not-found');
        const current = Number(vs.getAttribute('aria-valuenow')) || 0;
        if (!S._lastVolume) S._lastVolume = 70;
        if (current > 0) {
          S._lastVolume = current;
          return pointerAt(vs, 0);
        } else {
          return pointerAt(vs, S._lastVolume);
        }
      }
      case 'shuffle':
        S._localShuffle = !S._localShuffle;
        return reactClick(btn('[class*="shuffle"]'));
      case 'repeat': {
        // Цикл повторения на сайте: off → all → one → off
        S._localRepeatMode =
          S._localRepeatMode === 'off' ? 'all' : S._localRepeatMode === 'all' ? 'one' : 'off';
        return reactClick(btn('[class*="repeat"]'));
      }
      case 'hifi': return reactClick(btn('[class*="HiFi"], [class*="hiFi"]'));
      default: throw new Error('zvuk-unknown-' + CMD);
    }
  })()`;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { buildZvukGuestScript };
}
if (typeof window !== 'undefined') {
  window.buildZvukGuestScript = buildZvukGuestScript;
}
