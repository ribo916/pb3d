'use strict';

// Convert a pickleball-drills grid coord (e.g. 'F10') to pb3d world coords.
// Top of the SVG (row 1) = far side (z < 0); bottom (row 10) = near side (z > 0).
var COLS = 'ABCDEFGH';
var X_STOPS = [-3.8, -3.048, -1.524, -0.508, 0.508, 1.524, 3.048, 3.8];
var Z_STOPS = [-7.5, -6.706, -4.0, -2.134, -0.5, 0.5, 2.134, 4.0, 6.706, 7.5];

export function gridToWorld(coord) {
  if (!coord || typeof coord !== 'string') return { x: 0, z: 0 };
  var col = COLS.indexOf(coord[0]);
  var row = parseInt(coord.slice(1), 10);
  if (col < 0 || isNaN(row) || row < 1 || row > 10) return { x: 0, z: 0 };
  return { x: X_STOPS[col], z: Z_STOPS[row - 1] };
}

function normalizePositions(positions) {
  if (!positions) return {};
  var out = {};
  var keys = Object.keys(positions);
  for (var i = 0; i < keys.length; i++) {
    var k = keys[i];
    var v = positions[k];
    out[k] = (typeof v === 'string') ? gridToWorld(v) : v;
  }
  return out;
}

export function normalizeDrill(drill) {
  if (!drill) return drill;
  var steps = (drill.steps || []).map(function (step) {
    return Object.assign({}, step, { positions: normalizePositions(step.positions) });
  });
  // Legacy: if no step has positions but startPositions exists, inject into step 0.
  var startPos = drill.startPositions ? normalizePositions(drill.startPositions) : null;
  if (startPos && steps.length > 0 && !Object.keys(steps[0].positions).length) {
    steps[0] = Object.assign({}, steps[0], { positions: startPos });
  }
  return Object.assign({}, drill, { steps: steps });
}

var _drills = null;

// Phase 1: a single drill, played out as real live simulated gameplay (see
// src/drillDirector.js) rather than scripted/animated. Only step 0's
// `positions` is actually read by the engine (the Setup formation + the
// director's opening feed target); steps 1+ carry title/desc only, shown in
// the Steps modal as a description of what the drill's own AI/physics
// naturally produces — not a script the engine follows.
export var DEFAULT_DRILLS = [
  {
    id: 'drill-drip',
    name: 'Drip Practice',
    players: 4,
    desc: 'P1 simulates a bad return. P3 and P4 work the 3rd-shot drop. P2 threatens the poach from the NVZ.',
    goal: "Train the 3rd-shot drop under realistic game pressure. P3 must drip to P1's feet to neutralize the point and earn the transition forward.",
    tags: ['3rd shot drop', 'NVZ', 'driving', 'reset', 'poaching'],
    steps: [
      { title: 'Setup', desc: "P1 (Team A) is near the baseline right — simulating a bad return. P2 (Team A) is just behind the kitchen line, shading the middle. P3 and P4 (Team B) are both at the baseline on their respective sides.", positions: { P1: 'F10', P2: 'D7', P3: 'F1', P4: 'C2' } },
      { title: 'P1 Feeds', desc: "P1 hits a high, floaty ball toward P3, simulating a return that sat up. The moment the ball leaves P1's paddle, P1 starts moving forward toward NVZ." },
      { title: 'P3 Drops — P1 Split-Steps — P2 Reads', desc: "P3 moves to the ball and drops cross-court toward P1's feet. P1 split-steps as P3 contacts. P2 reads P3's paddle face before committing to the poach." },
      { title: 'Resolution', desc: "Clean drop at P1's feet: P1 is forced to reset low, P3 and P4 advance together toward NVZ, P2 holds. Popup: P2 attacks, P4 reacts." },
      { title: 'Rep Ends — Loops', desc: "The rep is a fixed sequence — about 4 hits (feed, drop, reset, resolution) — then it stops and loops back to Setup as a replay you can pause, rewind, and rewatch. In person: rotate P3/P4 each rep, and after 5 reps swap P1/P2 with P3/P4 so everyone practices both roles." }
    ]
  }
];

// Normalize grid coords to world coords at module load time.
for (var _i = 0; _i < DEFAULT_DRILLS.length; _i++) {
  DEFAULT_DRILLS[_i] = normalizeDrill(DEFAULT_DRILLS[_i]);
}

export function loadDrills() {
  if (_drills) return Promise.resolve(_drills.slice());
  return Promise.resolve(DEFAULT_DRILLS.slice());
}

export function getDrillById(id) {
  var drills = _drills || DEFAULT_DRILLS;
  for (var i = 0; i < drills.length; i++) {
    if (drills[i].id === id) return drills[i];
  }
  return null;
}
