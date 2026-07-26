'use strict';

import { SLOT_INFO } from './drillDirector.js';
import { COURT } from './constants.js';
import { TYPES as SHOT_TYPES } from './shots.js';

// Convert a pickleball-drills grid coord (e.g. 'F10') to pb3d world coords.
// Top of the SVG (row 1) = far side (z < 0); bottom (row 10) = near side (z > 0).
var COLS = 'ABCDEFGH';
var X_STOPS = [-3.8, -3.048, -1.524, -0.508, 0.508, 1.524, 3.048, 3.8];
var Z_STOPS = [-7.5, -6.706, -4.0, -2.134, -0.5, 0.5, 2.134, 4.0, 6.706, 7.5];
// smash/supersmash/popup are state-triggered in live play (never an
// AI-selectable intent — see Shots.TYPES), but ARE valid to author directly
// into a drill's `script` as a forced beat.
var VALID_SHOT_TYPES = SHOT_TYPES.concat(['smash', 'supersmash', 'popup']);
var VALID_PLAYER_BEHAVIORS = ['move', 'hold', 'shadow', 'recover', 'crash', 'retreat', 'switch', 'chase'];
var VALID_ARRIVE_BY = ['none', 'bounce', 'contact', 'ball-contact', 'next-contact'];
var ROW_RE = /^[0-9]+$/;
var MIN_PLAYER_SPACING = 0.35;

// Player-count tags (e.g. "2-player") are derived from the roster, never
// author-entered — normalizeDrill below injects the correct one on every
// load/save/export path. Kept as an ordinary tag (not a separate field) so
// the Drills library's existing tag-filter UI can filter by player count
// for free, with no separate UI needed.
var PLAYER_COUNT_TAG_RE = /^[0-9]+-player$/;

export function playerCountTag(n) {
  return n + '-player';
}

// Strips any existing N-player tag and appends the correct one for the
// given roster size — idempotent, so calling it again with an
// already-tagged list just re-confirms the same tag.
export function withPlayerCountTag(tags, activeCount) {
  var kept = (tags || []).filter(function (t) { return !PLAYER_COUNT_TAG_RE.test(t); });
  kept.push(playerCountTag(activeCount));
  return kept;
}

// Used only when populating the editable Tags text field (the standalone
// builder and in-app editor) — strips the derived tag so it never shows up
// as something an author could hand-edit or duplicate; normalizeDrill
// re-derives it on every save regardless of what that field contains.
export function stripPlayerCountTag(tags) {
  return (tags || []).filter(function (t) { return !PLAYER_COUNT_TAG_RE.test(t); });
}

// Lets the Drills library UI single out player-count tags to render as
// their own quick-filter row instead of mixing them into the general tag
// list — same underlying tag string, just a different display grouping.
export function isPlayerCountTag(tag) {
  return PLAYER_COUNT_TAG_RE.test(tag);
}

// Returns `null` (not a fallback coordinate) for anything malformed — a
// caller that gets `{x:0,z:0}` back from a typo can't tell "the drill wants
// the net" from "the input was garbage." Column letter is accepted case-
// insensitively (harmless authoring leniency); everything else (unknown
// column, out-of-range/non-numeric row, stray whitespace) is rejected.
export function gridToWorld(coord) {
  if (typeof coord !== 'string' || coord.trim() !== coord || coord.length < 2) return null;
  var col = COLS.indexOf(coord[0].toUpperCase());
  var rowStr = coord.slice(1);
  var row = Number(rowStr);
  if (col < 0 || !ROW_RE.test(rowStr) || row < 1 || row > 10) return null;
  return { x: X_STOPS[col], z: Z_STOPS[row - 1] };
}

function normalizeMoveTo(v) {
  return (typeof v === 'string') ? gridToWorld(v) : v;
}

function normalizePositions(positions) {
  if (!positions) return {};
  var out = {};
  var keys = Object.keys(positions);
  for (var i = 0; i < keys.length; i++) {
    var k = keys[i];
    out[k] = normalizeMoveTo(positions[k]);
  }
  return out;
}

// A script entry's optional `moves` array carries movement cues that arm the
// instant that beat's shot fires (see drillDirector.js's armMovesForBeat) —
// each cue's `to` accepts the same grid-coord-string-or-{x,z} shape
// startPositions does, so it needs the same one-time resolution.
function normalizeScript(script) {
  return (Array.isArray(script) ? script : []).map(function (entry) {
    var out = Object.assign({}, entry);
    if (out.landing) out.landing = normalizeMoveTo(out.landing);
    if (out.players) {
      var playerKeys = Object.keys(out.players);
      var players = {};
      for (var pi = 0; pi < playerKeys.length; pi++) {
        var slot = playerKeys[pi];
        var dir = out.players[slot] || {};
        players[slot] = Object.assign({}, dir, dir.to ? { to: normalizeMoveTo(dir.to) } : {});
      }
      out.players = players;
    }
    if (out.moves) {
      out.moves = out.moves.map(function (m) {
        return Object.assign({}, m, { to: normalizeMoveTo(m.to) });
      });
    }
    return out;
  });
}

function receiverOf(entry) {
  return entry && (entry.receiver || entry.target);
}

function landingOf(entry) {
  return entry && entry.landing ? normalizeMoveTo(entry.landing) : null;
}

function directiveTo(entry, slot) {
  var dir = entry && entry.players && entry.players[slot];
  return dir && dir.to ? normalizeMoveTo(dir.to) : null;
}

// Engine-consumed data (startPositions, script) and on-screen narration
// (steps) are kept as separate top-level fields — not nested inside one
// another — so an admin UI can edit a drill's starting formation or its shot
// sequence without touching its step text, or reword a step without risking
// the engine's real inputs.
export function normalizeDrill(drill) {
  if (!drill) return drill;
  // Guarded against a malformed/non-object entry (e.g. `null`) in a hand-
  // authored DEFAULT_DRILLS list — this runs at module load for every
  // shipped drill, so one bad entry would otherwise throw and take the
  // entire drill library down with it, not just that one drill.
  var steps = (Array.isArray(drill.steps) ? drill.steps : []).map(function (step) {
    step = step || {};
    return { title: step.title, desc: step.desc };
  });
  var startPositions = normalizePositions(drill.startPositions);
  // activeSlotsOf is defined further down this module but hoisted (function
  // declaration), so it's callable here safely — by the time normalizeDrill
  // actually runs (module load or later), the whole module has finished
  // evaluating, so TEAM_OF (which activeSlotsOf reads) is already populated.
  var activeCount = activeSlotsOf({ startPositions: startPositions }).length;
  return Object.assign({}, drill, {
    startPositions: startPositions,
    script: normalizeScript(drill.script),
    steps: steps,
    tags: withPlayerCountTag(drill.tags, activeCount)
  });
}

// P1/P2 are always partners on the near side of the net (Team A); P3/P4 are
// always partners on the far side (Team B) — derived from drillDirector.js's
// SLOT_INFO, the single source of truth for the P-slot-to-engine mapping, so
// this can't drift out of sync with how src/game.js's `mode==='drill'`
// roster is actually built. A drill can field 2, 3, or 4 players: P1/P3 are
// always present (the anchor slots); P2/P4 are each independently optional,
// as long as at least one player ends up on each side. A shot can only ever
// go from a player to one of the OTHER team's active players, the same way
// a real rally shot crosses the net, never sideways to your own partner.
export var TEAM_OF = {};
Object.keys(SLOT_INFO).forEach(function (slot) { TEAM_OF[slot] = SLOT_INFO[slot].team; });

// The canonical P1,P2,P3,P4-ordered list of slots a drill actually uses,
// filtered to whichever are present in its startPositions — the single
// place both the engine (main.js, before constructing Game) and any
// authoring UI should derive "how many players, which ones" from, rather
// than each re-deriving it from Object.keys() independently.
export function activeSlotsOf(drill) {
  var positions = (drill && drill.startPositions) || {};
  return Object.keys(SLOT_INFO).filter(function (slot) { return !!positions[slot]; });
}

function dist2D(a, b) {
  var dx = a.x - b.x, dz = a.z - b.z;
  return Math.sqrt(dx * dx + dz * dz);
}

function ownSide(slot, pos) {
  if (!pos) return true;
  return TEAM_OF[slot] === 'near' ? pos.z > 0 : pos.z < 0;
}

// Validates a drill's roster and `script`. Returns a (possibly empty) array
// of human-readable error strings — never throws, so it can be used both as
// a test assertion and as live feedback in an authoring UI. Accepts either
// raw grid-coordinate strings or already-resolved {x,z} positions in
// startPositions.
export function validateDrill(drill) {
  var errors = [];
  if (!drill) return errors;

  // Raw startPositions keys — checked independently of `active` below, so a
  // typo'd slot name or an unresolvable grid coord gets its own precise
  // error instead of only ever showing up indirectly as "no near-side
  // player"/"P2 without P1" once the bad entry silently drops out of the
  // active roster.
  var rawPositions = drill.startPositions || {};
  Object.keys(rawPositions).forEach(function (k) {
    if (!SLOT_INFO[k]) {
      errors.push('startPositions: "' + k + '" is not a recognized slot (expected P1-P4)');
      return;
    }
    var p = normalizeMoveTo(rawPositions[k]);
    if (!p || typeof p.x !== 'number' || typeof p.z !== 'number' || !isFinite(p.x) || !isFinite(p.z)) {
      errors.push('startPositions: ' + k + ' has an invalid position (' + JSON.stringify(rawPositions[k]) + ')');
    }
  });

  var positions = normalizePositions(drill.startPositions || {});
  var active = activeSlotsOf(Object.assign({}, drill, { startPositions: positions }));
  var activeSet = {};
  active.forEach(function (s) { activeSet[s] = true; });

  // Roster shape: at least one player per side, and P2/P4 (the optional
  // partner slots) can't exist without their anchor (P1/P3) — the engine's
  // per-team "who's responsible" logic assumes a solo player is always
  // team-slot 0, which P1/P3 already are; P2/P4 alone would be team-slot 1
  // with nobody in slot 0, which nothing here is built to handle.
  var hasNear = active.some(function (s) { return TEAM_OF[s] === 'near'; });
  var hasFar = active.some(function (s) { return TEAM_OF[s] === 'far'; });
  if (!hasNear) errors.push('roster: no near-side player (need P1 and/or P2)');
  if (!hasFar) errors.push('roster: no far-side player (need P3 and/or P4)');
  if (activeSet.P2 && !activeSet.P1) errors.push('roster: P2 is present without P1 — P1 is always the near-side anchor');
  if (activeSet.P4 && !activeSet.P3) errors.push('roster: P4 is present without P3 — P3 is always the far-side anchor');
  if (typeof drill.players === 'number' && drill.players !== active.length) {
    errors.push('players: says ' + drill.players + ', but startPositions defines ' + active.length + ' active player(s)');
  }

  for (var si = 0; si < active.length; si++) {
    var startPos = positions[active[si]];
    if (startPos && !ownSide(active[si], startPos)) {
      errors.push('startPositions: ' + active[si] + ' is on the wrong side of the net for its team');
    }
  }

  // Two active players standing too close together is never a real drill
  // formation — flag it rather than silently letting the engine sort out an
  // overlapping contact-reach/movement mess at runtime.
  for (var ai = 0; ai < active.length; ai++) {
    for (var aj = ai + 1; aj < active.length; aj++) {
      var pa = positions[active[ai]], pb = positions[active[aj]];
      if (pa && pb && dist2D(pa, pb) < MIN_PLAYER_SPACING) {
        errors.push('startPositions: ' + active[ai] + ' and ' + active[aj] + ' are too close together');
      }
    }
  }

  var script = Array.isArray(drill.script) ? drill.script : [];
  if (!script.length) {
    errors.push('script: has no shots — a drill needs at least one scripted shot, or it never starts (Setup hangs forever)');
  }
  for (var i = 0; i < script.length; i++) {
    var entry = script[i];
    var receiver = receiverOf(entry);
    if (!activeSet[entry.hitter]) {
      errors.push('shot ' + i + ': hitter ' + entry.hitter + ' is not in this drill\'s roster');
      continue;
    }
    if (!activeSet[receiver]) {
      errors.push('shot ' + i + ': receiver ' + receiver + ' is not in this drill\'s roster');
      continue;
    }
    if (entry.target && entry.receiver && entry.target !== entry.receiver) {
      errors.push('shot ' + i + ': target and receiver disagree — use receiver plus landing for v2 shots');
    }
    if (entry.hitter === receiver) {
      errors.push('shot ' + i + ': ' + entry.hitter + ' cannot target themselves');
    } else if (TEAM_OF[entry.hitter] === TEAM_OF[receiver]) {
      errors.push(
        'shot ' + i + ': ' + entry.hitter + ' hits to ' + receiver + ', but they\'re partners (same team) — ' +
        'a shot always crosses the net to an opponent, never sideways to your own partner'
      );
    }
    if (VALID_SHOT_TYPES.indexOf(entry.shotType) === -1) {
      errors.push('shot ' + i + ': shotType "' + entry.shotType + '" is not a recognized shot type (' + VALID_SHOT_TYPES.join('|') + ')');
    }
    if (i + 1 < script.length) {
      var next = script[i + 1];
      if (next && receiver !== next.hitter) {
        errors.push(
          'shot ' + i + ': receiver ' + receiver + ' does not match shot ' + (i + 1) +
          ' hitter ' + next.hitter + ' — the next hitter is how the receiving player is chosen'
        );
      }
    }
    var hasLanding = entry.landing != null;
    var landing = landingOf(entry);
    if (hasLanding && !landing) {
      errors.push('shot ' + i + ': landing has an invalid position (' + JSON.stringify(entry.landing) + ')');
    } else if (landing) {
      if (typeof landing.x !== 'number' || typeof landing.z !== 'number' || !isFinite(landing.x) || !isFinite(landing.z)) {
        errors.push('shot ' + i + ': landing has an invalid position (' + JSON.stringify(entry.landing) + ')');
      } else {
        var landingSide = TEAM_OF[entry.hitter] === 'near' ? 'far' : 'near';
        if (!ownSide(landingSide === 'near' ? 'P1' : 'P3', landing)) {
          errors.push('shot ' + i + ': landing is on the wrong side of the net for a shot from ' + entry.hitter);
        }
        if (Math.abs(landing.x) > COURT.HALF_W || Math.abs(landing.z) > COURT.HALF_L) {
          errors.push('shot ' + i + ': landing (' + landing.x.toFixed(2) + ',' + landing.z.toFixed(2) + ') must be inside the court');
        }
      }
    }

    // Player directives (v2, `players`) and legacy movement cues (`moves`):
    // each names any active player (hitter, partner, or opponent — unlike
    // `target`, not restricted to opponents, since a cue can be a self-
    // recovery or a partner poach/shadow) and, when movement is requested,
    // a legal own-side position to head toward the instant this beat's shot
    // fires.
    var directives = entry.players || {};
    var directivePlayers = {};
    Object.keys(directives).forEach(function (slot) {
      var dir = directives[slot] || {};
      directivePlayers[slot] = true;
      if (!activeSet[slot]) {
        errors.push('shot ' + i + ' player ' + slot + ': is not in this drill\'s roster');
        return;
      }
      var behavior = dir.behavior || 'move';
      if (VALID_PLAYER_BEHAVIORS.indexOf(behavior) === -1) {
        errors.push('shot ' + i + ' player ' + slot + ': behavior "' + behavior + '" is not recognized');
      }
      var arriveBy = dir.arriveBy || 'none';
      if (VALID_ARRIVE_BY.indexOf(arriveBy) === -1) {
        errors.push('shot ' + i + ' player ' + slot + ': arriveBy "' + arriveBy + '" is not recognized');
      }
      var toDir = directiveTo(entry, slot);
      if ((behavior !== 'hold') && !toDir) {
        errors.push('shot ' + i + ' player ' + slot + ': has no valid `to` position');
        return;
      }
      if (toDir) {
        if (typeof toDir.x !== 'number' || typeof toDir.z !== 'number' || !isFinite(toDir.x) || !isFinite(toDir.z)) {
          errors.push('shot ' + i + ' player ' + slot + ': has no valid `to` position');
          return;
        }
        if (!ownSide(slot, toDir)) {
          errors.push('shot ' + i + ' player ' + slot + ': target is on the wrong side of the net');
        }
        var dirMargin = 2.5;
        if (Math.abs(toDir.x) > COURT.HALF_W + dirMargin || Math.abs(toDir.z) > COURT.HALF_L + dirMargin) {
          errors.push(
            'shot ' + i + ' player ' + slot + ': target (' +
            toDir.x.toFixed(2) + ',' + toDir.z.toFixed(2) + ') is unreasonably far outside the court'
          );
        }
      }
    });

    var moves = entry.moves || [];
    var movedPlayers = {};
    for (var mi = 0; mi < moves.length; mi++) {
      var mv = moves[mi];
      if (!activeSet[mv.player]) {
        errors.push('shot ' + i + ' move ' + mi + ': player ' + mv.player + ' is not in this drill\'s roster');
        continue;
      }
      if (movedPlayers[mv.player]) {
        errors.push('shot ' + i + ' move ' + mi + ': player ' + mv.player + ' already has a move cue on this shot');
      }
      if (directivePlayers[mv.player]) {
        errors.push('shot ' + i + ' move ' + mi + ': player ' + mv.player + ' also has a v2 players directive on this shot');
      }
      movedPlayers[mv.player] = true;
      var to = normalizeMoveTo(mv.to);
      if (!to || typeof to.x !== 'number' || typeof to.z !== 'number' || !isFinite(to.x) || !isFinite(to.z)) {
        errors.push('shot ' + i + ' move ' + mi + ': player ' + mv.player + ' has no valid `to` position');
        continue;
      }
      if (!ownSide(mv.player, to)) {
        errors.push('shot ' + i + ' move ' + mi + ': player ' + mv.player + ' target is on the wrong side of the net');
      }
      var margin = 2.5;
      if (Math.abs(to.x) > COURT.HALF_W + margin || Math.abs(to.z) > COURT.HALF_L + margin) {
        errors.push(
          'shot ' + i + ' move ' + mi + ': player ' + mv.player + ' target (' +
          to.x.toFixed(2) + ',' + to.z.toFixed(2) + ') is unreasonably far outside the court'
        );
      }
    }
  }
  return errors;
}

var _drills = null;

// Played out as real live simulated gameplay (see src/drillDirector.js)
// rather than scripted/animated. `startPositions` and `script` are the only
// fields the engine reads: `startPositions` places all 4 players before the
// rep begins, `script` is the ordered {hitter, shotType, target, moves?} shot
// sequence the director follows (script[0] is the opener; script[1+] are
// forced responses). "The drill is the drill" — the rep ends EXACTLY when
// `script` runs out (game.js's _drillMaxShots() is always script.length; no
// undirected free-play tail beyond it), so a script's own length is the only
// thing that controls how many hits a rep plays before it loops. `steps` is
// pure on-screen narration for the Steps
// modal, describing what the drill's own AI/physics naturally produce — not
// a script the engine follows. `shotType` is any of Shots.TYPES
// ('drive'|'drop'|'dink'|'lob'|'speedup') plus the state-triggered
// 'smash'/'supersmash'/'popup'. `popup` forces a smash-height sitter
// (see shots.js) regardless of contact quality — use it to script the
// consequence of a drip/drive at someone's feet before a following
// 'smash'/'supersmash' beat attacks it. `supersmash` fires the real blast/
// knockback spectacle (drillDirector.js arms it through the same
// _executeSuper path live play uses, targeting exactly the beat's named
// `target`). `target` is always a
// player slot (P1-P4) on the OPPOSING team from `hitter`; see validateDrill
// above for the authoring constraints that come with that. `moves` (optional)
// is a list of {player, to} movement cues that arm the instant this beat's
// shot fires — `player` can be ANY active slot (hitter or not), `to` is a
// grid coord or {x,z}; see drillDirector.js's armMovesForBeat. Cues are
// fire-and-forget: they steer real per-frame AI movement (never faked/
// interpolated position) toward `to` until the player arrives or ball
// responsibility overrides them, and never gate the script's advance.
export var DEFAULT_DRILLS = [
  {
    id: 'drill-drip',
    name: 'Drip Practice',
    players: 4,
    desc: "P1 simulates a short return and can't quite reach the kitchen line before P3 attacks their feet with a drip down the line.",
    goal: "Train the 3rd-shot drip under pressure: P3 must get there before P1 recovers to the kitchen line and finish at P1's feet, while P2/P4 learn the matching shadow positions.",
    tags: ['3rd shot drip', 'down the line', 'NVZ', 'reset', 'poaching'],
    // P1 and P3 share a column so the down-the-line shot actually travels in
    // a straight line between them both directions. This didn't use to be
    // possible — P3 used to need P4's role instead, because the engine's
    // x-zone contact-assignment could hand a shot aimed at P1 to P1's
    // partner instead. Fixed at the source: game.js's _checkContacts/
    // _moveCPU now override that zone check whenever a drillForcedShot is
    // armed, so a scripted target always receives it regardless of which
    // zone their position sits in. Any x/z on your own side of the net now
    // works for any target.
    startPositions: { P1: 'F10', P2: 'D7', P3: 'F1', P4: 'C2' },
    // P2/P4 carry explicit `moves` cues matching their own `steps` narration
    // below — off-ball movement in drill mode no longer comes from default
    // AI drift (see game.js's _moveCPU: a non-forced player holds position
    // unless cued), so shadowing has to be authored, not assumed.
    script: [
      { hitter: 'P1', shotType: 'drive', target: 'P3', // "return directly down the line"
        moves: [{ player: 'P4', to: 'F3' }] }, // P4 moves in alongside P3, ready to crash
      // Open question flagged for confirmation: described as "a drive that
      // lands at P1's feet" — real `drive` (shots.js) is the flat, fast,
      // driven family; a soft neutralizing drip is closer to `drop`'s
      // profile. Using `drop` here (matches the original neutralize-the-
      // point intent) but this is a guess, not a third assumption to build
      // on silently — confirm or correct.
      { hitter: 'P3', shotType: 'drop', target: 'P1',
        moves: [{ player: 'P2', to: 'E7' }] } // P2 shades toward the middle, staying in the lane
    ],
    steps: [
      { title: 'Setup', desc: "P1 is at the baseline about to hit a short return — simulating shot 2 of a rally that came up just short of the kitchen line. P2 shades the middle, ready to poach but respecting P1's down-the-line lane. P3 and P4 start at the baseline, P3 directly across from P1." },
      { title: 'P1 Returns Down the Line', desc: "P1 hits shot 2 — a return down the line to P3 — then starts moving forward toward the kitchen line. Because the return was short, P1 won't quite get there in time." },
      { title: "P3 Drips at P1's Feet", desc: "P3 reads the short return and attacks it — shot 3, a drip down the line at P1's feet — trying to arrive before P1 reaches the kitchen line. P4 moves in alongside P3, ready to crash if the ball pops up." },
      { title: 'Rep Ends — Review the Shape', desc: "The rep stops after P3's drip lands. Watch whether P4 crashes behind the attack and P2 shades middle without overcommitting. The replay loops so the down-the-line shape can be reviewed." }
    ]
  },
  {
    id: 'drill-dink-rally',
    name: 'Cross-Court Dink Rally',
    players: 4,
    desc: 'P1 and P3 hold a cross-court diagonal dinking exchange at the kitchen line; P2 and P4 shadow the rally without touching the ball.',
    goal: "Train cross-court dinking angles and off-ball court awareness — the two players not in the exchange should still be reading it and repositioning, not standing still.",
    tags: ['dinking', 'cross-court', 'NVZ', 'soft game', 'shadowing'],
    // P1/P3 on opposite x makes this a true diagonal, not a shared column.
    startPositions: { P1: 'F7', P2: 'C7', P3: 'C4', P4: 'F4' },
    // Alternates P1<->P3 for 5 real touches (matches the "runs 5 touches"
    // narration below, which used to be stale against a 1-entry script from
    // before the maxShots-driven free-play tail was removed). P2/P4 (the
    // off-ball pair) don't need moves cues to track the ball toward whoever
    // is currently responsible — strategies/doubles.js's chooseMovement
    // already does that for free — so the moves cues here are deliberately
    // for the OTHER half of "shadowing": a visible, choreographed in/out
    // sway toward the middle T and back out to the alley, synced to which
    // side is live, on top of the AI's own default lane-shading.
    script: [
      { hitter: 'P1', shotType: 'dink', target: 'P3' },
      { hitter: 'P3', shotType: 'dink', target: 'P1', moves: [{ player: 'P2', to: 'D7' }, { player: 'P4', to: 'E4' }] },
      { hitter: 'P1', shotType: 'dink', target: 'P3', moves: [{ player: 'P2', to: 'C7' }, { player: 'P4', to: 'F4' }] },
      { hitter: 'P3', shotType: 'dink', target: 'P1', moves: [{ player: 'P2', to: 'D7' }, { player: 'P4', to: 'E4' }] },
      { hitter: 'P1', shotType: 'dink', target: 'P3', moves: [{ player: 'P2', to: 'C7' }, { player: 'P4', to: 'F4' }] }
    ],
    steps: [
      { title: 'Setup', desc: "All four players are at the kitchen line. P1 and P3 are diagonally cross-court from each other — the live dinking lane. P2 and P4 hold the other diagonal, shadowing the rally." },
      { title: 'Rally Opens', desc: "P1 dinks cross-court to P3 — the exchange is already live, no setup shot needed to get it started." },
      { title: 'Cross-Court Dinks + Shadowing', desc: "P1 and P3 trade soft dinks on the diagonal. P2 and P4 aren't touching the ball, but they shift and follow the rally, moving to wherever they'd need to be if it came to their side." },
      { title: 'Rep Ends — Loops', desc: "The rep runs 5 touches, then stops and loops back to Setup as a replay you can pause, rewind, and rewatch. In person: rotate who's on the live diagonal each rep." }
    ]
  },
  // Minimal drills for testing variable roster sizes (2 and 3 players) —
  // not meant as real content, tagged 'test' so they're identifiable.
  {
    id: 'drill-1v1-test',
    name: '1v1 Quick Test',
    players: 2,
    desc: 'Minimal 2-player rally (P1 vs P3, no partners) for testing variable roster sizes.',
    goal: 'Verify a solo-vs-solo drill roster plays correctly.',
    tags: ['test'],
    startPositions: { P1: 'F10', P3: 'F1' },
    script: [
      { hitter: 'P1', shotType: 'drive', target: 'P3' }
    ],
    steps: [
      { title: 'Setup', desc: 'P1 and P3 only — no partners on either side.' },
      { title: 'Rally', desc: 'P1 drives to P3 and the rep ends there — a single scripted touch.' }
    ]
  },
  {
    id: 'drill-2v1-test',
    name: '2v1 Quick Test',
    players: 3,
    desc: 'Minimal 3-player rally (P1+P2 vs P3, far side has no partner) for testing variable roster sizes.',
    goal: 'Verify an uneven 2-vs-1 drill roster plays correctly.',
    tags: ['test'],
    startPositions: { P1: 'F10', P2: 'D7', P3: 'F1' },
    script: [
      { hitter: 'P1', shotType: 'drive', target: 'P3' }
    ],
    steps: [
      { title: 'Setup', desc: 'P1 and P2 (near) vs P3 alone (far).' },
      { title: 'Rally', desc: 'P1 drives to P3 and the rep ends there — a single scripted touch.' }
    ]
  }
];

// Normalize grid coords to world coords at module load time.
for (var _i = 0; _i < DEFAULT_DRILLS.length; _i++) {
  DEFAULT_DRILLS[_i] = normalizeDrill(DEFAULT_DRILLS[_i]);
}

// Fetches the live table via /api/drills. Any failure — network error,
// non-2xx, a non-JSON response (e.g. plain `vite`-only dev with no
// server.dev.js/proxy running, which 404s with an HTML body, not JSON) —
// falls back to the bundled DEFAULT_DRILLS, so the app keeps working with no
// database at all. Caches the result in `_drills` so subsequent calls (and
// getDrillById) reflect the live list without refetching.
export function loadDrills() {
  if (_drills) return Promise.resolve(_drills.slice());
  return fetch('/api/drills')
    .then(function (res) {
      var ct = res.headers.get('content-type') || '';
      if (!res.ok || ct.indexOf('application/json') === -1) return null;
      return res.json();
    })
    .then(function (body) {
      if (!body || !Array.isArray(body.drills)) return DEFAULT_DRILLS.slice();
      _drills = body.drills.map(normalizeDrill);
      return _drills.slice();
    })
    .catch(function () {
      return DEFAULT_DRILLS.slice();
    });
}

export function getDrillById(id) {
  var drills = _drills || DEFAULT_DRILLS;
  for (var i = 0; i < drills.length; i++) {
    if (drills[i].id === id) return drills[i];
  }
  return null;
}

function cacheUpsert(drill) {
  var list = (_drills || DEFAULT_DRILLS).slice();
  var idx = list.findIndex(function (d) { return d.id === drill.id; });
  if (idx === -1) list.push(drill); else list[idx] = drill;
  _drills = list;
}

function cacheRemove(id) {
  _drills = (_drills || DEFAULT_DRILLS).filter(function (d) { return d.id !== id; });
}

// createDrill/updateDrill/deleteDrill are the save-path counterparts to
// loadDrills(), used by both the in-app manage UI and tools/drill-builder.
// Client-side validateDrill runs first so obviously-invalid input never
// makes a network round trip; the server (api/drills.js) re-validates the
// same way as the real backstop, since a client can always be bypassed.
export function createDrill(drill) {
  var normalized = normalizeDrill(drill);
  var errors = validateDrill(normalized);
  if (errors.length) return Promise.resolve({ ok: false, errors: errors });
  return fetch('/api/drills', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(normalized)
  }).then(function (res) {
    return res.json().catch(function () { return {}; }).then(function (body) {
      if (!res.ok) return { ok: false, errors: body.errors || [body.error || 'save failed'] };
      cacheUpsert(body);
      return { ok: true, drill: body };
    });
  }).catch(function () {
    return { ok: false, errors: ['network error — could not reach the server'] };
  });
}

export function updateDrill(drill) {
  var normalized = normalizeDrill(drill);
  var errors = validateDrill(normalized);
  if (errors.length) return Promise.resolve({ ok: false, errors: errors });
  return fetch('/api/drills?id=' + encodeURIComponent(normalized.id), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(normalized)
  }).then(function (res) {
    return res.json().catch(function () { return {}; }).then(function (body) {
      if (!res.ok) return { ok: false, errors: body.errors || [body.error || 'save failed'] };
      cacheUpsert(body);
      return { ok: true, drill: body };
    });
  }).catch(function () {
    return { ok: false, errors: ['network error — could not reach the server'] };
  });
}

export function deleteDrill(id) {
  return fetch('/api/drills?id=' + encodeURIComponent(id), { method: 'DELETE' })
    .then(function (res) {
      if (!res.ok) return { ok: false, errors: ['delete failed'] };
      cacheRemove(id);
      return { ok: true };
    })
    .catch(function () {
      return { ok: false, errors: ['network error — could not reach the server'] };
    });
}
