/* ============================================================================
 * main.js — Bootstrap: difficulty picker -> Game -> rAF loop.
 * ==========================================================================*/
'use strict';

import { Game } from './game.js';
import { makeInput } from './input.js';
import { makeHUD } from './hud.js';
import { makeAudio } from './audio.js';
import { preloadAssetPack, assetStatusSummary } from './assets.js';
import { CHARACTERS, DEFAULT_ROSTER, DRILL_ROSTER, getCharacter, resolveSlotCharacter } from './characters.js';
import { makeCharacterPreview } from './characterPreview.js';
import { normalizeMode } from './modes.js';
import { loadDrills, normalizeDrill, activeSlotsOf } from './drillStore.js';
import { openNewDrill, openEditDrill } from './drillAdmin.js';
import { SLOT_INFO } from './drillDirector.js';
import * as Power from './power.js';
import * as AI from './ai.js';
import { PERSONA_META, personaStats, STAT_LABELS } from './strategies/personas.js';
import { resolveTraits } from './ai.js';

const $ = (id) => document.getElementById(id);

let game    = null;
let input   = null;
let audio   = makeAudio();
let last    = 0;
let running = false;
let paused  = false;
let replaying = false;
let drilling = false;
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
const POSITION_TAB_NUMBER = { nearYou: 'P1', nearMate: 'P2', farA: 'P3', farB: 'P4' };

// Which character id each slot currently has selected. Seeded from
// DEFAULT_ROSTER so a match can start without ever opening the picker.
var rosterPicks = Object.assign({}, DEFAULT_ROSTER);

// Doubles uses all four slots; singles only plays nearYou vs farA
// (see the mode-conditional roster build in src/game.js _initWorld).
function positionsForMode(mode) {
  if (mode === 'singles') return ['nearYou', 'farA'];
  if (mode === 'practice') return ['nearYou'];
  return ALL_POSITIONS;
}

function activePositions() {
  return positionsForMode(normalizeMode(checkedValue('mode', 'doubles')));
}

function positionLabel(position) {
  var mode = normalizeMode(checkedValue('mode', 'doubles'));
  if (position === 'farA' && mode === 'singles') return 'Opponent';
  return POSITION_LABELS[position] || position;
}

const IS_TOUCH_DEVICE = navigator.maxTouchPoints > 0 || 'ontouchstart' in window;

// TEST FLAG: ?fastsuper=1 (or ?fastsuper=25) makes the power meter fill almost
// immediately so the super smash can be exercised without grinding out clean
// contacts. 1 => default boost of 20x. Also settable live in the console:
//   window.__game.superChargeMul = 20
const FAST_SUPER = (function () {
  var raw = new URLSearchParams(location.search).get('fastsuper');
  if (raw === null) return 1;
  var n = parseFloat(raw);
  if (!isFinite(n) || n <= 0) return 20;      // ?fastsuper / ?fastsuper=1
  return n <= 1 ? 20 : n;
})();
if (FAST_SUPER > 1) console.log('[pb3d] fastsuper ON — meter charge x' + FAST_SUPER);

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
    superMode: checkedValue('superMode', 'on'),
    superChargeMul: FAST_SUPER,
    roster: {
      nearYou: rosterPicks.nearYou,
      nearMate: rosterPicks.nearMate,
      farA: rosterPicks.farA,
      farB: rosterPicks.farB
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
  if (replaying) {
    game.updateReplay(Math.min(dt, 1 / 30));
    updateReplayBar();
  } else {
    game.update(dt);
    if (drilling) updateDrillBar();
  }
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
  clearTransientInput();
}

function clearTransientInput() {
  if (input) {
    input.state.swingQueued = false;
    input.state.serveQueued = false;
    input.state.superQueued = false;
    input.state.camCycleQueued = false;
    input.state.swingShot = null;
  }
}

/* --------------------------- Instant replay --------------------------- */
const REPLAY_SPEEDS = [0.25, 0.5, 1, 2];

function enterReplayMode() {
  if (!game || replaying || paused) return;
  if (!game.enterReplay()) {                 // nothing buffered yet
    game._message && game._message('Nothing to replay yet', 1.2);
    return;
  }
  replaying = true;
  $('replayBar').classList.add('active');
  renderReplaySpeeds();
  updateReplayBar();
}

function exitReplayMode() {
  if (!replaying) return;
  replaying = false;
  $('replayBar').classList.remove('active');
  if (game) game.exitReplay();
  // Drop any input queued while reviewing so it can't fire on resume.
  clearTransientInput();
  last = 0;   // avoid a dt spike on the first resumed live frame
}

function renderReplaySpeeds() {
  const cur = game && game.replayInfo() ? game.replayInfo().speed : 1;
  $('replaySpeeds').innerHTML = REPLAY_SPEEDS.map(function (s) {
    return '<button class="replay-speed' + (s === cur ? ' active' : '') +
      '" data-speed="' + s + '">' + (s === 1 ? '1×' : s + '×') + '</button>';
  }).join('');
}

function fmtTime(sec) {
  const s = Math.max(0, sec);
  return s.toFixed(1) + 's';
}

function updateReplayBar() {
  if (!game) return;
  const info = game.replayInfo();
  if (!info) return;
  const scrub = $('replayScrub');
  if (document.activeElement !== scrub && !scrub._dragging) {
    scrub.max = String(Math.max(0.001, info.duration));
    scrub.value = String(info.playhead);
  }
  $('replayTime').textContent = fmtTime(info.playhead) + ' / ' + fmtTime(info.duration);
  $('replayPlayBtn').textContent = info.playing ? '⏸' : '▶';
  $('replayCamBtn').textContent = '🎥 ' + info.camLabel;
}

function quitToMenu() {
  running = false;
  paused = false;
  if (replaying) exitReplayMode();
  if (drilling) exitDrillMode();
  closeMusicModal();
  $('pauseModal').classList.remove('active');
  $('hud').style.display = 'none';
  // Return to the arcade flow's Start screen; #menu stays a hidden harness.
  // flowState (radios + rosterPicks) persists, so prior picks are remembered.
  $('flowRoot').style.display = '';
  goToFlow('start');
  game = null;
  input = null;
  last = 0;
  updateAudioUI();
}

function buildHudRefs() {
  return {
    scoreNear: $('scoreNear'), scoreFar: $('scoreFar'),
    dotNear: $('dotNear'), dotFar: $('dotFar'),
    callout: $('callout'), banner: $('banner'),
    shotTag: $('shotTag'), levelBadge: $('levelBadge'),
    serveBtn: $('serveBtn'), camBtn: $('camBtn'),
    powerMeter: $('powerMeter'), powerLabel: $('powerLabel'),
    powerFill: $('powerFill'), powerPips: $('powerPips'),
    superBtn: $('superBtn'), superBtnWrap: document.querySelector('.btns-br')
  };
}

async function startMatch(difficulty, config) {
  if (starting) return;
  starting = true;
  var startBtn = $('startBtn');
  var startLabel = startBtn.textContent;
  startBtn.disabled = true;
  startBtn.textContent = 'Loading...';
  var neededPlayerKeys = positionsForMode(config.mode).map(function (position) {
    return resolveSlotCharacter(position, config.roster[position]).playerModelKey;
  });
  config = Object.assign({}, config, { neededPlayerKeys: neededPlayerKeys });
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
  $('flowRoot').style.display = 'none';

  const hudRefs = buildHudRefs();

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
    superMode: config.superMode,
    superChargeMul: config.superChargeMul,
    roster: config.roster,
    assets: assetPack
  });
  input = makeInput($('game'), $('joy'), $('joyKnob'));
  game.setInput(input);

  const hud = makeHUD(hudRefs,
    function () { input.state.serveQueued = true; },
    function () { input.state.superQueued = true; });
  game.hud = hud;

  $('camBtn').addEventListener('click', function (e) { e.preventDefault(); input.state.camCycleQueued = true; });
  $('camBtn').addEventListener('touchstart', function (e) { e.preventDefault(); input.state.camCycleQueued = true; }, { passive: false });

  $('hud').style.display = 'block';
  updateAudioUI();
  game.start();

  window.__game = game;
  window.__pb3dPower = Power;
  window.__pb3dAI = AI;
  window.__input = input;

  running = true;
  paused = false;
  last = 0;
  requestAnimationFrame(loop);
}

document.querySelectorAll('input[name="mode"], input[name="venue"], input[name="palette"], input[name="tod"], input[name="difficulty"], input[name="cameraMode"], input[name="superMode"]').forEach(function (el) {
  el.addEventListener('change', syncMenuSummary);
});
document.querySelectorAll('input[name="musicStart"]').forEach(function (el) {
  el.addEventListener('change', function () {
    applyMenuMusicStart(true);
    updateAudioUI();
  });
});

// Shared launch handoff: the exact audio dance both the (now hidden) #startBtn
// and the arcade flow's GO step run before entering the match.
function beginMatch() {
  if (starting) return Promise.resolve();
  var cfg = syncMenuSummary();
  applyMenuMusicStart(true);
  audio.unlock();
  applyMenuMusicStart(false);
  return startMatch(cfg.difficulty, cfg);
}

$('startBtn').addEventListener('click', function () { beginMatch(); });

syncMenuSummary();
syncMenuMusicStartFromState();
updateAudioUI();

// Renders a single character to a bust-framed portrait PNG using an isolated,
// never-started preview instance (no turntable spin, no swing cycle) so tooling
// can bake picker thumbnails without touching any live UI state.
function bakePortrait(characterId) {
  var mount = document.createElement('div');
  mount.style.cssText = 'position:fixed;left:-9999px;top:-9999px;width:512px;height:512px;';
  document.body.appendChild(mount);
  var preview = makeCharacterPreview(mount, { framing: 'bust', rotationMode: 'none' });
  var character = resolveSlotCharacter('nearYou', characterId);
  return preview.show(character).then(function () {
    var dataUrl = preview.snapshot();
    preview.dispose();
    mount.remove();
    return dataUrl;
  });
}

window.__pb3dMenu = {
  readConfig: readMenuConfig,
  syncTimeOfDayUI: syncTimeOfDayUI,
  syncMenuSummary: syncMenuSummary,
  // Test/tooling entry points (the visible flow drives these too):
  launch: function () { return launchFromFlow(); },
  goToFlow: function (id) { goToFlow(id); },
  openCharacterScreen: function () { goToFlow('character'); },
  bakePortrait: bakePortrait
};

$('pauseBtn').addEventListener('click', function (e) { e.preventDefault(); if (running && !paused && !replaying) pauseGame(); });
$('pauseBtn').addEventListener('touchstart', function (e) { e.preventDefault(); if (running && !paused && !replaying) pauseGame(); }, { passive: false });

/* --------- Instant replay: entry button + DVR overlay controls --------- */
$('replayBtn').addEventListener('click', function (e) { e.preventDefault(); enterReplayMode(); });
$('replayBtn').addEventListener('touchstart', function (e) { e.preventDefault(); enterReplayMode(); }, { passive: false });

$('replayExitBtn').addEventListener('click', function (e) { e.preventDefault(); exitReplayMode(); });
$('replayPlayBtn').addEventListener('click', function (e) { e.preventDefault(); if (game) { game.replayToggle(); updateReplayBar(); } });
$('replayBackBtn').addEventListener('click', function (e) { e.preventDefault(); if (game) { game.replayStep(-1); updateReplayBar(); } });
$('replayFwdBtn').addEventListener('click', function (e) { e.preventDefault(); if (game) { game.replayStep(1); updateReplayBar(); } });
$('replayCamBtn').addEventListener('click', function (e) { e.preventDefault(); if (game) { game.replayCycleCamera(); updateReplayBar(); } });

$('replaySpeeds').addEventListener('click', function (e) {
  var btn = e.target.closest('[data-speed]');
  if (!btn || !game) return;
  game.replaySetSpeed(Number(btn.getAttribute('data-speed')));
  renderReplaySpeeds();
});

(function wireScrub() {
  var scrub = $('replayScrub');
  scrub._dragging = false;
  var onSeek = function () { if (game) { game.replaySeek(Number(scrub.value)); updateReplayBar(); } };
  scrub.addEventListener('input', onSeek);
  scrub.addEventListener('pointerdown', function () { scrub._dragging = true; });
  scrub.addEventListener('pointerup', function () { scrub._dragging = false; });
  scrub.addEventListener('change', function () { scrub._dragging = false; });
})();

// Free-orbit camera: drag to rotate, wheel/pinch to zoom (only bites in free mode).
(function wireOrbit() {
  var canvas = $('game');
  var last = null;
  canvas.addEventListener('pointerdown', function (e) {
    if (!replaying) return;
    last = { x: e.clientX, y: e.clientY };
  });
  window.addEventListener('pointermove', function (e) {
    if (!replaying || !last) return;
    if (game) game.replayOrbitDrag(e.clientX - last.x, e.clientY - last.y);
    last = { x: e.clientX, y: e.clientY };
  });
  window.addEventListener('pointerup', function () { last = null; });
  canvas.addEventListener('wheel', function (e) {
    if (!replaying) return;
    e.preventDefault();
    if (game) game.replayOrbitZoom(e.deltaY);
  }, { passive: false });
})();

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
    var character = getCharacter(rosterPicks[position]);
    return positionLabel(position) + ': ' + (character ? character.label : rosterPicks[position]);
  }).join(' · ');
}

var characterPreview = null;
var characterActiveTab = 'nearYou';

function renderCharacterTabs() {
  $('characterTabStrip').innerHTML = activePositions().map(function (position) {
    return '<button class="character-tab' + (position === characterActiveTab ? ' active' : '') +
      '" data-position="' + position + '">' +
      '<span class="tab-num">' + POSITION_TAB_NUMBER[position] + '</span>' +
      '<span class="tab-role">' + positionLabel(position) + '</span></button>';
  }).join('');
}

function renderCharacterGrid() {
  var active = activePositions();
  $('characterGrid').innerHTML = CHARACTERS.map(function (character) {
    var badges = active.filter(function (position) {
      return rosterPicks[position] === character.id;
    }).map(function (position) {
      return '<span class="character-tile-badge">' + POSITION_TAB_NUMBER[position] + '</span>';
    }).join('');
    var isActive = rosterPicks[characterActiveTab] === character.id;
    return '<button class="character-tile' + (isActive ? ' active' : '') +
      '" data-character-id="' + character.id + '" tabindex="0">' +
      '<span class="character-tile-badges">' + badges + '</span>' +
      '<span class="character-tile-portrait"><img src="' + portraitUrl(character.id) + '" alt="' + character.label + '" loading="lazy"></span>' +
      '<span class="character-tile-label">' + character.label + '</span></button>';
  }).join('');
}

function focusCharacterPreview(position, characterId) {
  var character = resolveSlotCharacter(position, characterId);
  $('characterPreviewName').textContent = positionLabel(position) + ' — ' + character.label;
  if (!characterPreview) return;
  $('characterPreviewLoading').style.display = '';
  characterPreview.show(character).then(function () {
    $('characterPreviewLoading').style.display = 'none';
  });
}

function openCharacterModal() {
  var active = activePositions();
  if (active.indexOf(characterActiveTab) === -1) characterActiveTab = active[0];
  renderCharacterTabs();
  renderCharacterGrid();
  $('characterModal').classList.add('active');
  if (!characterPreview) characterPreview = makeCharacterPreview($('characterPreviewPane'), { framing: 'full' });
  characterPreview.start();
  focusCharacterPreview(characterActiveTab, rosterPicks[characterActiveTab]);
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

$('characterTabStrip').addEventListener('click', function (e) {
  var btn = e.target.closest('[data-position]');
  if (!btn) return;
  characterActiveTab = btn.getAttribute('data-position');
  renderCharacterTabs();
  renderCharacterGrid();
  focusCharacterPreview(characterActiveTab, rosterPicks[characterActiveTab]);
});

$('characterGrid').addEventListener('click', function (e) {
  var tile = e.target.closest('[data-character-id]');
  if (!tile) return;
  rosterPicks[characterActiveTab] = tile.getAttribute('data-character-id');
  renderCharacterGrid();
  focusCharacterPreview(characterActiveTab, rosterPicks[characterActiveTab]);
});

$('characterCloseBtn').addEventListener('click', function (e) { e.preventDefault(); closeCharacterModal(); });
$('characterDoneBtn').addEventListener('click', function (e) { e.preventDefault(); closeCharacterModal(); });
$('characterModal').addEventListener('click', function (e) { if (e.target === $('characterModal')) closeCharacterModal(); });

$('infoBtn').addEventListener('click', function (e) { e.preventDefault(); $('infoModal').classList.add('active'); });
$('infoBtn').addEventListener('touchstart', function (e) { e.preventDefault(); $('infoModal').classList.add('active'); }, { passive: false });
$('infoCloseBtn').addEventListener('click', function (e) { e.preventDefault(); $('infoModal').classList.remove('active'); });
$('infoCloseBtn').addEventListener('touchstart', function (e) { e.preventDefault(); $('infoModal').classList.remove('active'); }, { passive: false });
$('infoModal').addEventListener('click', function (e) { if (e.target === $('infoModal')) $('infoModal').classList.remove('active'); });

/* ============================================================================
 * Arcade launch flow — Street-Fighter-style one-decision-per-screen router.
 * The visible screens drive the same source of truth (radios + rosterPicks)
 * readMenuConfig() reads, so the launch handoff stays unchanged.
 * ==========================================================================*/
var FLOW_ACTIVE = 'start';
var flowPreview = null;      // single shared characterPreview instance
var flowPreviewMount = null;
var flowSlotOrder = [];      // active slot positions for the character screen
var flowActiveSlot = 'nearYou'; // the slot currently being edited
var flowVsTimer = null;

function flowScreenEl(id) {
  return $('scr' + id.charAt(0).toUpperCase() + id.slice(1));
}

// Keep at most one turntable alive; recreate when the mount changes.
function ensureFlowPreview(mountEl, framing) {
  if (flowPreview && flowPreviewMount === mountEl) {
    flowPreview.setFraming(framing);
    return flowPreview;
  }
  disposeFlowPreview();
  // 'drag' mode: no auto-spin (the player faces forward), but pointer-drag still rotates.
  flowPreview = makeCharacterPreview(mountEl, { framing: framing, rotationMode: 'drag' });
  flowPreviewMount = mountEl;
  return flowPreview;
}
function disposeFlowPreview() {
  if (flowPreview) { flowPreview.dispose(); flowPreview = null; flowPreviewMount = null; }
}

function goToFlow(id) {
  if (flowVsTimer) { clearTimeout(flowVsTimer); flowVsTimer = null; }
  var current = flowScreenEl(FLOW_ACTIVE);
  if (current) current.classList.remove('active');
  FLOW_ACTIVE = id;
  var next = flowScreenEl(id);
  if (next) next.classList.add('active');
  var root = $('flowRoot');
  if (root) root.dataset.screen = id;   // gates #flowFx off on vs/loading (CSS)
  enterFlowScreen(id);
}

function enterFlowScreen(id) {
  if (id === 'start') {
    var p = ensureFlowPreview($('startPreviewMount'), 'full');
    p.start();
    // Title screen always shows AJ (CH01), regardless of roster picks.
    p.show(resolveSlotCharacter('nearYou', 'ch01'));
  } else if (id === 'character') {
    enterCharacter();
  } else if (id === 'venue') {
    if (flowPreview) flowPreview.stop();
    syncTimeOfDayUI();
  } else if (id === 'vs') {
    if (flowPreview) flowPreview.stop();
    enterVs();
  } else if (id === 'loading') {
    disposeFlowPreview();
  } else if (id === 'drills') {
    disposeFlowPreview();
    renderDrillLibrary();
  } else {
    if (flowPreview) flowPreview.stop();
  }
}

// ---- Character screen (all active slots pre-filled, edit any in any order) ----
function enterCharacter() {
  flowSlotOrder = activePositions();
  if (flowSlotOrder.indexOf(flowActiveSlot) === -1) flowActiveSlot = flowSlotOrder[0];
  ensureFlowPreview($('flowCharPreviewMount'), 'full').start();
  renderFlowCharacter();
}

function renderFlowCharacter() {
  renderFlowCharSlots();
  renderFlowCharGrid();
  showFlowCharPreview(flowActiveSlot, rosterPicks[flowActiveSlot]);
}

function renderFlowCharSlots() {
  $('flowCharSlots').innerHTML = flowSlotOrder.map(function (pos) {
    var c = getCharacter(rosterPicks[pos]);
    var hex = '#' + ((c && c.swatch) || 0x888888).toString(16).padStart(6, '0');
    return '<button class="flow-slot-chip' + (pos === flowActiveSlot ? ' active' : '') + '" data-slot="' + pos + '">' +
      '<span class="flow-slot-swatch" style="background:' + hex + '"></span>' +
      '<span class="flow-slot-meta">' +
      '<span class="flow-slot-role">' + POSITION_TAB_NUMBER[pos] + ' · ' + positionLabel(pos) + '</span>' +
      '<span class="flow-slot-char">' + (c ? c.label : '—') + '</span></span></button>';
  }).join('');
}

// Baked headshot for a character id (see tools/generate-portraits.mjs).
function portraitUrl(id) {
  return '/assets/images/portraits/' + id + '.png';
}

// --- Persona / AI-style presentation (see src/strategies/personas.js) --------
function personaOf(characterId) {
  var c = getCharacter(characterId);
  return (c && c.persona) || 'balanced';
}

// A small colored persona tag, e.g. "BANGER". `cls` picks the styling context.
function personaTagHtml(persona, cls) {
  var meta = PERSONA_META[persona] || PERSONA_META.balanced;
  return '<span class="' + cls + '" style="background:' + meta.color + '">' + meta.tag + '</span>';
}

// The preview-pane trait panel: persona tag + tendency blurb + stat bars. Bars
// reflect the resolved config (chosen DUPR × persona), so they show the actual
// opponent, not just the style.
function traitPanelHtml(persona) {
  var meta = PERSONA_META[persona] || PERSONA_META.balanced;
  var stats = personaStats(resolveTraits(checkedValue('difficulty', '4.0'), persona));
  var bars = STAT_LABELS.map(function (name) {
    var pct = Math.round((stats[name] || 0) * 100);
    return '<div class="flow-trait-row"><span class="flow-trait-name">' + name + '</span>' +
      '<div class="flow-trait-bar"><div class="flow-trait-fill" style="width:' + pct + '%;background:' + meta.color + '"></div></div></div>';
  }).join('');
  return '<div class="flow-trait-head"><span class="flow-persona-tag" style="background:' + meta.color + '">' + meta.tag + '</span></div>' +
    '<div class="flow-persona-blurb">' + meta.blurb + '</div>' + bars;
}

function renderFlowCharGrid() {
  var slot = flowActiveSlot;
  $('flowCharGrid').innerHTML = CHARACTERS.map(function (c) {
    var badges = flowSlotOrder.filter(function (pos) { return rosterPicks[pos] === c.id; })
      .map(function (pos) { return '<span class="flow-char-badge">' + POSITION_TAB_NUMBER[pos] + '</span>'; }).join('');
    var isActive = rosterPicks[slot] === c.id;
    return '<button class="flow-char-tile' + (isActive ? ' active' : '') + '" data-character-id="' + c.id + '" tabindex="0">' +
      '<span class="flow-char-tile-badges">' + badges + '</span>' +
      personaTagHtml(c.persona || 'balanced', 'flow-char-persona') +
      '<span class="flow-char-portrait"><img src="' + portraitUrl(c.id) + '" alt="' + c.label + '" loading="lazy"></span>' +
      '<span class="flow-char-cap">' + c.label + '</span></button>';
  }).join('');
}

function showFlowCharPreview(slot, characterId) {
  var ch = resolveSlotCharacter(slot, characterId);
  $('flowCharName').textContent = positionLabel(slot) + ' — ' + ch.label;
  // The human plays their own slot, so their persona is inert — say so instead
  // of implying the AI style applies to you.
  var traits = $('flowCharTraits');
  if (traits) {
    if (slot === 'nearYou') {
      traits.innerHTML = '<div class="flow-persona-blurb">You control this player — AI style does not apply.</div>';
    } else {
      traits.innerHTML = traitPanelHtml(ch.persona);
    }
  }
  if (!flowPreview) return;
  $('flowCharPreviewLoading').style.display = '';
  flowPreview.show(ch).then(function () { $('flowCharPreviewLoading').style.display = 'none'; });
}

function randomCharacterId() {
  return CHARACTERS[Math.floor(Math.random() * CHARACTERS.length)].id;
}

// ---- VS splash ----
function flowVsPortrait(slot, characterId) {
  var ch = resolveSlotCharacter(slot, characterId);
  // Only CPU slots have an active AI style; the human's own slot does not.
  var style = (slot === 'nearYou') ? '' :
    '<div>' + personaTagHtml(ch.persona, 'flow-vs-style') + '</div>';
  return '<div class="flow-vs-card">' +
    '<div class="flow-vs-portrait"><img src="' + portraitUrl(ch.id) + '" alt="' + ch.label + '"></div>' +
    '<div><div class="flow-vs-name">' + ch.label + '</div><div class="flow-vs-role">' + positionLabel(slot) + '</div>' + style + '</div>' +
    '</div>';
}

function enterVs() {
  var mode = normalizeMode(checkedValue('mode', 'doubles'));
  var left, right;
  if (mode === 'singles') { left = ['nearYou']; right = ['farA']; }
  else if (mode === 'practice') { left = ['nearYou']; right = []; }
  else { left = ['nearYou', 'nearMate']; right = ['farA', 'farB']; }
  $('flowVsLeft').innerHTML = left.map(function (s) { return flowVsPortrait(s, rosterPicks[s]); }).join('');
  $('flowVsRight').innerHTML = right.length
    ? right.map(function (s) { return flowVsPortrait(s, rosterPicks[s]); }).join('')
    : '<div class="flow-vs-role" style="opacity:.6">Solo practice</div>';
  flowVsTimer = setTimeout(function () { launchFromFlow(); }, 1200);
}

// ---- Launch handoff ----
function launchFromFlow() {
  if (starting || running) return Promise.resolve();
  goToFlow('loading');
  return beginMatch();
}

// ---- Wiring ----
// Start: advance only when the player chooses the Start button (no tap-anywhere,
// so the on-screen theme dots can be clicked without launching the flow).
$('startGameBtn').addEventListener('click', function () { goToFlow('format'); });

// Generic next/back buttons that just navigate to a named screen.
$('flowRoot').addEventListener('click', function (e) {
  var next = e.target.closest('[data-flow-next]');
  if (next) { goToFlow(next.getAttribute('data-flow-next')); return; }
  var back = e.target.closest('[data-flow-back]');
  if (back) { goToFlow(back.getAttribute('data-flow-back')); return; }
});

// Character screen controls.
$('flowCharSlots').addEventListener('click', function (e) {
  var chip = e.target.closest('[data-slot]');
  if (!chip) return;
  flowActiveSlot = chip.getAttribute('data-slot');
  renderFlowCharacter();
});
$('flowCharGrid').addEventListener('click', function (e) {
  var tile = e.target.closest('[data-character-id]');
  if (!tile) return;
  rosterPicks[flowActiveSlot] = tile.getAttribute('data-character-id');
  updateCharactersSummary();
  renderFlowCharSlots();
  renderFlowCharGrid();
  showFlowCharPreview(flowActiveSlot, rosterPicks[flowActiveSlot]);
});
$('flowRollSlot').addEventListener('click', function () {
  rosterPicks[flowActiveSlot] = randomCharacterId();
  updateCharactersSummary();
  renderFlowCharSlots();
  renderFlowCharGrid();
  showFlowCharPreview(flowActiveSlot, rosterPicks[flowActiveSlot]);
});
$('flowRollAll').addEventListener('click', function () {
  flowSlotOrder.forEach(function (slot) { rosterPicks[slot] = randomCharacterId(); });
  updateCharactersSummary();
  renderFlowCharacter();
});
$('flowCharNext').addEventListener('click', function () { goToFlow('venue'); });
$('flowCharBack').addEventListener('click', function () { goToFlow('format'); });

// Venue back → return to the character screen.
$('flowVenueBack').addEventListener('click', function () { goToFlow('character'); });

// VS: tap anywhere advances immediately.
$('scrVs').addEventListener('click', function () { launchFromFlow(); });

// Keyboard affordances (only while the flow is showing, not mid-match).
document.addEventListener('keydown', function (e) {
  if ($('flowRoot').style.display === 'none') return;
  if (FLOW_ACTIVE === 'start' && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); goToFlow('format'); }
  else if (FLOW_ACTIVE === 'vs' && e.key === 'Enter') { e.preventDefault(); launchFromFlow(); }
});

// ---- Drills wiring ----
$('drillsBtn').addEventListener('click', function () { goToFlow('drills'); });

// Library state: all() drills fetched once per screen-entry, then filtered
// client-side by name search + selected tags so typing/toggling stays instant.
var drillLibState = { drills: [], search: '', tags: [] };

function renderDrillLibrary() {
  var list = $('drillCardList');
  list.innerHTML = '<div class="drill-lib-empty">Loading…</div>';
  $('drillTagRow').innerHTML = '';
  drillLibState.search = '';
  drillLibState.tags = [];
  $('drillSearchInput').value = '';
  $('drillSearchClear').hidden = true;
  loadDrills().then(function (drills) {
    drillLibState.drills = drills;
    renderDrillTagFilters();
    renderDrillCards();
  });
}

function renderDrillTagFilters() {
  var row = $('drillTagRow');
  var seen = {};
  var tags = [];
  drillLibState.drills.forEach(function (d) {
    (d.tags || []).forEach(function (t) { if (!seen[t]) { seen[t] = true; tags.push(t); } });
  });
  tags.sort(function (a, b) { return a.localeCompare(b); });
  row.innerHTML = tags.map(function (t) {
    var active = drillLibState.tags.indexOf(t) !== -1;
    return '<button type="button" class="drill-tag-chip' + (active ? ' active' : '') + '" data-tag="' +
      escapeHtml(t) + '">' + escapeHtml(t) + '</button>';
  }).join('');
}

function drillMatchesFilters(d) {
  var q = drillLibState.search.trim().toLowerCase();
  if (q && (d.name || '').toLowerCase().indexOf(q) === -1) return false;
  if (drillLibState.tags.length) {
    var dTags = d.tags || [];
    if (!drillLibState.tags.some(function (t) { return dTags.indexOf(t) !== -1; })) return false;
  }
  return true;
}

function renderDrillCards() {
  var list = $('drillCardList');
  var all = drillLibState.drills;
  if (!all.length) {
    list.innerHTML = '<div class="drill-lib-empty">No drills yet — tap + to create one.</div>';
    $('drillLibCount').textContent = '';
    return;
  }
  var filtered = all.filter(drillMatchesFilters);
  $('drillLibCount').textContent = filtered.length + ' of ' + all.length + ' drill' + (all.length !== 1 ? 's' : '');
  list.innerHTML = filtered.map(function (d) {
    var tags = (d.tags || []).map(function (t) {
      return '<span class="drill-card-tag">' + escapeHtml(t) + '</span>';
    }).join('');
    var steps = d.steps ? d.steps.length : 0;
    return '<div class="drill-card" data-drill-id="' + d.id + '">' +
      '<button class="hud-icon-btn drill-card-edit-btn" data-drill-edit="' + d.id + '" title="Edit" type="button">✎</button>' +
      '<div class="drill-card-name">' + escapeHtml(d.name) + '</div>' +
      '<div class="drill-card-steps">' + steps + ' step' + (steps !== 1 ? 's' : '') + '</div>' +
      '<div class="drill-card-desc">' + escapeHtml(d.desc || '') + '</div>' +
      (tags ? '<div class="drill-card-tags">' + tags + '</div>' : '') +
      '</div>';
  }).join('') || '<div class="drill-lib-empty">No drills match your search.</div>';
}

$('drillSearchInput').addEventListener('input', function (e) {
  drillLibState.search = e.target.value;
  $('drillSearchClear').hidden = !e.target.value;
  renderDrillCards();
});
$('drillSearchClear').addEventListener('click', function () {
  drillLibState.search = '';
  $('drillSearchInput').value = '';
  $('drillSearchClear').hidden = true;
  renderDrillCards();
  $('drillSearchInput').focus();
});
$('drillTagRow').addEventListener('click', function (e) {
  var chip = e.target.closest('[data-tag]');
  if (!chip) return;
  var tag = chip.getAttribute('data-tag');
  var idx = drillLibState.tags.indexOf(tag);
  if (idx === -1) drillLibState.tags.push(tag); else drillLibState.tags.splice(idx, 1);
  renderDrillTagFilters();
  renderDrillCards();
});

$('newDrillBtn').addEventListener('click', function () {
  loadDrills().then(function (drills) {
    openNewDrill(drills);
    goToFlow('drillEdit');
  });
});

$('drillCardList').addEventListener('click', function (e) {
  var editBtn = e.target.closest('[data-drill-edit]');
  if (editBtn) {
    e.stopPropagation();
    var editId = editBtn.getAttribute('data-drill-edit');
    loadDrills().then(function (drills) {
      var drill = drills.filter(function (d) { return d.id === editId; })[0];
      if (drill) { openEditDrill(drill, drills); goToFlow('drillEdit'); }
    });
    return;
  }
  var card = e.target.closest('[data-drill-id]');
  if (!card) return;
  var id = card.getAttribute('data-drill-id');
  loadDrills().then(function (drills) {
    var drill = drills.filter(function (d) { return d.id === id; })[0];
    if (drill) startDrillView(drill);
  });
});

// drillAdmin.js calls these after a successful save/delete (rather than
// importing renderDrillLibrary/goToFlow itself, to avoid a circular import
// between main.js and drillAdmin.js).
window.pb3dOnDrillSaved = function () { goToFlow('drills'); };
window.pb3dOnDrillDeleted = function () { goToFlow('drills'); };

function escapeHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

async function startDrillView(drill) {
  if (starting || running) return;
  starting = true;
  // Show #drillBar immediately on tap — asset preload + Game construction
  // below can take a real, visible amount of time on a real device (this
  // was previously masked by #hud already being visible during that gap;
  // now that #hud is hidden entirely, don't leave the screen blank while
  // waiting). Steps/Exit both work before `game` exists; the badge/
  // transport catch up to the live game state once updateDrillBar() runs.
  drilling = true;
  $('drillBar').classList.add('active');
  $('drillBadge').textContent = '● LOADING';
  $('drillTransport').style.display = 'none';
  renderDrillSteps(drill);
  // Variable roster (2/3/4 players) — only the slots this drill actually
  // declares in startPositions get spawned/preloaded, not always all 4.
  var activeSlots = activeSlotsOf(drill);
  var cfg = { mode: 'drill', venue: 'park', courtPalette: 'blue', timeOfDay: 'day',
              difficulty: 'normal', cameraMode: 'broadcast', superMode: 'off',
              roster: Object.assign({}, DRILL_ROSTER) };
  var neededPlayerKeys = activeSlots.map(function (slotKey) {
    var rosterKey = SLOT_INFO[slotKey].rosterKey;
    return resolveSlotCharacter(rosterKey, cfg.roster[rosterKey]).playerModelKey;
  });
  cfg.neededPlayerKeys = neededPlayerKeys;
  var assetPack = null;
  try {
    assetPack = await preloadAssetPack(cfg);
    window.__pb3dAssets = assetPack;
  } catch (e) {
    console.warn('PB3D drill asset preload failed; using procedural fallback.', e);
  }
  starting = false;
  $('flowRoot').style.display = 'none';
  game = new Game({
    canvas: $('game'), difficulty: cfg.difficulty, audio: audio, isMobile: IS_TOUCH_DEVICE,
    mode: 'drill', venue: cfg.venue, courtPalette: cfg.courtPalette,
    timeOfDay: cfg.timeOfDay, roster: cfg.roster, assets: assetPack,
    cameraMode: cfg.cameraMode, superMode: cfg.superMode, drillActiveSlots: activeSlots
  });
  // No game.setInput() for drill mode — no player to drive. #hud (score,
  // camera/pause/info/music controls) stays fully hidden too — there's no
  // score, and every control a drill needs (steps/camera/exit/replay
  // transport) is baked into #drillBar instead.
  $('hud').style.display = 'none';
  game.startDrill(drill);
  updateDrillBar();
  window.__game = game;
  running = true;
  paused = false;
  last = 0;
  requestAnimationFrame(loop);
}

function exitDrillMode() {
  if (!drilling) return;
  drilling = false;
  $('drillBar').classList.remove('active');
  $('drillStepsModal').classList.remove('active');
}

function updateDrillBar() {
  if (!game) return;
  $('drillCamBtn').textContent = '🎥 ' + ['BROADCAST', 'FOLLOW', 'TOP-DOWN'][game.camMode];
  var info = game.drillReplayInfo();
  var transport = $('drillTransport');
  if (info) {
    $('drillBadge').textContent = '🔁 REPLAY';
    transport.style.display = 'flex';
    var scrub = $('drillScrub');
    if (document.activeElement !== scrub && !scrub._dragging) {
      scrub.max = String(Math.max(0.001, info.duration));
      scrub.value = String(info.playhead);
    }
    $('drillTime').textContent = fmtTime(info.playhead) + ' / ' + fmtTime(info.duration);
    $('drillPlayBtn').textContent = info.playing ? '⏸' : '▶';
  } else {
    $('drillBadge').textContent = '● LIVE';
    transport.style.display = 'none';
  }
}

function renderDrillSteps(drill) {
  if (!drill) return;
  $('drillStepsList').innerHTML = drill.steps.map(function (s) {
    return '<div class="drill-steps-row">' +
      '<div class="drill-steps-row-title">' + escapeHtml(s.title || '') + '</div>' +
      '<div class="drill-steps-row-desc">' + escapeHtml(s.desc || '') + '</div>' +
      '</div>';
  }).join('');
}

$('drillCamBtn').addEventListener('click', function () { if (game) { game.cycleCamera(); updateDrillBar(); } });
$('drillExitBtn').addEventListener('click', function () { quitToMenu(); });
$('drillPlayBtn').addEventListener('click', function () { if (game) { game.drillToggle(); updateDrillBar(); } });

$('drillStepsBtn').addEventListener('click', function () {
  if (game) renderDrillSteps(game.drillData);
  $('drillStepsModal').classList.add('active');
});
$('drillStepsCloseBtn').addEventListener('click', function () { $('drillStepsModal').classList.remove('active'); });
$('drillStepsModal').addEventListener('click', function (e) { if (e.target === $('drillStepsModal')) $('drillStepsModal').classList.remove('active'); });

(function wireDrillScrub() {
  var scrub = $('drillScrub');
  scrub._dragging = false;
  var onSeek = function () { if (game) { game.drillSeek(Number(scrub.value)); updateDrillBar(); } };
  scrub.addEventListener('input', onSeek);
  scrub.addEventListener('pointerdown', function () { scrub._dragging = true; });
  scrub.addEventListener('pointerup', function () { scrub._dragging = false; });
  scrub.addEventListener('change', function () { scrub._dragging = false; });
})();

// ?drill=<id> deep-link: skip the flow and jump straight to the viewer.
(function () {
  var params = new URLSearchParams(location.search);
  var drillId = params.get('drill');
  if (!drillId) return;
  loadDrills().then(function (drills) {
    var drill = drills.filter(function (d) { return d.id === drillId; })[0];
    if (drill) startDrillView(drill);
  });
})();

// ?testDrill=1 deep-link: launch a work-in-progress drill staged by
// tools/drill-builder.html in sessionStorage — not part of DEFAULT_DRILLS,
// lets a drill be played live before it's pasted into drillStore.js.
(function () {
  var params = new URLSearchParams(location.search);
  if (params.get('testDrill') !== '1') return;
  var raw = sessionStorage.getItem('pb3dWipDrill');
  if (!raw) return;
  try {
    var drill = normalizeDrill(JSON.parse(raw));
    startDrillView(drill);
  } catch (e) {
    console.error('PB3D: failed to load WIP drill from sessionStorage', e);
  }
})();

// Boot the flow on the Start screen (kicks off AJ's turntable).
enterFlowScreen('start');
