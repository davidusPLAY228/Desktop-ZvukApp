/**
 * Audio Controller — renderer process
 * UI мини-плеера. Показывает состояние, пришедшее из main-процесса,
 * и отправляет команды через window.playerAPI.
 *
 * Main-процесс сам общается с активным <webview> zvuk.com —
 * здесь мы только отображаем данные и дёргаем IPC.
 */

// ============ DOM ============
const btnClose         = document.getElementById('btn-close');

const cover            = document.getElementById('cover');
const coverPlaceholder = document.getElementById('cover-placeholder');
const trackTitle       = document.getElementById('track-title');
const trackArtist      = document.getElementById('track-artist');

const btnPrev          = document.getElementById('btn-prev');
const btnPlay          = document.getElementById('btn-play');
const btnNext          = document.getElementById('btn-next');
const btnLike          = document.getElementById('btn-like');
const iconPlay         = document.getElementById('icon-play');
const iconPause        = document.getElementById('icon-pause');

const progressBar      = document.getElementById('progress-bar');
const progressFill     = document.getElementById('progress-fill');
const progressThumb    = document.getElementById('progress-thumb');
const timeCurrent      = document.getElementById('time-current');
const timeTotal        = document.getElementById('time-total');

const btnMute          = document.getElementById('btn-mute');
const iconVol          = document.getElementById('icon-vol');
const iconMute         = document.getElementById('icon-mute');
const volumeSlider     = document.getElementById('volume-slider');

const btnShuffle       = document.getElementById('btn-shuffle');
const btnRepeat        = document.getElementById('btn-repeat');
const btnQueue         = document.getElementById('btn-queue');
const btnHifi          = document.getElementById('btn-hifi');

// ============ Утилиты ============
function formatTime(seconds) {
  if (!seconds || !isFinite(seconds) || seconds < 0) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function setPlayIcon(isPlaying) {
  iconPlay.style.display    = isPlaying ? 'none'   : 'block';
  iconPause.style.display   = isPlaying ? 'block' : 'none';
}

// ============ Обработчики кнопок ============
btnClose.addEventListener('click', () => {
  // Главное окно само решит: спрятать плеер + поменять пункт в трее
  window.playerAPI.closePlayer();
});

btnPlay.addEventListener('click', () => window.playerAPI.togglePlay());
btnNext.addEventListener('click', () => window.playerAPI.next());
btnPrev.addEventListener('click', () => window.playerAPI.prev());
btnLike.addEventListener('click', () => {
  btnLike.classList.toggle('active');
  window.playerAPI.toggleLike();
});

btnShuffle.addEventListener('click', () => {
  btnShuffle.classList.toggle('active');
  window.playerAPI.toggleShuffle();
});

btnRepeat.addEventListener('click', () => {
  // Циклически: off → all → one → off
  const cls = btnRepeat.classList;
  if (!cls.contains('active') && !cls.contains('repeat-one')) {
    cls.add('active');
  } else if (cls.contains('active') && !cls.contains('repeat-one')) {
    cls.remove('active');
    cls.add('active', 'repeat-one');
  } else {
    cls.remove('active', 'repeat-one');
  }
  window.playerAPI.toggleRepeat();
});

btnQueue.addEventListener('click', () => window.playerAPI.openQueue());

btnHifi.addEventListener('click', () => {
  btnHifi.classList.toggle('active');
  window.playerAPI.toggleHifi();
});

// ============ Прогресс-бар ============
progressBar.addEventListener('click', (e) => {
  const rect = progressBar.getBoundingClientRect();
  const pct  = ((e.clientX - rect.left) / rect.width) * 100;
  window.playerAPI.seek(Math.max(0, Math.min(100, pct)));
});

// Drag по прогресс-бару
let isDraggingProgress = false;
function updateProgressFromEvent(e) {
  const rect = progressBar.getBoundingClientRect();
  const pct  = ((e.clientX - rect.left) / rect.width) * 100;
  progressFill.style.width = `${pct}%`;
  progressThumb.style.left = `${pct}%`;
}
progressBar.addEventListener('mousedown', (e) => {
  isDraggingProgress = true;
  updateProgressFromEvent(e);
});
document.addEventListener('mousemove', (e) => {
  if (isDraggingProgress) updateProgressFromEvent(e);
});
document.addEventListener('mouseup', (e) => {
  if (isDraggingProgress) {
    isDraggingProgress = false;
    const rect = progressBar.getBoundingClientRect();
    const pct  = ((e.clientX - rect.left) / rect.width) * 100;
    window.playerAPI.seek(Math.max(0, Math.min(100, pct)));
  }
});

// ============ Громкость ============
volumeSlider.addEventListener('input', () => {
  const v = parseInt(volumeSlider.value, 10);
  window.playerAPI.setVolume(v);
  updateMuteIcon(v);
});

btnMute.addEventListener('click', () => {
  const cur = parseInt(volumeSlider.value, 10);
  if (cur > 0) {
    volumeSlider.dataset.prev = String(cur);
    volumeSlider.value = 0;
  } else {
    volumeSlider.value = volumeSlider.dataset.prev || 70;
  }
  const v = parseInt(volumeSlider.value, 10);
  window.playerAPI.setVolume(v);
  updateMuteIcon(v);
});

function updateMuteIcon(volume) {
  if (volume === 0) {
    iconVol.style.display   = 'none';
    iconMute.style.display  = 'block';
  } else {
    iconVol.style.display   = 'block';
    iconMute.style.display  = 'none';
  }
}

// ============ Приём состояния от main ============
window.playerAPI.onState((state) => {
  // Обложка
  if (state.coverUrl) {
    cover.src = state.coverUrl;
    cover.classList.add('show');
    coverPlaceholder.style.display = 'none';
  } else {
    cover.classList.remove('show');
    cover.removeAttribute('src');
    coverPlaceholder.style.display = 'block';
  }

  // Текст
  trackTitle.textContent  = state.title  || 'Нет трека';
  trackArtist.textContent = state.artist || '—';

  // Play/Pause
  if (typeof state.isPlaying === 'boolean') {
    setPlayIcon(state.isPlaying);
  }

  // Like — accept both isLiked (new) and liked (legacy) field names
  var isLikedVal = state.isLiked;
  if (isLikedVal === undefined && state.liked !== undefined) isLikedVal = state.liked;
  if (typeof isLikedVal === 'boolean') {
    btnLike.classList.toggle('active', isLikedVal);
  }

  // Shuffle / Repeat / HiFi
  if (typeof state.isShuffle === 'boolean') {
    btnShuffle.classList.toggle('active', state.isShuffle);
  }
  if (typeof state.repeatMode === 'string') {
    btnRepeat.classList.remove('active', 'repeat-one');
    if (state.repeatMode === 'all')  btnRepeat.classList.add('active');
    if (state.repeatMode === 'one')  btnRepeat.classList.add('active', 'repeat-one');
  }
  if (typeof state.isHifi === 'boolean') {
    btnHifi.classList.toggle('active', state.isHifi);
  }

  // Прогресс
  if (typeof state.position === 'number' && !isDraggingProgress) {
    const pct = state.duration > 0
      ? (state.position / state.duration) * 100
      : 0;
    progressFill.style.width = `${pct}%`;
    progressThumb.style.left = `${pct}%`;
    timeCurrent.textContent  = formatTime(state.position);
    timeTotal.textContent    = formatTime(state.duration);
  }

  // Громкость
  if (typeof state.volume === 'number') {
    volumeSlider.value = state.volume;
    updateMuteIcon(state.volume);
  }
});

// ============ Инициализация ============
setPlayIcon(false);
updateMuteIcon(parseInt(volumeSlider.value, 10));
