'use strict';

// In-app "create/edit/delete a drill" screen (index.html's #scrDrillEdit).
// Reuses the standalone tools/drill-builder/{state,court-svg,step-view}.js
// modules rather than re-implementing court placement/step editing a second
// time — those modules already correctly solve every hard part of this
// (own-side-of-net placement, opponent-only target dropdowns, live
// validateDrill feedback, P2/P4 roster toggling, the merged step-by-step
// court+editor view). court-svg.js/state.js's render/compute functions take
// explicit target-element arguments specifically so they can be pointed at
// THIS screen's elements instead of the standalone builder's #deCourt/
// #deStepBody/#dePosReadout (a single document can't reuse those ids twice).
//
// Narration (inline per-step, collapsed accordion) and JSON export reuse the
// standalone builder's same patterns — "Export JSON" opens #deJsonModal with
// the same buildDrill() this screen already uses to save.

import { validateDrill, TEAM_OF, createDrill, updateDrill, deleteDrill } from './drillStore.js';
import {
  state, activeSlots, opponentsOf, isIncluded, setSlotIncluded, computeStepPositions,
  ALL_SLOTS, SLOT_CLASS, ANCHOR_SLOTS
} from '../tools/drill-builder/state.js';
import { buildCourt, attachStepCourtClicks, renderStepCourt } from '../tools/drill-builder/court-svg.js';
import { renderStepChips, renderStepBody } from '../tools/drill-builder/step-view.js';

var $ = function (id) { return document.getElementById(id); };

var initialized = false;
var playerGroup = null;
var editingId = null; // null while creating a new drill; the drill's id while editing one
var currentDrills = []; // the last list loadDrills() resolved, for id-collision checks

function resetState() {
  state.selectedSlot = 'P1';
  state.includeP2 = true;
  state.includeP4 = true;
  state.positions = {};
  state.script = [];
  state.steps = [{ title: 'Setup', desc: '' }];
  state.expandedMoveRow = null;
  state.placingMoveFor = null;
  state.placingLandingFor = null;
  state.builderStepIndex = 0;
}

// Converts a script entry's movement cue into the editor's internal `moves`
// shape regardless of whether it was authored as plain `moves` (the shape
// DEFAULT_DRILLS itself uses) or the standalone builder's richer `players`
// directive export — an existing drill can be either.
function movesFromEntry(entry) {
  if (entry.moves) {
    return entry.moves.map(function (m) {
      return { player: m.player, to: m.to, behavior: m.behavior || 'move', arriveBy: m.arriveBy || 'none' };
    });
  }
  if (entry.players) {
    return Object.keys(entry.players).map(function (slot) {
      var d = entry.players[slot] || {};
      return { player: slot, to: d.to || null, behavior: d.behavior || 'move', arriveBy: d.arriveBy || 'none' };
    });
  }
  return [];
}

function loadIntoState(drill) {
  resetState();
  state.includeP2 = !!(drill.startPositions && drill.startPositions.P2);
  state.includeP4 = !!(drill.startPositions && drill.startPositions.P4);
  state.positions = Object.assign({}, drill.startPositions);
  // Positional correlation: drill.steps[0] is Setup's narration, drill.steps[i+1]
  // is script[i]'s (see tools/drill-builder/main.js buildDrill() — it emits
  // exactly one entry per step, even blank, specifically so this mapping is
  // reliable). A hand-authored drill whose `steps` predates that convention
  // (a short, free-standing caption list, e.g. DEFAULT_DRILLS) won't line up
  // perfectly here — narration is cosmetic-only, so a best-effort mapping
  // that can't crash anything is an acceptable trade for the common case.
  state.steps = [drill.steps && drill.steps[0] ? Object.assign({}, drill.steps[0]) : { title: 'Setup', desc: '' }];
  state.script = (drill.script || []).map(function (entry, i) {
    var copy = { hitter: entry.hitter, shotType: entry.shotType, target: entry.target || entry.receiver };
    if (entry.landing) copy.landing = Object.assign({}, entry.landing);
    var moves = movesFromEntry(entry);
    if (moves.length) copy.moves = moves;
    var narration = drill.steps && drill.steps[i + 1];
    if (narration) {
      copy.title = narration.title || '';
      copy.desc = narration.desc || '';
    }
    return copy;
  });
}

function slugify(name) {
  return 'drill-' + String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

function buildDrill() {
  var name = $('deFName').value;
  return {
    id: editingId || slugify(name),
    name: name,
    players: activeSlots().length,
    desc: $('deFDesc').value,
    goal: $('deFGoal').value,
    tags: $('deFTags').value.split(',').map(function (t) { return t.trim(); }).filter(Boolean),
    startPositions: Object.assign({}, state.positions),
    script: state.script.map(function (s) {
      // title/desc are authoring-only narration fields folded into the
      // top-level `steps` array below — they don't belong on the shipped
      // script entry itself.
      var copy = Object.assign({}, s);
      delete copy.title;
      delete copy.desc;
      return copy;
    }),
    // Always one entry per step (Setup + one per script index), even when
    // blank — not filtered down to only the non-empty ones, so loadIntoState
    // above can map narration back to the right step reliably. Blank entries
    // are filtered out at display time instead (src/main.js's
    // renderDrillSteps and the drill-card step count).
    steps: [state.steps[0] || { title: 'Setup', desc: '' }].concat(
      state.script.map(function (s) { return { title: s.title || '', desc: s.desc || '' }; })
    )
  };
}

function drillProblems() {
  var missing = activeSlots().filter(function (s) { return !state.positions[s]; });
  if (missing.length) return ['Missing positions for: ' + missing.join(', ')];
  if (!state.script.length) return ['Add at least one shot to the script (the opener).'];
  var drill = buildDrill();
  var problems = validateDrill(drill);
  if (!drill.id || drill.id === 'drill-') {
    problems.push('Drill name produces an empty id — give it a real name.');
  } else if (!editingId && currentDrills.some(function (d) { return d.id === drill.id; })) {
    problems.push('id "' + drill.id + '" already exists — rename this drill.');
  }
  return problems;
}

function escapeHtml(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

function renderCourt() {
  var snapshot = computeStepPositions(state.builderStepIndex);
  var prevSnapshot = state.builderStepIndex > 0 ? computeStepPositions(state.builderStepIndex - 1) : null;
  renderStepCourt(playerGroup, snapshot, prevSnapshot, $('dePosReadout'));
}

// Placement (the player picker) only does anything while viewing Setup
// (attachStepCourtClicks gates the actual write on builderStepIndex === 0
// too) — hide it on every other step rather than leaving a control on
// screen that silently does nothing.
function togglePickerVisibility() {
  var showPicker = state.builderStepIndex === 0;
  var els = document.querySelectorAll('#scrDrillEdit .player-picker, #scrDrillEdit .picker-label');
  for (var i = 0; i < els.length; i++) els[i].style.display = showPicker ? '' : 'none';
}

function onChange() {
  renderCourt();
  renderStepUI();
  revalidate();
}

function renderStepUI() {
  renderStepChips($('deStepChips'), jumpToStep);
  renderStepBody($('deStepBody'), { onChange: onChange, onRemoveStep: onRemoveStep });
  $('deStepPrevBtn').disabled = state.builderStepIndex === 0;
  var nextBtn = $('deStepNextBtn');
  var hasNext = state.builderStepIndex < state.script.length;
  // At the end of the script there's nothing to navigate to, so "Next"
  // becomes the add-shot action instead of just going disabled.
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
// moves the view to the new step.
function addStepAfterCurrent() {
  var insertAt = state.builderStepIndex;
  var prevEntry = insertAt > 0 ? state.script[insertAt - 1] : null;
  var nextEntry = state.script[insertAt] || null;
  var hitter = prevEntry ? prevEntry.target : 'P1';
  var target = opponentsOf(hitter)[0];
  if (nextEntry && opponentsOf(hitter).indexOf(nextEntry.hitter) !== -1) target = nextEntry.hitter;
  state.script.splice(insertAt, 0, { hitter: hitter, shotType: 'drive', target: target });
  state.placingMoveFor = null;
  state.placingLandingFor = null;
  state.builderStepIndex = insertAt + 1;
  onChange();
}

function onRemoveStep() {
  var idx = state.builderStepIndex - 1;
  if (idx < 0 || idx >= state.script.length) return;
  state.script.splice(idx, 1);
  state.expandedMoveRow = null;
  state.placingMoveFor = null;
  state.placingLandingFor = null;
  clampStepIndex();
  onChange();
}

function revalidate() {
  var n = state.script.length;
  $('deShotCount').textContent = n ? (n + ' scripted shot' + (n === 1 ? '' : 's')) : '0 shots';
  var problems = drillProblems();
  var banner = $('deBanner');
  var saveBtn = $('deSaveBtn');
  if (!problems.length) {
    banner.className = 'status-pill ok';
    banner.textContent = 'Valid.';
    saveBtn.disabled = false;
    return;
  }
  banner.className = 'status-pill err';
  if (problems.length === 1) {
    banner.textContent = problems[0];
  } else {
    banner.innerHTML = '<strong>' + problems.length + ' issue(s):</strong><ul>' +
      problems.map(function (e) { return '<li>' + escapeHtml(e) + '</li>'; }).join('') + '</ul>';
  }
  saveBtn.disabled = true;
}

function renderPicker() {
  var pickerNear = $('dePickerNear'), pickerFar = $('dePickerFar');
  [pickerNear, pickerFar].forEach(function (el) { el.innerHTML = ''; });
  ALL_SLOTS.forEach(function (slot) {
    var included = isIncluded(slot);
    var selected = slot === state.selectedSlot;
    var wrap = document.createElement('div');
    wrap.className = 'picker-slot';

    var b = document.createElement('button');
    b.textContent = slot;
    b.className = 'icon-btn ' + SLOT_CLASS[slot] + (selected ? ' active' : '');
    b.disabled = !included;
    b.title = ANCHOR_SLOTS[slot] ? slot + ' is always in the roster' : 'Select ' + slot + ' for placement';
    b.addEventListener('click', function () { state.selectedSlot = slot; renderPicker(); renderCourt(); revalidate(); });
    wrap.appendChild(b);

    if (!ANCHOR_SLOTS[slot]) {
      var toggle = document.createElement('label');
      toggle.className = 'toggle';
      var cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = included;
      cb.addEventListener('change', function () {
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

function renderAll() {
  renderPicker();
  renderStepUI();
  renderCourt();
  revalidate();
}

function ensureInit() {
  if (initialized) return;
  initialized = true;
  var svg = $('deCourt');
  playerGroup = buildCourt(svg);
  attachStepCourtClicks(svg, onChange);

  // The court defines the workspace's visual height. Mirror that measured
  // height onto the right-hand step column so only its own content scrolls
  // internally, keeping the court and the current step's chips/nav visible
  // together without scrolling the whole screen.
  var courtPanel = document.querySelector('#scrDrillEdit .court-panel');
  function syncCourtHeight() {
    document.documentElement.style.setProperty('--de-court-h', courtPanel.getBoundingClientRect().height + 'px');
  }
  if (typeof ResizeObserver !== 'undefined') {
    new ResizeObserver(syncCourtHeight).observe(courtPanel);
  } else {
    window.addEventListener('resize', syncCourtHeight);
  }

  $('deStepPrevBtn').addEventListener('click', function () {
    if (state.builderStepIndex > 0) jumpToStep(state.builderStepIndex - 1);
  });
  $('deStepNextBtn').addEventListener('click', function () {
    if (state.builderStepIndex < state.script.length) jumpToStep(state.builderStepIndex + 1);
    else addStepAfterCurrent();
  });

  ['deFName', 'deFDesc', 'deFGoal', 'deFTags'].forEach(function (id) {
    $(id).addEventListener('input', revalidate);
  });

  $('deSaveBtn').addEventListener('click', function () {
    var problems = drillProblems();
    var status = $('deStatus');
    if (problems.length) return;
    var drill = buildDrill();
    var save = editingId ? updateDrill(drill) : createDrill(drill);
    $('deSaveBtn').disabled = true;
    save.then(function (result) {
      $('deSaveBtn').disabled = false;
      if (!result.ok) {
        status.textContent = (result.errors || ['save failed']).join('; ');
        status.style.color = '#f0a8a8';
        return;
      }
      status.textContent = 'Saved.';
      status.style.color = '#8fd9a8';
      if (typeof window.pb3dOnDrillSaved === 'function') window.pb3dOnDrillSaved(result.drill);
    });
  });

  $('deDeleteBtn').addEventListener('click', function () {
    if (!editingId) return;
    if (!window.confirm('Delete this drill? This cannot be undone.')) return;
    deleteDrill(editingId).then(function (result) {
      var status = $('deStatus');
      if (!result.ok) {
        status.textContent = (result.errors || ['delete failed']).join('; ');
        status.style.color = '#f0a8a8';
        return;
      }
      if (typeof window.pb3dOnDrillDeleted === 'function') window.pb3dOnDrillDeleted(editingId);
    });
  });

  $('deTestLiveBtn').addEventListener('click', function () {
    var problems = drillProblems();
    var status = $('deStatus');
    if (problems.length) {
      status.textContent = 'Fix validation issues above before testing live.';
      status.style.color = '#f0a8a8';
      return;
    }
    sessionStorage.setItem('pb3dWipDrill', JSON.stringify(buildDrill()));
    window.open(window.location.origin + '/?testDrill=1', '_blank');
    status.textContent = 'Opened in a new tab.';
    status.style.color = '#8fd9a8';
  });

  // ---- Export JSON modal ----
  $('deJsonBtn').addEventListener('click', function () {
    var problems = drillProblems();
    var status = $('deStatus');
    if (problems.length) {
      status.textContent = 'Fix validation issues above before exporting JSON.';
      status.style.color = '#f0a8a8';
      return;
    }
    $('deJsonOut').value = JSON.stringify(buildDrill(), null, 2);
    $('deJsonModal').classList.add('active');
  });
  $('deJsonClose').addEventListener('click', function () { $('deJsonModal').classList.remove('active'); });
  $('deJsonModal').addEventListener('click', function (e) {
    if (e.target === $('deJsonModal')) $('deJsonModal').classList.remove('active');
  });
  $('deJsonCopy').addEventListener('click', function () {
    var ta = $('deJsonOut');
    ta.select();
    if (navigator.clipboard) navigator.clipboard.writeText(ta.value);
  });
}

// Called by main.js's "+ New Drill" button.
export function openNewDrill(drills) {
  currentDrills = drills || [];
  editingId = null;
  resetState();
  ensureInit();
  $('deScreenTitle').textContent = 'New Drill';
  $('deDeleteBtn').style.display = 'none';
  $('deFName').value = 'New Drill';
  $('deFDesc').value = '';
  $('deFGoal').value = '';
  $('deFTags').value = '';
  $('deStatus').textContent = '';
  renderAll();
}

// Called by main.js's per-card "Edit" affordance.
export function openEditDrill(drill, drills) {
  currentDrills = drills || [];
  editingId = drill.id;
  loadIntoState(drill);
  ensureInit();
  $('deScreenTitle').textContent = 'Edit Drill';
  $('deDeleteBtn').style.display = '';
  $('deFName').value = drill.name || '';
  $('deFDesc').value = drill.desc || '';
  $('deFGoal').value = drill.goal || '';
  $('deFTags').value = (drill.tags || []).join(', ');
  $('deStatus').textContent = '';
  renderAll();
}
