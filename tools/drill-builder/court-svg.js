'use strict';

// The court preview: static background (body, kitchen zones, net,
// reference grid) drawn once, plus per-change rendering of player dots and
// movement-cue markers, plus the click-to-place interaction. Kept separate
// from script-editor.js/main.js since "draw the court + players + cues" is
// the one piece of this tool that's a real reusable concern (e.g. a future
// in-app admin UI would want this exact rendering, not the DOM-wiring
// around it).

import { COURT } from '../../src/constants.js';
import { TEAM_OF } from '../../src/drillStore.js';
import { state, activeSlots, SLOT_COLOR } from './state.js';

const HALF_W = COURT.HALF_W, HALF_L = COURT.HALF_L, KITCHEN = COURT.KITCHEN;
const MIN_NET_GAP = 0.3;
// Mirrors src/scene.js COURT_PALETTES.green — keep in sync if that changes.
const COURT_GREEN = { court: '#1d6a3a', kitchen: '#6fbe78' };

function svgEl(tag, attrs) {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const k in attrs) el.setAttribute(k, attrs[k]);
  return el;
}

// A team's side of the net is fixed (near = positive z, far = negative z —
// same convention drillStore.js's grid rows use). The UI enforces it here
// rather than just flagging it in the validation banner afterward: a click
// on the wrong side snaps to the nearest legal spot instead of placing
// there or being ignored.
function clampToOwnSide(team, z) {
  return team === 'near' ? Math.max(z, MIN_NET_GAP) : Math.min(z, -MIN_NET_GAP);
}

function clampCourtPoint(p, team) {
  p.x = Math.max(-HALF_W, Math.min(HALF_W, p.x));
  p.z = Math.max(-HALF_L, Math.min(HALF_L, p.z));
  p.z = clampToOwnSide(team, p.z);
  return p;
}

// Court body + kitchen zones colored to match the real game's green court
// palette (COURT_PALETTES.green in scene.js), rather than a neutral slate —
// so the preview reads as an actual pickleball court. Draws once; returns
// the <g> layer subsequent renderPlayers() calls should target.
export function buildCourt(svg) {
  svg.appendChild(svgEl('rect', { x: -HALF_W, y: -HALF_L, width: HALF_W * 2, height: HALF_L * 2, fill: COURT_GREEN.court, stroke: '#eaf6ee', 'stroke-width': 0.04 }));
  [1, -1].forEach(sign => svg.appendChild(svgEl('rect', {
    x: -HALF_W, y: sign > 0 ? 0 : -KITCHEN, width: HALF_W * 2, height: KITCHEN,
    fill: COURT_GREEN.kitchen, opacity: 0.85
  })));
  svg.appendChild(svgEl('line', { x1: -HALF_W, y1: 0, x2: HALF_W, y2: 0, stroke: '#f4fbf6', 'stroke-width': 0.045 })); // net
  [-KITCHEN, KITCHEN].forEach(z => svg.appendChild(svgEl('line', { x1: -HALF_W, y1: z, x2: HALF_W, y2: z, stroke: '#eaf6ee', 'stroke-width': 0.025, 'stroke-dasharray': '0.08,0.08' })));
  // Faint reference grid (visual aid only — clicking anywhere places exactly there, not snapped).
  for (let x = -5; x <= 5; x++) svg.appendChild(svgEl('line', { x1: x, y1: -10, x2: x, y2: 10, stroke: '#ffffff', 'stroke-width': 0.01, opacity: 0.08 }));
  for (let z = -9; z <= 9; z += 1.5) svg.appendChild(svgEl('line', { x1: -6, y1: z, x2: 6, y2: z, stroke: '#ffffff', 'stroke-width': 0.01, opacity: 0.08 }));

  const playerGroup = svgEl('g', { class: 'player-dot' });
  svg.appendChild(playerGroup);
  return playerGroup;
}

function svgPointFromEvent(svg, evt) {
  const pt = svg.createSVGPoint();
  pt.x = evt.clientX; pt.y = evt.clientY;
  const p = pt.matrixTransform(svg.getScreenCTM().inverse());
  return { x: Math.round(p.x * 100) / 100, z: Math.round(p.y * 100) / 100 };
}

// Wires the click-to-place interaction (player placement, or a movement
// cue's target when one is armed). `onChange` is called after any state
// mutation so the caller re-renders dependent panels.
export function attachCourtClicks(svg, onChange) {
  svg.addEventListener('click', (evt) => {
    const p = svgPointFromEvent(svg, evt);
    if (state.placingLandingFor != null) {
      const entry = state.script[state.placingLandingFor];
      state.placingLandingFor = null;
      if (entry) {
        const receiverTeam = TEAM_OF[entry.target || entry.receiver];
        entry.landing = clampCourtPoint(p, receiverTeam);
      }
      onChange();
      return;
    }
    // Placing a movement cue's target takes priority over the normal
    // player-placement click. Cue targets are clamped to that player's own
    // side too; the runtime also clamps live position, but authoring a
    // wrong-side steering target creates misleading arrows and validation
    // errors.
    if (state.placingMoveFor) {
      const { entryIndex, moveIndex } = state.placingMoveFor;
      const entry = state.script[entryIndex];
      state.placingMoveFor = null;
      // Defensive: entryIndex/moveIndex can only ever be stale if something
      // upstream failed to clear placingMoveFor on a script-structure change
      // (see state.js's setSlotIncluded) — guarded here too so a future gap
      // in that bookkeeping degrades to "the click did nothing" instead of
      // throwing and leaving placingMoveFor armed forever.
      if (entry && entry.moves && entry.moves[moveIndex]) {
        const mv = entry.moves[moveIndex];
        mv.to = clampCourtPoint(p, TEAM_OF[mv.player]);
      }
      onChange();
      return;
    }
    state.positions[state.selectedSlot] = clampCourtPoint(p, TEAM_OF[state.selectedSlot]);
    onChange();
  });
}

// Renders start-position dots (all active players) plus — only for the
// script row currently expanded, to avoid unreadable clutter across a
// multi-shot script — that beat's movement-cue markers.
export function renderPlayers(playerGroup) {
  playerGroup.innerHTML = '';
  const lines = [];
  const active = activeSlots();
  active.forEach(slot => {
    const p = state.positions[slot];
    if (!p) { lines.push(slot + ': not placed'); return; }
    const dot = svgEl('circle', { cx: p.x, cy: p.z, r: 0.26, fill: SLOT_COLOR[slot], stroke: '#fff', 'stroke-width': 0.03 });
    const label = svgEl('text', { x: p.x, y: p.z + 0.08, 'text-anchor': 'middle', 'font-size': 0.26, fill: '#fff' });
    label.textContent = slot;
    playerGroup.appendChild(dot);
    playerGroup.appendChild(label);
    lines.push(slot + ': x=' + p.x.toFixed(2) + ', z=' + p.z.toFixed(2));
  });
  document.getElementById('posReadout').textContent = lines.join('\n');

  // Hollow/dashed ring + arrow glyph, distinct from the solid filled
  // start-position dot above, so "cue" reads differently from "starts
  // here" at a glance.
  if (state.expandedMoveRow != null) {
    const entry = state.script[state.expandedMoveRow];
    if (entry && entry.landing) {
      const hitterPos = state.positions[entry.hitter];
      const color = '#f2e85b';
      const ring = svgEl('circle', {
        cx: entry.landing.x, cy: entry.landing.z, r: 0.2, fill: color,
        stroke: '#1b1d26', 'stroke-width': 0.04
      });
      const label = svgEl('text', {
        x: entry.landing.x, y: entry.landing.z - 0.32,
        'text-anchor': 'middle', 'font-size': 0.22, fill: color
      });
      label.textContent = 'ball';
      playerGroup.appendChild(ring);
      playerGroup.appendChild(label);
      if (hitterPos) {
        playerGroup.appendChild(svgEl('line', {
          x1: hitterPos.x, y1: hitterPos.z, x2: entry.landing.x, y2: entry.landing.z,
          stroke: color, 'stroke-width': 0.025, 'stroke-dasharray': '0.12,0.08', opacity: 0.75
        }));
      }
    }
    (entry && entry.moves || []).forEach(mv => {
      if (!mv.to) return;
      const color = SLOT_COLOR[mv.player] || '#aaa';
      const ring = svgEl('circle', {
        cx: mv.to.x, cy: mv.to.z, r: 0.3, fill: 'none', stroke: color,
        'stroke-width': 0.05, 'stroke-dasharray': '0.1,0.08'
      });
      const glyph = svgEl('text', { x: mv.to.x, y: mv.to.z + 0.09, 'text-anchor': 'middle', 'font-size': 0.28, fill: color });
      glyph.textContent = '→';
      playerGroup.appendChild(ring);
      playerGroup.appendChild(glyph);
      const fromPos = state.positions[mv.player];
      if (fromPos) {
        playerGroup.appendChild(svgEl('line', {
          x1: fromPos.x, y1: fromPos.z, x2: mv.to.x, y2: mv.to.z,
          stroke: color, 'stroke-width': 0.02, 'stroke-dasharray': '0.06,0.1', opacity: 0.6
        }));
      }
    });
  }
}
