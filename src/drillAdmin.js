'use strict';

// In-app "create/edit/delete a drill" screen (index.html's #scrDrillEdit).
// Reuses the standalone tools/drill-builder/{state,court-svg,script-editor}.js
// modules rather than re-implementing court placement/script editing a
// second time — those modules already correctly solve every hard part of
// this (own-side-of-net placement, opponent-only target dropdowns, live
// validateDrill feedback, P2/P4 roster toggling). court-svg.js/
// script-editor.js's render functions take an optional target-element
// argument specifically so they can be pointed at THIS screen's elements
// instead of the standalone builder's #court/#scriptList/#posReadout (a
// single document can't reuse those ids twice) — the standalone tool's own
// call sites are unaffected since that argument defaults to its ids.
//
// Narration (steps) editing and JSON export reuse the standalone builder's
// same modal pattern — a "Narration (N)" button opens #deNarrationModal
// (renderSteps pointed at this screen's own #deStepsList/#deOpenNarration,
// same optional-target pattern court-svg.js/script-editor.js already use
// for the court/script panels), and "Export JSON" opens #deJsonModal with
// the same buildDrill() this screen already uses to save.

import { validateDrill, TEAM_OF, createDrill, updateDrill, deleteDrill } from './drillStore.js';
import {
  state, activeSlots, opponentsOf, isIncluded, setSlotIncluded,
  ALL_SLOTS, SLOT_CLASS, ANCHOR_SLOTS
} from '../tools/drill-builder/state.js';
import { buildCourt, attachCourtClicks, renderPlayers as renderCourtPlayers } from '../tools/drill-builder/court-svg.js';
import { renderScript, renderSteps } from '../tools/drill-builder/script-editor.js';

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
  state.script = (drill.script || []).map(function (entry) {
    var copy = { hitter: entry.hitter, shotType: entry.shotType, target: entry.target || entry.receiver };
    if (entry.landing) copy.landing = Object.assign({}, entry.landing);
    var moves = movesFromEntry(entry);
    if (moves.length) copy.moves = moves;
    return copy;
  });
  state.steps = (drill.steps && drill.steps.length) ? drill.steps.map(function (s) { return Object.assign({}, s); }) : [{ title: 'Setup', desc: '' }];
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
    script: state.script.map(function (s) { return Object.assign({}, s); }),
    steps: state.steps.filter(function (s) { return s.title || s.desc; })
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

function onChange() {
  renderCourtPlayers(playerGroup, $('dePosReadout'));
  revalidate();
}

function revalidate() {
  renderCourtPlayers(playerGroup, $('dePosReadout'));
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
    b.addEventListener('click', function () { state.selectedSlot = slot; renderPicker(); onChange(); });
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
        renderScript(onChange, $('deScriptList'));
        onChange();
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
  renderScript(onChange, $('deScriptList'));
  renderSteps($('deStepsList'), $('deOpenNarration'));
  onChange();
}

function ensureInit() {
  if (initialized) return;
  initialized = true;
  var svg = $('deCourt');
  playerGroup = buildCourt(svg);
  attachCourtClicks(svg, function () { renderScript(onChange, $('deScriptList')); onChange(); });

  $('deAddShot').addEventListener('click', function () {
    var last = state.script[state.script.length - 1];
    var hitter = last ? last.target : 'P1';
    var target = last ? last.hitter : opponentsOf(hitter)[0];
    state.placingMoveFor = null;
    state.placingLandingFor = null;
    state.script.push({ hitter: hitter, shotType: 'drive', target: target });
    renderScript(onChange, $('deScriptList'));
    onChange();
  });
  $('deDupShot').addEventListener('click', function () {
    var last = state.script[state.script.length - 1];
    if (!last) return;
    var entry = { hitter: last.target, shotType: last.shotType, target: last.hitter };
    if (last.landing) entry.landing = Object.assign({}, last.landing);
    if (last.moves && last.moves.length) {
      entry.moves = last.moves.map(function (mv) { return Object.assign({}, mv, mv.to ? { to: Object.assign({}, mv.to) } : {}); });
    }
    state.placingMoveFor = null;
    state.placingLandingFor = null;
    state.script.push(entry);
    renderScript(onChange, $('deScriptList'));
    onChange();
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

  // ---- Narration (steps) modal ----
  $('deOpenNarration').addEventListener('click', function () {
    renderSteps($('deStepsList'), $('deOpenNarration'));
    $('deNarrationModal').classList.add('active');
  });
  $('deAddStep').addEventListener('click', function () {
    state.steps.push({ title: '', desc: '' });
    renderSteps($('deStepsList'), $('deOpenNarration'));
  });
  $('deNarrationClose').addEventListener('click', function () { $('deNarrationModal').classList.remove('active'); });
  $('deNarrationDone').addEventListener('click', function () { $('deNarrationModal').classList.remove('active'); });
  $('deNarrationModal').addEventListener('click', function (e) {
    if (e.target === $('deNarrationModal')) $('deNarrationModal').classList.remove('active');
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
