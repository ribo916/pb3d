/* ============================================================================
 * characters.js — Shared character catalog (pure data, no three/DOM imports).
 *
 * Single source of truth for the selectable roster: menu picker labels and
 * portrait paths plus the per-character cosmetics consumed by makePlayer().
 *
 * Cosmetics (colors, hairStyle, headwear) are keyed by CHARACTER, not by
 * slot: each authored GLB only has hair/headwear variant nodes for the
 * look it shipped with, so a slot's opts must travel with whichever
 * character the picker assigns there, or a swapped-in character can end
 * up hairless/mismatched (e.g. forcing hairStyle:'short' onto a model
 * that only has a 'long' hair node hides its hair entirely).
 * ==========================================================================*/
'use strict';

export const CHARACTERS = {
  'player-human-v1': {
    key: 'player-human-v1',
    label: 'Player 1',
    portrait: '/assets/images/characters/player-human-v1.png',
    jersey: 0xff7a1f, shorts: 0x20283c, paddle: 0x2bd4ff, shoe: 0xf6f8ff,
    skin: 0xe4bf9f, hair: 0x241814, height: 'tall', build: 'average',
    hairStyle: 'short', headwear: 'headband', headband: 0x2bd4ff,
    playerModelKey: 'player-human-v1'
  },
  'player-partner-v1': {
    key: 'player-partner-v1',
    label: 'Partner',
    portrait: '/assets/images/characters/player-partner-v1.png',
    jersey: 0x21bdb0, shorts: 0x20283c, paddle: 0xffa53c, shoe: 0xf8fbff,
    skin: 0xe8c3ab, hair: 0x5b3724, height: 'medium', build: 'average',
    hairStyle: 'long', headwear: 'none', playerModelKey: 'player-partner-v1'
  },
  'player-opponent-a-v1': {
    key: 'player-opponent-a-v1',
    label: 'Opponent A',
    portrait: '/assets/images/characters/player-opponent-a-v1.png',
    jersey: 0xf14668, shorts: 0x30111e, paddle: 0x36d399, shoe: 0xf9fbff,
    skin: 0xf0cbb2, hair: 0xd5bb58, height: 'tower', build: 'slim',
    hairStyle: 'short', headwear: 'cap', headband: 0xf4f5f6,
    playerModelKey: 'player-opponent-a-v1'
  },
  'player-opponent-b-v1': {
    key: 'player-opponent-b-v1',
    label: 'Opponent B',
    portrait: '/assets/images/characters/player-opponent-b-v1.png',
    jersey: 0xff7aa8, shorts: 0x55233a, paddle: 0xc8ff65, shoe: 0xfffbff,
    skin: 0xedc6b0, hair: 0x4a2b22, height: 'medium', build: 'average',
    hairStyle: 'ponytail', headwear: 'none', headband: 0xffd166,
    playerModelKey: 'player-opponent-b-v1'
  }
};

export const CHARACTER_LIST = Object.keys(CHARACTERS).map(function (key) {
  return CHARACTERS[key];
});

export const DEFAULT_ROSTER = {
  nearYou: 'player-human-v1',
  nearMate: 'player-partner-v1',
  farA: 'player-opponent-a-v1',
  farB: 'player-opponent-b-v1'
};

export function characterByKey(key) {
  return CHARACTERS[key] || CHARACTERS[DEFAULT_ROSTER.nearYou];
}
