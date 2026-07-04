/* ============================================================================
 * characters.js — Shared character catalog (pure data, no three/DOM imports).
 *
 * Single source of truth for the selectable roster: each of the 4 slots
 * (nearYou/nearMate/farA/farB) independently picks a gender (which selects
 * the base GLB), a hairstyle, a hair color, and (male only) an independent
 * facial-hair option layered on top of any hairstyle. Hair options are
 * filtered to each gender's pool — the merged GLBs only carry variant nodes
 * for their own gender's hairstyles. Team colors (jersey/paddle/shoe/skin/
 * etc.) stay keyed by SLOT, not by the gender/hair pick, so switching a
 * slot's look doesn't change its team color.
 * ==========================================================================*/
'use strict';

export const HAIR_COLORS = {
  black: 0x241814,
  darkBrown: 0x4a2b22,
  brown: 0x5b3724,
  blonde: 0xd5bb58,
  auburn: 0x8a4a2b,
  gray: 0xc7c2ba
};

export const GENDERS = {
  male: {
    playerModelKey: 'player-male-v1',
    hairOptions: ['simpleParted', 'buzzed'],
    defaultHair: 'simpleParted',
    facialHairOptions: ['none', 'beard']
  },
  female: {
    playerModelKey: 'player-female-v1',
    hairOptions: ['long', 'buns', 'buzzedFemale'],
    defaultHair: 'long',
    facialHairOptions: ['none']
  }
};

export const SLOT_DEFAULTS = {
  nearYou: {
    label: 'Player 1',
    jersey: 0xff7a1f, shorts: 0x20283c, paddle: 0x2bd4ff, shoe: 0xf6f8ff,
    skin: 0xe4bf9f, height: 'tall', build: 'average',
    headwear: 'headband', headband: 0x2bd4ff,
    gender: 'male', hairStyle: 'simpleParted', hairColor: 'black', facialHair: 'none'
  },
  nearMate: {
    label: 'Partner',
    jersey: 0x21bdb0, shorts: 0x20283c, paddle: 0xffa53c, shoe: 0xf8fbff,
    skin: 0xe8c3ab, height: 'medium', build: 'average',
    headwear: 'none',
    gender: 'female', hairStyle: 'long', hairColor: 'brown', facialHair: 'none'
  },
  farA: {
    label: 'Opponent A',
    jersey: 0xf14668, shorts: 0x30111e, paddle: 0x36d399, shoe: 0xf9fbff,
    skin: 0xf0cbb2, height: 'tower', build: 'slim',
    headwear: 'cap', headband: 0xf4f5f6,
    gender: 'male', hairStyle: 'buzzed', hairColor: 'blonde', facialHair: 'none'
  },
  farB: {
    label: 'Opponent B',
    jersey: 0xff7aa8, shorts: 0x55233a, paddle: 0xc8ff65, shoe: 0xfffbff,
    skin: 0xedc6b0, height: 'medium', build: 'average',
    headwear: 'none', headband: 0xffd166,
    gender: 'female', hairStyle: 'buzzedFemale', hairColor: 'darkBrown', facialHair: 'none'
  }
};

// Merges a slot's stored defaults with a user's {gender, hairStyle,
// hairColor, facialHair} picks into the full cosmetics object makePlayer()
// expects.
export function resolveSlotCharacter(position, picks) {
  var d = SLOT_DEFAULTS[position] || SLOT_DEFAULTS.nearYou;
  var gender = (picks && picks.gender) || d.gender;
  var g = GENDERS[gender] || GENDERS.male;
  var hairStyle = (picks && picks.hairStyle) || d.hairStyle;
  if (g.hairOptions.indexOf(hairStyle) === -1) hairStyle = g.defaultHair;
  var hairColor = (picks && picks.hairColor) || d.hairColor;
  if (!HAIR_COLORS[hairColor]) hairColor = d.hairColor;
  var facialHair = (picks && picks.facialHair) || d.facialHair || 'none';
  if (g.facialHairOptions.indexOf(facialHair) === -1) facialHair = 'none';
  return Object.assign({}, d, {
    gender: gender,
    hairStyle: hairStyle,
    hairColor: hairColor,
    hair: HAIR_COLORS[hairColor],
    facialHair: facialHair,
    playerModelKey: g.playerModelKey,
    key: position + ':' + gender + ':' + hairStyle + ':' + hairColor + ':' + facialHair
  });
}
