# Pickleball 3D — AI Agent Context

> This is the primary context file for AI coding agents. Both **Claude Code** and
> **OpenAI Codex** read this file. See `CLAUDE.md` for Claude-specific additions.
> Read this before starting any task.
>
> **Gameplay mechanics, tuning surfaces, and system design →
> [`GAMEPLAY.md`](GAMEPLAY.md).** Read it before touching any gameplay code.
>
> **Graphics architecture, asset pipeline, player-model status, and visual
> verification → [`GRAPHICS.md`](GRAPHICS.md).** Read it before touching
> rendering, venues, authored assets, player models, effects, or HUD layout.

---

## What This Is

A standalone **Three.js pickleball game** with doubles, singles, and a
single-player practice mode. In doubles, you (`players[0]`) + a CPU partner
take on two CPUs; in singles, you face one CPU opponent; in practice, a Titan-
style ball machine on the far baseline feeds one-ball drills to the human side.
Match play uses real rules (diagonal serve, two-bounce rule, non-volley
"kitchen", side-out scoring to 11 win-by-2), with arcade-tuned physics, three
difficulties, and desktop + mobile controls.

The gameplay was ported from a larger project's 3D match and is now fully
self-contained: **real track-based music, no 2D overworld, no save system** —
pure gameplay plus audio. A verified rendering and authored-asset scaffold, plus
a 12-character Mixamo chooser, are merged into `master`. Character art
is improved, but the animation set and team-identity treatment are still not
final. See [`GRAPHICS.md`](GRAPHICS.md).

**The single most important quality bar is swing + ball-contact feel** — it should
read like polished arcade tennis (Wii Sports / Mario Tennis energy). Treat the
tuning constants as load-bearing; don't "improve" the numbers casually.

---

## Tech Stack

- **Vite static build.** Modern Three.js (r160) is installed from npm and bundled
  by Vite; the app code remains hand-written ES modules (`import`/`export`).
- **Runs over HTTP**: `npm run dev` for local development, `npm run build` for a
  Vercel/static-ready `dist/`, and `npm run preview` to inspect the production build.
- **ES modules**, `'use strict'`, mostly ES5-style code inside (ported verbatim
  to preserve tuned behavior) — don't refactor style for its own sake.
- **Pure-logic modules have no Three.js / DOM dependency** and run in plain Node
  for tests: `constants`, `physics`, `shots`, `rules`, `ai`, `utils`.

---

## Commands

```bash
# Run the game
npm run dev                 # then open the printed localhost URL

# Tests
npm test                    # pure-logic assertions (no Three.js needed)
npm run shots               # headless render smoke test; writes tools/shots/*.png
node tools/play.mjs         # headed AI-vs-AI full match you can watch live (needs playwright)
npm run build               # production static build in dist/
npm run preview             # preview the production build locally
npm run music:sync          # rescan music/active/* and rebuild music/catalog.js
npm run music:generate      # regenerate bundled placeholder WAVs, then rescan the catalog
```

**When to run what:**
- After any logic change (physics/rules/shots/ai/game): `node test/logic.test.mjs`.
- After any visual/scene change: `npm run shots`, then **look at the PNGs**
  in `tools/shots/`. Do not trust visual changes without looking — most of this was
  built without a live render loop.
- To eyeball gameplay feel/mechanics live: `node tools/play.mjs` opens a headed
  window and plays a full AI-vs-AI match (all four players AI-driven), fast-forwarding
  the sim while the render loop keeps drawing. Good for rally quality, positioning,
  kitchen/two-bounce adherence, and shot selection — but it exercises AI only, not
  human input (aim/poach/swing timing still need manual play). Env knobs:
  `SPEED` (sim multiplier, default 4), `VENUE` (park|tropical|indoor), `PALETTE`
  (blue|green), `TOD` (day|night), `DIFF`, `MATCHES`, `MAXSEC` (prints a
  per-match metrics summary). Speed multiplies
  *simulated* time (fixed 1/60 steps), so behavior matches 1x; drop to `SPEED=1`
  to confirm anything suspicious isn't a fast-forward artifact.
- `playwright` is a declared dev dependency; run `npx playwright install chromium`
  if a fresh machine does not already have the browser installed.

---

## Directory Structure

```
GRAPHICS.md       graphics architecture, asset pipeline, verification baseline
index.html        entry point: <canvas>, HUD DOM, joystick, menu, loads src/main.js
package.json      type:module; Vite/test/build/screenshot/music scripts
assets/           optional GLB/textures/environments copied into dist/assets
src/
  constants.js    court geometry + ALL tuning (physics/shots/AI/camera/hit) — single source of truth
  physics.js      ball integration, net-aware launch() solver, clearsNet()    (pure)
  shots.js        5 selectable shot types + state-triggered specials (smash/erne/atp/supersmash/blastpop) (pure)
  rules.js        side-out scoring + rally state machine                       (pure)
  ai.js           opponent predict/chooseMovement/chooseShot, difficulty LEVELS (trait vector) (pure)
  strategies/     mode strategies (doubles/singles/common) + personas.js (play styles) (pure)
  practice.js     practice-mode target generation + timing/contact feedback    (pure)
  movement.js     local-velocity + visual-move (run/shuffle/backpedal/stun) classify (pure)
  power.js        super-smash meter economy + knockdown stun timeline          (pure)
  utils.js        clamp/dist2D/lerp                                            (pure)
  input.js        desktop (WASD/mouse/keys) + dual-thumb touch controls
  audio.js        Web Audio SFX + HTMLAudioElement music player + persisted music state
  assets.js       optional GLB loader + fallback-safe getModel/preload         (Three)
  scene.js        court, net, lighting, ball + trail, fence, trees            (Three)
  players.js      primitive rig + authored-GLB adapter + swing/locomotion clips (Three)
  camera.js       broadcast camera + follow/shake                             (Three)
  characters.js   12-character Mixamo chooser data + slot/team identity + AI play style (pure)
  characterPreview.js live 3D preview used by the chooser modal                (Three)
  game.js         orchestrator: STATE machine, hit model, movement, aim marker, HUD wiring
  hud.js          DOM HUD (score, serve dots, callout, banner, shot tag, SERVE + SUPER buttons, power meter/pips)
  replay.js       instant-replay ring buffer + interpolating playback          (pure)
  modes.js        shared mode normalization (`doubles` / `singles` / `practice`)
  main.js         bootstrap: difficulty picker -> Game -> requestAnimationFrame loop
music/
  active/         drop genre folders with playable audio files here
  catalog.js      generated music catalog consumed by src/audio.js
test/
  logic.test.mjs  Node assertions for the pure modules
tools/
  shoot.mjs       Vite + Playwright render smoke test
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

**`physics.js`** — pure ball integration. Honest simulated flight: the ball
*always* integrates gravity + quadratic drag + Magnus (`stepV2`), and a hit
solves a launch velocity with `solveArc` (three families: flat **driven** for
drive/speedup, **arc** for touch shots — net clearance by construction — and
**direct** for smash/Erne). Spin curves/dips flight and shapes a spin-aware
bounce. `stepV2` advances one substep + discrete events (`bounce` / `floor-out`
/ `net`). See GAMEPLAY.md → "Trajectory System". Constants live in `constants.js`
`PHYS_V2`/`TIMING_V2`. (Don't simplify `solveArc`'s net-clearance search to a
drag-free parabola or stop snapping the ball to the contact point — either
reintroduces net clips.)

**`power.js`** — the super-smash economy and the knockdown timeline, kept pure so
both are node-testable. Charging (`chargeFor`/`addCharge`, clean contacts only),
every unleash gate in one place (`canUnleash`), spending/carry, and the
`blown -> down -> up -> none` stun machine (`applyBlast`/`tickStun`/
`stunBlocksInput`/`stunSlideSpeed`). Tuning lives in `constants.js SUPER`. Nothing
here knows about rendering — `game.js` reads this state and drives the visuals.
See GAMEPLAY.md → "Power Meter & Super Smash".

**`shots.js`** — THE shot tuning surface. Shot types (`drive`, `drop`, `dink`,
`lob`, `speedup`, plus `serve`/`smash`/`erne`/`atp`/`feed`/`supersmash`/`blastpop`) as `PROFILES_V2`
(apex hint, depth, spin, net margin, `vMax`, driven/direct/allowNet flags) fed to
`physics.solveArc`. `classify(zone, intent, ballHigh)` maps a swing *intent*
(`power`/`touch`/`lob`) + court zone + ball height to a concrete shot;
`resolveV2()`/`specV2()` build the physical envelope; `aimDepth()` applies
momentum-aim depth. **All shot numbers live here** — never scatter them into
`game.js` or `ai.js`.

**`rules.js`** — rally state machine + side-out scoring. Phases
`serve → return → open`. Models diagonal serve validation (`serveFault`), the
two-bounce rule, kitchen-volley fault, doubles serve rotation (serverNum 1/2,
serverSlot 0/1, the 0-0-2 start), and singles serve rotation (one server per
side). `onFloor()` is the single floor-contact source of truth (1st bounce =
placement check, 2nd = no-return). Geometry is injected via `setGeometry()` so
the module stays dependency-free.

**`ai.js`** — opponent brain. `LEVELS` (family/easy/normal/hard) is the **skill
tier** (a trait vector: speed, reaction + `reactJitter`, error scatter, `shotIQ`,
`aggression`, unforced-error rate). `src/strategies/personas.js` layers a **play
style** (BALANCED / BANGER / DEFENSIVE) over the tier — assigned per character in
`characters.js`, so opponent identity = DUPR × style. `makeAI(level, persona)`
merges them; strategy formulas read `aggBias = aggression − shotIQ` (0 for
balanced) so balanced reproduces the pre-persona AI. `predict()` forward-sims the
ball; `chooseShot()` picks intent by zone/height/style, is score-aware, and
scatters aim by difficulty. Priority in `chooseShot`: unforced error
(pressure-linked) → smash (risk-gated) → return-of-serve (shots=2, always power)
→ 3rd-shot drop (shots=3, shotIQ/aggression-scaled) → power cap → situational lob
→ normal intent selection.

**`game.js`** — the orchestrator. Owns the `STATE` machine
(`MENU/SERVE/RALLY/POINT/OVER`), the mode-specific roster, sub-stepped physics, the
**hit model** (a swing opens a ~0.3s timing window; the hit fires when the ball
enters the strike zone during the window), momentum aiming (`_aimTarget`), the
aim-marker ring, doubles lane or singles full-court movement, and HUD wiring. The hit
tail `_executeSplineShot` snaps the ball to the contact point and builds the
Bezier arc. Smash overrides apply in both `_hit()` (human) and `_cpuHit()` (CPU)
before the normal shot-selection path, producing a steep low-apex arc when the
ball is at or above `POWER_CAP.SMASH_H`. Practice mode branches separately:
single human player, auto-fed one-ball machine reps, visual-only return balls,
landing markers, and practice-only coaching feedback. The serving team's CPU
holds at the baseline until `rally.shots >= 3` before advancing to the kitchen.

**`practice.js`** — pure helpers for practice mode. Generates opening/random
feed targets, grades timing/contact feedback (`early` / `late` / `good` /
`clean` / `perfect`), and defines the live contact-window cue used to tint the
incoming practice ball.

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
Practice mode adds a procedural Titan-style machine prop on the far baseline, a
landing marker for the previous return, and a strong color cue on the live
practice feed ball to show good/clean/perfect contact windows. Current
graphics-overhaul details, including the generated player POC and why it is not
final art, live in [`GRAPHICS.md`](GRAPHICS.md).

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
- Practice mode is intentionally **not** rules-driven match play; keep its
  machine-feed/session logic separate from `rules.js`.
- **Poaching is DEFERRED, never instant.** `_checkPoach` only *arms* a poach;
  `_checkPoachContact` executes it when the ball actually reaches the poacher.
  Executing at hit time teleported the ball 4-5.5m across the court in one frame
  ("the ball just appears and nobody hit it") and skipped the whole intervening
  flight. Don't re-inline it.
- **The super smash is aimed at a PLAYER, not a court spot.** `_pickSuperVictim`
  chooses the target before the shot is solved and the same player goes into
  `this.blast`, so intent and outcome can't disagree.
- **The blast bypasses `lastHitCooldown` on purpose.** `_checkBlastContact` runs
  per substep before `_checkContacts` and ignores the cooldown — a super covers
  ~3.6m inside the 0.12s cooldown, so the receiver would otherwise be skipped
  entirely and it would be a silent free winner.
- **A blasted player is gated in five places** (`_updateHuman`, `_moveCPU`,
  `_checkContacts` incl. the human-poach promotion, `_checkPoach`, and the
  authored `api.update` in `players.js`). Miss any one and they keep playing
  while lying on the floor.
- **`_responsibleSlot` prefers the un-stunned partner in doubles only.** Without
  it every blasted rally dies instantly because the ball keeps being assigned to
  the player on the ground.
- **Anything added to `Game._captureFrame` must also be added to the replay
  playback path** in `replay.js` — continuous/discrete state belongs in
  `makePlayback.sample()`, while one-shot events such as swing triggers or blast
  impact effects belong in `consumeEvents()`. Replay rebuilds frames by
  interpolation rather than passing them through, so a missing field or event is
  silently dropped with no error. This already bit twice: the super's glow and
  knockdown vanished once, and the blast impact effect vanished later.
- New characters in `characters.js` need an explicit `voice: 'boy'|'girl'`.
  **Never infer it from the name** — Leo and Max are girls, and several other
  roster names are deliberately unisex.

---

## Conventions

- **Tuning lives in `constants.js` and `shots.js` only.** PRs that hardcode physics
  or shot numbers elsewhere should be rejected. (Super-smash tuning is
  `constants.js SUPER` + the `supersmash`/`blastpop` rows in `shots.js`.)
- Keep the pure modules pure (no `import * as THREE`, no `document`/`window`) so
  `node test/logic.test.mjs` keeps working.
- Match the existing code style in a file you touch; don't reformat wholesale.
- After visual changes, regenerate and view screenshots before claiming done.
- Before visual/asset/player-model work, read [`GRAPHICS.md`](GRAPHICS.md).
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
seam. (The "current game" this was ported from did audio, venues, and richer
player presentation the way described below — mirror that where it still fits.)

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
- **Character models** — the active roster uses 12 optimized Mixamo characters
  (`ch01`, `ch03`, `ch04`, `ch06`-`ch12`, `ch14`, `ch15`; no `ch02`/`ch05`/`ch13`)
  selected per slot through a fighting-game-style chooser
  (`src/characters.js`, `src/main.js`, `src/characterPreview.js`). Slots
  (`nearYou`/`nearMate`/`farA`/`farB`) keep their own paddle/ring identity, so
  duplicate character picks are allowed without losing team distinction. Each
  character also carries an **AI play style** (`persona`: BALANCED/BANGER/
  DEFENSIVE) surfaced in the picker/VS UI and used when CPU-controlled. The
  old gender/hair/beard Quaternius customization UI is retired; its GLBs and
  build notes remain as legacy fallback/reference material in
  [`PLAYER-IMPORT.md`](PLAYER-IMPORT.md). Keep the primitive rig as gameplay
  authority. Before changing the active Mixamo pipeline, read
  [`GRAPHICS.md`](GRAPHICS.md)'s "Mixamo Character Pipeline" section and
  [`character-preview/CONTEXT.md`](character-preview/CONTEXT.md) for the open
  animation/licensing/team-identity TODOs.
- **Singles mode** — implemented via `opts.mode` on `Game`; it uses one player
  per side, immediate receiver side-outs, and a two-number HUD callout.
- **Difficulty/venue gating, pre-match cards, rankings** — layer above `main.js`;
  the `Game` already accepts `difficulty`, `partnerDiff`, and an `onMatchOver` hook.

---

## Testing notes

- `test/logic.test.mjs` imports only the pure modules — keep new pure logic
  importable without Three.js so it stays node-testable.
- If you change rules/physics/shots/ai behavior, update or add an assertion.
- `tools/shoot.mjs` spins up a Vite dev server, loads the page in headless
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
- `game.metrics` carries super-smash balance counters — `supersFired`,
  `supersBlasted`, `supersMissed` — and `tools/play.mjs` prints them. A low
  blasted/fired ratio means supers are sailing past nobody.

### Testing the super smash quickly

The meter normally needs ~4 clean contacts, which makes the super tedious to
exercise by hand. Load the page with **`?fastsuper=1`** to charge it almost
immediately (any contact charges, at 20x); `?fastsuper=N` sets an explicit
multiplier. It can also be changed live:

    window.__game.superChargeMul = 20

The flag only affects charge **rate** — every other gate (height, kitchen, rally
phase, `MIN_SHOTS`, the once-per-team-per-rally cap) still applies, so what you
test is the real feature.

### Balance numbers worth knowing before you retune

These were all measured, and each one overturned an assumption that looked
obvious on paper. Re-measure before trusting intuition here.

| Quantity | Measured | Why it matters |
|---|---|---|
| Contacts grading `clean` | ~25-30% | The meter's income. ~0.2 clean contacts per player per point. |
| Contact **height** | median 0.49m, p99 0.84m | Only ~1 in 99 clears net height. Height gates barely fire — see `SUPER.SMASH_H`. |
| Mean rally, DUPR 4.0 | 4.6 shots | Supers barely move it (4.8 with them on). |
| Mean rally, DUPR 5.0 | 15.7 shots | Pro rallies are long *before* supers. |
| Super connect rate | ~0.90 | Since supers aim at a player rather than a court spot. |
| Supers per rally | capped at 1/team | Uncapped this doubled Pro rallies to 36.6 shots. |

**Difficulty interacts strongly.** Pro's larger stability sweet spot
(`STABILITY.SWEET_SPOT.hard`) makes contacts cleaner, which fills meters faster,
which is why `AI_UNLEASH_P` is tuned against DUPR 5.0 rather than the default.
Always run `tools/play.mjs` (or an equivalent probe) at **both** 4.0 and 5.0, and
in **both** modes — singles and doubles have different pass criteria (see
GAMEPLAY.md → "Singles is deliberately brutal").
