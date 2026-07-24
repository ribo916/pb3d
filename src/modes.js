'use strict';

export function normalizeMode(mode) {
  if (mode === 'singles' || mode === 'practice' || mode === 'drill') return mode;
  return 'doubles';
}
