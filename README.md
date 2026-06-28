# Pickleball 3D (standalone)

A self-contained Three.js doubles pickleball game. You + a CPU partner take on two
CPUs, with real rules (diagonal serve, two-bounce, non-volley kitchen, side-out to
11 win-by-2) and arcade-tuned physics. The gameplay — shot model, momentum aiming,
swing-timing window, AI, and broadcast camera — is ported from the Picklelife 3D
match but fully decoupled from the 2D overworld (no music, character skinning,
venues, or save system).

## Run

No build step. Modern Three.js is loaded via an importmap from a CDN, so just serve
the folder over HTTP and open it (ES modules don't load from `file://`):

```bash
cd pb3d
npx serve .        # or: python3 -m http.server
# then open the printed localhost URL
```

## Controls

**Desktop:** `WASD` / arrows move · mouse X aims · `Space` = power (drive/speedup) ·
`V` = touch (drop/dink) · `B` = lob · `Enter`/`Space` serves. Left/right/middle mouse
buttons mirror power/touch/lob.

**Touch:** left thumb = move stick · right thumb = swing & aim swipe (hard/fast swipe
= power, soft = touch, flick up = lob). A SERVE button appears on your serve.

The swing opens a ~0.3s timing window; the hit fires when the ball enters your strike
zone during that window. The held move direction at contact steers the shot
(left/right = cross-court vs line, forward/back = deeper/shorter), previewed by the
white aim ring on the opponents' court.

## Layout

```
src/
  constants.js  court geometry + all tuning (physics/shots/AI/camera/hit) — single source
  physics.js    ball integration, net-aware launch solver        (pure, no Three)
  shots.js      5 shot types + intent/zone classification         (pure)
  rules.js      doubles side-out scoring + rally state machine     (pure)
  ai.js         opponent positioning + shot selection (4 levels)   (pure)
  input.js      desktop + dual-thumb touch controls
  scene.js      court, net, lighting, ball + trail, fence, trees   (Three)
  players.js    Mii-style rig + cross-body swing animation         (Three)
  camera.js     broadcast camera + follow/shake                    (Three)
  game.js       orchestrator: state machine, hit model, doubles movement
  hud.js        DOM HUD (score, serve dots, callout, banner, shot tag)
  main.js       bootstrap: difficulty picker -> game -> rAF loop
```

## Tests

```bash
node test/logic.test.mjs   # pure-logic assertions (physics/shots/rules/ai), no Three
node tools/shoot.mjs       # headless render smoke test (needs playwright); writes tools/shots/*.png
```
