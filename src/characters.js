/* ============================================================================
 * characters.js — Shared character catalog (pure data, no three/DOM imports).
 *
 * Single source of truth for the selectable roster: each of the 4 slots
 * (nearYou/nearMate/farA/farB) independently picks one of the authored
 * Mixamo characters. Team identity (paddle color, "you" ring color) stays
 * keyed by SLOT, not by character, so two slots can pick the same character
 * without losing their distinct team colors, and switching a slot's
 * character doesn't change its team color.
 * ==========================================================================*/
'use strict';

// The shippable Mixamo characters. `label` is the character's display name
// (AJ is the established name for ch01). `swatch` is a purely decorative
// per-tile accent color for the picker grid (no gameplay meaning).
export const CHARACTERS = [
  { id: 'ch01', playerModelKey: 'player-ch01-v1', label: 'AJ', swatch: 0xff6b6b },
  { id: 'ch03', playerModelKey: 'player-ch03-v1', label: 'Leo', swatch: 0xffd43b },
  { id: 'ch04', playerModelKey: 'player-ch04-v1', label: 'Milo', swatch: 0x94d82d },
  { id: 'ch06', playerModelKey: 'player-ch06-v1', label: 'Nina', swatch: 0x12b886 },
  { id: 'ch07', playerModelKey: 'player-ch07-v1', label: 'Theo', swatch: 0x22b8cf },
  { id: 'ch08', playerModelKey: 'player-ch08-v1', label: 'Owen', swatch: 0x4dabf7 },
  { id: 'ch09', playerModelKey: 'player-ch09-v1', label: 'Max', swatch: 0x5c7cfa },
  { id: 'ch10', playerModelKey: 'player-ch10-v1', label: 'Ivy', swatch: 0x9775fa },
  { id: 'ch11', playerModelKey: 'player-ch11-v1', label: 'Wren', swatch: 0xda77f2 },
  { id: 'ch12', playerModelKey: 'player-ch12-v1', label: 'Beau', swatch: 0xf06595 },
  { id: 'ch14', playerModelKey: 'player-ch14-v1', label: 'Piper', swatch: 0xe8590c },
  { id: 'ch15', playerModelKey: 'player-ch15-v1', label: 'Skye', swatch: 0x20c997 }
];

export function getCharacter(id) {
  for (var i = 0; i < CHARACTERS.length; i++) {
    if (CHARACTERS[i].id === id) return CHARACTERS[i];
  }
  return null;
}

// Distinct-by-default per position, so a match can start without ever
// opening the picker.
export const DEFAULT_ROSTER = {
  nearYou: 'ch01', nearMate: 'ch06', farA: 'ch03', farB: 'ch04'
};

// Team/role identity stays keyed by SLOT (reproduces the old SLOT_DEFAULTS
// paddle/ring hex values exactly, so switching a slot's character doesn't
// shift its existing team color).
var SLOT_TEAM_COLORS = {
  nearYou:  { label: 'Player 1',    paddle: 0x2bd4ff, ring: 0xff7a1f },
  nearMate: { label: 'Partner',     paddle: 0xffa53c, ring: 0x21bdb0 },
  farA:     { label: 'Opponent A',  paddle: 0x36d399, ring: 0xf14668 },
  farB:     { label: 'Opponent B',  paddle: 0xc8ff65, ring: 0xff7aa8 }
};

// Resolves a slot + a chosen character id into the object makePlayer()/
// game.js expect: .jersey (ring color, only read for nearYou today),
// .paddle (primitive paddle color), .playerModelKey (asset loading). Falls
// back to the slot's default character if the id doesn't resolve.
export function resolveSlotCharacter(position, characterId) {
  var colors = SLOT_TEAM_COLORS[position] || SLOT_TEAM_COLORS.nearYou;
  var id = getCharacter(characterId) ? characterId : (DEFAULT_ROSTER[position] || DEFAULT_ROSTER.nearYou);
  var character = getCharacter(id) || getCharacter(DEFAULT_ROSTER.nearYou);
  return {
    id: id,
    label: character.label,
    playerModelKey: character.playerModelKey,
    jersey: colors.ring,
    paddle: colors.paddle,
    key: position + ':' + id
  };
}
