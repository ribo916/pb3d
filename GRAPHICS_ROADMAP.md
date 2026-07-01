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
- [ ] Use instancing or shared materials for repeated props.
- [x] Preserve venue, palette, and time-of-day menu choices.
- [x] Keep procedural fallback available until new assets are fully verified.

### Phase 6: Player Model Upgrade

- [ ] Add support for skinned/animated player models.
- [ ] Preserve current primitive player implementation as fallback.
- [ ] Support team color/material slots.
- [ ] Support paddle attachment and `paddleWorld` equivalent.
- [ ] Support height/build/hair/headwear variants or an equivalent readable
  player identity system.

### Phase 7: Animation Integration

- [ ] Add idle animation.
- [ ] Add run/jog animation.
- [ ] Add ready stance.
- [ ] Add forehand animation.
- [ ] Add backhand animation.
- [ ] Add serve animation.
- [ ] Add smash/overhead animation if practical.
- [ ] Blend idle/run/swing states without breaking movement.
- [ ] Align animation contact frame with current gameplay hit timing.
- [ ] Verify human swing, CPU hit, serve, poach, ATP, and Erne timing.

### Phase 8: Effects And Juice

- [ ] Add paddle-hit effect.
- [ ] Add bounce/contact effect.
- [ ] Add net-hit effect.
- [ ] Add optional point/serve camera polish.
- [ ] Add optional point celebration or reaction animations.
- [ ] Keep all effects readable and performance-safe.

### Phase 9: Performance And Verification

- [ ] Run `node test/logic.test.mjs`.
- [ ] Run screenshot smoke test.
- [ ] Inspect screenshots manually.
- [ ] Run headed AI-vs-AI match with `node tools/play.mjs` when feasible.
- [ ] Verify mobile viewport rendering.
- [ ] Verify build output.
- [ ] Check asset sizes and loading behavior.
- [ ] Confirm Vercel/static deployment compatibility.

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

## Resume Prompt

For a new session, use:

```text
Read AGENTS.md, GAMEPLAY.md, and GRAPHICS_ROADMAP.md. Continue the graphics
overhaul from the next unchecked item. Preserve all gameplay invariants. Before
editing, inspect the current repo state and summarize what phase we are in.
After changes, update GRAPHICS_ROADMAP.md with completed checklist items, tests
run, screenshots inspected, risks, blockers, and next recommended step.
```
