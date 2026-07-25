'use strict';

// The Script panel (ordered hitter/shotType/target rows + expandable
// per-shot "moves" sub-editor) and the Narration steps panel.

import { TYPES as SHOT_TYPES } from '../../src/shots.js';
import { state, activeSlots, opponentsOf } from './state.js';

const SHAPE_TYPES = SHOT_TYPES.concat(['smash']); // smash is a real Shots profile, not in the auto-classified TYPES list
const PLAYER_BEHAVIORS = ['move', 'recover', 'shadow', 'crash', 'retreat', 'switch', 'chase', 'hold'];
const ARRIVE_BY = ['none', 'bounce', 'contact', 'ball-contact', 'next-contact'];

function select(options, value, onChange) {
  const s = document.createElement('select');
  options.forEach(o => {
    const opt = document.createElement('option');
    opt.value = o; opt.textContent = o; if (o === value) opt.selected = true;
    s.appendChild(opt);
  });
  s.addEventListener('change', () => onChange(s.value));
  return s;
}

// `onChange` re-renders the court + validation banner after any mutation
// that doesn't itself need a full re-render of THIS panel (most edits);
// this function re-renders itself (renderScript(onChange)) whenever the
// row/option structure changes (add/remove shot or move, hitter change).
export function renderScript(onChange) {
  const scriptList = document.getElementById('scriptList');
  scriptList.innerHTML = '';
  state.script.forEach((entry, i) => {
    const block = document.createElement('div');
    block.className = 'shot-block';

    const row = document.createElement('div');
    row.className = 'row';
    const hitterSelect = select(activeSlots(), entry.hitter, v => {
      entry.hitter = v;
      // Target must stay an opponent of the (possibly new) hitter.
      if (!opponentsOf(v).includes(entry.target)) entry.target = opponentsOf(v)[0];
      renderScript(onChange);
      onChange();
    });
    const typeSelect = select(SHAPE_TYPES, entry.shotType, v => { entry.shotType = v; onChange(); });
    // Target options are ALWAYS just the two opponents of the current hitter
    // — a shot can't be aimed at your own partner, so it's never offered.
    const targetSelect = select(opponentsOf(entry.hitter), entry.target, v => { entry.target = v; onChange(); });
    row.appendChild(hitterSelect);
    row.appendChild(typeSelect);
    row.appendChild(targetSelect);
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
      renderScript(onChange); onChange();
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
      renderScript(onChange);
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
        renderScript(onChange);
        onChange();
      });
      landingRow.appendChild(clearLanding);
    }
    block.appendChild(landingRow);

    const moves = entry.moves || [];
    const expanded = state.expandedMoveRow === i;
    const toggle = document.createElement('button');
    toggle.className = 'moves-toggle';
    toggle.title = 'Who heads where the instant this shot fires — expand to add a player directive';
    toggle.textContent = (expanded ? '▾' : '▸') + ' Directives (' + moves.length + ')';
    toggle.addEventListener('click', () => {
      state.expandedMoveRow = expanded ? null : i;
      state.placingMoveFor = null;
      state.placingLandingFor = null;
      renderScript(onChange);
      onChange();
    });
    block.appendChild(toggle);

    if (expanded) {
      moves.forEach((mv, mi) => {
        const mrow = document.createElement('div');
        mrow.className = 'move-row';
        const playerSelect = select(activeSlots(), mv.player, v => { mv.player = v; onChange(); });
        mrow.appendChild(playerSelect);
        const behaviorSelect = select(PLAYER_BEHAVIORS, mv.behavior || 'move', v => { mv.behavior = v; onChange(); });
        behaviorSelect.title = 'Intent label for this player directive';
        mrow.appendChild(behaviorSelect);
        const arriveSelect = select(ARRIVE_BY, mv.arriveBy || 'none', v => { mv.arriveBy = v; onChange(); });
        arriveSelect.title = 'Timing anchor metadata; movement still uses current real steering';
        mrow.appendChild(arriveSelect);
        const placeBtn = document.createElement('button');
        const armed = state.placingMoveFor && state.placingMoveFor.entryIndex === i && state.placingMoveFor.moveIndex === mi;
        placeBtn.className = 'place' + (armed ? ' armed' : '');
        placeBtn.textContent = armed ? 'click the court…' : (mv.to ? 'move target' : 'place on court');
        placeBtn.addEventListener('click', () => {
          state.placingMoveFor = armed ? null : { entryIndex: i, moveIndex: mi };
          state.placingLandingFor = null;
          renderScript(onChange);
        });
        mrow.appendChild(placeBtn);
        const readout = document.createElement('span');
        readout.className = 'to-readout';
        readout.textContent = mv.to ? ('x=' + mv.to.x.toFixed(2) + ', z=' + mv.to.z.toFixed(2)) : 'not placed';
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
          renderScript(onChange); onChange();
        });
        mrow.appendChild(rmMove);
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
        renderScript(onChange);
      });
      block.appendChild(addMove);
    }

    scriptList.appendChild(block);
  });
}

export function renderSteps() {
  const stepsList = document.getElementById('stepsList');
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
    rm.addEventListener('click', () => { state.steps.splice(i, 1); renderSteps(); });
    wrap.appendChild(title); wrap.appendChild(desc); wrap.appendChild(rm);
    stepsList.appendChild(wrap);
  });
}
