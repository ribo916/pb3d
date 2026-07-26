'use strict';

// Wiring only: DOM refs, the player picker, step navigation (chips + prev/
// next/insert/remove), the validation banner, the action bar (Generate JSON
// / Test Live / Save), and the help/JSON modals. Court rendering lives in
// court-svg.js, the per-step editor in step-view.js, shared state in state.js.

import { validateDrill, TEAM_OF, DEFAULT_DRILLS, createDrill } from '../../src/drillStore.js';
import {
  state, activeSlots, opponentsOf, isIncluded, setSlotIncluded, computeStepPositions,
  ALL_SLOTS, SLOT_CLASS, ANCHOR_SLOTS
} from './state.js';
import { buildCourt, attachStepCourtClicks, renderStepCourt } from './court-svg.js';
import { renderStepChips, renderStepBody } from './step-view.js';

const svg = document.getElementById('court');
const playerGroup = buildCourt(svg);

// The court defines the authoring workspace's visual height. Mirror that
// measured height onto the right-hand step column so only its own content
// scrolls internally, keeping the court and the current step's chips/nav
// visible together without scrolling the page.
const courtPanel = document.querySelector('.court-panel');
function syncStepColumnHeight() {
  document.documentElement.style.setProperty('--court-panel-height', courtPanel.getBoundingClientRect().height + 'px');
}
if (window.ResizeObserver) {
  new ResizeObserver(syncStepColumnHeight).observe(courtPanel);
} else {
  window.addEventListener('resize', syncStepColumnHeight);
}

function renderCourt() {
  const snapshot = computeStepPositions(state.builderStepIndex);
  const prevSnapshot = state.builderStepIndex > 0 ? computeStepPositions(state.builderStepIndex - 1) : null;
  renderStepCourt(playerGroup, snapshot, prevSnapshot, document.getElementById('posReadout'));
}

attachStepCourtClicks(svg, () => onChange());

// Placement (the player picker) only does anything while viewing Setup
// (attachStepCourtClicks gates the actual write on builderStepIndex === 0
// too) — hide it on every other step rather than leaving a control on
// screen that silently does nothing.
function togglePickerVisibility() {
  const showPicker = state.builderStepIndex === 0;
  document.querySelectorAll('.player-picker, .picker-label').forEach(el => {
    el.style.display = showPicker ? '' : 'none';
  });
}

function onChange() {
  renderCourt();
  renderStepUI();
  revalidate();
}

function renderStepUI() {
  renderStepChips(document.getElementById('stepChips'), jumpToStep);
  renderStepBody(document.getElementById('stepBody'), { onChange, onRemoveStep });
  document.getElementById('stepPrevBtn').disabled = state.builderStepIndex === 0;
  const nextBtn = document.getElementById('stepNextBtn');
  const hasNext = state.builderStepIndex < state.script.length;
  // At the end of the script there's nothing to navigate to, so "Next"
  // becomes the add-shot action instead of just going disabled — the most
  // common thing you want to do at the last step is add the next one.
  nextBtn.textContent = hasNext ? 'Next ›' : '+ Add shot';
  nextBtn.title = hasNext ? 'Go to the next step' : 'Adds a new shot after this one and moves to it';
  togglePickerVisibility();
}

function clampStepIndex() {
  state.builderStepIndex = Math.max(0, Math.min(state.builderStepIndex, state.script.length));
}

function jumpToStep(i) {
  state.builderStepIndex = i;
  state.placingMoveFor = null;
  state.placingLandingFor = null;
  onChange();
}

// Inserts right after the currently-viewed step (not always at the end) and
// moves the view to the new step, so building a drill stays a linear
// "add, fill in, next" flow.
function addStepAfterCurrent() {
  const insertAt = state.builderStepIndex;
  const prevEntry = insertAt > 0 ? state.script[insertAt - 1] : null;
  const nextEntry = state.script[insertAt] || null;
  const hitter = prevEntry ? prevEntry.target : 'P1';
  let target = opponentsOf(hitter)[0];
  // Preserve chain continuity with whatever already follows, when legal,
  // rather than always defaulting to the same opponent regardless of context.
  if (nextEntry && opponentsOf(hitter).includes(nextEntry.hitter)) target = nextEntry.hitter;
  state.script.splice(insertAt, 0, { hitter, shotType: 'drive', target });
  state.placingMoveFor = null;
  state.placingLandingFor = null;
  state.builderStepIndex = insertAt + 1;
  onChange();
}

document.getElementById('stepPrevBtn').addEventListener('click', () => {
  if (state.builderStepIndex > 0) jumpToStep(state.builderStepIndex - 1);
});
document.getElementById('stepNextBtn').addEventListener('click', () => {
  if (state.builderStepIndex < state.script.length) jumpToStep(state.builderStepIndex + 1);
  else addStepAfterCurrent();
});

function onRemoveStep() {
  const idx = state.builderStepIndex - 1;
  if (idx < 0 || idx >= state.script.length) return;
  state.script.splice(idx, 1);
  // Unconditional reset: removing an entry shifts every later index, so a
  // stale expandedMoveRow/placingMoveFor could otherwise silently point at
  // the wrong shot afterward instead of a merely-missing one.
  state.expandedMoveRow = null;
  state.placingMoveFor = null;
  state.placingLandingFor = null;
  clampStepIndex();
  onChange();
}

// ---- player picker ----
// P1/P3 are anchors: always in the roster, the icon just selects them for
// placement. P2/P4 are optional: a checkbox is the explicit include/exclude
// control; their icon selects them for placement, same as the anchors, and
// is disabled while excluded since there's nothing to place.
const pickerNear = document.getElementById('pickerNear');
const pickerFar = document.getElementById('pickerFar');

function renderPicker() {
  [pickerNear, pickerFar].forEach(el => (el.innerHTML = ''));
  ALL_SLOTS.forEach(slot => {
    const included = isIncluded(slot);
    const selected = slot === state.selectedSlot;
    const wrap = document.createElement('div');
    wrap.className = 'picker-slot';

    const b = document.createElement('button');
    b.textContent = slot;
    b.className = 'icon-btn ' + SLOT_CLASS[slot] + (selected ? ' active' : '');
    b.disabled = !included;
    b.title = ANCHOR_SLOTS[slot] ? slot + ' is always in the roster' : 'Select ' + slot + ' for placement';
    b.addEventListener('click', () => { state.selectedSlot = slot; renderPicker(); renderCourt(); revalidate(); });
    wrap.appendChild(b);

    if (!ANCHOR_SLOTS[slot]) {
      const toggle = document.createElement('label');
      toggle.className = 'toggle';
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = included;
      cb.addEventListener('change', () => {
        setSlotIncluded(slot, cb.checked);
        renderPicker();
        clampStepIndex();
        renderStepUI();
        renderCourt();
        revalidate();
      });
      toggle.appendChild(cb);
      toggle.appendChild(document.createTextNode('include'));
      wrap.appendChild(toggle);
    }

    (TEAM_OF[slot] === 'near' ? pickerNear : pickerFar).appendChild(wrap);
  });
}
renderPicker();

// Keep the top-level status current while the author edits drill metadata,
// especially the name-derived id used by duplicate-id validation.
['fName', 'fDesc', 'fGoal', 'fTags'].forEach(id => {
  document.getElementById(id).addEventListener('input', revalidate);
});

// ---- validation ----
// Single source of truth for "is this drill authorable right now" — the
// banner AND the Generate JSON/Test Live/Save Server gates below all call
// this SAME function, so they can never drift out of sync with each other.
function drillProblems() {
  const missing = activeSlots().filter(s => !state.positions[s]);
  if (missing.length) return ['Missing positions for: ' + missing.join(', ')];
  if (!state.script.length) return ['Add at least one shot to the script (the opener).'];
  const drill = buildDrill();
  const problems = validateDrill(drill);
  if (!drill.id || drill.id === 'drill-') {
    problems.push('Drill name produces an empty id — give it a real name.');
  } else if (DEFAULT_DRILLS.some(d => d.id === drill.id)) {
    problems.push('id "' + drill.id + '" already exists in DEFAULT_DRILLS — rename this drill.');
  }
  return problems;
}

const banner = document.getElementById('banner');
function revalidate() {
  // The rep ends exactly when the script runs out — no separate cap to
  // configure — so this is purely informational, kept in sync with the
  // script rather than authored independently.
  const n = state.script.length;
  document.getElementById('shotCount').textContent = n
    ? n + ' scripted shot' + (n === 1 ? '' : 's')
    : '0 shots';
  const problems = drillProblems();
  if (!problems.length) {
    banner.className = 'status-pill ok';
    banner.textContent = 'Valid.';
    return;
  }
  banner.className = 'status-pill err';
  if (problems.length === 1) {
    banner.textContent = problems[0];
  } else {
    banner.innerHTML = '<strong>' + problems.length + ' issue(s):</strong><ul>' +
      problems.map(e => '<li>' + escapeHtml(e) + '</li>').join('') + '</ul>';
  }
}
function escapeHtml(s) { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

renderStepUI();
renderCourt();
revalidate();

// ---- drill object assembly (shared by JSON export + live test) ----
function buildDrill() {
  return {
    id: 'drill-' + document.getElementById('fName').value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, ''),
    name: document.getElementById('fName').value,
    players: activeSlots().length,
    desc: document.getElementById('fDesc').value,
    goal: document.getElementById('fGoal').value,
    tags: document.getElementById('fTags').value.split(',').map(t => t.trim()).filter(Boolean),
    startPositions: Object.assign({}, state.positions),
    script: state.script.map(s => {
      // title/desc are authoring-only narration fields folded into the
      // top-level `steps` array below, same as `moves` is folded into
      // `players` — neither belongs on the shipped script entry itself.
      const { title, desc, moves, ...rest } = s;
      const copy = Object.assign({}, rest);
      if (copy.landing) {
        copy.receiver = copy.target;
        copy.landing = Object.assign({}, copy.landing);
      }
      if (moves && moves.length) {
        copy.players = Object.assign({}, copy.players || {});
        moves.forEach(m => {
          const dir = {
            behavior: m.behavior || 'move',
            arriveBy: m.arriveBy || 'none'
          };
          if (m.to) dir.to = Object.assign({}, m.to);
          copy.players[m.player] = dir;
        });
      }
      return copy;
    }),
    // Always one entry per step (Setup + one per script index), even when
    // blank — NOT filtered down to only the non-empty ones. Losing empties
    // would also lose their position, and an editor reloading this drill
    // (src/drillAdmin.js) needs steps[i+1] to reliably mean script[i]'s
    // narration. Blank entries are filtered out at display time instead
    // (src/main.js's renderDrillSteps and the drill-card step count) so the
    // live game's UI still only shows narration that's actually there.
    steps: [state.steps[0] || { title: 'Setup', desc: '' }]
      .concat(state.script.map(s => ({ title: s.title || '', desc: s.desc || '' })))
  };
}

document.getElementById('testLive').addEventListener('click', () => {
  const problems = drillProblems();
  const result = document.getElementById('testResult');
  if (problems.length) {
    result.textContent = 'Fix validation issues above before testing live.';
    result.style.color = '#f0a8a8';
    return;
  }
  sessionStorage.setItem('pb3dWipDrill', JSON.stringify(buildDrill()));
  window.open(window.location.origin + '/?testDrill=1', '_blank');
  result.textContent = 'Opened in a new tab — this builder tab is untouched, so you can keep editing.';
  result.style.color = '#8fd9a8';
});

// This builder has no "load an existing drill" path (it always starts from
// a blank state), so it only ever creates a new drill via the API — editing
// or deleting an already-saved one is the in-app Drills screen's job
// (src/drillAdmin.js), which shares this same createDrill/updateDrill/
// deleteDrill store rather than a forked save path.
document.getElementById('saveServer').addEventListener('click', () => {
  const problems = drillProblems();
  const result = document.getElementById('testResult');
  if (problems.length) {
    result.textContent = 'Fix validation issues above before saving.';
    result.style.color = '#f0a8a8';
    return;
  }
  result.textContent = 'Saving…';
  result.style.color = '';
  createDrill(buildDrill()).then(saved => {
    if (!saved.ok) {
      result.textContent = (saved.errors || ['save failed']).join('; ');
      result.style.color = '#f0a8a8';
      return;
    }
    result.textContent = 'Saved "' + saved.drill.name + '" — find it in the app\'s Drills list.';
    result.style.color = '#8fd9a8';
  });
});

// ---- help & JSON modals ----
const helpModal = document.getElementById('helpModal');
document.getElementById('helpBtn').addEventListener('click', () => helpModal.classList.add('active'));
document.getElementById('helpClose').addEventListener('click', () => helpModal.classList.remove('active'));
helpModal.addEventListener('click', (e) => { if (e.target === helpModal) helpModal.classList.remove('active'); });

const jsonModal = document.getElementById('jsonModal');
document.getElementById('jsonClose').addEventListener('click', () => jsonModal.classList.remove('active'));
jsonModal.addEventListener('click', (e) => { if (e.target === jsonModal) jsonModal.classList.remove('active'); });
document.getElementById('genJson').addEventListener('click', () => {
  const problems = drillProblems();
  const result = document.getElementById('testResult');
  if (problems.length) {
    result.textContent = 'Fix validation issues above before generating JSON.';
    result.style.color = '#f0a8a8';
    return;
  }
  document.getElementById('jsonOut').value = JSON.stringify(buildDrill(), null, 2);
  jsonModal.classList.add('active');
});
document.getElementById('jsonCopy').addEventListener('click', () => {
  const ta = document.getElementById('jsonOut');
  ta.select();
  if (navigator.clipboard) navigator.clipboard.writeText(ta.value);
});
