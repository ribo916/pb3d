# Pickleball 3D — AI Agent Context

> This is the primary context file for AI coding agents. Both **Claude Code** and
> **OpenAI Codex** read this file. See `CLAUDE.md` for Claude-specific additions.
> Read this before starting any task.

---

## What This Is

A standalone **Three.js doubles pickleball game**. You (`players[0]`) + a CPU
partner take on two CPUs. Real rules (diagonal serve, two-bounce rule, non-volley
"kitchen", side-out scoring to 11 win-by-2), arcade-tuned physics, three
difficulties, desktop + mobile controls.

The gameplay was ported from a larger project's 3D match and is now fully
self-contained: **no music, no character skinning, no 2D overworld, no save
system** — pure gameplay. Those are intentional extension points (see
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
```

**When to run what:**
- After any logic change (physics/rules/shots/ai/game): `node test/logic.test.mjs`.
- After any visual/scene change: `node tools/shoot.mjs`, then **look at the PNGs**
  in `tools/shots/`. Do not trust visual changes without looking — most of this was
  built without a live render loop.
- `playwright` is not a declared dependency here; install it if you need the
  render smoke test (`npm i -D playwright && npx playwright install chromium`).

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
  scene.js        court, net, lighting, ball + trail, fence, trees            (Three)
  players.js      Mii-style rig + cross-body swing animation                  (Three)
  camera.js       broadcast camera + follow/shake                             (Three)
  game.js         orchestrator: STATE machine, hit model, doubles movement, aim marker, HUD wiring
  hud.js          DOM HUD (score, serve dots, doubles callout, banner, shot tag, SERVE button)
  main.js         bootstrap: difficulty picker -> Game -> requestAnimationFrame loop
test/
  logic.test.mjs  Node assertions for the pure modules
tools/
  shoot.mjs       headless static-server + Playwright render smoke test
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
rate. `predict()` forward-sims the ball; `chooseMovement()` does the kitchen race;
`chooseShot()` picks intent by zone/height/skill and scatters aim by difficulty.

**`game.js`** — the orchestrator. Owns the `STATE` machine
(`MENU/SERVE/RALLY/POINT/OVER`), the doubles roster, sub-stepped physics, the
**hit model** (a swing opens a ~0.3s timing window; the hit fires when the ball
enters the strike zone during the window), momentum aiming (`_aimTarget`), the
aim-marker ring, doubles lane responsibility / movement, and HUD wiring. The hit
tail `_executeHit` snaps the ball to the contact point and calls `launch()`.

**`players.js` / `scene.js` / `camera.js`** — the Three.js layer. Swing is a
horizontal cross-body arc from an isolated upper-body twist; the paddle extends
beyond the hand. Court is dark navy, kitchen a mid-blue band, ball neon green with
a glow + trail (kept high-contrast on purpose). Camera is a low broadcast angle
behind the near baseline that gently follows the ball and shakes on points.

### The gameplay contract (don't break these)
- Swing timing window `HIT.SWING_WINDOW = 0.30`; rig swing duration 0.44, contact
  at `contactT = 0.5`.
- Two-bounce rule gate in `_checkContacts`; reach test `dist2D < 1.5`, `0 < y < 2.3`.
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

---

## Extending the game

These were intentionally left out for a clean gameplay core. Each has an obvious
seam. (The "current game" this was ported from did audio/venues/skinning the way
described below — mirror that.)

### Audio (SFX + music) — the priority extension

The original game used a single `audio.js` module: **Web Audio API for procedural
SFX** + an **`HTMLAudioElement` for music** (MP3 files), unlocked on first user
gesture (mobile autoplay policy requires this).

**1. Add `src/audio.js`** exporting `makeAudio()` that returns
`{ unlock(), sfx: { paddle, bounce, net, serve, point, fault, cheer, win }, music: { play, pause, setTrack, setVolume } }`.

Sketch:

```js
export function makeAudio() {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  let ac = null, master = null, sfxGain = null, noiseBuf = null;
  function init() {
    if (ac) return;
    ac = new Ctx();
    master = ac.createGain(); master.gain.value = 0.9; master.connect(ac.destination);
    sfxGain = ac.createGain(); sfxGain.gain.value = 0.8; sfxGain.connect(master);
    const n = ac.sampleRate * 1.0;             // shared white-noise buffer for "thock"/cheer
    noiseBuf = ac.createBuffer(1, n, ac.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
  }
  function unlock() { init(); if (ac.state === 'suspended') ac.resume(); }
  function tone(freq, type, dur, vol) { /* createOscillator + gain envelope -> sfxGain */ }

  // MP3 music via HTMLAudioElement (autoplay needs the unlock gesture)
  const musicEl = new Audio(); musicEl.loop = true; musicEl.volume = 0.7;
  const TRACKS = [{ key: 'theme', label: 'Theme', file: 'music/active/theme.mp3' }];

  return {
    unlock,
    sfx: {
      paddle: () => tone(440, 'square', 0.05, 0.5),     // a short "thock"
      bounce: () => tone(220, 'sine', 0.04, 0.3),
      net:    () => tone(140, 'triangle', 0.08, 0.4),
      serve:  () => tone(520, 'sine', 0.06, 0.4),
      point:  () => tone(660, 'sine', 0.20, 0.5),
      fault:  () => tone(180, 'sawtooth', 0.18, 0.4),
      cheer:  () => { /* filtered noise burst */ },
      win:    () => { /* little arpeggio */ },
    },
    music: {
      play: () => musicEl.play(),
      pause: () => musicEl.pause(),
      setTrack: (k) => { const t = TRACKS.find(x => x.key === k); if (t) { musicEl.src = t.file; musicEl.play(); } },
      setVolume: (v) => { musicEl.volume = v; },
    },
  };
}
```

**2. Wire it in `main.js`:** create `const audio = makeAudio()`, pass it into
`new Game({ ..., audio })`, and call `audio.unlock()` on the difficulty-button
click (the first user gesture) plus `audio.music.setTrack('theme')` to start music.

**3. Re-add the SFX hooks in `game.js`** (they were removed during the port — these
are exactly where the original fired them):
- `_doServe()` → `this.audio?.sfx.serve()`
- `_handleBallEvent()` → `bounce`/`floor-out` ⇒ `sfx.bounce()`, `net` ⇒ `sfx.net()`
- `_hit()` and `_cpuHit()` → `sfx.paddle()`
- `_endPoint()` → `result.scored ? sfx.point() : sfx.fault()`, then `sfx.cheer()`;
  on `result.gameOver` → `sfx.win()`

**4. Add MP3s** under `music/active/*.mp3` and a small music-picker UI if you want
station switching. Keep audio fully optional: guard every call (`this.audio &&` or
`?.`) so the game runs silently without it.

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
