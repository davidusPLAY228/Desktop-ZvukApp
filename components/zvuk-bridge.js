/**
 * Гостевой скрипт для webview zvuk.com.
 * Селекторы основаны на фактическом DOM мини-плеера (см. .codex/player.md).
 * Управление — через DOM-события; чтение состояния — DOM + <audio> + Media Session API.
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

    /** Найти корень плеера: мини-плеер или нижняя панель. */
    const findRoot = () => {
      const mini = document.querySelector('[class*="miniPlayerWrapper"]');
      if (mini) return mini;
      const playerContainer = document.querySelector('[class*="playerContainer"]');
      if (playerContainer?.querySelector('[class*="controls__"]')) return playerContainer;
      const controls = document.querySelector('[class*="controls__"]');
      if (controls) return controls.closest('[class*="player"]') || controls.parentElement || document.body;
      return null;
    };

    const root = findRoot();
    if (!root) return state;
    state.hasPlayer = true;
    state._debug = { rootClass: root.className || 'no-class' };

    const q = (sel) => root.querySelector(sel);
    const qa = (sel) => [...root.querySelectorAll(sel)];

    const media = document.querySelector('audio,video');
    const meta = navigator.mediaSession?.metadata;

    const titleEl = q('[class*="infoTitle"]') || q('a[href*="/track/"] p[title]') || document.querySelector('[class*="infoTitle"], a[href*="/track/"] p[title]');
    const artistEl = q('[class*="artistsWrapper"]') || q('[class*="info__"] a[href*="/artist/"]') || document.querySelector('[class*="artistsWrapper"], [class*="info__"] a[href*="/artist/"]');
    const coverEl = q('[class*="coverButton"] img') || q('img[alt*="Трек"]') || document.querySelector('[class*="coverButton"] img, img[alt*="Трек"], [class*="player"] img');

    state._debug.titleEl = !!titleEl;
    state._debug.artistEl = !!artistEl;
    state._debug.coverEl = !!coverEl;

    state.title = titleEl?.getAttribute('title') || titleEl?.textContent?.trim() || meta?.title || '';
    state.artist = artistEl?.getAttribute('title') || artistEl?.textContent?.trim() || (meta?.artist || '');
    state.coverUrl = coverEl?.currentSrc || coverEl?.src || meta?.artwork?.[meta.artwork.length - 1]?.src || '';

    const controls = q('[class*="controls__"]') || q('[class*="actions__"]') || document.querySelector('[class*="controls__"], [class*="actions__"]');
    const buttons = controls ? [...controls.querySelectorAll('button[class*="btn__"]')] : [];
    const prevButton = buttons[0] || null;
    const playButton = buttons[1] || null;
    const nextButton = buttons[2] || null;

    const isPauseIcon = (btn) => {
      if (!btn) return false;
      const paths = [...btn.querySelectorAll('path')];
      return paths.some(p => {
        const d = p.getAttribute('d') || '';
        return d.includes('8.25 3.09') || d.includes('15.608 3.09') || d.includes('V16.91') || /M\d+\.\d+\s+3\.09/.test(d);
      });
    };

    if (media) {
      state.position = Number.isFinite(media.currentTime) ? media.currentTime : 0;
      state.duration = Number.isFinite(media.duration) && media.duration > 0 ? media.duration : 0;
      state.volume = Math.round((media.volume ?? 1) * 100);
      state.isPlaying = !media.paused && !media.ended;
      state._debug.media = { hasAudio: true, currentTime: media.currentTime, duration: media.duration };
    } else {
      state._debug.media = { hasAudio: false };
    }

    try {
      const pos = navigator.mediaSession?.getPositionState?.();
      if (pos?.duration > 0) state.duration = pos.duration;
      if (pos?.position >= 0) state.position = pos.position;
      state._debug.mediaSession = pos || null;
    } catch (_) {
      state._debug.mediaSession = null;
    }

    if (playButton) {
      state.isPlaying = isPauseIcon(playButton);
    }

    const progressInner = q('[class*="inner__"][class*="nimated"]')
      || q('[class*="inner__"]')
      || document.querySelector('[class*="inner__"][class*="nimated"], [class*="inner__"]');
    if (progressInner) {
      const raw = progressInner.style.getPropertyValue('--width')
        || getComputedStyle(progressInner).getPropertyValue('--width')
        || progressInner.getAttribute('style')?.match(/--width:\s*([0-9.]+)/)?.[1]
        || '0';
      const pct = parseFloat(raw) || 0;
      if (state.duration > 0 && pct > 0) {
        state.position = Math.max(state.position, (state.duration * pct) / 100);
      }
    }

    const volumeSlider = q('[class*="miniPlayerControls"] [role="slider"]')
      || q('[role="slider"][aria-valuetext*="ромкость"]')
      || q('[role="slider"]')
      || document.querySelector('[role="slider"][aria-valuetext*="ромкость"], [class*="miniPlayerControls"] [role="slider"], [class*="wrapper__"] [role="slider"]');
    if (volumeSlider) {
      const vol = Number(volumeSlider.getAttribute('aria-valuenow'));
      if (Number.isFinite(vol)) state.volume = Math.round(vol);
    }

    const isVisible = (el) => {
      if (!el) return false;
      const s = getComputedStyle(el);
      return s.display !== 'none' && s.visibility !== 'hidden' && Number(s.opacity || 1) > 0.05;
    };

    const buttonActive = (btn) => {
      if (!btn) return false;
      const activeIcon = btn.querySelector('[class*="activeIcon"]');
      if (activeIcon) return isVisible(activeIcon);
      const wrapper = btn.querySelector('[class*="wrapper__"]');
      if (wrapper && wrapper.querySelector('[class*="activeIcon"]')) {
        return isVisible(wrapper.querySelector('[class*="activeIcon"]'));
      }
      return /active|Active/i.test(btn.className) || btn.getAttribute('aria-pressed') === 'true';
    };

    const shuffleBtn = (q('[class*="shuffleIcon"]') || q('button [class*="shuffle"]') || document.querySelector('[class*="shuffleIcon"], button [class*="shuffle"]'))?.closest('button');
    const repeatBtn = (q('[class*="repeatIcon"]') || q('button [class*="repeat"]') || document.querySelector('[class*="repeatIcon"], button [class*="repeat"]'))?.closest('button');
    const hifiBtn = q('[class*="hiFiButton"]') || q('[class*="HifiButton"]') || document.querySelector('[class*="hiFiButton"], [class*="HifiButton"]');

    state.isShuffle = buttonActive(shuffleBtn);
    if (buttonActive(repeatBtn)) {
      const oneMarker = repeatBtn?.querySelector('[class*="repeatOne"], [class*="RepeatOne"], small');
      const text = repeatBtn?.textContent || '';
      const hasOneMarker = oneMarker && isVisible(oneMarker) && oneMarker.textContent.trim() === '1';
      state.repeatMode = hasOneMarker || /\b1\b/.test(text) ? 'one' : 'all';
    }

    state.isHiFi = buttonActive(hifiBtn);
    state._debug.hifiBtn = !!hifiBtn;

    state.authenticated = Boolean(
      state.title || meta?.title || media?.src || document.cookie.includes('auth')
    );

    if (!CMD) return state;

    const reactClick = (element, name) => {
      if (!element) throw new Error('zvuk-' + name + '-not-found');
      const opts = { bubbles: true, cancelable: true, view: window, buttons: 1 };
      element.dispatchEvent(new PointerEvent('pointerdown', { ...opts, pointerId: 1, pointerType: 'mouse', isPrimary: true }));
      element.dispatchEvent(new MouseEvent('mousedown', opts));
      element.dispatchEvent(new PointerEvent('pointerup', { ...opts, pointerId: 1, pointerType: 'mouse', isPrimary: true }));
      element.dispatchEvent(new MouseEvent('mouseup', opts));
      element.dispatchEvent(new MouseEvent('click', opts));
      return true;
    };

    /** React-слайдеры Zvuk слушают mousedown → mousemove/mouseup на document. */
    const pointerAtPercent = (element, percent, name) => {
      if (!element) throw new Error('zvuk-' + name + '-not-found');
      const pct = Math.max(0, Math.min(100, Number(percent)));
      const box = element.getBoundingClientRect();
      const x = box.left + (box.width * pct) / 100;
      const y = box.top + box.height / 2;
      const base = { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y, buttons: 1 };
      element.dispatchEvent(new MouseEvent('mousedown', base));
      document.dispatchEvent(new MouseEvent('mousemove', base));
      document.dispatchEvent(new MouseEvent('mouseup', base));
      return true;
    };

    const progressBar = q('[class*="bar__"]')
      || q('[class*="root__"][class*="progress"]')
      || document.querySelector('[class*="bar__"], [class*="root__"][class*="progress"], div[class*="root__"] > div[class*="bar__"]');

    switch (CMD) {
      case 'toggle':
        return reactClick(playButton, 'play-button');
      case 'play':
        if (!state.isPlaying) return reactClick(playButton, 'play-button');
        return true;
      case 'pause':
        if (state.isPlaying) return reactClick(playButton, 'play-button');
        return true;
      case 'prev':
        return reactClick(prevButton, 'previous-button');
      case 'next':
        return reactClick(nextButton, 'next-button');
      case 'shuffle':
        return reactClick(shuffleBtn, 'shuffle-button');
      case 'repeat':
        return reactClick(repeatBtn, 'repeat-button');
      case 'hifi':
        return reactClick(hifiBtn, 'hifi-button');
      case 'seek':
        return pointerAtPercent(progressBar, VAL, 'progress-bar');
      case 'volume':
        return pointerAtPercent(volumeSlider, VAL, 'volume-slider');
      default:
        throw new Error('zvuk-unknown-command-' + CMD);
    }
  })()`;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { buildZvukGuestScript };
}

if (typeof window !== 'undefined') {
  window.buildZvukGuestScript = buildZvukGuestScript;
}
