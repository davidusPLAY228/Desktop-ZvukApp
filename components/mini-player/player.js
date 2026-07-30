const $ = (id) => document.getElementById(id);

const els = Object.fromEntries(
  [
    "cover",
    "placeholder",
    "title",
    "artist",
    "notice",
    "seek",
    "current",
    "duration",
    "play",
    "prev",
    "next",
    "volume",
    "mute",
    "shuffle",
    "repeat",
    "repeat-mode",
    "retry",
    "close",
  ].map((id) => [id, $(id)])
);

let dragging = false;
let lastVolume = 70;
let staleTimer = null;
let lastUpdate = 0;

const time = (seconds) => `${Math.floor((seconds || 0) / 60)}:${String(Math.floor((seconds || 0) % 60)).padStart(2, '0')}`;
const send = (command, value) => window.miniPlayer.command(command, value);

function setBusy(isBusy) {
  els.play.disabled = isBusy;
  els.prev.disabled = isBusy;
  els.next.disabled = isBusy;
}

function markFresh() {
  lastUpdate = Date.now();
  if (staleTimer) clearTimeout(staleTimer);
  staleTimer = setTimeout(() => {
    if (Date.now() - lastUpdate >= 4500) {
      els.notice.hidden = false;
      els.notice.textContent = 'Нет связи с zvuk.com. Проверьте вкладку и воспроизведение.';
      els.retry.hidden = false;
    }
  }, 4500);
}

els.close.onclick = () => window.miniPlayer.close();
els.play.onclick = () => { setBusy(true); send('toggle'); };
els.prev.onclick = () => { setBusy(true); send('prev'); };
els.next.onclick = () => { setBusy(true); send('next'); };
els.shuffle.onclick = () => send('shuffle');
els.repeat.onclick = () => send('repeat');
els.volume.oninput = () => {
  lastVolume = Number(els.volume.value) || lastVolume;
  send('volume', Number(els.volume.value));
  els.mute.textContent = Number(els.volume.value) ? '🔊' : '🔇';
};
els.mute.onclick = () => {
  els.volume.value = Number(els.volume.value) ? 0 : lastVolume;
  els.volume.dispatchEvent(new Event('input'));
};
els.seek.onpointerdown = () => { dragging = true; };
els.seek.onpointerup = () => { dragging = false; send('seek', Number(els.seek.value)); };
els.retry.onclick = () => { setBusy(true); send('play'); window.miniPlayer.requestState(); };

window.miniPlayer.onState((state) => {
  markFresh();
  setBusy(false);

  const noSite = state.available === false;
  const noPlayer = state.available && !state.hasPlayer && !state.title;
  const needAuth = state.available && !state.authenticated && !state.title;
  const unavailable = noSite || noPlayer || needAuth;

  els.notice.hidden = !unavailable && !state.error;
  els.retry.hidden = !state.error && !noSite;

  if (state.error === 'network') els.notice.textContent = 'Сетевая ошибка. Откройте zvuk.com и повторите.';
  else if (state.error === 'command') els.notice.textContent = 'Команда не выполнена. Убедитесь, что трек воспроизводится.';
  else if (noSite) els.notice.textContent = 'Откройте zvuk.com в главном окне.';
  else if (noPlayer) els.notice.textContent = 'Включите воспроизведение на сайте.';
  else if (needAuth) els.notice.textContent = 'Пожалуйста, войдите в zvuk.com.';
  else els.notice.textContent = '';

  els.title.textContent = state.title || 'Нет трека';
  els.artist.textContent = state.artist || '—';
  els.play.dataset.playing = String(!!state.isPlaying);
  els.play.textContent = state.isPlaying ? 'Ⅱ' : '▶';

  if (state.coverUrl) {
    els.cover.src = state.coverUrl;
    els.cover.hidden = false;
    els.placeholder.hidden = true;
  } else {
    els.cover.hidden = true;
    els.placeholder.hidden = false;
  }

  if (!dragging && state.duration > 0) {
    els.seek.value = Math.round((state.position / state.duration) * 100);
    els.current.textContent = time(state.position);
    els.duration.textContent = time(state.duration);
  } else if (!dragging) {
    els.current.textContent = time(state.position);
    els.duration.textContent = time(state.duration);
  }

  if (Number.isFinite(state.volume)) {
    els.volume.value = state.volume;
    els.mute.textContent = state.volume ? '🔊' : '🔇';
  }

  els.shuffle.classList.toggle('active', !!state.isShuffle);
  els.repeat.dataset.mode = state.repeatMode || 'off';
  els['repeat-mode'].textContent = state.repeatMode === 'one' ? '1' : '';
});

window.miniPlayer.onDebug((data) => {
  setBusy(false);
  if (data.ok) return;
  els.notice.hidden = false;
  els.notice.textContent = `Ошибка: ${data.error}`;
  els.retry.hidden = false;
});

window.miniPlayer.requestState();
