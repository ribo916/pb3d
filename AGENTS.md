# Pickleball 3D — AI Agent Context

> This is the primary context file for AI coding agents. Both **Claude Code** and
> **OpenAI Codex** read this file. See `CLAUDE.md` for Claude-specific additions.
> Read this before starting any task.
>
> **Gameplay mechanics, tuning surfaces, and system design →
> [`GAMEPLAY.md`](GAMEPLAY.md).** Read it before touching any gameplay code.

---

## What This Is

A standalone **Three.js doubles pickleball game**. You (`players[0]`) + a CPU
partner take on two CPUs. Real rules (diagonal serve, two-bounce rule, non-volley
"kitchen", side-out scoring to 11 win-by-2), arcade-tuned physics, three
difficulties, desktop + mobile controls.

The gameplay was ported from a larger project's 3D match and is now fully
self-contained: **real track-based music, no character skinning, no 2D overworld,
no save system** — pure gameplay plus audio. Those are intentional extension points (see
[Extending the game](#extending-the-game)).

**The single most important quality bar is swing + ball-contact feel** — it should
read like polished arcade tennis (Wii Sports / Mario Tennis energy). Treat the
tuning constants as load-bearing; don't "improve" the numbers casually.

---

## Tech Stack

- **No build step, no bundler.** Modern Three.js (r160) is loaded via an
  `<script type="importmap">` from a CDN; everything else is hand-written ES
  modules (`import`/`export`).
- **Runs over HTTP** (ES modules don't load from `file://`): `npx serve .`.
- **ES modules**, `'use strict'`, mostly ES5-style code inside (ported verbatim
  to preserve tuned behavior) — don't refactor style for its own sake.
- **Pure-logic modules have no Three.js / DOM dependency** and run in plain Node
  for tests: `constants`, `physics`, `shots`, `rules`, `ai`, `utils`.

---

## Commands

```bash
# Run the game (any static server works)
npx serve .                 # then open the printed localhost URL
python3 -m http.server      # alternative

# Tests
node test/logic.test.mjs    # pure-logic assertions (no Three.js needed)
node tools/shoot.mjs        # headless render smoke test (needs playwright); writes tools/shots/*.png
node tools/play.mjs         # headed AI-vs-AI full match you can watch live (needs playwright)
npm run music:sync          # rescan music/active/* and rebuild music/catalog.js
npm run music:generate      # regenerate bundled placeholder WAVs, then rescan the catalog
```

**When to run what:**
- After any logic change (physics/rules/shots/ai/game): `node test/logic.test.mjs`.
- After any visual/scene change: `node tools/shoot.mjs`, then **look at the PNGs**
  in `tools/shots/`. Do not trust visual changes without looking — most of this was
  built without a live render loop.
- To eyeball gameplay feel/mechanics live: `node tools/play.mjs` opens a headed
  window and plays a full AI-vs-AI match (all four players AI-driven), fast-forwarding
  the sim while the render loop keeps drawing. Good for rally quality, positioning,
  kitchen/two-bounce adherence, and shot selection — but it exercises AI only, not
  human input (aim/poach/swing timing still need manual play). Env knobs:
  `SPEED` (sim multiplier, default 4), `VENUE` (park|tropical|indoor), `PALETTE`
  (blue|green), `TOD` (day|night), `DIFF`, `MATCHES`, `MAXSEC`. Speed multiplies
  *simulated* time (fixed 1/60 steps), so behavior matches 1x; drop to `SPEED=1`
  to confirm anything suspicious isn't a fast-forward artifact.
- `playwright` is not a declared dependency here; install it if you need the
  render smoke test or `play.mjs` (`npm i -D playwright && npx playwright install chromium`).

---

## Directory Structure

```
index.html        entry point: importmap, <canvas>, HUD DOM, joystick, menu, loads src/main.js
package.json      type:module; scripts for test + serve
src/
  constants.js    court geometry + ALL tuning (physics/shots/AI/camera/hit) — single source of truth
  physics.js      ball integration, net-aware launch() solver, clearsNet()    (pure)
  shots.js        5 shot types + intent/zone classification (THE shot tuning) (pure)
  rules.js        doubles side-out scoring + rally state machine               (pure)
  ai.js           opponent predict/chooseMovement/chooseShot, difficulty LEVELS (pure)
  utils.js        clamp/dist2D/lerp                                            (pure)
  input.js        desktop (WASD/mouse/keys) + dual-thumb touch controls
  audio.js        Web Audio SFX + HTMLAudioElement music player + persisted music state
  scene.js        court, net, lighting, ball + trail, fence, trees            (Three)
  players.js      Mii-style rig + cross-body swing animation                  (Three)
  camera.js       broadcast camera + follow/shake                             (Three)
  game.js         orchestrator: STATE machine, hit model, doubles movement, aim marker, HUD wiring
  hud.js          DOM HUD (score, serve dots, doubles callout, banner, shot tag, SERVE button)
  main.js         bootstrap: difficulty picker -> Game -> requestAnimationFrame loop
music/
  active/         drop genre folders with playable audio files here
  catalog.js      generated music catalog consumed by src/audio.js
test/
  logic.test.mjs  Node assertions for the pure modules
tools/
  shoot.mjs       headless static-server + Playwright render smoke test
  play.mjs        headed Playwright AI-vs-AI full match viewer (SPEED/VENUE/... env)
  sync-music-catalog.mjs  scans music/active/* and rewrites music/catalog.js
  generate-music-wavs.mjs generates placeholder WAV tracks, then syncs the catalog
  shots/          screenshot output (gitignored)
```

---

## Architecture

### Coordinate system (meters)
`x` = sideways, `y` = up, `z` = court length. **Net at `z = 0`.** Near/human side
is `+z` (toward camera); far/AI side is `-z`. All court constants live in
`constants.js` `COURT`.

### Module responsibilities

**`constants.js`** — the only place court geometry and gameplay tuning live.
`COURT` (regulation 20×44 ft in half-extents), `PHYS` (gravity 13.5, drag, magnus,
restitution, friction, spin decay), `RULES` (11, win-by-2), `CAMERA`, `HIT`
(swing window 0.30, reach 1.5, cooldowns, human speed). Change tuning **here**.

**`physics.js`** — pure ball integration. `step()` advances the ball one substep
and returns discrete events (`bounce` / `floor-out` / `net`). `launch(p0, target,
apex, margin, spin)` is a **net-aware** solver: it raises the arc 0.25 m at a time
until `clearsNet()` (which simulates the *same* gravity + drag + Magnus as `step`)
confirms it clears. **Do not** simplify `clearsNet` to a drag-free parabola or stop
snapping the ball to the contact point on a hit — either reintroduces net clips.

**`shots.js`** — THE shot tuning surface. Five types (`drive`, `drop`, `dink`,
`lob`, `speedup`) as `PROFILES` (apex, depth, spin, net margin). `classify(zone,
intent, ballHigh)` maps a swing *intent* (`power`/`touch`/`lob`) + court zone +
ball height to a concrete shot. `aimDepth()` applies momentum-aim depth. **All shot
numbers live here** — never scatter them into `game.js` or `ai.js`.

**`rules.js`** — doubles rally state machine + side-out scoring. Phases
`serve → return → open`. Models diagonal serve validation (`serveFault`), the
two-bounce rule, kitchen-volley fault, and the doubles serve rotation (serverNum
1/2, serverSlot 0/1, the 0-0-2 start). `onFloor()` is the single floor-contact
source of truth (1st bounce = placement check, 2nd = no-return). Geometry is
injected via `setGeometry()` so the module stays dependency-free.

**`ai.js`** — opponent brain. `LEVELS` (family/easy/normal/hard) tune speed,
reaction, error scatter, "smart" shot selection, aggression, and unforced-error
rate. `predict()` forward-sims the ball; `chooseShot()` picks intent by
zone/height/skill and scatters aim by difficulty. Priority order in `chooseShot`:
smash (high ball) → return-of-serve (shots=2, always power) → 3rd-shot drop
(shots=3, skill-scaled high probability) → power cap → normal intent selection.

**`game.js`** — the orchestrator. Owns the `STATE` machine
(`MENU/SERVE/RALLY/POINT/OVER`), the doubles roster, sub-stepped physics, the
**hit model** (a swing opens a ~0.3s timing window; the hit fires when the ball
enters the strike zone during the window), momentum aiming (`_aimTarget`), the
aim-marker ring, doubles lane responsibility / movement, and HUD wiring. The hit
tail `_executeSplineShot` snaps the ball to the contact point and builds the
Bezier arc. Smash overrides apply in both `_hit()` (human) and `_cpuHit()` (CPU)
before the normal shot-selection path, producing a steep low-apex arc when the
ball is at or above `POWER_CAP.SMASH_H`. The serving team's CPU holds at the
baseline until `rally.shots >= 3` before advancing to the kitchen.

**`audio.js`** — Web Audio paddle/bounce/net/serve/point/fault SFX plus a
track-based `HTMLAudioElement` music player. Music tracks are loaded from the
generated `music/catalog.js`, which is built by scanning `music/active/<genre>/`
folders. The player persists mute/volume/genre/track in `localStorage` and starts
muted on first visit.

**`players.js` / `scene.js` / `camera.js`** — the Three.js layer. Swing is a
horizontal cross-body arc from an isolated upper-body twist; the paddle extends
beyond the hand. Court is dark navy, kitchen a mid-blue band, ball neon green with
a glow + trail (kept high-contrast on purpose). Camera is a low broadcast angle
behind the near baseline that gently follows the ball and shakes on points.

### The gameplay contract (don't break these)
- Swing timing window `HIT.SWING_WINDOW = 0.30`; rig swing duration 0.44, contact
  at `contactT = 0.5`.
- Two-bounce rule gate in `_checkContacts`; reach test `dist2D < 1.5`, `0 < y < 2.3`.
- Contact dispatch picks one hitter per team by lane (`_responsibleSlot`), but the
  human can **poach** their AI partner: `_checkContacts` promotes `players[0]` to
  hitter when in reach with an active swing window. Don't remove this override or
  make assignment purely lane-based again. See GAMEPLAY.md → Poaching.
- Momentum aim: `move.x` = left/right (blended with `swingAim`), `-move.z` = depth.
- Side-out scoring: only the serving team scores; game to 11 win-by-2.
- Spin is flipped by `-fwd` at hit time so Magnus curves correctly for each side.

---

## Conventions

- **Tuning lives in `constants.js` and `shots.js` only.** PRs that hardcode physics
  or shot numbers elsewhere should be rejected.
- Keep the pure modules pure (no `import * as THREE`, no `document`/`window`) so
  `node test/logic.test.mjs` keeps working.
- Match the existing code style in a file you touch; don't reformat wholesale.
- After visual changes, regenerate and view screenshots before claiming done.
- After changing music assets, run `npm run music:sync` so `music/catalog.js`
  matches the folders on disk.
- **The 4-shot pattern is a first-class design constraint.** Serve deep → return
  deep → serving team drops → kitchen battle. Any change to shot selection, AI
  movement, or bounce physics should be evaluated against whether it preserves or
  breaks this rhythm. See the "4-Shot Pattern" section in `GAMEPLAY.md`.

## Music Asset Workflow

- Supported track formats: `.wav`, `.mp3`, `.ogg`, `.m4a`, `.aac`.
- Put files in `music/active/<genre>/`.
- Run `npm run music:sync`.
- Reload the game; the picker reads the regenerated `music/catalog.js`.
- The title screen has a `Music Start` radio choice that sets whether the next match begins muted or with music already live.

Filename conventions:
- `open-road.wav` becomes `Open Road`.
- `Artist Name - Track Title.mp3` becomes artist `Artist Name` and title `Track Title`.
- Folder names become uppercase genre labels in the UI, so `music/active/kpop/`
  renders as `KPOP`.

The browser does not enumerate static folders directly, so the generated catalog is
intentional. Do not promise "drop files in and refresh" without the sync step.
The shipped library now includes imported Picklelife MP3 tracks grouped by genre alongside local placeholder tracks.

---

## Extending the game

These were intentionally left out for a clean gameplay core. Each has an obvious
seam. (The "current game" this was ported from did audio/venues/skinning the way
described below — mirror that.)

### Audio expansion

The repo already ships with:
- `src/audio.js` for Web Audio SFX + track-based music playback
- a music picker in the menu/HUD/pause UI
- folder-driven asset discovery via `npm run music:sync`
- placeholder tracks generated by `npm run music:generate`

The important implementation contract:
- Keep music asset discovery data-driven through `music/catalog.js`.
- Keep audio fully optional: guard gameplay SFX calls (`this.audio &&` or `?.`) so
  the game still runs silently if assets are missing or broken.
- Do not add direct folder-enumeration assumptions to browser code; static servers
  are inconsistent there, which is why the generated catalog exists.

### Other extensions
- **More venues** — `scene.js` is the seam. Parameterize `build(scene, opts)` with
  a venue (e.g. `park` vs `stadium`): swap court tint, surroundings, lighting, and
  sky. Keep the dark-court / neon-ball contrast.
- **Night mode** — add a `nightMode` flag to `scene.build` and lerp sky/fog/light
  intensities + the ball's `emissiveIntensity` (the original raised it to ~1.2 at
  night so the ball stays visible).
- **Character skinning** — `players.makePlayer(opts)` already takes color slots;
  re-add geometry variants (hair styles, body scale, cap/visor/band) inside
  `makePlayer` and feed a per-player appearance object from `game.js`.
- **Singles mode** — the rules/movement are doubles-specific; a singles variant
  would simplify the serve rotation (no serverNum 1/2, no partner) and movement
  (one player per side). Architect via an `opts.mode` on `Game`.
- **Difficulty/venue gating, pre-match cards, rankings** — layer above `main.js`;
  the `Game` already accepts `difficulty`, `partnerDiff`, and an `onMatchOver` hook.

---

## Testing notes

- `test/logic.test.mjs` imports only the pure modules — keep new pure logic
  importable without Three.js so it stays node-testable.
- If you change rules/physics/shots/ai behavior, update or add an assertion.
- `tools/shoot.mjs` spins up a tiny static server, loads the page in headless
  Chromium (SwiftShader WebGL), drives a match via `window.__game`, and asserts the
  serve→rally→point loop plus zero page errors. Use `HEADED=1` if headless WebGL
  renders black.
- `tools/play.mjs` is the interactive counterpart: it opens a **headed** window and
  plays a full match with every player AI-driven (it flips `players[0]` off human
  control and gives it its own AI), then injects extra fixed-step `game.update()`
  calls each frame to fast-forward while the native render loop draws. It streams
  score/state transitions to the terminal and reports page errors at the end. Use it
  to watch mechanics live; use `SPEED=1` to verify anything the fast-forward makes
  look off. It does not cover human input paths.
