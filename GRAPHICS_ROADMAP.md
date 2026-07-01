# Graphics Overhaul Roadmap

This file is the durable source of truth for the PB3D graphics upgrade. Every
graphics-overhaul session should read this file, update checklist state, and add
a session log entry before stopping.

## Goal

Upgrade Pickleball 3D from a primitive/procedural Three.js presentation to a
premium stylized sports-game look while preserving the current gameplay, rules,
shot feel, controls, music system, and static web/Vercel deployability.

Target direction:
- Premium stylized 3D sports game, not photoreal.
- Clear follow-mode gameplay readability.
- Richer court materials, lighting, shadows, ball effects, venues, and player
  presentation.
- Browser-first Three.js app that can still deploy as static assets.

## Non-Negotiable Gameplay Invariants

- Preserve swing and ball-contact feel.
- Preserve `HIT.SWING_WINDOW`, player `contactT`, paddle/contact timing, and
  current human/CPU hit dispatch behavior.
- Preserve the 4-shot pattern: deep serve, deep return, serving-team drop,
  kitchen battle.
- Preserve side-out scoring, two-bounce rule, kitchen faults, serve rotation,
  ATP/Erne/poach behavior, and current difficulty behavior.
- Keep pure modules pure: no Three.js, DOM, or browser dependency in
  `constants`, `physics`, `shots`, `rules`, `ai`, or `utils`.
- Keep tuning numbers in `src/constants.js` and `src/shots.js`; do not scatter
  gameplay constants into render modules.
- Ball readability beats visual richness. Do not add effects, lighting, or
  camera changes that make the ball harder to track.
- The game must remain deployable as a static web app, preferably Vercel-ready.

## Current Architecture Notes

- Current app uses Vite with npm `three` r160 and remains deployable as static
  output from `npm run build`.
- Current visuals are mostly procedural primitives in `src/scene.js` and
  `src/players.js`.
- Current render setup is in `Game._initThree()` in `src/game.js`.
- Current screenshot smoke test is `npm run shots` / `node tools/shoot.mjs`.
- Current live AI-vs-AI visual test is `node tools/play.mjs`.
- Current logic test is `npm test` / `node test/logic.test.mjs`.
- Current music catalog is generated and should remain data-driven.

## Phase Checklist

### Phase 0: Baseline And Guardrails

- [x] Run `node test/logic.test.mjs`.
- [x] Run `node tools/shoot.mjs`.
- [x] Inspect generated screenshots in `tools/shots/`.
- [x] Capture notes about current visual baseline and any existing failures.
- [x] Confirm no gameplay tuning changes are needed for initial graphics work.

### Phase 1: Modern Web Build

- [x] Convert project to Vite while preserving ES module structure.
- [x] Install/use npm `three` instead of CDN importmap.
- [x] Add/update scripts: `dev`, `build`, `preview`, `test`, screenshot smoke.
- [x] Ensure static build output is Vercel-compatible.
- [x] Keep pure gameplay tests working unchanged.
- [x] Update tooling/docs if commands change.

### Phase 2: Rendering Foundation

- [x] Upgrade renderer color management and tone mapping.
- [x] Add improved shadow setup.
- [x] Add optional post-processing path.
- [x] Add anti-aliasing/post AA strategy.
- [x] Add bloom or glow support suitable for ball/lights.
- [x] Add quality presets or runtime quality controls.
- [x] Provide a low-cost/mobile-safe fallback.

### Phase 3: Procedural Visual Upgrade

- [x] Improve court material/texture while preserving regulation geometry.
- [x] Improve court lines, kitchen/court contrast, and surface scuffs.
- [x] Improve day/night/indoor lighting.
- [x] Improve ball material, glow, trail, and contact shadow.
- [x] Improve player marker and aim marker polish.
- [x] Improve current procedural venue atmosphere before requiring external
  authored assets.
- [x] Verify gameplay camera readability after visual changes.

### Phase 4: Asset Pipeline

- [x] Add `assets/` folder structure for models, textures, HDR/environment, and
  animations.
- [x] Add GLTF/GLB loader support.
- [x] Add graceful fallback when optional assets are missing.
- [x] Add loading/preload flow for game-critical assets.
- [x] Add asset optimization notes or tooling path for GLB/texture compression.

### Phase 5: Venue Upgrade

- [x] Replace or augment park scenery with authored/loaded assets.
- [x] Replace or augment tropical scenery with authored/loaded assets.
- [x] Replace or augment indoor scenery with authored/loaded assets.
- [x] Use instancing or shared materials for repeated props.
- [x] Preserve venue, palette, and time-of-day menu choices.
- [x] Keep procedural fallback available until new assets are fully verified.

### Phase 6: Player Model Upgrade

- [x] Add support for skinned/animated player models.
- [x] Preserve current primitive player implementation as fallback.
- [x] Support team color/material slots.
- [x] Support paddle attachment and `paddleWorld` equivalent.
- [x] Support height/build/hair/headwear variants or an equivalent readable
  player identity system.

### Phase 6.5: One-Character Visual POC

- [x] Interject a visible player-art POC before continuing full animation work.
- [x] Apply the POC to only one roster slot for side-by-side comparison.
- [x] Keep the primitive rig and paddle contact timing as the gameplay source.
- [x] Add a reproducible local generation path for the POC GLB.
- [x] Verify the POC remains readable in gameplay and mobile screenshots.

### Phase 7: Animation Integration

- [x] Add idle animation.
- [x] Add run/jog animation.
- [x] Add ready stance.
- [x] Add forehand animation.
- [x] Add backhand animation.
- [x] Add serve animation.
- [x] Add smash/overhead animation if practical.
- [x] Blend idle/run/swing states without breaking movement.
- [x] Align animation contact frame with current gameplay hit timing.
- [x] Verify human swing, CPU hit, serve, poach, ATP, and Erne timing.

### Phase 8: Effects And Juice

- [x] Add paddle-hit effect.
- [x] Add bounce/contact effect.
- [x] Add net-hit effect.
- [x] Add optional point/serve camera polish.
- [x] Add optional point celebration or reaction animations.
- [x] Keep all effects readable and performance-safe.

### Phase 9: Performance And Verification

- [x] Run `node test/logic.test.mjs`.
- [x] Run screenshot smoke test.
- [x] Inspect screenshots manually.
- [x] Run headed AI-vs-AI match with `node tools/play.mjs` when feasible.
- [x] Verify mobile viewport rendering.
- [x] Verify build output.
- [x] Check asset sizes and loading behavior.
- [x] Confirm Vercel/static deployment compatibility.

## Verification Commands

Use these commands unless a later phase intentionally updates them:

```bash
npm test
npm run shots
node tools/play.mjs
npm run build
```

After visual changes, screenshots must be inspected manually. Do not claim visual
success from a passing command alone.

## Visual Acceptance Criteria

- Ball is easy to see in follow, broadcast, and top-down modes.
- Court lines are readable at gameplay camera distance.
- Players are distinct by team/role.
- Hit, bounce, and trail effects support gameplay readability instead of
  obscuring it.
- Day/night/indoor/tropical variants remain visually distinct.
- Mobile viewports remain playable and uncluttered.
- Performance can degrade gracefully through quality settings.

## Asset Pipeline Notes

- Prefer `.glb` for bundled models.
- Prefer compressed GLB assets when asset size becomes meaningful.
- Use shared materials and instancing for repeated venue props.
- Lazy-load non-selected venues where practical.
- Keep music discovery data-driven through `music/catalog.js`; do not introduce
  browser-side folder enumeration.

## Session Log

Add a new entry after every graphics-overhaul session:

```md
### YYYY-MM-DD - Short Session Title

- Phase worked on:
- Completed checklist items:
- Files changed:
- Tests/checks run:
- Screenshots inspected:
- Gameplay risks noticed:
- Blockers:
- Next recommended step:
```

### 2026-07-01 - Phases 0-3 Graphics Foundation

- Phase worked on: Phases 0, 1, 2, and 3.
- Completed checklist items: all Phase 0 baseline/guardrail items; all Phase 1
  Vite/npm Three/static build items; all Phase 2 renderer foundation items; all
  Phase 3 procedural visual upgrade items.
- Files changed: `package.json`, `package-lock.json`, `vite.config.js`,
  `index.html`, `.gitignore`, `src/game.js`, `src/scene.js`, `tools/shoot.mjs`,
  `tools/play.mjs`, `tools/test-3shots.mjs`, `tools/vite-test-server.mjs`,
  `tools/copy-static-assets.mjs`, `AGENTS.md`, `README.md`,
  `GRAPHICS_ROADMAP.md`.
- Tests/checks run: baseline `node test/logic.test.mjs` passed 29 assertions;
  baseline `node tools/shoot.mjs` passed after local-server approval; `npm test`
  passed 29 assertions after Vite/render changes; `npm run build` passed and
  copied `music/active` into `dist/music/active`; `npm run shots` passed after
  Vite/tooling changes; mobile Playwright render check at `390x844` with
  `?quality=medium` passed with no page errors; final `npm run shots` passed.
- Screenshots inspected: baseline and upgraded `court.png`, `court-night.png`,
  `court-indoor-blue.png`, `court-tropical-day.png`, `roster-closeup.png`,
  upgraded `rally-0.png`, `rally-1.png`, `rally-2.png`, and
  `mobile-check.png`.
- Gameplay risks noticed: no pure gameplay modules were changed; `HIT`, shot
  profiles, physics/rules/AI modules, hit dispatch, poach/specialty logic, and
  player `contactT`/`paddleWorld` API were left untouched. Visual-only risk:
  desktop high quality now uses post-processing bloom, so keep checking ball
  contrast in future night/indoor changes.
- Blockers: none. Notes: npm reported 2 dependency audit findings after adding
  Vite/Three, and Vite warns the bundled chunk is over 500 kB because Three and
  post-processing are in the main bundle.
- Next recommended step: begin Phase 4 by adding an `assets/` structure plus
  GLTF/GLB loading with procedural fallbacks; consider code-splitting the
  optional post-processing path before adding large authored assets.

### 2026-07-01 - Phase 4 Asset Pipeline

- Phase worked on: Phase 4.
- Completed checklist items: added the `assets/` folder structure for models,
  textures, environments, and animations; added GLTF/GLB loader support through
  `src/assets.js`; added empty-manifest fallback behavior so optional missing
  assets do not request files or block play; added startup preload before match
  creation; documented the GLB/texture optimization path.
- Files changed: `assets/README.md`, `assets/manifest.js`,
  `assets/models/venues/.gitkeep`, `assets/models/players/.gitkeep`,
  `assets/textures/court/.gitkeep`, `assets/textures/venues/.gitkeep`,
  `assets/environments/.gitkeep`, `assets/animations/.gitkeep`,
  `src/assets.js`, `src/main.js`, `src/game.js`, `src/scene.js`,
  `tools/copy-static-assets.mjs`, `GRAPHICS_ROADMAP.md`.
- Tests/checks run: `npm test` passed 29 assertions; `npm run build` passed and
  copied `assets/` into `dist/assets`; `npm run shots` passed and verified the
  serve/rally/scoring loop.
- Screenshots inspected: `court.png`, `court-night.png`,
  `court-indoor-blue.png`, `court-tropical-day.png`, `rally-0.png`, and
  `roster-closeup.png`.
- Gameplay risks noticed: no pure gameplay modules were changed; `HIT`, shot
  profiles, physics/rules/AI modules, hit dispatch, poach/specialty logic,
  player `contactT`/`paddleWorld`, and the 4-shot pattern were left untouched.
  Visual-only risk: adding `GLTFLoader` increases the already-large main bundle,
  and no authored GLBs exist yet, so this verifies the fallback path rather than
  final asset placement. The indoor ceiling crop remains visible in screenshots
  and appears pre-existing from the procedural shell.
- Blockers: none. Notes: Vite still warns that the main bundle is over 500 kB.
- Next recommended step: begin Phase 5 with a small authored or placeholder
  venue-prop GLB for one venue, verify placement through the manifest hook, then
  decide whether to code-split the asset loader/post-processing before adding
  larger venue packs.

### 2026-07-01 - Phase 5 Park Venue Prop GLB

- Phase worked on: Phase 5.
- Completed checklist items: replaced/augmented park scenery with a loaded
  placeholder venue prop GLB; preserved venue, palette, and time-of-day menu
  choices; kept procedural fallback available through optional manifest loading
  and unchanged procedural venue generation.
- Files changed: `assets/manifest.js`,
  `assets/models/venues/park-props.glb`, `GRAPHICS_ROADMAP.md`.
- Tests/checks run: `npm test` passed 29 assertions; `npm run build` passed and
  copied the final `assets/` tree into `dist/assets`; `npm run shots` passed
  after the initial GLB hookup and again after moving the prop placement to the
  far-side venue band.
- Screenshots inspected: `court.png`, `court-night.png`, `rally-0.png`,
  `roster-closeup.png`, `court-tropical-day.png`, and `court-indoor-blue.png`.
- Gameplay risks noticed: no pure gameplay modules were changed; `HIT`, shot
  profiles, physics/rules/AI modules, hit dispatch, poaching, ATP/Erne,
  player `contactT`/`paddleWorld`, and the 4-shot pattern were left untouched.
  Visual-only risk: the park GLB is intentionally a tiny placeholder bench/sign,
  and the far-side sign is partially behind serve banner text in the default
  serve screenshot, though it is clear in the roster close-up and stays outside
  the playable court/fence footprint.
- Blockers: none. Notes: Vite still warns that the main bundle is over 500 kB.
- Next recommended step: add a similarly small authored/placeholder prop GLB for
  the tropical venue, then introduce manifest-level placement metadata or a small
  venue prop adapter before scaling up to larger repeated prop sets.

### 2026-07-01 - Phase 5 Tropical Venue Prop GLB

- Phase worked on: Phase 5.
- Completed checklist items: replaced/augmented tropical scenery with a loaded
  placeholder venue prop GLB while preserving the procedural tropical sand,
  water, palms, venue/palette/time-of-day choices, and optional fallback path.
- Files changed: `assets/manifest.js`,
  `assets/models/venues/tropical-props.glb`, `GRAPHICS_ROADMAP.md`.
- Tests/checks run: `npm test` passed 29 assertions; `npm run build` passed and
  copied `assets/` into `dist/assets`; `npm run shots` passed and verified the
  serve/rally/scoring loop.
- Screenshots inspected: `court-tropical-day.png`,
  `court-tropical-night.png`, `court.png`, `court-indoor-blue.png`, and
  `rally-0.png`.
- Gameplay risks noticed: no pure gameplay modules were changed; `HIT`, shot
  profiles, physics/rules/AI modules, hit dispatch, poaching, ATP/Erne,
  player `contactT`/`paddleWorld`, and the 4-shot pattern were left untouched.
  Visual-only risk: the tropical placeholder prop sits in the far-side scenery
  band and is partly crossed by the default serve banner, but it stays outside
  the playable court footprint and does not affect ball readability.
- Blockers: none. Notes: Vite still warns that the main bundle is over 500 kB.
- Next recommended step: add the indoor venue placeholder GLB, then consider a
  small manifest-level placement adapter before scaling to repeated prop sets
  or marking the instancing/shared-materials Phase 5 item complete.

### 2026-07-01 - Phase 5 Indoor Venue Prop GLB

- Phase worked on: Phase 5.
- Completed checklist items: replaced/augmented indoor scenery with a loaded
  placeholder venue prop GLB while preserving the procedural gym shell and
  optional fallback path.
- Files changed: `assets/manifest.js`,
  `assets/models/venues/indoor-props.glb`, `GRAPHICS_ROADMAP.md`.
- Tests/checks run: `npm test` passed 29 assertions; `npm run build` passed and
  copied `assets/` into `dist/assets`; `npm run shots` passed and verified the
  serve/rally/scoring loop; an extra HUD-hidden indoor prop inspection screenshot
  was captured with a short Playwright/Vite check.
- Screenshots inspected: `court-indoor-blue.png`,
  `court-indoor-green.png`, `indoor-props-check.png`, `court.png`, and
  `rally-0.png`.
- Gameplay risks noticed: no pure gameplay modules were changed; `HIT`, shot
  profiles, physics/rules/AI modules, hit dispatch, poaching, ATP/Erne,
  player `contactT`/`paddleWorld`, and the 4-shot pattern were left untouched.
  Visual-only risk: the indoor prop is intentionally a small placeholder cluster
  in the far-side scenery band, and part of it is crossed by the default serve
  banner in normal screenshots.
- Blockers: none. Notes: Vite still warns that the main bundle is over 500 kB.
- Next recommended step: address the Phase 5 repeated-prop checklist item with
  a small shared-material or instancing pass before broad venue replacement.

### 2026-07-01 - Phase 5 Repeated Prop Instancing

- Phase worked on: Phase 5.
- Completed checklist items: used instancing/shared materials for repeated
  procedural venue props by converting park/tropical tree scatter, tropical palm
  scatter, and fence posts to `THREE.InstancedMesh` while preserving authored
  GLB loading and procedural scenery fallback.
- Files changed: `src/scene.js`, `GRAPHICS_ROADMAP.md`.
- Tests/checks run: `npm test` passed 29 assertions; `npm run build` passed and
  copied `assets/` into `dist/assets`; `npm run shots` passed and verified the
  serve/rally/scoring loop.
- Screenshots inspected: `court.png`, `court-tropical-day.png`,
  `court-indoor-blue.png`, `court-night.png`, `mobile-check.png`, and
  `rally-0.png`.
- Gameplay risks noticed: no pure gameplay modules were changed; `HIT`, shot
  profiles, physics/rules/AI modules, hit dispatch, poaching, ATP/Erne,
  player `contactT`/`paddleWorld`, and the 4-shot pattern were left untouched.
  Visual-only risk: palm fronds now use instanced transforms instead of child
  meshes, so continue checking tropical silhouettes when replacing placeholder
  venue assets with richer authored props.
- Blockers: none. Notes: Vite still warns that the main bundle is over 500 kB.
- Next recommended step: begin Phase 6 by adding player-model support behind the
  current primitive player fallback, starting with team color/material slots and
  a preserved paddle attachment/`paddleWorld` equivalent.

### 2026-07-01 - Phase 6 Player Model Adapter

- Phase worked on: Phase 6.
- Completed checklist items: added support for skinned/animated player models
  through a `player-base` asset adapter; preserved the primitive player
  implementation as the fallback and canonical gameplay driver; added team color
  and material-slot tinting for authored player meshes.
- Files changed: `src/assets.js`, `src/players.js`, `src/game.js`,
  `assets/manifest.js`, `assets/README.md`, `GRAPHICS_ROADMAP.md`.
- Tests/checks run: `npm test` passed 29 assertions; `npm run build` passed and
  copied `assets/` into `dist/assets`; `npm run shots` passed and verified the
  serve/rally/scoring loop; a synthetic Node adapter check instantiated a
  skinned player model, updated its mixer, swung, and confirmed `contactT ===
  0.5` plus a live `paddleWorld`.
- Screenshots inspected: `roster-closeup.png`, `court.png`,
  `court-night.png`, `court-tropical-day.png`, `court-tropical-night.png`,
  `court-indoor-blue.png`, `mobile-check.png`, `rally-0.png`, and
  `rally-1.png`.
- Gameplay risks noticed: no pure gameplay modules were changed; `HIT`, shot
  profiles, physics/rules/AI modules, hit dispatch, poaching, ATP/Erne,
  two-bounce/kitchen behavior, and the 4-shot pattern were left untouched. The
  primitive rig still owns swing timing, `contactT`, and `paddleWorld`; when an
  authored model is present only the primitive body hides while the primitive
  paddle remains visible and gameplay-canonical.
- Blockers: no real skinned player GLB exists yet, so the active screenshot path
  still verifies the primitive fallback. Notes: Vite still warns that the main
  bundle is over 500 kB.
- Next recommended step: add a tiny placeholder `assets/models/players/`
  `player-base.glb` with named material slots and a simple idle/run/swing clip,
  then verify authored-model alignment before marking paddle socket and identity
  variant support complete.

### 2026-07-01 - Phase 6.5 One-Character Visual POC

- Phase worked on: Phase 6.5.
- Completed checklist items: interjected a visible player-art POC before Phase 7;
  applied the POC only to the human roster slot for direct comparison against
  the three primitive players; kept the primitive rig and paddle contact timing
  as the gameplay source; added a reproducible local generator for the POC GLB;
  verified the POC in gameplay and mobile screenshots.
- Files changed: `GRAPHICS_ROADMAP.md`, `assets/manifest.js`,
  `assets/README.md`, `assets/models/players/player-poc.glb`,
  `src/game.js`, `src/players.js`, `tools/generate-player-poc.mjs`.
- Tests/checks run: `npm test` passed 29 assertions; `npm run build` passed and
  copied `assets/` into `dist/assets`; `npm run shots` passed and verified the
  serve/rally/scoring loop after the initial POC and again after adding authored
  arm meshes synced to the primitive swing rig.
- Screenshots inspected: `roster-closeup.png`, `court.png`,
  `mobile-check.png`, `rally-0.png`, `court-night.png`, and
  `court-indoor-blue.png`.
- Gameplay risks noticed: no pure gameplay modules were changed; `HIT`, shot
  profiles, physics/rules/AI modules, hit dispatch, poaching, ATP/Erne,
  two-bounce/kitchen behavior, and the 4-shot pattern were left untouched. The
  human POC hides the primitive body, but the primitive rig still drives arm
  rotations, swing timing, `contactT`, and `paddleWorld`; only the primitive
  paddle remains visible as the gameplay-canonical paddle.
- Blockers: this is still a lightweight authored-style GLB generated from Three
  primitives, not final photoreal scanned/rigged character art. Notes: Vite
  still warns that the main bundle is over 500 kB, and the POC GLB is about
  383 kB.
- Next recommended step: decide whether the desired target is premium stylized
  or actual photoreal licensed assets; if staying in-repo, continue with a
  proper paddle socket on the authored model, then expand the POC into reusable
  player identity variants.

### 2026-07-01 - Phase 6 Player Socket And Identity Variants

- Phase worked on: Phase 6.
- Completed checklist items: support paddle attachment and `paddleWorld`
  equivalent for authored player models; support height/build/hair/headwear
  variants through the authored player identity system.
- Files changed: `src/players.js`, `src/game.js`, `assets/manifest.js`,
  `assets/README.md`, `assets/models/players/player-poc.glb`,
  `tools/generate-player-poc.mjs`, `GRAPHICS_ROADMAP.md`.
- Tests/checks run: `node tools/generate-player-poc.mjs` regenerated the POC
  GLB; `npm test` passed 29 assertions; a Node GLB structure check confirmed
  `paddle_socket`, five variant groups, and the expected clips; `npm run build`
  passed and copied assets into `dist/`; `npm run shots` passed and verified the
  serve/rally/scoring loop; an extra mobile Playwright capture refreshed
  `tools/shots/mobile-check.png`.
- Screenshots inspected: `roster-closeup.png`, `court.png`, `rally-0.png`,
  `court-night.png`, `court-tropical-day.png`, `court-indoor-blue.png`, and
  `mobile-check.png`.
- Gameplay risks noticed: no pure gameplay modules were changed; `HIT`, shot
  profiles, physics/rules/AI modules, hit dispatch, poaching, ATP/Erne,
  two-bounce/kitchen behavior, and the 4-shot pattern were left untouched. The
  primitive rig still owns swing timing and `contactT`; authored models now
  attach the visible primitive paddle to a named `paddle_socket` when present,
  and refresh `paddleWorld` from the same blade after arm sync. Visual-only
  risk: all four roster slots now use the generated POC when it loads, so future
  screenshots should keep checking player silhouette clarity and ball contrast.
- Blockers: none. Notes: Vite still warns that the main bundle is over 500 kB,
  and `player-poc.glb` is now about 498 kB after adding socket and variant
  nodes.
- Next recommended step: begin Phase 7 by adding/aligning idle, run, ready, and
  swing animation blends against the existing primitive contact frame, with
  explicit checks for human swing, CPU hits, serve, poach, ATP, and Erne timing.

### 2026-07-01 - Phase 7 Ready Stance And Swing Blend

- Phase worked on: Phase 7.
- Completed checklist items: added an authored ready-stance loop to the
  generated player POC; blended in-match stationary players to ready, moving
  players to run, and one-shot swings back to locomotion; scaled authored swing
  clips to the primitive swing duration so the authored contact frame remains
  aligned with `contactT = 0.5`; verified human swing, CPU hit, serve, poach,
  ATP, and Erne animation triggers.
- Files changed: `src/players.js`, `src/game.js`, `assets/manifest.js`,
  `assets/README.md`, `assets/models/players/player-poc.glb`,
  `tools/generate-player-poc.mjs`, `GRAPHICS_ROADMAP.md`.
- Tests/checks run: `node tools/generate-player-poc.mjs`; `npm test` passed 29
  assertions; a Node GLB structure/duration check confirmed `idle`, `ready`,
  `run`, `forehand`, `backhand`, and `serve` clips with swing clips still at
  `0.44s`; a focused Playwright/Vite probe confirmed ready/run loops, real serve
  animation, human backhand animation, CPU hit animation, poach swing, ATP
  swing, Erne swing, `contactT === 0.5`, and authored swing scale ~1.0;
  `npm run build` passed and copied assets into `dist/`; `npm run shots` passed
  and verified the serve/rally/scoring loop; an extra mobile Playwright capture
  refreshed `tools/shots/mobile-check.png`.
- Screenshots inspected: `roster-closeup.png`, `court.png`, `rally-0.png`,
  `rally-1.png`, `rally-2.png`, `court-night.png`,
  `court-tropical-day.png`, `court-indoor-blue.png`, and
  `mobile-check.png`.
- Gameplay risks noticed: no pure gameplay modules were changed; `HIT`, shot
  profiles, physics/rules/AI modules, hit dispatch, poaching, ATP/Erne,
  two-bounce/kitchen behavior, and the 4-shot pattern were left untouched. The
  primitive rig still owns swing timing, `contactT`, and `paddleWorld`; authored
  clips only add visual torso/leg/stance motion around that timing. Visual-only
  risk: the ready crouch makes near players fill slightly more screen space on
  mobile, so keep checking ball contrast and HUD overlap as authored motion gets
  richer.
- Blockers: none. Notes: Vite still warns that the main bundle is over 500 kB,
  and `player-poc.glb` is about 500 kB after adding the ready clip.
- Next recommended step: add dedicated authored forehand/backhand/serve clips
  with clearer anticipation and follow-through poses, then add a small overhead
  or smash clip once the existing contact-frame checks stay green.

### 2026-07-01 - Phase 7 Swing Clip Polish

- Phase worked on: Phase 7.
- Completed checklist items: marked idle and run/jog animation complete from
  the existing generated POC clips; improved and marked forehand, backhand, and
  serve animation complete with clearer authored anticipation/contact/follow-
  through body poses while keeping the primitive contact frame unchanged.
- Files changed: `tools/generate-player-poc.mjs`,
  `assets/models/players/player-poc.glb`, `GRAPHICS_ROADMAP.md`.
- Tests/checks run: `node tools/generate-player-poc.mjs`; GLB clip
  structure/duration check confirmed `idle`, `ready`, `run`, `forehand`,
  `backhand`, and `serve`, with `forehand`/`backhand`/`serve` still `0.44s`
  and keyed at `0.22s`; `npm test` passed 29 assertions; `npm run build`
  passed and copied assets into `dist/`; `npm run shots` passed and verified
  the serve/rally/scoring loop; a focused Playwright/Vite probe confirmed real
  serve animation, human backhand swing animation, CPU hit animation,
  `contactT === 0.5`, `_swingDur === 0.44`, and authored swing scale ~1.0.
- Screenshots inspected: `roster-closeup.png`, `court.png`, `rally-0.png`,
  `rally-1.png`, `rally-2.png`, `court-night.png`,
  `court-tropical-day.png`, `court-indoor-blue.png`, and
  `mobile-check.png`.
- Gameplay risks noticed: no pure gameplay modules were changed; `HIT`, shot
  profiles, physics/rules/AI modules, hit dispatch, poaching, ATP/Erne,
  two-bounce/kitchen behavior, and the 4-shot pattern were left untouched. The
  primitive rig still owns swing timing, `contactT`, gameplay contact, and
  `paddleWorld`; authored clips only add torso/hip/leg anticipation and finish
  around the same midpoint contact. Visual-only risk: stronger follow-through
  poses can make near-player silhouettes broader in mobile views, so keep
  checking ball and paddle readability.
- Blockers: none. Notes: Vite still warns that the main bundle is over 500 kB,
  and `player-poc.glb` is now about 507 kB.
- Next recommended step: add a narrowly routed authored smash/overhead visual
  only if it can be triggered without changing shot selection, contact timing,
  or the primitive rig's gameplay authority; otherwise move to Phase 8 hit and
  bounce effects.

### 2026-07-01 - Phase 7 Smash Visual

- Phase worked on: Phase 7.
- Completed checklist items: added a narrow smash/overhead animation path. The
  generated POC GLB now includes a `smash` clip at `0.44s`, keyed on the same
  `0.22s` contact frame as the other swing clips. Human and CPU smash/Erne
  branches now route only their visual swing type to `smash`; shot selection,
  hit dispatch, timing windows, shot execution, and gameplay authority were
  left unchanged.
- Files changed: `tools/generate-player-poc.mjs`,
  `assets/models/players/player-poc.glb`, `src/players.js`, `src/game.js`,
  `GRAPHICS_ROADMAP.md`.
- Tests/checks run: `node tools/generate-player-poc.mjs`; GLB clip
  structure/duration check confirmed `idle`, `ready`, `run`, `forehand`,
  `backhand`, `serve`, and `smash`, with all swing clips still `0.44s`;
  `npm test` passed 29 assertions; `npm run build` passed and copied assets
  into `dist/`; a focused Playwright/Vite probe forced human and CPU smash
  contacts and confirmed active authored `smash`, `contactT === 0.5`,
  `_swingDur === 0.44`, and authored swing scale ~1.0; `npm run shots` passed
  and verified the serve/rally/scoring loop.
- Screenshots inspected: `smash-human.png`, `smash-cpu.png`,
  `roster-closeup.png`, `court.png`, `rally-0.png`, `mobile-check.png`, and
  `court-night.png`.
- Gameplay risks noticed: no pure gameplay modules were changed; `HIT`, shot
  profiles, physics/rules/AI modules, hit dispatch, poaching, ATP/Erne,
  two-bounce/kitchen behavior, and the 4-shot pattern were left untouched. The
  primitive rig still owns swing timing, `contactT`, paddle/contact timing, and
  `paddleWorld`; the new `smash` pose is visual-only and uses the same
  duration/contact fraction. Visual-only risk: the overhead pose broadens the
  player silhouette during rare high-ball contacts, so keep checking mobile
  readability if the animation becomes more dramatic.
- Blockers: none. Notes: Vite still warns that the main bundle is over 500 kB,
  and `player-poc.glb` is now about 510 kB after adding the smash clip.
- Next recommended step: move to Phase 8 with a tiny paddle-hit or
  bounce/contact visual effect, keeping it short-lived and low-opacity so the
  neon ball remains easy to track.

### 2026-07-01 - Phase 8 Paddle Hit Pop

- Phase worked on: Phase 8.
- Completed checklist items: added a paddle-hit effect.
- Files changed: `src/game.js`, `GRAPHICS_ROADMAP.md`.
- Tests/checks run: `npm test` passed 29 assertions; `npm run build` passed and
  copied assets/music into `dist/` with the existing over-500 kB bundle warning;
  focused Playwright/Vite probe confirmed the hit effect triggers on serve
  contact, fades to hidden, and is not created in `?quality=low`; `npm run shots`
  passed and verified the serve/rally/scoring loop.
- Screenshots inspected: `court.png`, `court-night.png`,
  `court-indoor-blue.png`, `rally-0.png`, `mobile-check.png`, and
  `hit-fx-serve.png`.
- Gameplay risks noticed: no pure gameplay modules were changed; `HIT`, shot
  profiles, physics/rules/AI modules, hit dispatch, poaching, ATP/Erne,
  two-bounce/kitchen behavior, and the 4-shot pattern were left untouched. The
  primitive rig still owns swing timing, `contactT`, paddle/contact timing,
  gameplay contact, and `paddleWorld`; the effect is triggered only after the
  existing paddle/serve/poach contact branches have already fired. Visual-only
  risk: the hollow hit sprite draws above depth so it can appear over the near
  player in close follow-camera contacts, but it lasts only `0.18s`, is below
  the ball ghost render order, and is skipped entirely on low quality.
- Blockers: none. Notes: Vite still warns that the main bundle is over 500 kB.
- Next recommended step: add an equally small bounce/contact floor effect,
  gated by quality and tuned so it never competes with the neon ball or trail.

### 2026-07-01 - Phase 8 Contact And Net Juice

- Phase worked on: Phase 8.
- Completed checklist items: added a bounce/contact floor effect; added a
  net-hit effect; added small serve camera polish; added subtle point winner
  reaction hops; confirmed effects remain readable and performance-safe.
- Files changed: `src/game.js`, `GRAPHICS_ROADMAP.md`.
- Tests/checks run: `npm test` passed 29 assertions; `npm run build` passed and
  copied assets/music into `dist/` with the existing over-500 kB bundle warning;
  focused Playwright/Vite probe confirmed serve camera shake, bounce effect,
  net effect, point reaction, and low-quality fallback with no effects created;
  `npm run shots` passed and verified the serve/rally/point loop.
- Screenshots inspected: `phase8-effects.png`, `court.png`,
  `court-night.png`, `rally-0.png`, and `mobile-check.png`.
- Gameplay risks noticed: no pure gameplay modules were changed; `HIT`, shot
  profiles, physics/rules/AI modules, hit dispatch, poaching, ATP/Erne,
  two-bounce/kitchen behavior, and the 4-shot pattern were left untouched. The
  primitive rig still owns swing timing, `contactT`, paddle/contact timing,
  gameplay contact, and `paddleWorld`; the new effects are triggered only from
  existing visual/audio event hooks after gameplay events have already occurred.
  Visual-only risk: the net sprite draws above depth like the paddle-hit pop,
  but lasts only `0.22s`, stays below the ball ghost render order, and is
  skipped on low quality.
- Blockers: none. Notes: Vite still warns that the main bundle is over 500 kB.
- Next recommended step: begin Phase 9 with a broader verification pass,
  including a headed AI-vs-AI match when feasible and final mobile/build/static
  deployment checks.

### 2026-07-01 - Phase 9 Verification Pass

- Phase worked on: Phase 9.
- Completed checklist items: all Phase 9 verification items. Ran pure logic,
  screenshot smoke, headed AI-vs-AI, mobile viewport, build, asset-size/loading,
  and production-preview/static deploy checks.
- Files changed: `index.html`, `GRAPHICS_ROADMAP.md`.
- Tests/checks run: `npm test` passed 29 assertions before and after the
  visual fix; `npm run shots` passed before and after the fix and verified the
  serve/rally/point loop; mobile Playwright checks passed at `390x844`,
  `320x740`, and `844x390` with no page errors, full-size canvas, medium
  quality, and no HUD/banner overlaps; `npm run build` passed and copied
  `assets/` plus `music/active` into `dist/`; `npm run preview -- --port
  43210` initially required sandbox approval, then served the production build
  successfully with HTTP 200, no page errors, four players, and `serve` state;
  `env SPEED=6 MATCHES=1 MAXSEC=45 node tools/play.mjs` ran headed and cycled
  through repeated serve/rally/point states to `near 2 : 5 far` before the
  safety cap, with no reported page errors.
- Screenshots inspected: `court.png`, `court-night.png`,
  `court-tropical-day.png`, `court-indoor-blue.png`, `rally-0.png`,
  `rally-1.png`, `rally-2.png`, `phase8-effects.png`,
  `roster-closeup.png`, `mobile-portrait-phase9.png`,
  `mobile-small-phase9.png`, and `mobile-landscape-phase9.png`.
- Gameplay risks noticed: no pure gameplay modules were changed; `HIT`, shot
  profiles, physics/rules/AI modules, hit dispatch, poaching, ATP/Erne,
  two-bounce/kitchen behavior, player `contactT`/`paddleWorld`, and the 4-shot
  pattern were left untouched. The primitive rig remains the gameplay source.
  Visual-only fix: compact mobile HUD layout now stacks the top-right music
  controls on narrow portrait screens, lowers the score callout slightly, and
  reduces/repositions the transient banner on short landscape screens.
- Blockers: none. Notes: Vite still warns that the main bundle is over 500 kB
  (`dist/assets/index-*.js` about 685 kB minified / 183 kB gzip). Asset-size
  check showed `assets/` about 664 kB, copied `dist/assets/` about 1.3 MB, and
  copied `dist/music/` about 37 MB; music remains the dominant static payload.
  The headed match reached the `MAXSEC=45` cap before a full game over, but the
  live visual loop, scoring transitions, and browser stability were verified.
- Next recommended step: treat Phase 9 as complete for this checkpoint; the next
  graphics pass should focus on reducing the known main-bundle warning via
  code-splitting/manual chunks or continue asset polish with the same mobile HUD
  checks in place.

## Resume Prompt

For a new session, use:

```text
Read AGENTS.md, GAMEPLAY.md, and GRAPHICS_ROADMAP.md. Continue the graphics
overhaul from the next unchecked item. Preserve all gameplay invariants. Before
editing, inspect the current repo state and summarize what phase we are in.
After changes, update GRAPHICS_ROADMAP.md with completed checklist items, tests
run, screenshots inspected, risks, blockers, and next recommended step.
```
