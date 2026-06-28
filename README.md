# Pickleball 3D

A self-contained **Three.js doubles pickleball game**. You and a CPU partner take on
two CPUs, with real pickleball rules and arcade-tuned physics that aim for polished
arcade-tennis feel (Wii Sports / Mario Tennis energy).

It started life as the 3D match inside a larger browser game and was extracted into
this clean, decoupled project — gameplay only: **no music, character skinning, 2D
overworld, or save system** (those are documented extension points below).

> **Working on this with an AI agent?** Read [`AGENTS.md`](AGENTS.md) — it's the
> primary context for both Claude Code and Codex. [`CLAUDE.md`](CLAUDE.md) adds
> Claude-specific notes.

---

## Run

No build step. Modern Three.js (r160) loads via an `<script type="importmap">` from a
CDN, and the rest is hand-written ES modules. ES modules don't load from `file://`,
so serve the folder over HTTP:

```bash
npx serve .            # or: python3 -m http.server
# then open the printed localhost URL
```

---

## How to play

You control the **orange** player (marked by a pulsing ground ring). Your partner is
**teal**; the opponents are **red** and **pink**.

**Desktop**
| Action | Key |
|---|---|
| Move | `WASD` / arrow keys |
| Aim | mouse X position (left/right of center) |
| Power swing (drive / speedup) | `Space` or left-click |
| Touch swing (drop / dink) | `V` or right-click |
| Lob | `B` or middle-click / Shift+click |
| Serve | `Enter` / `Space` (or the on-screen SERVE button) |

**Touch (mobile)**
- **Left thumb** = virtual move stick.
- **Right thumb** = swing & aim: drag left/right to aim, release to hit. A hard/fast
  swipe = power, a soft/short one = touch, a flick upward = lob.
- A **SERVE** button appears when it's your serve.

**The feel:** a swing opens a ~0.3-second timing window; your hit fires the instant
the ball enters your strike zone during that window (press with no ball nearby and
you just whiff). The direction you're holding at contact steers the shot —
left/right = cross-court vs down-the-line, forward/back = deeper/shorter. A white
ring on the opponents' court previews where your held direction will place the ball.

---

## Rules modeled

Full doubles pickleball:
- **Diagonal serve** that must clear the kitchen and land in the correct service box.
- **Two-bounce rule** — the serve and the return must each bounce before being hit.
- **Non-volley zone ("kitchen")** — you can't volley (hit before a bounce) while
  standing in the kitchen.
- **Side-out scoring** — only the serving team can score; game to **11, win by 2**.
- **Doubles serve rotation** — first/second server per side, partners swap courts on
  each point, and the standard **0-0-2** start (the first serving team gets only its
  second server).

Three difficulties (Beginner / Intermediate / Advanced) scale movement speed,
reaction time, shot smarts, aggression, and unforced-error rate.

---

## Project layout

```
index.html        importmap + <canvas> + HUD DOM + menu; loads src/main.js
package.json      type:module; test + serve scripts
src/
  constants.js    court geometry + ALL tuning (physics/shots/AI/camera/hit)  ← single source of truth
  physics.js      ball integration, net-aware launch() solver, clearsNet()    (pure, no Three)
  shots.js        5 shot types + intent/zone classification                   (pure)  ← THE shot tuning
  rules.js        doubles side-out scoring + rally state machine               (pure)
  ai.js           opponent predict / movement / shot selection (4 levels)     (pure)
  utils.js        clamp / dist2D / lerp                                        (pure)
  input.js        desktop (WASD/mouse/keys) + dual-thumb touch controls
  scene.js        court, net, lighting, ball + trail, fence, trees            (Three)
  players.js      Mii-style rig + cross-body swing animation                  (Three)
  camera.js       broadcast camera + follow/shake                             (Three)
  game.js         orchestrator: state machine, hit model, doubles movement, aim marker
  hud.js          DOM HUD (score, serve dots, callout, banner, shot tag)
  main.js         bootstrap: difficulty picker -> Game -> requestAnimationFrame loop
test/
  logic.test.mjs  Node assertions for the pure modules
tools/
  shoot.mjs       headless render smoke test (writes tools/shots/*.png)
```

**Two tuning surfaces hold all the gameplay numbers:** `src/constants.js` (physics,
court, camera, hit timings) and `src/shots.js` (per-shot apex/depth/spin/margin).
Change feel there, not scattered through the code.

---

## Tests

```bash
node test/logic.test.mjs   # pure-logic assertions (physics/shots/rules/ai) — no Three.js needed
node tools/shoot.mjs       # headless WebGL render smoke test; writes tools/shots/*.png
```

The smoke test needs Playwright (not a declared dependency): `npm i -D playwright &&
npx playwright install chromium`. After any visual change, run it and **look at the
PNGs** — much of this was built without a live render loop.

---

## Extending the game (music, venues, skinning, more)

This build is deliberately gameplay-only. The most likely additions all have clean
seams, documented in detail in [`AGENTS.md` → Extending the game](AGENTS.md#extending-the-game):

### Adding music & sound effects
The original game used one `audio.js` module: **Web Audio API for procedural SFX**
(paddle thock, bounce, net, serve, point, fault, cheer, win) plus an
**`HTMLAudioElement` for music** (MP3 files in `music/active/`). Browser autoplay
policy means it must be **unlocked by a user gesture** — do that on the
difficulty-button click. The recipe:

1. Add `src/audio.js` exporting `makeAudio()` → `{ unlock(), sfx{…}, music{…} }`.
2. In `main.js`, create it, pass `audio` into `new Game(...)`, call `audio.unlock()`
   on the first button click, and start a track with `audio.music.setTrack(...)`.
3. Re-add the SFX hooks in `game.js` (the exact spots the original fired them):
   `_doServe` (serve), `_handleBallEvent` (bounce / net), `_hit` & `_cpuHit`
   (paddle), `_endPoint` (point / fault / cheer, and win on game over).
4. Drop your MP3s in `music/active/` and add a station picker if you want.

Keep audio **optional and guarded** (`this.audio?.sfx.paddle()`) so the game still
runs silently without it. Full code sketch is in `AGENTS.md`.

### Other planned-friendly extensions
- **More venues** (e.g. a pro stadium) — parameterize `scene.build(scene, opts)`.
- **Night mode** — lerp sky/fog/light intensities + the ball's emissive glow.
- **Character skinning** — `players.makePlayer(opts)` already takes color slots; add
  geometry variants (hair, body scale, cap/visor) and feed appearance from `game.js`.
- **Singles mode** — simplify serve rotation + movement via an `opts.mode` on `Game`.
- **Rankings / pre-match cards / venue gating** — layer above `main.js`; `Game`
  already accepts `difficulty`, `partnerDiff`, and an `onMatchOver` hook.
