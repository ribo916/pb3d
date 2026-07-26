'use strict';

// Standalone-builder-only: the merged step-by-step editor. Renders exactly
// ONE step at a time (Setup, or a single script entry) — the chip strip for
// jumping between steps, plus that step's own fields (hitter/shot/receiver,
// landing, movement cues, inline narration). Deliberately re-implements the
// small slice of row-rendering it needs rather than importing/factoring
// anything out of script-editor.js: that file (and its renderScript/
// renderSteps exports) is shared with src/drillAdmin.js and must stay
// byte-identical for that in-app screen.

import { TYPES as SHOT_TYPES } from '../../src/shots.js';
import { state, activeSlots, opponentsOf, SLOT_COLOR } from './state.js';

// Mirrors script-editor.js's SHAPE_TYPES/PLAYER_BEHAVIORS/ARRIVE_BY — plain
// data, low drift risk, not worth threading a shared import for.
const SHAPE_TYPES = SHOT_TYPES.concat(['smash', 'supersmash', 'popup']);
// The full label set (move/recover/shadow/crash/retreat/switch/chase) used
// to be offered here, but only 'hold' vs. everything-else is ever actually
// read by the engine (src/drillDirector.js's armMovesForBeat special-cases
// `behavior === 'hold'`; every other value drives identical movement
// physics) — the rest were purely cosmetic labels. Collapsed to the one
// distinction that matters: does this player move to a destination, or
// hold their exact spot.
const PLAYER_BEHAVIORS = [
  { value: 'move', label: 'Moves to a destination', desc: 'Moves to the destination set below.' },
  { value: 'hold', label: 'Holds position', desc: 'Stays exactly where they are when this shot fires.' }
];
const ARRIVE_BY = [
  { value: 'none', label: 'No deadline' },
  { value: 'bounce', label: 'By this shot’s bounce' },
  { value: 'next-contact', label: 'By next paddle contact' }
];

function optionValue(option) { return typeof option === 'string' ? option : option.value; }
function optionLabel(option) { return typeof option === 'string' ? option : option.label; }
function behaviorInfo(value) {
  return PLAYER_BEHAVIORS.find(option => option.value === value) || PLAYER_BEHAVIORS[0];
}

function select(options, value, onChange) {
  const s = document.createElement('select');
  options.forEach(o => {
    const opt = document.createElement('option');
    opt.value = optionValue(o); opt.textContent = optionLabel(o); if (opt.value === value) opt.selected = true;
    s.appendChild(opt);
  });
  s.addEventListener('change', () => onChange(s.value));
  return s;
}

function field(labelText, control) {
  const wrap = document.createElement('div');
  wrap.className = 'directive-field';
  const label = document.createElement('label');
  label.textContent = labelText;
  wrap.appendChild(label);
  wrap.appendChild(control);
  return wrap;
}

// One chip for Setup + one per scripted shot; `.active` marks
// state.builderStepIndex. Click jumps via onJump(index).
export function renderStepChips(container, onJump) {
  container.innerHTML = '';
  const makeChip = (label, index) => {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'step-chip' + (state.builderStepIndex === index ? ' active' : '');
    chip.textContent = label;
    chip.addEventListener('click', () => onJump(index));
    container.appendChild(chip);
  };
  makeChip('Setup', 0);
  state.script.forEach((entry, i) => makeChip('Shot ' + (i + 1), i + 1));
}

// Collapsed-by-default disclosure for a step's optional coaching narration
// (title/desc). Native <details> resets to closed on every re-render — since
// nothing here reopens it, each step's narration is collapsed the moment you
// navigate to it or trigger a structural re-render, per the "collapsed by
// default on each step" requirement. Typing itself never triggers a
// re-render, so it stays open while actually being edited.
function renderNarrationAccordion(obj) {
  const details = document.createElement('details');
  details.className = 'accordion';
  const summary = document.createElement('summary');
  summary.textContent = 'Narration' + ((obj.title || obj.desc) ? ' •' : '');
  details.appendChild(summary);

  const body = document.createElement('div');
  body.className = 'accordion-body';
  const title = document.createElement('input');
  title.type = 'text'; title.placeholder = 'Step title'; title.value = obj.title || '';
  title.addEventListener('input', () => { obj.title = title.value; });
  const desc = document.createElement('textarea');
  desc.placeholder = 'Step description'; desc.value = obj.desc || '';
  desc.addEventListener('input', () => { obj.desc = desc.value; });
  body.appendChild(field('Narration title', title));
  body.appendChild(field('Narration notes', desc));
  details.appendChild(body);
  return details;
}

function renderSetupBody(container) {
  if (!state.steps[0]) state.steps[0] = { title: 'Setup', desc: '' };
  container.appendChild(renderNarrationAccordion(state.steps[0]));

  const hint = document.createElement('p');
  hint.className = 'hint';
  hint.textContent = 'Select a player above (Far/Near pickers), then click the court to place them.';
  container.appendChild(hint);
}

function renderMoveRow(container, entry, mv, mi, rerender, onChange) {
  const mrow = document.createElement('div');
  mrow.className = 'move-row';
  const playerSelect = select(activeSlots(), mv.player, v => { mv.player = v; rerender(); onChange(); });
  mrow.appendChild(field('Player', playerSelect));
  const behaviorSelect = select(PLAYER_BEHAVIORS, mv.behavior || 'move', v => {
    mv.behavior = v;
    if (v === 'hold') state.placingMoveFor = null;
    rerender();
    onChange();
  });
  behaviorSelect.title = 'Whether this player moves to a destination or holds their exact spot';
  mrow.appendChild(field('Movement', behaviorSelect));
  const canonicalArrive = mv.arriveBy === 'contact' || mv.arriveBy === 'ball-contact'
    ? 'next-contact'
    : (mv.arriveBy || 'none');
  if (canonicalArrive !== mv.arriveBy) mv.arriveBy = canonicalArrive;
  const arriveSelect = select(ARRIVE_BY, canonicalArrive, v => { mv.arriveBy = v; rerender(); onChange(); });
  arriveSelect.title = 'When this player should reach the destination';
  mrow.appendChild(field('Arrive by', arriveSelect));

  const placeBtn = document.createElement('button');
  const armed = state.placingMoveFor && state.placingMoveFor.entryIndex === state.builderStepIndex - 1 && state.placingMoveFor.moveIndex === mi;
  const holds = (mv.behavior || 'move') === 'hold';
  placeBtn.className = 'place' + (armed ? ' armed' : '');
  placeBtn.textContent = holds ? 'holds here' : (armed ? 'click the court…' : (mv.to ? 'move target' : 'set destination'));
  placeBtn.disabled = holds;
  placeBtn.title = holds ? 'Hold uses the player’s position when this shot fires' : 'Choose where this player should move';
  placeBtn.addEventListener('click', () => {
    state.placingMoveFor = armed ? null : { entryIndex: state.builderStepIndex - 1, moveIndex: mi };
    state.placingLandingFor = null;
    rerender();
  });
  mrow.appendChild(placeBtn);

  const readout = document.createElement('span');
  readout.className = 'to-readout';
  readout.textContent = holds
    ? 'current position'
    : (mv.to ? ('x=' + mv.to.x.toFixed(2) + ', z=' + mv.to.z.toFixed(2)) : 'destination needed');
  mrow.appendChild(readout);

  const rmMove = document.createElement('button');
  rmMove.textContent = '✕'; rmMove.className = 'danger'; rmMove.title = 'Remove this cue';
  rmMove.addEventListener('click', () => {
    entry.moves.splice(mi, 1);
    if (state.placingMoveFor && state.placingMoveFor.entryIndex === state.builderStepIndex - 1 && state.placingMoveFor.moveIndex >= mi) {
      state.placingMoveFor = null;
    }
    rerender();
    onChange();
  });
  mrow.appendChild(rmMove);

  const explainer = document.createElement('div');
  explainer.className = 'directive-explainer';
  // Pacing (arrive-by) only means anything when they're actually moving
  // somewhere — appending it to "holds position" would read as a
  // contradiction ("stays put... paced to arrive").
  explainer.textContent = holds
    ? behaviorInfo('hold').desc
    : behaviorInfo('move').desc + ' ' +
      (canonicalArrive === 'none'
        ? 'The player moves at their normal pace.'
        : (canonicalArrive === 'bounce'
          ? 'The player is paced to arrive when this shot bounces.'
          : 'The player is paced to arrive by the next paddle contact.'));
  mrow.appendChild(explainer);

  container.appendChild(mrow);
}

function renderShotBody(container, entry, idx, handlers) {
  const { onChange, onRemoveStep } = handlers;
  // Must clear before re-rendering: renderShotBody only ever appends, it
  // never clears its own container (renderStepBody does that on the way
  // in). Callers that invoke rerender() without a following onChange() —
  // "+ add directive", arming a move's "set destination" — would otherwise
  // stack a second full copy of the step body under the first.
  const rerender = () => { container.innerHTML = ''; renderShotBody(container, entry, idx, handlers); };

  container.appendChild(renderNarrationAccordion(entry));

  const row = document.createElement('div');
  row.className = 'row shot-fields';

  if (idx === 0) {
    const hitterSelect = select(activeSlots(), entry.hitter, v => {
      entry.hitter = v;
      if (!opponentsOf(v).includes(entry.target)) entry.target = opponentsOf(v)[0];
      rerender();
      onChange();
    });
    row.appendChild(field('Hitter', hitterSelect));
  } else {
    const lock = document.createElement('div');
    lock.className = 'hitter-lock';
    const swatch = document.createElement('span');
    swatch.className = 'hitter-lock-swatch';
    swatch.style.background = SLOT_COLOR[entry.hitter] || '#888';
    lock.appendChild(swatch);
    const text = document.createElement('span');
    text.textContent = entry.hitter + ' — locked, receiver of the previous shot';
    lock.appendChild(text);
    row.appendChild(field('Hitter', lock));
  }

  const typeSelect = select(SHAPE_TYPES, entry.shotType, v => { entry.shotType = v; onChange(); });
  row.appendChild(field('Shot', typeSelect));

  const targetSelect = select(opponentsOf(entry.hitter), entry.target, v => { entry.target = v; onChange(); });
  row.appendChild(field('Receiver', targetSelect));
  container.appendChild(row);

  const landingRow = document.createElement('div');
  landingRow.className = 'landing-row';
  const landingBtn = document.createElement('button');
  const landingArmed = state.placingLandingFor === idx;
  landingBtn.className = 'place' + (landingArmed ? ' armed' : '');
  landingBtn.textContent = landingArmed ? 'click ball landing…' : (entry.landing ? 'move landing' : 'place landing');
  landingBtn.title = 'Optional: aim the ball at a court spot while the selected receiver still owns the next contact';
  landingBtn.addEventListener('click', () => {
    state.placingLandingFor = landingArmed ? null : idx;
    state.placingMoveFor = null;
    rerender();
    onChange();
  });
  landingRow.appendChild(landingBtn);
  const landingReadout = document.createElement('span');
  landingReadout.className = 'to-readout';
  landingReadout.textContent = entry.landing ? ('landing x=' + entry.landing.x.toFixed(2) + ', z=' + entry.landing.z.toFixed(2)) : 'landing defaults to receiver';
  landingRow.appendChild(landingReadout);
  if (entry.landing) {
    const clearLanding = document.createElement('button');
    clearLanding.textContent = 'clear';
    clearLanding.title = 'Aim at the receiver again';
    clearLanding.addEventListener('click', () => {
      delete entry.landing;
      if (state.placingLandingFor === idx) state.placingLandingFor = null;
      rerender();
      onChange();
    });
    landingRow.appendChild(clearLanding);
  }
  container.appendChild(landingRow);

  const movesWrap = document.createElement('div');
  const movesTitle = document.createElement('div');
  movesTitle.className = 'panel-title spaced';
  movesTitle.textContent = 'Player directions';
  movesWrap.appendChild(movesTitle);
  const moves = entry.moves || [];
  if (!moves.length) {
    const empty = document.createElement('div');
    empty.className = 'directive-empty';
    empty.textContent = 'No extra player movement on this shot.';
    movesWrap.appendChild(empty);
  } else {
    moves.forEach((mv, mi) => renderMoveRow(movesWrap, entry, mv, mi, rerender, onChange));
  }
  const addMove = document.createElement('button');
  addMove.textContent = '+ add directive';
  addMove.addEventListener('click', () => {
    if (!entry.moves) entry.moves = [];
    entry.moves.push({ player: entry.hitter, to: null, behavior: 'recover', arriveBy: 'none' });
    rerender();
  });
  movesWrap.appendChild(addMove);
  container.appendChild(movesWrap);

  const rm = document.createElement('button');
  rm.className = 'danger';
  rm.style.marginTop = '10px';
  rm.textContent = 'Remove this step';
  rm.addEventListener('click', () => onRemoveStep());
  container.appendChild(rm);
}

// Renders the body for whichever step state.builderStepIndex points at.
// `handlers = { onChange, onRemoveStep }` — onChange re-renders the court +
// validation banner after any mutation; onRemoveStep deletes the currently
// viewed script step (never called for Setup, which has no remove action).
export function renderStepBody(container, handlers) {
  container.innerHTML = '';
  if (state.builderStepIndex === 0) {
    renderSetupBody(container);
    return;
  }
  const idx = state.builderStepIndex - 1;
  const entry = state.script[idx];
  if (!entry) return; // stale index guard; caller (main.js) clamps builderStepIndex after any script-structure change
  renderShotBody(container, entry, idx, handlers);
}
