'use strict';

// Shared authoring state + pure derivation helpers for the drill builder.
// Rendering (court-svg.js, script-editor.js) and event wiring (main.js) both
// read/mutate this module's `state` object directly rather than passing it
// around — small enough app that a shared mutable singleton is simpler than
// threading state through every function, but every MUTATION that has
// side effects beyond a single field lives here as a named function so the
// "what does excluding a player actually clean up" logic has one home.

import { TEAM_OF, normalizeDrill } from '../../src/drillStore.js';

export const ALL_SLOTS = ['P1', 'P2', 'P3', 'P4'];
export const SLOT_CLASS = { P1: 'p1', P2: 'p2', P3: 'p3', P4: 'p4' };
export const SLOT_COLOR = { P1: '#d64545', P2: '#d68a45', P3: '#4576d6', P4: '#45b0d6' };
// P1/P3 are anchors: always in the roster, never removable. P2/P4 are
// optional, toggled via an explicit "include" checkbox.
export const ANCHOR_SLOTS = { P1: true, P3: true };

export const state = {
  selectedSlot: 'P1',
  includeP2: true,
  includeP4: true,
  positions: {},           // { P1: {x,z}, ... } — raw world coords, no grid quantization
  script: [],              // [{ hitter, shotType, target, landing?, moves?: [{player, to}] }]
  steps: [{ title: 'Setup', desc: '' }],
  expandedMoveRow: null,   // index of the script row whose "moves" editor is open (also what's drawn on the court)
  placingMoveFor: null,    // { entryIndex, moveIndex } while the next court click sets a move's target
  placingLandingFor: null, // script index while the next court click sets that shot's landing
  builderStepIndex: 0      // standalone-builder-only "which step is being viewed": 0 = Setup, N = script[N-1]
};

// P1/P3 are always active (the anchors); P2/P4 follow their checkboxes.
// Canonical P1,P2,P3,P4 order, matching drillStore.js's activeSlotsOf.
export function activeSlots() {
  return ALL_SLOTS.filter(s => s === 'P1' || s === 'P3' || (s === 'P2' && state.includeP2) || (s === 'P4' && state.includeP4));
}
export function opponentsOf(slot) { return activeSlots().filter(s => TEAM_OF[s] !== TEAM_OF[slot]); }

// Standalone-builder-only: approximates "where is everyone, right after step
// `stepIndex` fires" for the step-by-step court preview. stepIndex 0 = Setup
// (no shot has happened yet), stepIndex N = right after script[N-1]. Starts
// from the one-time authored state.positions. For each processed shot, the
// receiver is moved to the ball (landing, or their own prior spot if no
// landing was set) — the same "move to intercept" behavior the real AI
// exhibits, since the receiver has to be standing at the ball to hit it.
// An explicit moves[].to cue for that same player then overrides that
// default, same as any other player's cue. A player with no cue and who
// wasn't a receiver on this shot simply stays at their last known spot.
// Never mutates state.positions; this is a best-effort authoring aid, not
// real physics — the runtime's actual per-rally movement is live AI/
// physics, not authored data, so there is nothing more precise to compute
// from here.
export function computeStepPositions(stepIndex) {
  const positions = {};
  activeSlots().forEach(slot => {
    positions[slot] = state.positions[slot] ? Object.assign({}, state.positions[slot]) : null;
  });
  let ball = null;
  let hitter = null;
  let receiver = null;
  const upto = Math.min(stepIndex, state.script.length);
  for (let i = 0; i < upto; i++) {
    const entry = state.script[i];
    hitter = entry.hitter;
    receiver = entry.target;
    ball = entry.landing
      ? Object.assign({}, entry.landing)
      : (positions[entry.target] ? Object.assign({}, positions[entry.target]) : null);
    if (ball) positions[entry.target] = Object.assign({}, ball);
    (entry.moves || []).forEach(mv => { if (mv.to) positions[mv.player] = Object.assign({}, mv.to); });
  }
  return { positions, ball, hitter, receiver };
}

export function isIncluded(slot) {
  if (ANCHOR_SLOTS[slot]) return true;
  return slot === 'P2' ? state.includeP2 : state.includeP4;
}

// Toggle P2/P4 include/exclude. Mutates state only — the caller (main.js)
// re-renders every dependent panel afterward, since which panels need
// refreshing differs by direction (see the include/exclude asymmetry note
// below).
export function setSlotIncluded(slot, included) {
  if (slot === 'P2') state.includeP2 = included; else state.includeP4 = included;
  if (included) {
    // Newly added: select it so the next court click places it, same flow
    // as any other player — no default position is assigned.
    state.selectedSlot = slot;
  } else {
    // Removed: strip its position and any script entry referencing it
    // (hitter or target) — an orphaned reference would otherwise silently
    // fail validateDrill's "not in this drill's roster" check instead of
    // being cleaned up here where the intent (removing the player) is clear.
    delete state.positions[slot];
    state.script = state.script.filter(s => s.hitter !== slot && s.target !== slot && s.receiver !== slot);
    if (state.selectedSlot === slot) state.selectedSlot = 'P1';
    // Splicing `state.script` above can remove or shift the very entry
    // `expandedMoveRow`/`placingMoveFor` point at. Previously neither was
    // reset here, so an armed "place on court" click (state.placingMoveFor)
    // on the next court click would write into a stale/wrong/nonexistent
    // script index — a crash that never self-healed (the reset that would
    // have cleared it lived past the line that threw), permanently
    // breaking court clicks for the rest of the session. Simplest safe
    // rule: any script-structure change closes both open-editor states
    // rather than trying to prove which indices are still valid.
    state.expandedMoveRow = null;
    state.placingMoveFor = null;
    state.placingLandingFor = null;
  }
}

// Back to a blank drill — shared by "+ New Drill" and as the first step of
// loading any drill (existing library entry or imported JSON) into state.
export function resetState() {
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
// DEFAULT_DRILLS itself uses) or the builder's richer `players` directive
// export — an existing or imported drill can be either.
function movesFromEntry(entry) {
  if (entry.moves) {
    return entry.moves.map(m => ({ player: m.player, to: m.to, behavior: m.behavior || 'move', arriveBy: m.arriveBy || 'none' }));
  }
  if (entry.players) {
    return Object.keys(entry.players).map(slot => {
      const d = entry.players[slot] || {};
      return { player: slot, to: d.to || null, behavior: d.behavior || 'move', arriveBy: d.arriveBy || 'none' };
    });
  }
  return [];
}

// Populates `state` (roster toggles, positions, script, step narration) from
// a drill object shaped like DEFAULT_DRILLS — the shared path for both
// opening an existing library drill for editing and importing a hand-
// authored/pasted JSON drill. Grid-coord strings are resolved to world
// coords via normalizeDrill, so an import can use either coordinate shape.
// Returns the normalized drill so the caller can also read its
// name/desc/goal/tags for the metadata fields, which live outside `state`.
export function loadDrillIntoState(rawDrill) {
  const drill = normalizeDrill(rawDrill) || {};
  resetState();
  state.includeP2 = !!(drill.startPositions && drill.startPositions.P2);
  state.includeP4 = !!(drill.startPositions && drill.startPositions.P4);
  state.positions = Object.assign({}, drill.startPositions);
  // Positional correlation: drill.steps[0] is Setup's narration, drill.steps[i+1]
  // is script[i]'s (see buildDrill() in main.js/drillAdmin.js — both emit
  // exactly one entry per step, even blank, specifically so this mapping is
  // reliable). A hand-authored drill whose `steps` predates that convention
  // (a short, free-standing caption list, e.g. DEFAULT_DRILLS) won't line up
  // perfectly here — narration is cosmetic-only, so a best-effort mapping
  // that can't crash anything is an acceptable trade for the common case.
  state.steps = [drill.steps && drill.steps[0] ? Object.assign({}, drill.steps[0]) : { title: 'Setup', desc: '' }];
  state.script = (drill.script || []).map((entry, i) => {
    const copy = { hitter: entry.hitter, shotType: entry.shotType, target: entry.target || entry.receiver };
    if (entry.landing) copy.landing = Object.assign({}, entry.landing);
    const moves = movesFromEntry(entry);
    if (moves.length) copy.moves = moves;
    const narration = drill.steps && drill.steps[i + 1];
    if (narration) {
      copy.title = narration.title || '';
      copy.desc = narration.desc || '';
    }
    return copy;
  });
  return drill;
}
