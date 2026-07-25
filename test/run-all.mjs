// Runs every test/*.test.mjs file. Each file is a self-contained ES module
// that executes its own tests as an import side effect and prints its own
// "ok"/summary lines (see helpers.mjs's makeRunner) — importing them here
// just sequences that, so `node test/run-all.mjs` reports everything in one
// run. Any file's assertion failure sets process.exitCode = 1, which
// naturally propagates regardless of which file it came from.
import './logic.test.mjs';
import './drill.test.mjs';
