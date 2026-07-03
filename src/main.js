/* ============================================================================
 * main.js — Bootstrap: difficulty picker -> Game -> rAF loop.
 * ==========================================================================*/
'use strict';

import { Game } from './game.js';
import { makeInput } from './input.js';
import { makeHUD } from './hud.js';
import { makeAudio } from './audio.js';
import { preloadAssetPack, assetStatusSummary } from './assets.js';
import { CHARACTER_LIST, DEFAULT_ROSTER, characterByKey } from './characters.js';
import { makeCharacterPreview } from './characterPreview.js';
import { normalizeMode } from './modes.js';

const $ = (id) => document.getElementById(id);

let game    = null;
let input   = null;
let audio   = makeAudio();
let last    = 0;
let running = false;
let paused  = false;
let starting = false;

const MENU_META = {
  mode: {
    doubles: { label: 'Doubles' },
    singles: { label: 'Singles' },
    practice: { label: 'Practice' }
  },
  venue: {
    park: { label: 'Park' },
    indoor: { label: 'Indoor' },
    tropical: { label: 'Tropical' }
  },
  palette: {
    blue: { label: 'Blue' },
    green: { label: 'Green' }
  },
  tod: {
    day: { label: 'Day' },
    night: { label: 'Night' }
  },
  difficulty: {
    '4.0': { label: 'DUPR 4.0' },
    '4.5': { label: 'DUPR 4.5' },
    '5.0': { label: 'DUPR 5.0' }
  }
};

const ALL_POSITIONS = ['nearYou', 'nearMate', 'farA', 'farB'];
const POSITION_LABELS = { nearYou: 'You', nearMate: 'Partner', farA: 'Opponent A', farB: 'Opponent B' };
const CHARACTER_SHORT_LABELS = {
  'player-human-v1': 'Player 1',
  'player-partner-v1': 'Partner',
  'player-opponent-a-v1': 'Opp A',
  'player-opponent-b-v1': 'Opp B'
};

// Doubles uses all four slots; singles only plays nearYou vs farA
// (see the mode-conditional roster build in src/game.js _initWorld).
function activePositions() {
  var mode = normalizeMode(checkedValue('mode', 'doubles'));
  if (mode === 'singles') return ['nearYou', 'farA'];
  if (mode === 'practice') return ['nearYou'];
  return ALL_POSITIONS;
}

function positionLabel(position) {
  var mode = normalizeMode(checkedValue('mode', 'doubles'));
  if (position === 'farA' && mode === 'singles') return 'Opponent';
  return POSITION_LABELS[position] || position;
}

const IS_TOUCH_DEVICE = navigator.maxTouchPoints > 0 || 'ontouchstart' in window;

function checkedValue(name, fallback) {
  return (document.querySelector('input[name="' + name + '"]:checked') || {}).value || fallback;
}

function readMenuConfig() {
  var venue = checkedValue('venue', 'park');
  return {
    mode: normalizeMode(checkedValue('mode', 'doubles')),
    venue: venue,
    courtPalette: checkedValue('palette', 'blue'),
    timeOfDay: venue === 'indoor' ? 'day' : checkedValue('tod', 'day'),
    difficulty: checkedValue('difficulty', '4.0'),
    musicStart: checkedValue('musicStart', 'muted'),
    cameraMode: checkedValue('cameraMode', 'follow'),
    roster: {
      nearYou: checkedValue('char-nearYou', DEFAULT_ROSTER.nearYou),
      nearMate: checkedValue('char-nearMate', DEFAULT_ROSTER.nearMate),
      farA: checkedValue('char-farA', DEFAULT_ROSTER.farA),
      farB: checkedValue('char-farB', DEFAULT_ROSTER.farB)
    }
  };
}

function syncTimeOfDayUI() {
  var cfg = readMenuConfig();
  var todGroup = $('todGroup');
  var todHint = $('todHint');
  var disabled = cfg.venue === 'indoor';
  if (disabled) {
    var dayInput = document.querySelector('input[name="tod"][value="day"]');
    if (dayInput) dayInput.checked = true;
    cfg.timeOfDay = 'day';
  }
  todGroup.setAttribute('aria-disabled', disabled ? 'true' : 'false');
  todHint.textContent = disabled ? 'Indoor uses day lighting.' : '';
  document.querySelectorAll('input[name="tod"]').forEach(function (el) {
    el.disabled = disabled;
  });
  return cfg;
}

function syncMenuSummary() {
  var cfg = syncTimeOfDayUI();
  var mode = MENU_META.mode[cfg.mode] || MENU_META.mode.doubles;
  var venue = MENU_META.venue[cfg.venue] || MENU_META.venue.park;
  var palette = MENU_META.palette[cfg.courtPalette] || MENU_META.palette.blue;
  var tod = MENU_META.tod[cfg.timeOfDay] || MENU_META.tod.day;
  var diff = MENU_META.difficulty[cfg.difficulty] || MENU_META.difficulty['4.0'];
  var camLabels = { follow: 'Follow', broadcast: 'Broadcast', topdown: 'Top-Down' };
  var cam = camLabels[cfg.cameraMode] || 'Follow';
  $('menuSummary').textContent = mode.label + ' · ' + venue.label + ' · ' + tod.label + ' · ' + palette.label + ' · ' + cam + ' · ' + diff.label;
  return cfg;
}

if (IS_TOUCH_DEVICE) {
  document.body.classList.add('touch-device');
}

function loop(now) {
  if (!running) return;
  if (paused) {
    if (game) game.render();
    last = now;
    requestAnimationFrame(loop);
    return;
  }
  const dt = last ? (now - last) / 1000 : 1 / 60;
  last = now;
  game.update(dt);
  game.render();
  requestAnimationFrame(loop);
}

function musicState() {
  return audio.music.getState();
}

function audioCatalog() {
  return audio.music.getCatalog();
}

function syncMenuMusicStartFromState() {
  var state = musicState();
  var preferred = state.muted ? 'muted' : 'live';
  var input = document.querySelector('input[name="musicStart"][value="' + preferred + '"]');
  if (input) input.checked = true;
}

function applyMenuMusicStart(previewOnly) {
  var startMode = checkedValue('musicStart', 'muted');
  audio.music.setMuted(startMode !== 'live', { deferPlayback: !!previewOnly });
}

function syncMenuSfxFromState() {
  var sfxMuted = audio.sfx.isMuted();
  var el = document.querySelector('input[name="sfxStart"][value="' + (sfxMuted ? 'off' : 'on') + '"]');
  if (el) el.checked = true;
}

function updateAudioUI() {
  var state = musicState();
  var sfxMuted = audio.sfx.isMuted();
  syncMenuMusicStartFromState();
  syncMenuSfxFromState();
  $('sfxMuteBtn').textContent = sfxMuted ? '🔇' : '🔊';
  $('genreBtn').querySelector('span').textContent = state.genreLabel;
  $('pauseGenreBtn').textContent = state.genreLabel + ' · ' + state.trackLabel;
  $('menuMusicGenre').textContent = state.genreLabel;
  $('menuMusicTrack').textContent = state.hasTrack ? (state.trackLabel + (state.artist ? ' · ' + state.artist : '')) : 'No working track loaded';
  $('menuMusicStartState').textContent = state.muted ? 'Starts muted' : 'Starts with music live';
  $('musicCurrentTrack').textContent = state.trackLabel;
  $('musicCurrentGenre').textContent = state.genreLabel + (state.unavailable ? ' · unavailable' : '');
  $('musicCurrentArtist').textContent = state.artist || (state.hasTrack ? 'PB3D music catalog' : 'Silent fallback mode');
  $('musicPlayBtn').textContent = state.muted ? 'UNMUTE' : 'MUTE';
  $('musicVolume').value = Math.round(state.volume * 100);
  $('musicVolumeValue').textContent = Math.round(state.volume * 100) + '%';
  renderMusicPicker();
}

function renderMusicPicker() {
  var catalog = audioCatalog();
  var state = musicState();
  $('musicGenreList').innerHTML = catalog.map(function (genre) {
    return '<button class="music-genre-btn' + (genre.key === state.genreKey ? ' active' : '') + '" data-genre="' + genre.key + '">' +
      '<span>' + genre.label + '</span>' +
      '</button>';
  }).join('');

  var currentGenre = catalog.find(function (genre) { return genre.key === state.genreKey; }) || catalog[0] || { tracks: [] };
  $('musicTrackList').innerHTML = currentGenre.tracks.map(function (track) {
    return '<button class="music-track-btn' + (track.key === state.trackKey ? ' active' : '') + (track.unavailable ? ' unavailable' : '') + '" data-track="' + track.key + '"' + (track.unavailable ? ' disabled' : '') + '>' +
      '<strong>' + track.label + '</strong>' +
      '<span class="music-track-meta">' + (track.artist || 'PB3D House') + (track.unavailable ? ' · unavailable' : '') + '</span>' +
      '</button>';
  }).join('') || '<button class="music-track-btn unavailable" disabled><strong>NO TRACKS</strong><span class="music-track-meta">Add audio files under music/active to populate this genre.</span></button>';
}

function openMusicModal() {
  updateAudioUI();
  $('musicModal').classList.add('active');
}

function closeMusicModal() {
  $('musicModal').classList.remove('active');
}

function pauseGame() {
  paused = true;
  updateAudioUI();
  $('pauseModal').classList.add('active');
}

function resumeGame() {
  paused = false;
  $('pauseModal').classList.remove('active');
  closeMusicModal();
  if (input) {
    input.state.swingQueued = false;
    input.state.serveQueued = false;
    input.state.camCycleQueued = false;
  }
}

function quitToMenu() {
  running = false;
  paused = false;
  closeMusicModal();
  $('pauseModal').classList.remove('active');
  $('hud').style.display = 'none';
  $('menu').style.display = '';
  game = null;
  input = null;
  last = 0;
  updateAudioUI();
}

async function startMatch(difficulty, config) {
  if (starting) return;
  starting = true;
  var startBtn = $('startBtn');
  var startLabel = startBtn.textContent;
  startBtn.disabled = true;
  startBtn.textContent = 'Loading...';
  var assetPack = null;
  try {
    assetPack = await preloadAssetPack(config);
    window.__pb3dAssets = assetPack;
    console.info('PB3D assets:', assetStatusSummary(assetPack));
  } catch (e) {
    console.warn('PB3D asset preload failed; using procedural fallback.', e);
  }
  starting = false;
  startBtn.disabled = false;
  startBtn.textContent = startLabel;

  $('menu').style.display = 'none';

  const hudRefs = {
    scoreNear: $('scoreNear'), scoreFar: $('scoreFar'),
    dotNear: $('dotNear'), dotFar: $('dotFar'),
    callout: $('callout'), banner: $('banner'),
    shotTag: $('shotTag'), levelBadge: $('levelBadge'),
    serveBtn: $('serveBtn'), camBtn: $('camBtn')
  };

  game = new Game({
    canvas: $('game'),
    difficulty: difficulty,
    audio: audio,
    isMobile: IS_TOUCH_DEVICE,
    mode: config.mode,
    venue: config.venue,
    courtPalette: config.courtPalette,
    timeOfDay: config.timeOfDay,
    cameraMode: config.cameraMode,
    roster: config.roster,
    assets: assetPack
  });
  input = makeInput($('game'), $('joy'), $('joyKnob'));
  game.setInput(input);

  const hud = makeHUD(hudRefs, function () { input.state.serveQueued = true; });
  game.hud = hud;

  $('camBtn').addEventListener('click', function (e) { e.preventDefault(); input.state.camCycleQueued = true; });
  $('camBtn').addEventListener('touchstart', function (e) { e.preventDefault(); input.state.camCycleQueued = true; }, { passive: false });

  $('hud').style.display = 'block';
  updateAudioUI();
  game.start();

  window.__game = game;
  window.__input = input;

  running = true;
  paused = false;
  last = 0;
  requestAnimationFrame(loop);
}

document.querySelectorAll('input[name="mode"], input[name="venue"], input[name="palette"], input[name="tod"], input[name="difficulty"], input[name="cameraMode"]').forEach(function (el) {
  el.addEventListener('change', syncMenuSummary);
});
document.querySelectorAll('input[name="musicStart"]').forEach(function (el) {
  el.addEventListener('change', function () {
    applyMenuMusicStart(true);
    updateAudioUI();
  });
});

$('startBtn').addEventListener('click', function () {
  if (starting) return;
  var cfg = syncMenuSummary();
  applyMenuMusicStart(true);
  audio.unlock();
  applyMenuMusicStart(false);
  startMatch(cfg.difficulty, cfg);
});

syncMenuSummary();
syncMenuMusicStartFromState();
updateAudioUI();

window.__pb3dMenu = {
  readConfig: readMenuConfig,
  syncTimeOfDayUI: syncTimeOfDayUI,
  syncMenuSummary: syncMenuSummary
};

$('pauseBtn').addEventListener('click', function (e) { e.preventDefault(); if (running && !paused) pauseGame(); });
$('pauseBtn').addEventListener('touchstart', function (e) { e.preventDefault(); if (running && !paused) pauseGame(); }, { passive: false });

$('resumeBtn').addEventListener('click', function (e) { e.preventDefault(); resumeGame(); });
$('resumeBtn').addEventListener('touchstart', function (e) { e.preventDefault(); resumeGame(); }, { passive: false });

$('quitBtn').addEventListener('click', function (e) { e.preventDefault(); quitToMenu(); });
$('quitBtn').addEventListener('touchstart', function (e) { e.preventDefault(); quitToMenu(); }, { passive: false });

function toggleMute() {
  audio.unlock();
  audio.music.setMuted(!audio.music.isMuted());
  updateAudioUI();
}
$('musicPlayBtn').addEventListener('click', function (e) { e.preventDefault(); toggleMute(); });

document.querySelectorAll('input[name="sfxStart"]').forEach(function (el) {
  el.addEventListener('change', function () {
    audio.sfx.setMuted(el.value === 'off');
    updateAudioUI();
  });
});

function toggleSfxMute() {
  audio.unlock();
  audio.sfx.setMuted(!audio.sfx.isMuted());
  updateAudioUI();
}
$('sfxMuteBtn').addEventListener('click', function (e) { e.preventDefault(); toggleSfxMute(); });
$('sfxMuteBtn').addEventListener('touchstart', function (e) { e.preventDefault(); toggleSfxMute(); }, { passive: false });

function openMusicPicker(e) {
  if (e) e.preventDefault();
  audio.unlock();
  openMusicModal();
}
$('genreBtn').addEventListener('click', openMusicPicker);
$('genreBtn').addEventListener('touchstart', function (e) { openMusicPicker(e); }, { passive: false });
$('pauseGenreBtn').addEventListener('click', openMusicPicker);
$('pauseGenreBtn').addEventListener('touchstart', function (e) { openMusicPicker(e); }, { passive: false });
$('menuMusicBtn').addEventListener('click', openMusicPicker);

$('musicCloseBtn').addEventListener('click', function (e) { e.preventDefault(); closeMusicModal(); });
$('musicDoneBtn').addEventListener('click', function (e) { e.preventDefault(); closeMusicModal(); });
$('musicModal').addEventListener('click', function (e) { if (e.target === $('musicModal')) closeMusicModal(); });

$('musicGenreList').addEventListener('click', function (e) {
  var btn = e.target.closest('[data-genre]');
  if (!btn) return;
  audio.unlock();
  audio.music.setGenre(btn.getAttribute('data-genre'));
  updateAudioUI();
});

$('musicTrackList').addEventListener('click', function (e) {
  var btn = e.target.closest('[data-track]');
  if (!btn) return;
  audio.unlock();
  audio.music.setTrack(btn.getAttribute('data-track'));
  updateAudioUI();
});

$('musicPrevBtn').addEventListener('click', function (e) {
  e.preventDefault();
  audio.unlock();
  audio.music.prevTrack();
  updateAudioUI();
});

$('musicNextBtn').addEventListener('click', function (e) {
  e.preventDefault();
  audio.unlock();
  audio.music.nextTrack();
  updateAudioUI();
});

$('musicVolume').addEventListener('input', function () {
  audio.music.setVolume(Number($('musicVolume').value) / 100);
  updateAudioUI();
});

function updateCharactersSummary() {
  $('menuCharactersSummary').textContent = activePositions().map(function (position) {
    var key = checkedValue('char-' + position, DEFAULT_ROSTER[position]);
    return characterByKey(key).label;
  }).join(' · ');
}

// Measured head-top fraction of each 480x640 fallback portrait; the thumb
// crop window starts just above the head until the live thumbs replace them.
// top% = -(fraction * imgWidth% * 4/3) of the thumb box.
var CHARACTER_HEAD_TOP = {
  'player-human-v1': 0.245,
  'player-partner-v1': 0.305,
  'player-opponent-a-v1': 0.22,
  'player-opponent-b-v1': 0.305
};
var characterThumbs = {}; // key -> live-rendered bust data URL
var characterPreview = null;
var characterFocusKey = '';

function thumbFallbackTop(key) {
  return (-(CHARACTER_HEAD_TOP[key] || 0.26) * 400 * 4 / 3).toFixed(1) + '%';
}

function renderCharacterModal() {
  $('characterBody').innerHTML = activePositions().map(function (position) {
    var currentKey = checkedValue('char-' + position, DEFAULT_ROSTER[position]);
    var cards = CHARACTER_LIST.map(function (c) {
      var thumb = characterThumbs[c.key];
      var img = thumb
        ? '<img class="gen" src="' + thumb + '" alt="' + c.label + '" draggable="false">'
        : '<img src="' + c.portrait + '" alt="' + c.label + '" draggable="false" style="top:' + thumbFallbackTop(c.key) + '">';
      return '<button class="character-card' + (c.key === currentKey ? ' active' : '') +
        (c.key === characterFocusKey ? ' focused' : '') +
        '" data-position="' + position + '" data-char="' + c.key + '">' +
        '<span class="character-thumb">' + img + '</span>' +
        '<span class="character-name">' + (CHARACTER_SHORT_LABELS[c.key] || c.label) + '</span>' +
        '</button>';
    }).join('');
    return '<div class="character-position-block">' +
      '<div class="character-position-label">' + positionLabel(position) + '</div>' +
      '<div class="character-grid">' + cards + '</div>' +
      '</div>';
  }).join('');
}

function focusCharacterPreview(key) {
  characterFocusKey = key;
  $('characterPreviewName').textContent = characterByKey(key).label;
  if (!characterPreview) return;
  characterPreview.show(key).then(function () {
    $('characterPreviewLoading').style.display = 'none';
  });
}

// Picker thumbnails are rendered from the live models (face-on bust shots)
// so they always match the GLBs; the old portrait PNG crops only show while
// the models load on first open.
function generateCharacterThumbs() {
  var holder = document.createElement('div');
  holder.style.cssText = 'position:fixed;left:-9999px;top:0;width:108px;height:108px;';
  document.body.appendChild(holder);
  var thumbRenderer = makeCharacterPreview(holder, { framing: 'bust', rotationMode: 'drag' });
  var chain = Promise.resolve();
  CHARACTER_LIST.forEach(function (c) {
    chain = chain.then(function () {
      return thumbRenderer.show(c.key).then(function () {
        characterThumbs[c.key] = thumbRenderer.snapshot();
      });
    });
  });
  return chain.then(function () {
    thumbRenderer.dispose();
    holder.remove();
    renderCharacterModal();
  });
}

function openCharacterModal() {
  renderCharacterModal();
  $('characterModal').classList.add('active');
  if (!characterPreview) {
    characterPreview = makeCharacterPreview($('characterPreviewPane'));
    generateCharacterThumbs();
  }
  characterPreview.start();
  focusCharacterPreview(characterFocusKey || checkedValue('char-nearYou', DEFAULT_ROSTER.nearYou));
}

function closeCharacterModal() {
  $('characterModal').classList.remove('active');
  if (characterPreview) characterPreview.stop();
  updateCharactersSummary();
}

updateCharactersSummary();
document.querySelectorAll('input[name="mode"]').forEach(function (el) {
  el.addEventListener('change', updateCharactersSummary);
});

$('menuCharactersBtn').addEventListener('click', function (e) { e.preventDefault(); openCharacterModal(); });
$('menuCharactersBtn').addEventListener('touchstart', function (e) { e.preventDefault(); openCharacterModal(); }, { passive: false });

$('characterBody').addEventListener('click', function (e) {
  var btn = e.target.closest('[data-char]');
  if (!btn) return;
  var position = btn.getAttribute('data-position');
  var key = btn.getAttribute('data-char');
  var input = document.querySelector('input[name="char-' + position + '"][value="' + key + '"]');
  if (input) input.checked = true;
  focusCharacterPreview(key);
  renderCharacterModal();
});

$('characterCloseBtn').addEventListener('click', function (e) { e.preventDefault(); closeCharacterModal(); });
$('characterDoneBtn').addEventListener('click', function (e) { e.preventDefault(); closeCharacterModal(); });
$('characterModal').addEventListener('click', function (e) { if (e.target === $('characterModal')) closeCharacterModal(); });

$('infoBtn').addEventListener('click', function (e) { e.preventDefault(); $('infoModal').classList.add('active'); });
$('infoBtn').addEventListener('touchstart', function (e) { e.preventDefault(); $('infoModal').classList.add('active'); }, { passive: false });
$('infoCloseBtn').addEventListener('click', function (e) { e.preventDefault(); $('infoModal').classList.remove('active'); });
$('infoCloseBtn').addEventListener('touchstart', function (e) { e.preventDefault(); $('infoModal').classList.remove('active'); }, { passive: false });
$('infoModal').addEventListener('click', function (e) { if (e.target === $('infoModal')) $('infoModal').classList.remove('active'); });
