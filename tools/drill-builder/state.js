'use strict';

// Shared authoring state + pure derivation helpers for the drill builder.
// Rendering (court-svg.js, script-editor.js) and event wiring (main.js) both
// read/mutate this module's `state` object directly rather than passing it
// around — small enough app that a shared mutable singleton is simpler than
// threading state through every function, but every MUTATION that has
// side effects beyond a single field lives here as a named function so the
// "what does excluding a player actually clean up" logic has one home.

import { TEAM_OF } from '../../src/drillStore.js';

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
  script: [],              // [{ hitter, shotType, target, moves?: [{player, to}] }]
  steps: [{ title: 'Setup', desc: '' }],
  expandedMoveRow: null,   // index of the script row whose "moves" editor is open (also what's drawn on the court)
  placingMoveFor: null     // { entryIndex, moveIndex } while the next court click sets a move's target
};

// P1/P3 are always active (the anchors); P2/P4 follow their checkboxes.
// Canonical P1,P2,P3,P4 order, matching drillStore.js's activeSlotsOf.
export function activeSlots() {
  return ALL_SLOTS.filter(s => s === 'P1' || s === 'P3' || (s === 'P2' && state.includeP2) || (s === 'P4' && state.includeP4));
}
export function opponentsOf(slot) { return activeSlots().filter(s => TEAM_OF[s] !== TEAM_OF[slot]); }

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
    state.script = state.script.filter(s => s.hitter !== slot && s.target !== slot);
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
  }
}
