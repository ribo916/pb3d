# CLAUDE.md — Pickleball 3D (Claude Code)

> **Primary context is in [`AGENTS.md`](AGENTS.md) — read it before starting any task.**
> It covers: what this is, tech stack, commands, directory structure, architecture,
> the gameplay contract, conventions, music asset workflow, how to extend (venues, skinning,
> singles), and testing. Both Claude Code and OpenAI Codex use that file.

---

## Claude-specific notes

### Screenshot loop
After **any** visual/scene change, run `node tools/shoot.mjs` and **look at the
PNGs** in `tools/shots/` before reporting the task done. Most of this was built
without a live render loop — do not trust visual changes by reading code alone.
Use `HEADED=1 node tools/shoot.mjs` if headless WebGL renders black.

### The two tuning surfaces — keep them sacred
- **`src/constants.js`** — court geometry + physics/camera/hit tuning.
- **`src/shots.js`** — the shot model (apex/depth/spin/margin per shot type).

All gameplay numbers live in these two files. If you find yourself typing a
physics or shot constant into `game.js`, `ai.js`, or anywhere else, stop and put it
in the right place. The single most important feel is **swing + ball contact** —
change those numbers deliberately and re-test.

### Keep the pure modules pure
`constants`, `physics`, `shots`, `rules`, `ai`, `utils` must not import `three` or
touch `document`/`window`. `node test/logic.test.mjs` depends on that. New
pure-logic code goes in the same pattern so it stays node-testable.

### Don't regress the net solver
`physics.clearsNet()` deliberately simulates gravity + drag + Magnus (not a
drag-free parabola), and `game._executeHit()` snaps the ball to the contact point.
Both prevent "balls into the net." Don't simplify either.

### Music assets
Music is already implemented. To add or replace selectable tracks, drop supported
audio files into `music/active/<genre>/` and run `npm run music:sync`. The catalog
is generated into `music/catalog.js`; do not hand-edit that file unless you are
deliberately bypassing the sync flow.
The title screen also exposes a `Music Start` choice that controls whether the next
match begins muted or with music already playing.
