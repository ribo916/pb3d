'use strict';

export function normalizeMode(mode) {
  if (mode === 'singles' || mode === 'practice') return mode;
  return 'doubles';
}
