/* ============================================================================
 * utils.js — tiny shared math helpers (no deps).
 * ==========================================================================*/
'use strict';

export function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }
export function dist2D(dx, dy) { return Math.sqrt(dx * dx + dy * dy); }
export function lerp(a, b, t) { return a + (b - a) * t; }
