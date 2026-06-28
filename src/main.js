/* ============================================================================
 * main.js — Bootstrap: difficulty picker -> Game -> rAF loop.
 * ==========================================================================*/
'use strict';

import { Game } from './game.js';
import { makeInput } from './input.js';
import { makeHUD } from './hud.js';

const $ = (id) => document.getElementById(id);

let game = null;
let input = null;
let last = 0;
let running = false;

function loop(now) {
  if (!running) return;
  const dt = last ? (now - last) / 1000 : 1 / 60;
  last = now;
  game.update(dt);
  game.render();
  requestAnimationFrame(loop);
}

function startMatch(difficulty) {
  $('menu').style.display = 'none';

  const hudRefs = {
    scoreNear: $('scoreNear'), scoreFar: $('scoreFar'),
    dotNear: $('dotNear'), dotFar: $('dotFar'),
    callout: $('callout'), banner: $('banner'), shotTag: $('shotTag'),
    levelBadge: $('levelBadge'), serveBtn: $('serveBtn')
  };

  game = new Game({ canvas: $('game'), difficulty });

  // SERVE button + input both feed the same serve trigger via the input state.
  input = makeInput($('game'), $('joy'), $('joyKnob'));
  game.setInput(input);

  const hud = makeHUD(hudRefs, () => { input.state.serveQueued = true; });
  game.hud = hud;

  $('hud').style.display = 'block';
  game.start();

  // Debug hook (handy for headless smoke tests / the console).
  window.__game = game; window.__input = input;

  running = true;
  last = 0;
  requestAnimationFrame(loop);
}

// Wire the difficulty buttons.
document.querySelectorAll('[data-diff]').forEach((btn) => {
  btn.addEventListener('click', () => startMatch(btn.getAttribute('data-diff')));
});
