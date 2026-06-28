/* ============================================================================
 * main.js — Bootstrap: difficulty picker -> Game -> rAF loop.
 * ==========================================================================*/
'use strict';

import { Game } from './game.js';
import { makeInput } from './input.js';
import { makeHUD } from './hud.js';
import { makeAudio } from './audio.js';

const $ = (id) => document.getElementById(id);

let game    = null;
let input   = null;
let audio   = makeAudio();
let last    = 0;
let running = false;
let paused  = false;

// Mark touch-capable devices so CSS can swap the info-modal section.
if (navigator.maxTouchPoints > 0 || 'ontouchstart' in window) {
  document.body.classList.add('touch-device');
}

/* ---- rAF loop ---- */
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

/* ---- audio UI helpers ---- */
function updateAudioUI() {
  var m = audio.music.isMuted();
  var label = m ? '♪ OFF' : '♪ ON';
  $('muteBtn').textContent = label;
  $('pauseMuteBtn').textContent = label;
  $('pauseGenreBtn').textContent = audio.music.getGenreLabel();
}

/* ---- pause / resume / quit ---- */
function pauseGame() {
  paused = true;
  updateAudioUI();
  $('pauseModal').classList.add('active');
}

function resumeGame() {
  paused = false;
  $('pauseModal').classList.remove('active');
  // Flush any input that accumulated while paused so it isn't consumed on resume.
  if (input) {
    input.state.swingQueued  = false;
    input.state.serveQueued  = false;
    input.state.camCycleQueued = false;
  }
}

function quitToMenu() {
  running = false;
  paused  = false;
  $('pauseModal').classList.remove('active');
  $('hud').style.display = 'none';
  $('menu').style.display = 'flex';
  // Leave the old renderer/context; the next Game() call takes over the canvas.
  game  = null;
  input = null;
  last  = 0;
}

/* ---- start match ---- */
function startMatch(difficulty) {
  $('menu').style.display = 'none';

  const hudRefs = {
    scoreNear: $('scoreNear'), scoreFar: $('scoreFar'),
    dotNear:   $('dotNear'),   dotFar:   $('dotFar'),
    callout:   $('callout'),   banner:   $('banner'),
    shotTag:   $('shotTag'),   levelBadge: $('levelBadge'),
    serveBtn:  $('serveBtn'),  camBtn:   $('camBtn')
  };

  game  = new Game({ canvas: $('game'), difficulty, audio });
  input = makeInput($('game'), $('joy'), $('joyKnob'));
  game.setInput(input);

  const hud = makeHUD(hudRefs, () => { input.state.serveQueued = true; });
  game.hud = hud;

  $('camBtn').addEventListener('click', (e) => { e.preventDefault(); input.state.camCycleQueued = true; });
  $('camBtn').addEventListener('touchstart', (e) => { e.preventDefault(); input.state.camCycleQueued = true; }, { passive: false });

  $('hud').style.display = 'block';
  updateAudioUI();
  game.start();

  window.__game = game; window.__input = input;

  running = true;
  paused  = false;
  last    = 0;
  requestAnimationFrame(loop);
}

/* ---- difficulty buttons (also unlock audio on first gesture) ---- */
document.querySelectorAll('[data-diff]').forEach((btn) => {
  btn.addEventListener('click', () => {
    audio.unlock();
    startMatch(btn.getAttribute('data-diff'));
  });
});

/* ---- pause button ---- */
$('pauseBtn').addEventListener('click', (e) => { e.preventDefault(); if (running && !paused) pauseGame(); });
$('pauseBtn').addEventListener('touchstart', (e) => { e.preventDefault(); if (running && !paused) pauseGame(); }, { passive: false });

/* ---- resume button ---- */
$('resumeBtn').addEventListener('click', (e) => { e.preventDefault(); resumeGame(); });
$('resumeBtn').addEventListener('touchstart', (e) => { e.preventDefault(); resumeGame(); }, { passive: false });

/* ---- quit button ---- */
$('quitBtn').addEventListener('click', (e) => { e.preventDefault(); quitToMenu(); });
$('quitBtn').addEventListener('touchstart', (e) => { e.preventDefault(); quitToMenu(); }, { passive: false });

/* ---- mute buttons (HUD + pause modal) ---- */
function toggleMute() {
  audio.unlock();
  audio.music.setMuted(!audio.music.isMuted());
  updateAudioUI();
}
$('muteBtn').addEventListener('click',      (e) => { e.preventDefault(); toggleMute(); });
$('muteBtn').addEventListener('touchstart', (e) => { e.preventDefault(); toggleMute(); }, { passive: false });
$('pauseMuteBtn').addEventListener('click',      (e) => { e.preventDefault(); toggleMute(); });
$('pauseMuteBtn').addEventListener('touchstart', (e) => { e.preventDefault(); toggleMute(); }, { passive: false });

/* ---- genre cycle button (pause modal) ---- */
function cycleGenre() {
  audio.unlock();
  audio.music.cycleGenre();
  updateAudioUI();
}
$('pauseGenreBtn').addEventListener('click',      (e) => { e.preventDefault(); cycleGenre(); });
$('pauseGenreBtn').addEventListener('touchstart', (e) => { e.preventDefault(); cycleGenre(); }, { passive: false });

/* ---- info / controls modal ---- */
$('infoBtn').addEventListener('click',      (e) => { e.preventDefault(); $('infoModal').classList.add('active'); });
$('infoBtn').addEventListener('touchstart', (e) => { e.preventDefault(); $('infoModal').classList.add('active'); }, { passive: false });
$('infoCloseBtn').addEventListener('click',      (e) => { e.preventDefault(); $('infoModal').classList.remove('active'); });
$('infoCloseBtn').addEventListener('touchstart', (e) => { e.preventDefault(); $('infoModal').classList.remove('active'); }, { passive: false });
// Tap outside the panel closes it.
$('infoModal').addEventListener('click', (e) => { if (e.target === $('infoModal')) $('infoModal').classList.remove('active'); });
