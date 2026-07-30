/**
 * Гостевой скрипт для webview zvuk.com.
 * Управление — через DOM-события; чтение состояния — DOM + CSS + метаданные.
 */
function buildZvukGuestScript(command, value) {
  const cmdLiteral = command == null ? 'null' : JSON.stringify(String(command));
  const valLiteral = value == null ? 'null' : JSON.stringify(value);

  return `(() => {
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
      repeatMode: 'off',
      error: null,
    };

    if (!state.available) return state;

    /** Корень плеера */
    const findRoot = () => {
      const mini = document.querySelector('[class*="miniPlayerWrapper"]');
      if (mini) return mini;
      const p = document.querySelector('[class*="playerContainer"]');
      if (p?.querySelector('[class*="controls__"]')) return p;
      const c = document.querySelector('[class*="controls__"]');
      if (c) return c.closest('[class*="player"]') || c.parentElement;
      return null;
    };
    const root = findRoot();
    if (!root) return state;
    state.hasPlayer = true;
    state._debug = { rootClass: root.className || '' };

    const q = (sel) => root.querySelector(sel);
    const dq = (sel) => document.querySelector(sel); // document-level fallback

    // Длительность трека: метаданные страницы
    let durationSec = 0;
    try {
      // JSON-LD
      document.querySelectorAll('script[type="application/ld+json"]').forEach(script => {
        if (durationSec) return;
        const data = JSON.parse(script.textContent || '{}');
        (data['@graph'] || [data]).forEach(item => {
          if (item.duration) {
            const m = item.duration.match(/^PT(?:(\\d+)H)?(?:(\\d+)M)?(?:(\\d+)S)?$/);
            if (m) durationSec = (parseInt(m[1]||0)*3600)+(parseInt(m[2]||0)*60)+(parseInt(m[3]||0));
          }
        });
      });
      // meta-теги
      if (!durationSec) {
        const meta = dq('meta[property="music:duration"], meta[itemprop="duration"]');
        if (meta) {
          const c = meta.getAttribute('content') || '';
          const m = c.match(/^PT(?:(\\d+)H)?(?:(\\d+)M)?(?:(\\d+)S)?$/);
          if (m) durationSec = (parseInt(m[1]||0)*3600)+(parseInt(m[2]||0)*60)+(parseInt(m[3]||0));
          else durationSec = parseInt(c) || 0;
        }
      }
    } catch (_) {}
    state._debug.durationFromMeta = durationSec;

    // Название, артист, обложка
    const titleEl = q('[class*="infoTitle"]') || dq('[class*="infoTitle"]');
    const artistEl = q('[class*="artistsWrapper"]') || dq('[class*="artistsWrapper"]');
    const coverEl = q('[class*="coverButton"] img') || dq('[class*="coverButton"] img, [class*="player"] img');
    const meta = navigator.mediaSession?.metadata;

    state.title = titleEl?.getAttribute('title') || titleEl?.textContent?.trim() || meta?.title || '';
    state.artist = artistEl?.getAttribute('title') || artistEl?.textContent?.trim() || (meta?.artist || '');
    state.coverUrl = coverEl?.currentSrc || coverEl?.src || meta?.artwork?.[meta.artwork.length - 1]?.src || '';

    // Кнопки управления
    const controls = q('[class*="controls__"]') || dq('[class*="controls__"]');
    const buttons = controls ? [...controls.querySelectorAll('button[class*="btn__"]')] : [];
    const playButton = buttons[1] || null;
    state.isPlaying = playButton ? (() => {
      const paths = [...playButton.querySelectorAll('path')];
      return paths.some(p => (p.getAttribute('d') || '').includes('8.25 3.09'));
    })() : false;

    // CSS прогресс (--width)
    const inner = q('[class*="inner__"]') || dq('[class*="inner__"]');
    let pct = 0;
    if (inner) {
      pct = parseFloat(
        inner.style.getPropertyValue('--width')
        || getComputedStyle(inner).getPropertyValue('--width')
        || inner.getAttribute('style')?.match(/--width:\\s*([0-9.]+)/)?.[1]
        || '0'
      ) || 0;
    }

    // Длительность и позиция
    if (durationSec > 0) {
      state.duration = durationSec;
      state.position = pct > 0 ? Math.round((durationSec * pct) / 100) : 0;
      state._debug.durationSource = 'meta';
    } else if (pct > 0) {
      // Оценка через скорость изменения --width между поллами
      const track = window.__pTrack || { t0: 0, p0: 0, dur: 0 };
      const now = Date.now();
      if (track.p0 > 0 && track.t0 > 0) {
        const dt = (now - track.t0) / 1000;
        const dp = pct - track.p0;
        if (dp > 0.01 && dp < 25 && dt > 0.3) {
          const est = Math.round((dt * 100) / dp);
          if (est > 10 && est < 7200) {
            track.dur = track.dur === 0 ? est : Math.round(0.3 * est + 0.7 * track.dur);
          }
        }
        track.p0 = pct;
        track.t0 = now;
      } else {
        track.p0 = pct;
        track.t0 = now;
      }
      window.__pTrack = track;
      if (track.dur > 0) {
        state.duration = track.dur;
        state.position = Math.round((track.dur * pct) / 100);
        state._debug.estimated = true;
      }
    }
    state._debug.pct = pct;

    // Media Session override
    try {
      const ps = navigator.mediaSession?.getPositionState?.();
      if (ps?.duration > 0) { state.duration = Math.round(ps.duration); state.position = Math.round(ps.position || 0); }
    } catch (_) {}

    // Volume
    const vs = q('[class*="miniPlayerControls"] [role="slider"]')
      || q('[role="slider"]')
      || dq('[role="slider"]');
    if (vs) {
      const v = Number(vs.getAttribute('aria-valuenow'));
      if (Number.isFinite(v)) state.volume = Math.round(v);
    }

    // Shuffle / Repeat / HiFi
    const btn = (sel) => (q(sel) || dq(sel))?.closest('button');
    const isActive = (b) => b && (/active/i.test(b.className) || b.getAttribute('aria-pressed') === 'true');
    state.isShuffle = isActive(btn('[class*="shuffle"]'));
    state.repeatMode = isActive(btn('[class*="repeat"]'))
      ? (btn('[class*="repeat"]')?.querySelectorAll('svg path').length === 2 ? 'one' : 'all')
      : 'off';
    state.isHiFi = isActive(btn('[class*="HiFi"], [class*="hiFi"]'));
    state.authenticated = Boolean(state.title || meta?.title || document.cookie.includes('auth'));

    if (!CMD) return state;

    // Управление
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
    const progressBar = q('[class*="bar__"]') || q('[class*="root__"][class*="progress"]') || dq('[class*="bar__"]');

    switch (CMD) {
      case 'toggle': return reactClick(playButton);
      case 'play': return state.isPlaying || reactClick(playButton);
      case 'pause': return !state.isPlaying || reactClick(playButton);
      case 'prev': return reactClick(buttons[0]);
      case 'next': return reactClick(buttons[2]);
      case 'seek': return pointerAt(progressBar, VAL);
      case 'volume': return pointerAt(vs, VAL);
      case 'shuffle': return reactClick(btn('[class*="shuffle"]'));
      case 'repeat': return reactClick(btn('[class*="repeat"]'));
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
