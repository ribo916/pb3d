/* ============================================================================
 * main.js — Bootstrap: difficulty picker -> Game -> rAF loop.
 * ==========================================================================*/
'use strict';

import { Game } from './game.js';
import { makeInput } from './input.js';
import { makeHUD } from './hud.js';
import { makeAudio } from './audio.js';
import { preloadAssetPack, assetStatusSummary } from './assets.js';
import {
  GENDERS, HAIR_COLORS, GARMENT_COLORS, SLOT_DEFAULTS, resolveSlotCharacter,
  HEIGHT_SCALE_MIN, HEIGHT_SCALE_MAX
} from './characters.js';
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
const GENDER_LABELS = { male: 'Male', female: 'Female' };
const HAIR_LABELS = {
  simpleParted: 'Parted', buzzed: 'Buzzed',
  long: 'Long', buns: 'Buns', buzzedFemale: 'Buzzed'
};
const HAIR_COLOR_LABELS = {
  black: 'Black', darkBrown: 'Dark Brown', brown: 'Brown',
  blonde: 'Blonde', auburn: 'Auburn', gray: 'Gray'
};
const HAIR_COLOR_ORDER = ['black', 'darkBrown', 'brown', 'blonde', 'auburn', 'gray'];
const FACIAL_HAIR_LABELS = { none: 'Clean', beard: 'Beard' };
const GARMENT_COLOR_LABELS = {
  none: 'None',
  black: 'Black', charcoal: 'Charcoal', navy: 'Navy', skyBlue: 'Sky Blue',
  white: 'White', brown: 'Brown', forestGreen: 'Forest Green',
  identityOrange: 'Orange', identityTeal: 'Teal', identityCrimson: 'Crimson',
  identityPink: 'Pink', identityPlum: 'Plum', identityBerry: 'Berry'
};
// 'none' isn't a real color (not a key in GARMENT_COLORS) — it renders with
// its own "no color" swatch and, when picked, resolveSlotCharacter falls
// that region back to the character's skin tone instead of tinting it.
const GARMENT_COLOR_ORDER = [
  'none', 'black', 'charcoal', 'navy', 'skyBlue', 'white', 'brown', 'forestGreen',
  'identityOrange', 'identityTeal', 'identityCrimson', 'identityPink', 'identityPlum', 'identityBerry'
];

// Height is a continuous slider, not a radio group like everything else
// here, so it can't reuse the hidden-radio persistence pattern (there's no
// finite set of "checked" values). Track it directly in a plain object
// instead, seeded from each slot's default.
var heightPicks = {
  nearYou: SLOT_DEFAULTS.nearYou.heightScale,
  nearMate: SLOT_DEFAULTS.nearMate.heightScale,
  farA: SLOT_DEFAULTS.farA.heightScale,
  farB: SLOT_DEFAULTS.farB.heightScale
};

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

function checkedValue(name, fallback) {
  return (document.querySelector('input[name="' + name + '"]:checked') || {}).value || fallback;
}

function slotPicks(position) {
  var d = SLOT_DEFAULTS[position];
  return {
    gender: checkedValue('gender-' + position, d.gender),
    hairStyle: checkedValue('hair-' + position, d.hairStyle),
    hairColor: checkedValue('haircolor-' + position, d.hairColor),
    facialHair: checkedValue('facialhair-' + position, d.facialHair),
    shirtColor: checkedValue('shirtcolor-' + position, d.shirtColor),
    pantsColor: checkedValue('pantscolor-' + position, d.pantsColor),
    heightScale: heightPicks[position]
  };
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
      nearYou: slotPicks('nearYou'),
      nearMate: slotPicks('nearMate'),
      farA: slotPicks('farA'),
      farB: slotPicks('farB')
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
    var picks = slotPicks(position);
    var tag = GENDER_LABELS[picks.gender] + ' ' +
      (HAIR_COLOR_LABELS[picks.hairColor] || picks.hairColor) + ' ' +
      (HAIR_LABELS[picks.hairStyle] || picks.hairStyle);
    if (picks.facialHair === 'beard') tag += ' + Beard';
    return positionLabel(position) + ': ' + tag;
  }).join(' · ');
}

var characterPreview = null;
var characterFocusPosition = 'nearYou';

function setSlotRadio(position, axis, value) {
  var input = document.querySelector('input[name="' + axis + '-' + position + '"][value="' + value + '"]');
  if (input) input.checked = true;
}

function axisPill(position, axis, value, active, label) {
  return '<button class="axis-pill' + (active ? ' active' : '') +
    '" data-position="' + position + '" data-axis="' + axis + '" data-value="' + value + '">' +
    label + '</button>';
}

function colorPill(position, axis, value, active, label, hex) {
  var swatch = hex === undefined
    ? '<span class="pill-swatch pill-swatch-none"></span>'
    : '<span class="pill-swatch" style="background:#' + hex.toString(16).padStart(6, '0') + '"></span>';
  return '<button class="axis-pill' + (active ? ' active' : '') +
    '" data-position="' + position + '" data-axis="' + axis + '" data-value="' + value + '">' +
    swatch + label + '</button>';
}

function renderCharacterModal() {
  $('characterBody').innerHTML = activePositions().map(function (position) {
    var picks = slotPicks(position);
    var genderButtons = ['male', 'female'].map(function (g) {
      return axisPill(position, 'gender', g, g === picks.gender, GENDER_LABELS[g]);
    }).join('');
    var hairButtons = GENDERS[picks.gender].hairOptions.map(function (h) {
      return axisPill(position, 'hair', h, h === picks.hairStyle, HAIR_LABELS[h] || h);
    }).join('');
    var hairColorButtons = HAIR_COLOR_ORDER.map(function (c) {
      return colorPill(position, 'haircolor', c, c === picks.hairColor, HAIR_COLOR_LABELS[c], HAIR_COLORS[c]);
    }).join('');
    var facialHairOptions = GENDERS[picks.gender].facialHairOptions;
    var facialHairRow = facialHairOptions.length > 1
      ? '<div class="character-axis-row"><span class="character-axis-label">Face</span><div class="character-axis-group">' +
        facialHairOptions.map(function (f) {
          return axisPill(position, 'facialhair', f, f === picks.facialHair, FACIAL_HAIR_LABELS[f] || f);
        }).join('') + '</div></div>'
      : '';
    var shirtColorButtons = GARMENT_COLOR_ORDER.map(function (c) {
      return colorPill(position, 'shirtcolor', c, c === picks.shirtColor, GARMENT_COLOR_LABELS[c], GARMENT_COLORS[c]);
    }).join('');
    var pantsColorButtons = GARMENT_COLOR_ORDER.map(function (c) {
      return colorPill(position, 'pantscolor', c, c === picks.pantsColor, GARMENT_COLOR_LABELS[c], GARMENT_COLORS[c]);
    }).join('');
    var heightPct = Math.round(picks.heightScale * 100);
    var heightRow = '<div class="character-axis-row"><span class="character-axis-label">Height</span>' +
      '<input class="character-height-slider" type="range" min="' + HEIGHT_SCALE_MIN + '" max="' + HEIGHT_SCALE_MAX +
      '" step="0.01" value="' + picks.heightScale + '" data-position="' + position + '" data-axis="height">' +
      '<span class="character-height-value" id="heightValue-' + position + '">' + heightPct + '%</span></div>';
    return '<div class="character-position-block' + (position === characterFocusPosition ? ' focused' : '') + '">' +
      '<div class="character-position-label">' + positionLabel(position) + '</div>' +
      '<div class="character-axis-row"><span class="character-axis-label">Gender</span><div class="character-axis-group">' + genderButtons + '</div></div>' +
      heightRow +
      '<div class="character-axis-row"><span class="character-axis-label">Hair</span><div class="character-axis-group">' + hairButtons + '</div></div>' +
      '<div class="character-axis-row"><span class="character-axis-label">Color</span><div class="character-axis-group">' + hairColorButtons + '</div></div>' +
      facialHairRow +
      '<div class="character-axis-row"><span class="character-axis-label">Shirt</span><div class="character-axis-group">' + shirtColorButtons + '</div></div>' +
      '<div class="character-axis-row"><span class="character-axis-label">Pants</span><div class="character-axis-group">' + pantsColorButtons + '</div></div>' +
      '</div>';
  }).join('');
}

function focusCharacterPreview(position) {
  characterFocusPosition = position;
  var character = resolveSlotCharacter(position, slotPicks(position));
  $('characterPreviewName').textContent = positionLabel(position) + ' — ' + GENDER_LABELS[character.gender];
  if (!characterPreview) return;
  characterPreview.show(character).then(function () {
    $('characterPreviewLoading').style.display = 'none';
  });
}

function openCharacterModal() {
  renderCharacterModal();
  $('characterModal').classList.add('active');
  if (!characterPreview) characterPreview = makeCharacterPreview($('characterPreviewPane'), { framing: 'full' });
  characterPreview.start();
  focusCharacterPreview(characterFocusPosition);
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
  var btn = e.target.closest('[data-axis]');
  if (!btn) return;
  var position = btn.getAttribute('data-position');
  var axis = btn.getAttribute('data-axis');
  var value = btn.getAttribute('data-value');
  setSlotRadio(position, axis, value);
  if (axis === 'gender') {
    var picks = slotPicks(position);
    var g = GENDERS[picks.gender];
    if (g.hairOptions.indexOf(picks.hairStyle) === -1) setSlotRadio(position, 'hair', g.defaultHair);
    if (g.facialHairOptions.indexOf(picks.facialHair) === -1) setSlotRadio(position, 'facialhair', 'none');
  }
  focusCharacterPreview(position);
  renderCharacterModal();
});

var heightPreviewDebounce = 0;
$('characterBody').addEventListener('input', function (e) {
  var el = e.target;
  if (el.getAttribute('data-axis') !== 'height') return;
  var position = el.getAttribute('data-position');
  heightPicks[position] = parseFloat(el.value);
  var label = document.getElementById('heightValue-' + position);
  if (label) label.textContent = Math.round(heightPicks[position] * 100) + '%';
  // Height changes rebuild the authored model (scale is baked in at
  // construction time, same as every other authored-model trait), which is
  // too expensive to do on every pixel of drag — debounce until the user
  // pauses rather than refreshing the live preview on each 'input' tick.
  clearTimeout(heightPreviewDebounce);
  heightPreviewDebounce = setTimeout(function () { focusCharacterPreview(position); }, 120);
});

$('characterCloseBtn').addEventListener('click', function (e) { e.preventDefault(); closeCharacterModal(); });
$('characterDoneBtn').addEventListener('click', function (e) { e.preventDefault(); closeCharacterModal(); });
$('characterModal').addEventListener('click', function (e) { if (e.target === $('characterModal')) closeCharacterModal(); });

$('infoBtn').addEventListener('click', function (e) { e.preventDefault(); $('infoModal').classList.add('active'); });
$('infoBtn').addEventListener('touchstart', function (e) { e.preventDefault(); $('infoModal').classList.add('active'); }, { passive: false });
$('infoCloseBtn').addEventListener('click', function (e) { e.preventDefault(); $('infoModal').classList.remove('active'); });
$('infoCloseBtn').addEventListener('touchstart', function (e) { e.preventDefault(); $('infoModal').classList.remove('active'); }, { passive: false });
$('infoModal').addEventListener('click', function (e) { if (e.target === $('infoModal')) $('infoModal').classList.remove('active'); });
