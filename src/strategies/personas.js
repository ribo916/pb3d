/* ============================================================================
 * personas.js — Opponent play-style personas layered over a difficulty config.
 * Pure logic (no three/DOM) so it stays node-testable.
 *
 * A difficulty config (ai.js LEVELS) carries the mechanical + skill traits:
 *   speed, react, reactJitter, err, miss, shotIQ, aggression
 * A persona is a set of deltas/multipliers + named decision biases merged over
 * that base. `balanced` is the identity persona: it reproduces the baseline
 * feel, so an all-`balanced` roster behaves like the pre-persona AI.
 *
 * Trait axes (the split of the old overloaded `smart` scalar):
 *   shotIQ     — quality of shot SELECTION (drop-when-right, dink discipline,
 *                kitchen advance, poach, specialty unlock).
 *   aggression — risk appetite (power vs touch), INDEPENDENT of shotIQ.
 * Personas differentiate by pushing aggression away from shotIQ; the strategies
 * read the gap (`aggression - shotIQ`) so balanced (gap 0) stays neutral.
 * ==========================================================================*/
'use strict';

// Ball height (m) at/above which the AI will consider an overhead attack.
// Styles nudge this: bangers swat lower balls, defensive players wait for clear ones.
export const DEFAULT_SMASH_MIN = 1.3;

// Three play styles (typical of sports games): BALANCED, BANGER, DEFENSIVE.
// Named decision biases default to 1 (neutral); smashMin defaults above.
export const PERSONAS = {
  // Identity — reproduces the baseline AI. Do not add deltas here.
  balanced: {},

  // Aggressive attacker / risk-taker: high risk, slightly lower shot IQ. Drives
  // the 3rd, speeds up in the kitchen, rarely lobs.
  banger: {
    dAggr: +0.20, dShotIQ: -0.05, errMul: 1.15,
    speedupBias: 1.35, dropBias: 0.55, dinkBias: 0.8, lobBias: 0.3, smashMin: 1.2,
    superBias: 1.5
  },

  // Defensive counter-puncher: patient and steady, low risk. Drops/dinks/resets,
  // lobs situationally, gets balls back and waits for the opponent to miss.
  defensive: {
    dAggr: -0.20, dShotIQ: +0.05, speedMul: 1.05, errMul: 0.9, missMul: 0.85,
    speedupBias: 0.7, dropBias: 1.35, dinkBias: 1.25, lobBias: 1.45, smashMin: 1.45,
    superBias: 0.6
  }
};

function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }

// Merge a persona over a base difficulty config into a resolved cfg the
// strategies consume. Keeps `smart` as an alias of shotIQ for any reference
// that has not been migrated. Bias fields are always present (default 1).
export function mergeTraits(base, persona) {
  persona = persona || {};
  var cfg = Object.assign({}, base);
  cfg.aggression = clamp01((base.aggression || 0) + (persona.dAggr || 0));
  cfg.shotIQ = clamp01((base.shotIQ != null ? base.shotIQ : base.smart) + (persona.dShotIQ || 0));
  cfg.speed = (base.speed || 0) * (persona.speedMul || 1);
  cfg.err = (base.err || 0) * (persona.errMul || 1);
  cfg.miss = (base.miss || 0) * (persona.missMul || 1);
  cfg.reactJitter = base.reactJitter || 0;
  cfg.smart = cfg.shotIQ; // migration alias
  cfg.speedupBias = persona.speedupBias || 1;
  cfg.dropBias = persona.dropBias || 1;
  cfg.dinkBias = persona.dinkBias || 1;
  cfg.lobBias = persona.lobBias || 1;
  cfg.smashMin = persona.smashMin || DEFAULT_SMASH_MIN;
  cfg.superBias = persona.superBias || 1;   // how eagerly this style unloads a full meter
  return cfg;
}

// Legacy names (allcourt/grinder/retriever) fold onto the current 3 styles so
// old saved/passed values stay safe.
export function normalizePersona(name) {
  if (PERSONAS[name]) return name;
  if (name === 'grinder' || name === 'retriever') return 'defensive';
  return 'balanced';
}

// Player-facing presentation for each style: a short tag, a one-line tendency
// blurb, and an accent color for the UI (picker tag, VS splash). Colors are
// deep enough that the bold white tag text stays legible on any background/theme.
export const PERSONA_META = {
  balanced:  { tag: 'BALANCED',  blurb: 'Balanced — no glaring weakness; adapts to the rally.', color: '#2563eb' },
  banger:    { tag: 'BANGER',    blurb: 'Aggressive attacker — drives everything, speeds up, rarely resets.', color: '#dc2626' },
  defensive: { tag: 'DEFENSIVE', blurb: 'Defensive counter-puncher — dinks, drops and lobs; waits for your miss.', color: '#15803d' }
};

// Derive 0..1 display bars from a resolved cfg (difficulty × persona), so the
// bars reflect the actual opponent you'll face, not just the style. Order is
// fixed for stable rendering.
export const STAT_LABELS = ['Power', 'Touch', 'Control', 'Speed'];
export function personaStats(cfg) {
  return {
    Power: clamp01(cfg.aggression),
    Touch: clamp01(cfg.shotIQ),
    Control: clamp01(1 - (cfg.err * 0.9 + cfg.miss * 1.5)),
    Speed: clamp01(((cfg.speed || 5) - 4.0) / 2.2)
  };
}
