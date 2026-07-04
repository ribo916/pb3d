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

// Shared shirt/pants palette. The authored player GLBs bake their jersey and
// shorts regions as neutral desaturated fabric (see
// tools/paint-player-clothing.mjs), so any of these tint cleanly via the
// existing jersey/shorts material-slot system in players.js — the same one
// the primitive rig already used, just newly reachable on the authored body.
// The four `identity*` entries reproduce each roster slot's original fixed
// hex exactly, so existing per-position looks don't shift by default.
export const GARMENT_COLORS = {
  black: 0x1c1e22,
  charcoal: 0x3a3d44,
  navy: 0x20283c,
  skyBlue: 0x6fb3e0,
  white: 0xf0f0f0,
  brown: 0x5b3a24,
  forestGreen: 0x1f4d3a,
  identityOrange: 0xff7a1f,
  identityTeal: 0x21bdb0,
  identityCrimson: 0xf14668,
  identityPink: 0xff7aa8,
  identityPlum: 0x30111e,
  identityBerry: 0x55233a
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

// Height is a continuous scale multiplier (a slider in the character
// modal). The original short/medium/tall/tower presets (0.96/1.0/1.14/1.22)
// were tuned against the primitive rig and never actually reached the
// authored model (applyAuthoredIdentity didn't apply height at all — see
// PLAYER-IMPORT.md), so nobody had seen them rendered on realistic human
// proportions until the gap was fixed. On a realistic body a given percent
// difference reads far more dramatically than on the primitive rig's
// stylized blob proportions — 0.85-1.3 looked like "midgets and giants," not
// plausible human height variation. Narrowed to a subtler range.
export const HEIGHT_SCALE_MIN = 0.97;
export const HEIGHT_SCALE_MAX = 1.08;

export const SLOT_DEFAULTS = {
  nearYou: {
    label: 'Player 1',
    shirtColor: 'identityOrange', pantsColor: 'navy', paddle: 0x2bd4ff, shoe: 0xf6f8ff,
    skin: 0xe4bf9f, heightScale: 1.06, build: 'average',
    headwear: 'headband', headband: 0x2bd4ff,
    gender: 'male', hairStyle: 'simpleParted', hairColor: 'black', facialHair: 'none'
  },
  nearMate: {
    label: 'Partner',
    shirtColor: 'identityTeal', pantsColor: 'navy', paddle: 0xffa53c, shoe: 0xf8fbff,
    skin: 0xe8c3ab, heightScale: 1.0, build: 'average',
    headwear: 'none',
    gender: 'female', hairStyle: 'long', hairColor: 'brown', facialHair: 'none'
  },
  farA: {
    label: 'Opponent A',
    shirtColor: 'identityCrimson', pantsColor: 'identityPlum', paddle: 0x36d399, shoe: 0xf9fbff,
    skin: 0xf0cbb2, heightScale: 1.08, build: 'slim',
    headwear: 'cap', headband: 0xf4f5f6,
    gender: 'male', hairStyle: 'buzzed', hairColor: 'blonde', facialHair: 'none'
  },
  farB: {
    label: 'Opponent B',
    shirtColor: 'identityPink', pantsColor: 'identityBerry', paddle: 0xc8ff65, shoe: 0xfffbff,
    skin: 0xedc6b0, heightScale: 1.0, build: 'average',
    headwear: 'none', headband: 0xffd166,
    gender: 'female', hairStyle: 'buzzedFemale', hairColor: 'darkBrown', facialHair: 'none'
  }
};

// Merges a slot's stored defaults with a user's {gender, hairStyle,
// hairColor, facialHair, shirtColor, pantsColor} picks into the full
// cosmetics object makePlayer() expects.
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
  // 'none' is a valid pick (deliberately not a key in GARMENT_COLORS) —
  // it means "don't paint this region a garment color," which falls back to
  // the character's own skin tone so the jersey/shorts primitive reads as
  // bare skin rather than a flat untinted gray fabric.
  var shirtColor = (picks && picks.shirtColor) || d.shirtColor;
  if (shirtColor !== 'none' && !GARMENT_COLORS[shirtColor]) shirtColor = d.shirtColor;
  var pantsColor = (picks && picks.pantsColor) || d.pantsColor;
  if (pantsColor !== 'none' && !GARMENT_COLORS[pantsColor]) pantsColor = d.pantsColor;
  var heightScale = picks && typeof picks.heightScale === 'number' && !isNaN(picks.heightScale)
    ? picks.heightScale : d.heightScale;
  heightScale = Math.max(HEIGHT_SCALE_MIN, Math.min(HEIGHT_SCALE_MAX, heightScale));
  return Object.assign({}, d, {
    gender: gender,
    hairStyle: hairStyle,
    hairColor: hairColor,
    hair: HAIR_COLORS[hairColor],
    facialHair: facialHair,
    shirtColor: shirtColor,
    pantsColor: pantsColor,
    jersey: shirtColor === 'none' ? d.skin : GARMENT_COLORS[shirtColor],
    shorts: pantsColor === 'none' ? d.skin : GARMENT_COLORS[pantsColor],
    heightScale: heightScale,
    playerModelKey: g.playerModelKey,
    key: position + ':' + gender + ':' + hairStyle + ':' + hairColor + ':' + facialHair + ':' +
      shirtColor + ':' + pantsColor + ':' + heightScale.toFixed(2)
  });
}
