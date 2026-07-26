'use strict';

// The Script panel (ordered hitter/shotType/target rows + expandable
// per-shot "moves" sub-editor) and the Narration steps panel.

import { TYPES as SHOT_TYPES } from '../../src/shots.js';
import { state, activeSlots, opponentsOf } from './state.js';

const SHAPE_TYPES = SHOT_TYPES.concat(['smash']); // smash is a real Shots profile, not in the auto-classified TYPES list
const PLAYER_BEHAVIORS = [
  { value: 'move', label: 'Move', desc: 'General repositioning.' },
  { value: 'recover', label: 'Recover', desc: 'Return to a useful base position after the shot.' },
  { value: 'shadow', label: 'Shadow partner', desc: 'Move with a partner to preserve team spacing.' },
  { value: 'crash', label: 'Crash forward', desc: 'Close quickly toward the kitchen or attack position.' },
  { value: 'retreat', label: 'Retreat', desc: 'Give ground toward the baseline.' },
  { value: 'switch', label: 'Switch sides', desc: 'Cross over to exchange coverage with a partner.' },
  { value: 'chase', label: 'Chase', desc: 'Pursue a wide or displaced ball position.' },
  { value: 'hold', label: 'Hold position', desc: 'Stay where the player is when this shot fires.' }
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
function arriveLabel(value) {
  const canonical = value === 'contact' || value === 'ball-contact' ? 'next-contact' : value;
  const option = ARRIVE_BY.find(item => item.value === canonical) || ARRIVE_BY[0];
  return option.label;
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

function renderDirectionSummary(container, moves) {
  container.innerHTML = '';
  if (!moves.length) {
    const empty = document.createElement('span');
    empty.className = 'directive-empty';
    empty.textContent = 'No extra player movement on this shot.';
    container.appendChild(empty);
    return;
  }
  moves.forEach(mv => {
    const chip = document.createElement('span');
    chip.className = 'directive-chip';
    const behavior = behaviorInfo(mv.behavior || 'move').label;
    const destination = (mv.behavior || 'move') === 'hold'
      ? 'current position'
      : (mv.to ? ('x ' + mv.to.x.toFixed(1) + ', z ' + mv.to.z.toFixed(1)) : 'destination needed');
    chip.innerHTML = '<strong>' + mv.player + '</strong> · ' + behavior + ' → ' +
      destination + ' · ' + arriveLabel(mv.arriveBy || 'none');
    container.appendChild(chip);
  });
}

// `onChange` re-renders the court + validation banner after any mutation
// that doesn't itself need a full re-render of THIS panel (most edits);
// this function re-renders itself (renderScript(onChange, scriptListEl)) whenever the
// row/option structure changes (add/remove shot or move, hitter change).
// `scriptListEl` defaults to the standalone builder's #scriptList; the
// in-app editor (src/drillAdmin.js) passes its own element since a single
// document can't reuse that id twice.
export function renderScript(onChange, scriptListEl) {
  const scriptList = scriptListEl || document.getElementById('scriptList');
  scriptList.innerHTML = '';
  state.script.forEach((entry, i) => {
    const block = document.createElement('div');
    block.className = 'shot-block';

    const number = document.createElement('div');
    number.className = 'shot-number';
    number.textContent = 'Shot ' + (i + 1);
    block.appendChild(number);

    const row = document.createElement('div');
    row.className = 'row shot-fields';
    const hitterSelect = select(activeSlots(), entry.hitter, v => {
      entry.hitter = v;
      // Target must stay an opponent of the (possibly new) hitter.
      if (!opponentsOf(v).includes(entry.target)) entry.target = opponentsOf(v)[0];
      renderScript(onChange, scriptListEl);
      onChange();
    });
    const typeSelect = select(SHAPE_TYPES, entry.shotType, v => { entry.shotType = v; onChange(); });
    // Target options are ALWAYS just the two opponents of the current hitter
    // — a shot can't be aimed at your own partner, so it's never offered.
    const targetSelect = select(opponentsOf(entry.hitter), entry.target, v => { entry.target = v; onChange(); });
    row.appendChild(field('Hitter', hitterSelect));
    row.appendChild(field('Shot', typeSelect));
    row.appendChild(field('Receiver', targetSelect));
    const rm = document.createElement('button');
    rm.textContent = '✕'; rm.className = 'danger'; rm.title = 'Remove this shot';
    rm.addEventListener('click', () => {
      state.script.splice(i, 1);
      // Unconditional reset, not just "if it pointed at index i": removing
      // an entry shifts every later index, so a stale expandedMoveRow/
      // placingMoveFor could otherwise silently point at the WRONG shot
      // afterward instead of a merely-missing one.
      state.expandedMoveRow = null;
      state.placingMoveFor = null;
      state.placingLandingFor = null;
      renderScript(onChange, scriptListEl); onChange();
    });
    row.appendChild(rm);
    block.appendChild(row);

    const landingRow = document.createElement('div');
    landingRow.className = 'landing-row';
    const landingBtn = document.createElement('button');
    const landingArmed = state.placingLandingFor === i;
    landingBtn.className = 'place' + (landingArmed ? ' armed' : '');
    landingBtn.textContent = landingArmed ? 'click ball landing…' : (entry.landing ? 'move landing' : 'place landing');
    landingBtn.title = 'Optional: aim the ball at a court spot while the selected receiver still owns the next contact';
    landingBtn.addEventListener('click', () => {
      state.placingLandingFor = landingArmed ? null : i;
      state.placingMoveFor = null;
      state.expandedMoveRow = i;
      renderScript(onChange, scriptListEl);
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
        if (state.placingLandingFor === i) state.placingLandingFor = null;
        renderScript(onChange, scriptListEl);
        onChange();
      });
      landingRow.appendChild(clearLanding);
    }
    block.appendChild(landingRow);

    const moves = entry.moves || [];
    const expanded = state.expandedMoveRow === i;
    const summary = document.createElement('div');
    summary.className = 'directive-summary';
    renderDirectionSummary(summary, moves);
    block.appendChild(summary);

    const toggle = document.createElement('button');
    toggle.className = 'moves-toggle';
    toggle.title = 'Who heads where the instant this shot fires — expand to add a player directive';
    toggle.textContent = (expanded ? '▾' : '▸') + (moves.length ? ' Edit player directions' : ' Add player direction');
    toggle.addEventListener('click', () => {
      state.expandedMoveRow = expanded ? null : i;
      state.placingMoveFor = null;
      state.placingLandingFor = null;
      renderScript(onChange, scriptListEl);
      onChange();
    });
    block.appendChild(toggle);

    if (expanded) {
      moves.forEach((mv, mi) => {
        const mrow = document.createElement('div');
        mrow.className = 'move-row';
        const playerSelect = select(activeSlots(), mv.player, v => {
          mv.player = v;
          renderScript(onChange, scriptListEl);
          onChange();
        });
        mrow.appendChild(field('Player', playerSelect));
        const behaviorSelect = select(PLAYER_BEHAVIORS, mv.behavior || 'move', v => {
          mv.behavior = v;
          if (v === 'hold') state.placingMoveFor = null;
          renderScript(onChange, scriptListEl);
          onChange();
        });
        behaviorSelect.title = 'Coaching label: explains why this player moves';
        mrow.appendChild(field('Coaching label', behaviorSelect));
        const canonicalArrive = mv.arriveBy === 'contact' || mv.arriveBy === 'ball-contact'
          ? 'next-contact'
          : (mv.arriveBy || 'none');
        if (canonicalArrive !== mv.arriveBy) mv.arriveBy = canonicalArrive;
        const arriveSelect = select(ARRIVE_BY, canonicalArrive, v => {
          mv.arriveBy = v;
          renderScript(onChange, scriptListEl);
          onChange();
        });
        arriveSelect.title = 'When this player should reach the destination';
        mrow.appendChild(field('Arrive by', arriveSelect));
        const placeBtn = document.createElement('button');
        const armed = state.placingMoveFor && state.placingMoveFor.entryIndex === i && state.placingMoveFor.moveIndex === mi;
        const holds = (mv.behavior || 'move') === 'hold';
        placeBtn.className = 'place' + (armed ? ' armed' : '');
        placeBtn.textContent = holds ? 'holds here' : (armed ? 'click the court…' : (mv.to ? 'move target' : 'set destination'));
        placeBtn.disabled = holds;
        placeBtn.title = holds ? 'Hold uses the player’s position when this shot fires' : 'Choose where this player should move';
        placeBtn.addEventListener('click', () => {
          state.placingMoveFor = armed ? null : { entryIndex: i, moveIndex: mi };
          state.placingLandingFor = null;
          renderScript(onChange, scriptListEl);
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
          moves.splice(mi, 1);
          // >= not === : removing move mi shifts every later move in this
          // SAME entry down by one, so an armed placingMoveFor pointing at
          // a later index in this entry would otherwise silently write
          // into the wrong (shifted) move on the next court click.
          if (state.placingMoveFor && state.placingMoveFor.entryIndex === i && state.placingMoveFor.moveIndex >= mi) {
            state.placingMoveFor = null;
          }
          renderScript(onChange, scriptListEl); onChange();
        });
        mrow.appendChild(rmMove);
        const explainer = document.createElement('div');
        explainer.className = 'directive-explainer';
        explainer.textContent = behaviorInfo(mv.behavior || 'move').desc + ' ' +
          (canonicalArrive === 'none'
            ? 'The player moves at their normal pace.'
            : (canonicalArrive === 'bounce'
              ? 'The player is paced to arrive when this shot bounces.'
              : 'The player is paced to arrive by the next paddle contact.'));
        mrow.appendChild(explainer);
        block.appendChild(mrow);
      });
      const addMove = document.createElement('button');
      addMove.textContent = '+ add directive';
      addMove.style.marginLeft = '12px';
      addMove.addEventListener('click', () => {
        if (!entry.moves) entry.moves = [];
        // Default to the hitter's own post-contact recovery — the most
        // common cue — the author can retarget the select to any active slot.
        entry.moves.push({ player: entry.hitter, to: null, behavior: 'recover', arriveBy: 'none' });
        renderScript(onChange, scriptListEl);
      });
      block.appendChild(addMove);
    }

    scriptList.appendChild(block);
  });
}

// `stepsListEl`/`openNarrationBtnEl` default to the standalone builder's
// #stepsList/#openNarration, same optional-target pattern as renderScript
// above — the in-app editor (src/drillAdmin.js) passes its own elements
// since a single document can't reuse those ids twice.
export function renderSteps(stepsListEl, openNarrationBtnEl) {
  const stepsList = stepsListEl || document.getElementById('stepsList');
  stepsList.innerHTML = '';
  state.steps.forEach((step, i) => {
    const wrap = document.createElement('div');
    wrap.style.marginBottom = '8px';
    const title = document.createElement('input');
    title.type = 'text'; title.placeholder = 'Step title'; title.value = step.title;
    title.addEventListener('input', () => { step.title = title.value; });
    const desc = document.createElement('textarea');
    desc.placeholder = 'Step description'; desc.value = step.desc;
    desc.addEventListener('input', () => { step.desc = desc.value; });
    const rm = document.createElement('button');
    rm.textContent = 'Remove step'; rm.className = 'danger'; rm.style.marginTop = '4px';
    rm.addEventListener('click', () => { state.steps.splice(i, 1); renderSteps(stepsListEl, openNarrationBtnEl); });
    wrap.appendChild(title); wrap.appendChild(desc); wrap.appendChild(rm);
    stepsList.appendChild(wrap);
  });
  const openNarration = openNarrationBtnEl || document.getElementById('openNarration');
  if (openNarration) {
    openNarration.textContent = 'Narration (' + state.steps.length + ')';
  }
}
