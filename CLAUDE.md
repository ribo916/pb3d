# CLAUDE.md — Pickleball 3D (Claude Code)

> **Primary context is in [`AGENTS.md`](AGENTS.md) — read it before starting any task.**
> It covers: what this is, tech stack, commands, directory structure, architecture,
> the gameplay contract, conventions, music asset workflow, how to extend (venues, graphics,
> singles), and testing. Both Claude Code and OpenAI Codex use that file.
>
> **Gameplay mechanics, tuning constants, shot system, AI, and specialty shots →
> [`GAMEPLAY.md`](GAMEPLAY.md).** Read before touching any gameplay code.
>
> **Graphics architecture, asset pipeline, player-model status, and visual
> verification → [`GRAPHICS.md`](GRAPHICS.md).** Read before touching rendering,
> venues, authored assets, player models, effects, or HUD layout.

---

## Claude-specific notes

### Screenshot loop
After **any** visual/scene change, run `node tools/shoot.mjs` and **look at the
PNGs** in `tools/shots/` before reporting the task done. Most of this was built
without a live render loop — do not trust visual changes by reading code alone.
Use `HEADED=1 node tools/shoot.mjs` if headless WebGL renders black.

For graphics-overhaul context, use `GRAPHICS.md` instead of the retired roadmap.
The current generated player POC is a technical adapter proof, not final
photoreal or premium character art.

### Watching a full match (gameplay feel)
To eyeball whether gameplay adheres to the goals, run `node tools/play.mjs` — it
opens a headed window and plays a full **AI-vs-AI** match (all four players
AI-driven), fast-forwarding the sim while the render loop keeps drawing, and streams
score/state transitions to the terminal. Tune with env vars: `SPEED` (sim
multiplier, default 4), `VENUE` (park|tropical|indoor), `PALETTE` (blue|green),
`TOD` (day|night), `DIFF`, `MATCHES`, `MAXSEC`. `SPEED` multiplies *simulated* time
(fixed 1/60 steps), so behavior matches 1x — drop to `SPEED=1` to confirm anything
suspicious isn't a fast-forward artifact. It exercises the AI only, not human input
(aim/poach/swing timing still need manual play).

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
