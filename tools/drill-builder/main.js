'use strict';

// Wiring only: DOM refs, the player picker, the validation banner, the
// action bar (Generate JSON / Test Live), and the help/JSON modals. Court
// rendering lives in court-svg.js, the script/steps editors in
// script-editor.js, shared state in state.js.

import { validateDrill, TEAM_OF, DEFAULT_DRILLS } from '../../src/drillStore.js';
import {
  state, activeSlots, opponentsOf, isIncluded, setSlotIncluded,
  ALL_SLOTS, SLOT_CLASS, ANCHOR_SLOTS
} from './state.js';
import { buildCourt, attachCourtClicks, renderPlayers as renderCourtPlayers } from './court-svg.js';
import { renderScript, renderSteps } from './script-editor.js';

const svg = document.getElementById('court');
const playerGroup = buildCourt(svg);
function renderPlayers() { renderCourtPlayers(playerGroup); }

// The court defines the authoring workspace's visual height. Mirror that
// measured height onto the Script panel so only its shot list scrolls, rather
// than letting a long script stretch the whole page.
const courtPanel = document.querySelector('.court-panel');
function syncScriptPanelHeight() {
  document.documentElement.style.setProperty('--court-panel-height', courtPanel.getBoundingClientRect().height + 'px');
}
if (window.ResizeObserver) {
  new ResizeObserver(syncScriptPanelHeight).observe(courtPanel);
} else {
  window.addEventListener('resize', syncScriptPanelHeight);
}

function onChange() { renderPlayers(); revalidate(); }
attachCourtClicks(svg, () => { renderScript(onChange); onChange(); });

// ---- player picker ----
// P1/P3 are anchors: always in the roster, the icon just selects them for
// placement. P2/P4 are optional: a checkbox is the explicit include/exclude
// control (unambiguous — no "click means something different depending on
// state" behavior); their icon selects them for placement, same as the
// anchors, and is disabled while excluded since there's nothing to place.
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
    b.addEventListener('click', () => { state.selectedSlot = slot; renderPicker(); renderPlayers(); revalidate(); });
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
        renderPlayers();
        // Both directions refresh the Script panel now: excluding can
        // remove/alter rows (setSlotIncluded's own job), and including
        // needs it too — the hitter/target/move-player <select>s already
        // on screen were built from activeSlots() at their OWN render
        // time, so a newly-restored slot won't appear as an option in any
        // already-rendered row until this runs (previously only the
        // exclude direction refreshed this panel).
        renderScript(onChange);
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
// banner AND the Generate JSON/Test Live gates below all call this SAME
// function, so they can never drift out of sync with each other again. (A
// prior version of this fix only made the two buttons call validateDrill()
// directly, but missed that the banner ALSO short-circuits on two earlier
// checks — checkbox-included-but-unplaced slots, and an empty script —
// before validateDrill ever runs; the buttons silently skipped those two
// and could still proceed while the banner showed a real error.)
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
  renderPlayers(); // keep the per-player zone-mismatch markers current
  // The rep ends exactly when the script runs out — no separate cap to
  // configure — so this is purely informational, kept in sync with the
  // script editor rather than authored independently.
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

document.getElementById('addShot').addEventListener('click', () => {
  const last = state.script[state.script.length - 1];
  // Default a new shot's hitter to the previous shot's target (the natural
  // next contact) and target to whoever hasn't been hit to yet, rather than
  // always defaulting to the same P1->P3 pair regardless of context.
  const hitter = last ? last.target : 'P1';
  const target = last ? last.hitter : opponentsOf(hitter)[0];
  state.placingMoveFor = null;
  state.placingLandingFor = null;
  state.script.push({ hitter, shotType: 'drive', target });
  renderScript(onChange);
  onChange();
});
document.getElementById('dupShot').addEventListener('click', () => {
  const last = state.script[state.script.length - 1];
  if (!last) return;
  // Mirrors hitter/target (the natural next contact in an alternating
  // exchange, e.g. P1->P3 then P3->P1) and deep-clones shotType + moves —
  // shadow cues on an off-ball pair (P2/P4) rarely change beat-to-beat, so
  // re-authoring a long alternating pattern by hand (add shot, re-pick
  // type, re-place every move) is the exact tedium this button removes.
  const entry = { hitter: last.target, shotType: last.shotType, target: last.hitter };
  if (last.landing) entry.landing = Object.assign({}, last.landing);
  if (last.moves && last.moves.length) {
    entry.moves = last.moves.map(mv => Object.assign({}, mv, mv.to ? { to: Object.assign({}, mv.to) } : {}));
  }
  state.placingMoveFor = null;
  state.placingLandingFor = null;
  state.script.push(entry);
  renderScript(onChange);
  onChange();
});

document.getElementById('addStep').addEventListener('click', () => {
  state.steps.push({ title: '', desc: '' });
  renderSteps();
});

renderScript(onChange);
renderSteps();
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
      const copy = Object.assign({}, s);
      if (copy.landing) {
        copy.receiver = copy.target;
        copy.landing = Object.assign({}, copy.landing);
      }
      if (copy.moves && copy.moves.length) {
        copy.players = Object.assign({}, copy.players || {});
        copy.moves.forEach(m => {
          const dir = {
            behavior: m.behavior || 'move',
            arriveBy: m.arriveBy || 'none'
          };
          if (m.to) dir.to = Object.assign({}, m.to);
          copy.players[m.player] = dir;
        });
      }
      delete copy.moves;
      return copy;
    }),
    steps: state.steps.filter(s => s.title || s.desc)
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

const narrationModal = document.getElementById('narrationModal');
function closeNarration() { narrationModal.classList.remove('active'); }
document.getElementById('openNarration').addEventListener('click', () => {
  renderSteps();
  narrationModal.classList.add('active');
});
document.getElementById('narrationClose').addEventListener('click', closeNarration);
document.getElementById('narrationDone').addEventListener('click', closeNarration);
narrationModal.addEventListener('click', e => { if (e.target === narrationModal) closeNarration(); });
window.addEventListener('keydown', e => {
  if (e.key === 'Escape' && narrationModal.classList.contains('active')) closeNarration();
});
