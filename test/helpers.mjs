'use strict';

// Tiny shared assertion-runner used by every test/*.test.mjs file — a
// hand-rolled `test(name, fn)` + running pass-count, not a framework,
// consistent with this repo's node:assert-based, no-dependency test style.
// Each test/*.test.mjs file gets its own runner instance (so its own "ok"
// lines and summary print independently when run directly), but they all
// share this exact same implementation instead of copy-pasting it.
export function makeRunner() {
  let passed = 0;
  function test(name, fn) {
    try { fn(); passed++; console.log('  ok  ' + name); }
    catch (e) { console.error('FAIL  ' + name + '\n      ' + e.message); process.exitCode = 1; }
  }
  function report(label) {
    console.log('\n' + passed + (label ? ' ' + label : '') + ' assertions passed.');
    return passed;
  }
  return { test, report };
}
