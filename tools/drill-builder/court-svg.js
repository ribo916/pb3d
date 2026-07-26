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
const PLACEMENT_X = HALF_W + 2.45;
const PLACEMENT_Z = HALF_L + 2.2;
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

export function clampLandingPoint(p, team) {
  p.x = Math.max(-HALF_W, Math.min(HALF_W, p.x));
  p.z = Math.max(-HALF_L, Math.min(HALF_L, p.z));
  p.z = clampToOwnSide(team, p.z);
  return p;
}

export function clampPlacementPoint(p, team) {
  p.x = Math.max(-PLACEMENT_X, Math.min(PLACEMENT_X, p.x));
  p.z = Math.max(-PLACEMENT_Z, Math.min(PLACEMENT_Z, p.z));
  p.z = clampToOwnSide(team, p.z);
  return p;
}

// Court body + kitchen zones colored to match the real game's green court
// palette (COURT_PALETTES.green in scene.js), rather than a neutral slate —
// so the preview reads as an actual pickleball court. Draws once; returns
// the <g> layer subsequent renderPlayers() calls should target.
export function buildCourt(svg) {
  // Colored placement apron: makes the legal off-court authoring space read
  // as intentional and gives the reference grid enough contrast to remain
  // visible beyond the sidelines/baselines.
  svg.appendChild(svgEl('rect', {
    x: -6, y: -10, width: 12, height: 20, rx: 0.28,
    fill: '#0a2029'
  }));
  svg.appendChild(svgEl('rect', {
    x: -6, y: -10, width: 12, height: 10,
    fill: '#132b40', opacity: 0.72
  }));
  svg.appendChild(svgEl('rect', {
    x: -6, y: 0, width: 12, height: 10,
    fill: '#30232a', opacity: 0.58
  }));
  svg.appendChild(svgEl('rect', {
    x: -HALF_W - 0.34, y: -HALF_L - 0.34,
    width: HALF_W * 2 + 0.68, height: HALF_L * 2 + 0.68,
    fill: 'none', stroke: '#7ef0ff', 'stroke-width': 0.055, opacity: 0.22, rx: 0.08
  }));
  svg.appendChild(svgEl('rect', { x: -HALF_W, y: -HALF_L, width: HALF_W * 2, height: HALF_L * 2, fill: COURT_GREEN.court, stroke: '#eaf6ee', 'stroke-width': 0.04 }));
  [1, -1].forEach(sign => svg.appendChild(svgEl('rect', {
    x: -HALF_W, y: sign > 0 ? 0 : -KITCHEN, width: HALF_W * 2, height: KITCHEN,
    fill: COURT_GREEN.kitchen, opacity: 0.85
  })));
  svg.appendChild(svgEl('line', { x1: -HALF_W, y1: 0, x2: HALF_W, y2: 0, stroke: '#f4fbf6', 'stroke-width': 0.045 })); // net
  [-KITCHEN, KITCHEN].forEach(z => svg.appendChild(svgEl('line', { x1: -HALF_W, y1: z, x2: HALF_W, y2: z, stroke: '#eaf6ee', 'stroke-width': 0.025, 'stroke-dasharray': '0.08,0.08' })));
  // Reference grid (visual aid only — clicking places exactly there, never
  // snaps). Stronger in the colored apron, still subtle over the court.
  for (let x = -5; x <= 5; x++) {
    svg.appendChild(svgEl('line', {
      x1: x, y1: -10, x2: x, y2: 10, stroke: '#d9f5ff',
      'stroke-width': x === 0 ? 0.025 : 0.016, opacity: x === 0 ? 0.25 : 0.18
    }));
    if (x !== 0) {
      const label = svgEl('text', {
        x, y: -9.55, 'text-anchor': 'middle', 'font-size': 0.22,
        fill: '#d9f5ff', opacity: 0.55
      });
      label.textContent = x;
      svg.appendChild(label);
    }
  }
  for (let z = -9; z <= 9; z += 1.5) {
    svg.appendChild(svgEl('line', {
      x1: -6, y1: z, x2: 6, y2: z, stroke: '#d9f5ff',
      'stroke-width': 0.016, opacity: 0.18
    }));
    if (Math.abs(z) > 0.1) {
      const label = svgEl('text', {
        x: -5.65, y: z + 0.08, 'text-anchor': 'start', 'font-size': 0.2,
        fill: '#d9f5ff', opacity: 0.52
      });
      label.textContent = z.toFixed(1);
      svg.appendChild(label);
    }
  }
  [
    { y: -8.85, text: 'FAR PLACEMENT AREA', fill: '#91bfff' },
    { y: 9.15, text: 'NEAR PLACEMENT AREA', fill: '#ffb0a6' }
  ].forEach(item => {
    const label = svgEl('text', {
      x: 0, y: item.y, 'text-anchor': 'middle', 'font-size': 0.24,
      'font-family': 'sans-serif', 'font-weight': 700, 'letter-spacing': 0.06,
      fill: item.fill, opacity: 0.58
    });
    label.textContent = item.text;
    svg.appendChild(label);
  });

  const playerGroup = svgEl('g', { class: 'player-dot' });
  svg.appendChild(playerGroup);
  return playerGroup;
}

export function svgPointFromEvent(svg, evt) {
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
        entry.landing = clampLandingPoint(p, receiverTeam);
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
        mv.to = clampPlacementPoint(p, TEAM_OF[mv.player]);
      }
      onChange();
      return;
    }
    state.positions[state.selectedSlot] = clampPlacementPoint(p, TEAM_OF[state.selectedSlot]);
    onChange();
  });
}

// Standalone-builder-only variant of attachCourtClicks for the merged
// step-by-step view: same landing/move-target/plain-placement branching, but
// plain placement (setting a player's one-time Setup position) only applies
// while viewing Setup (builderStepIndex 0) — a stray court click on a later
// step must never silently rewrite a Setup position. attachCourtClicks
// itself is untouched; drillAdmin.js keeps using that one.
export function attachStepCourtClicks(svg, onChange) {
  svg.addEventListener('click', (evt) => {
    const p = svgPointFromEvent(svg, evt);
    if (state.placingLandingFor != null) {
      const entry = state.script[state.placingLandingFor];
      state.placingLandingFor = null;
      if (entry) {
        const receiverTeam = TEAM_OF[entry.target || entry.receiver];
        entry.landing = clampLandingPoint(p, receiverTeam);
      }
      onChange();
      return;
    }
    if (state.placingMoveFor) {
      const { entryIndex, moveIndex } = state.placingMoveFor;
      const entry = state.script[entryIndex];
      state.placingMoveFor = null;
      if (entry && entry.moves && entry.moves[moveIndex]) {
        const mv = entry.moves[moveIndex];
        mv.to = clampPlacementPoint(p, TEAM_OF[mv.player]);
      }
      onChange();
      return;
    }
    if (state.builderStepIndex === 0 && state.selectedSlot) {
      state.positions[state.selectedSlot] = clampPlacementPoint(p, TEAM_OF[state.selectedSlot]);
      onChange();
    }
  });
}

// Renders start-position dots (all active players) plus — only for the
// script row currently expanded, to avoid unreadable clutter across a
// multi-shot script — that beat's movement-cue markers. `posReadoutEl`
// defaults to the standalone builder's #posReadout so its own call sites
// don't need to change; the in-app editor (src/drillAdmin.js) passes its own
// element instead, since a single document can't reuse that id twice.
export function renderPlayers(playerGroup, posReadoutEl) {
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
  (posReadoutEl || document.getElementById('posReadout')).textContent = lines.join('\n');

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

// Standalone-builder-only step-view renderer: draws a computeStepPositions()
// snapshot (see state.js) instead of the raw Setup positions renderPlayers()
// draws. Renders `prevSnapshot` first as a faint, non-interactive ghost (so
// movement between steps reads at a glance), then the current snapshot's
// player dots/labels (same visual language as renderPlayers), a hollow ring
// around the current hitter, and a ball marker. Deliberately re-implements
// the dot/label loop rather than calling renderPlayers — renderPlayers's
// expandedMoveRow-gated cue overlay stays untouched for drillAdmin.js.
export function renderStepCourt(playerGroup, snapshot, prevSnapshot, posReadoutEl) {
  playerGroup.innerHTML = '';

  // Ghost layer: the previous step's ball path (hitter -> ball) and each
  // player's movement line from their previous spot to where they are now,
  // all faint/non-interactive, so the last shot's flight and the last
  // repositioning both read at a glance before the current step draws over them.
  if (prevSnapshot) {
    if (prevSnapshot.ball) {
      const prevHitterPos = prevSnapshot.positions[prevSnapshot.hitter];
      if (prevHitterPos) {
        playerGroup.appendChild(svgEl('line', {
          x1: prevHitterPos.x, y1: prevHitterPos.z, x2: prevSnapshot.ball.x, y2: prevSnapshot.ball.z,
          stroke: '#f2e85b', 'stroke-width': 0.025, 'stroke-dasharray': '0.1,0.08', opacity: 0.25
        }));
      }
      playerGroup.appendChild(svgEl('circle', {
        cx: prevSnapshot.ball.x, cy: prevSnapshot.ball.z, r: 0.13, fill: '#f2e85b', opacity: 0.28
      }));
    }
    activeSlots().forEach(slot => {
      const from = prevSnapshot.positions[slot];
      const to = snapshot.positions[slot];
      if (!from) return;
      if (to && (Math.abs(from.x - to.x) > 0.01 || Math.abs(from.z - to.z) > 0.01)) {
        playerGroup.appendChild(svgEl('line', {
          x1: from.x, y1: from.z, x2: to.x, y2: to.z,
          stroke: SLOT_COLOR[slot] || '#aaa', 'stroke-width': 0.035,
          'stroke-dasharray': '0.06,0.1', opacity: 0.4
        }));
      }
      playerGroup.appendChild(svgEl('circle', {
        cx: from.x, cy: from.z, r: 0.22, fill: SLOT_COLOR[slot], stroke: 'none', opacity: 0.28
      }));
    });
  }

  const lines = [];
  activeSlots().forEach(slot => {
    const p = snapshot.positions[slot];
    if (!p) { lines.push(slot + ': not placed'); return; }
    if (slot === snapshot.hitter) {
      // A fixed highlight color (matching the ball marker), not the
      // player's own SLOT_COLOR — a same-hue ring around a same-hue dot
      // reads as barely-there on the two/four slots whose color it matches,
      // and this way the ring never competes with the white "P1" label for
      // attention.
      playerGroup.appendChild(svgEl('circle', {
        cx: p.x, cy: p.z, r: 0.42, fill: 'none',
        stroke: '#f2e85b', 'stroke-width': 0.06, opacity: 0.9
      }));
    } else if (slot === snapshot.receiver) {
      // Dashed (vs. the hitter's solid ring) marks "the ball is headed
      // here." No separate ball dot is drawn on top of them for this same
      // reason — computeStepPositions always moves the receiver TO the
      // ball, so a filled marker at that exact spot would just sit on top
      // of their dot and hide the "P2" label under it.
      playerGroup.appendChild(svgEl('circle', {
        cx: p.x, cy: p.z, r: 0.42, fill: 'none',
        stroke: '#f2e85b', 'stroke-width': 0.05, 'stroke-dasharray': '0.1,0.07', opacity: 0.8
      }));
    }
    const dot = svgEl('circle', { cx: p.x, cy: p.z, r: 0.26, fill: SLOT_COLOR[slot], stroke: '#fff', 'stroke-width': 0.03 });
    const label = svgEl('text', { x: p.x, y: p.z + 0.08, 'text-anchor': 'middle', 'font-size': 0.26, fill: '#fff' });
    label.textContent = slot;
    playerGroup.appendChild(dot);
    playerGroup.appendChild(label);
    lines.push(slot + ': x=' + p.x.toFixed(2) + ', z=' + p.z.toFixed(2));
  });

  // Current step's ball path: hitter -> ball, same visual language as the
  // per-shot landing cue in renderPlayers, so "where the ball is going"
  // reads as a path, not just an isolated marker. The ball's own dot is
  // only drawn when it does NOT land on the receiver's dot (e.g. the
  // receiver hasn't been placed yet) — normally the receiver's dashed ring
  // above already shows exactly where the ball is going, and a solid ball
  // marker on top of them would just hide their label again.
  if (snapshot.ball) {
    const hitterPos = snapshot.positions[snapshot.hitter];
    if (hitterPos) {
      playerGroup.appendChild(svgEl('line', {
        x1: hitterPos.x, y1: hitterPos.z, x2: snapshot.ball.x, y2: snapshot.ball.z,
        stroke: '#f2e85b', 'stroke-width': 0.03, 'stroke-dasharray': '0.12,0.08', opacity: 0.8
      }));
    }
    const receiverPos = snapshot.receiver ? snapshot.positions[snapshot.receiver] : null;
    if (!receiverPos) {
      const ball = svgEl('circle', {
        cx: snapshot.ball.x, cy: snapshot.ball.z, r: 0.16,
        fill: '#f2e85b', stroke: '#1b1d26', 'stroke-width': 0.04
      });
      playerGroup.appendChild(ball);
    }
  }

  (posReadoutEl || document.getElementById('posReadout')).textContent = lines.join('\n');
}
