# Pickleball 3D

A self-contained **Three.js doubles pickleball game**. You and a CPU partner take on
two CPUs, with real pickleball rules, arcade-tuned physics, and a real track-based
music picker that supports genre folders such as `KPOP`, `RAP`, `COUNTRY`, and `POP`.

It started life as the 3D match inside a larger browser game and was extracted into
this clean, decoupled project — focused on gameplay, music, and presentation without
character skinning, a 2D overworld, or a save system.

> **Working on this with an AI agent?** Read [`AGENTS.md`](AGENTS.md) — it's the
> primary context for both Claude Code and Codex. [`CLAUDE.md`](CLAUDE.md) adds
> Claude-specific notes.

---

## Run

Modern Three.js (r160) is installed from npm and served/bundled by Vite. The app
code remains hand-written ES modules and deploys as static assets:

```bash
npm install
npm run dev
# then open the printed localhost URL

npm run build          # writes static output to dist/
npm run preview        # preview the production build
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
- **Left thumb** = virtual move stick. It rests on the lower-left so you can always
  see it, and jumps to your thumb while you hold.
- **Right thumb** = swing & aim: drag left/right to aim, release to hit. Direction
  picks the shot — **flick up = drive (power)**, **flick down = lob**, a short/soft
  swipe = drop / dink.
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
index.html        <canvas> + HUD DOM + menu; loads src/main.js
package.json      type:module; Vite/test/build/screenshot/music scripts
src/
  audio.js        Web Audio SFX + HTMLAudioElement music player + persisted music state
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
music/
  active/         drop genre folders with playable audio files here
  catalog.js      generated music catalog consumed by src/audio.js
test/
  logic.test.mjs  Node assertions for the pure modules
tools/
  shoot.mjs       headless render smoke test (writes tools/shots/*.png)
  sync-music-catalog.mjs  scans music/active/* and rewrites music/catalog.js
  generate-music-wavs.mjs generates placeholder WAV tracks, then syncs the catalog
```

**Two tuning surfaces hold all the gameplay numbers:** `src/constants.js` (physics,
court, camera, hit timings) and `src/shots.js` (per-shot apex/depth/spin/margin).
Change feel there, not scattered through the code.

---

## Tests

```bash
node test/logic.test.mjs   # pure-logic assertions (physics/shots/rules/ai) — no Three.js needed
npm run shots              # headless WebGL render smoke test; writes tools/shots/*.png
npm run build              # Vite production build; copies music/active into dist/
npm run music:sync         # rescan music/active/* and rebuild music/catalog.js
```

The smoke test uses Playwright; run `npx playwright install chromium` on a fresh
machine if the browser is missing. After any visual change, run it and **look at
the PNGs** — much of this was built without a live render loop.

---

## Music workflow

Music now ships in the game and is discovered from a generated catalog:

- Put supported audio files in `music/active/<genre>/`.
- Supported extensions are `.wav`, `.mp3`, `.ogg`, `.m4a`, `.aac`.
- Run `npm run music:sync`.
- Reload the game and the new files appear in the music picker automatically.
- The title screen includes a `Music Start` choice so a new match can begin either muted or with music already live.

Filename conventions:

- `open-road.wav` becomes the track label `Open Road`.
- `Artist Name - Track Title.mp3` becomes artist `Artist Name` and title `Track Title`.
- Genre labels come from folder names and are uppercased in the UI, so `music/active/kpop/` renders as `KPOP`.

The catalog is generated into `music/catalog.js`, which is what `src/audio.js` reads at runtime. The browser does not enumerate static folders directly, so the sync step is intentional.

Fresh installs start with music muted. User mute, volume, selected genre, and selected track are persisted in `localStorage`.
The repo also includes imported Picklelife tracks grouped into `POP`, `RAP`, `ROCK`, `DISCO`, and `COUNTRY`, alongside the local placeholder library.

If you want the built-in placeholder tracks back or need a seed library for testing, run:

```bash
npm run music:generate
```

## Extending the game (venues, skinning, more)

This build is deliberately gameplay-only. The most likely additions all have clean
seams, documented in detail in [`AGENTS.md` → Extending the game](AGENTS.md#extending-the-game):

### Audio expansion ideas
- Add richer metadata support to the catalog generator if you want album art, sort order, or artist grouping beyond filename parsing.
- Add preview snippets, shuffle/repeat behavior, or separate menu-vs-match playlists in `src/audio.js` and `src/main.js`.
- Keep audio **optional and guarded** (`this.audio?.sfx.paddle()`) so the game still runs silently if assets are missing.

### Other planned-friendly extensions
- **More venues** (e.g. a pro stadium) — parameterize `scene.build(scene, opts)`.
- **Night mode** — lerp sky/fog/light intensities + the ball's emissive glow.
- **Character skinning** — `players.makePlayer(opts)` already takes color slots; add
  geometry variants (hair, body scale, cap/visor) and feed appearance from `game.js`.
- **Singles mode** — simplify serve rotation + movement via an `opts.mode` on `Game`.
- **Rankings / pre-match cards / venue gating** — layer above `main.js`; `Game`
  already accepts `difficulty`, `partnerDiff`, and an `onMatchOver` hook.
