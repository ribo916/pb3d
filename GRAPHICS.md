# Pickleball 3D Graphics Context

This is the durable graphics context for PB3D. The old graphics roadmap is
complete and has been retired; use this file when planning visual, asset,
rendering, venue, player-model, or screenshot-verification work.

## Current State

The graphics-overhaul branch has completed its verification pass through Phase 9.
The game now has:

- Vite + npm Three.js static build output.
- Renderer color management, tone mapping, shadows, quality presets, and a
  mobile-safe fallback path.
- Upgraded procedural courts, lighting, ball glow/trail, court markings, player
  markers, aim marker, and venue atmosphere.
- Optional asset loading through `assets/manifest.js` and `src/assets.js`.
- Placeholder GLB venue props for park, tropical, and indoor venues.
- Instanced/shared-material repeated props for selected procedural scenery.
- The gendered Quaternius-customization roster (`player-male-v1`/
  `player-female-v1`, gender/hair/hair-color/facial-hair/shirt-color/
  pants-color picker) has been **fully retired**. All 4 roster slots now pick
  one of the **12 Mixamo characters** (`ch01`-`ch12`) via a fighting-game-style
  picker (see "Mixamo Character Pipeline" below) — no per-character cosmetic
  customization exists anymore; each Mixamo GLB renders with its own imported
  look untouched (`customizable: false`). The `player-male-v1`/
  `player-female-v1` runtime GLBs and manifest slots have been removed; their
  historical build tooling (`tools/build-player-model.mjs`,
  `tools/paint-player-clothing.mjs`; see `PLAYER-IMPORT.md`) remains only as
  reference.
- Authored-player identity hooks for color slots, scale/build, cosmetic variants,
  paddle socket, and animation clip names. The active Mixamo roster opts out of
  cosmetic tinting with `customizable: false`.
- Visual-only idle/ready/run/forehand/backhand/serve/smash animation blending.
- Player GLB validation and Player 1 comparison screenshot tooling.
- Visual-only paddle-hit, bounce/contact, net-hit, serve camera shake, and point
  reaction effects.
- A procedural Titan-style ball-machine prop for practice mode.
- Practice-only visual coaching aids: machine-feed ball color cue, return
  landing marker, and visual-only overlapping return balls.
- Compact mobile HUD fixes for portrait and short landscape viewports.

The result is crisper and more presentable than the original primitive-only
version, but it is not final premium character presentation. The 12 Mixamo
characters are the active roster; any missing non-`ch01` character falls back to
`ch01`, and if that is unavailable the primitive rig remains the runtime
fallback.

## Branch And Release Status

- Latest graphics checkpoint: `f61aeb4 Complete Phase 9 verification`.
- Work remains on `feature/graphics-overhaul`.
- Do not merge this branch to `master` as-is.
- The branch is useful as a verified rendering/asset/animation scaffold.
- The next serious graphics investment should focus on animation completion,
  team/role identity, and final character presentation, not further code-only
  crispness.

## Non-Negotiable Gameplay Invariants

Graphics work must not change the feel contract:

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
- Ball readability beats visual richness.
- Practice-mode coaching cues must stay legible from gameplay camera distance.
- The primitive rig remains the gameplay source unless a deliberate gameplay
  migration is planned, tested, and explicitly documented.

## Primitive Rig Authority

The authored player model is visual-only scaffolding around the primitive rig.
The primitive rig still owns:

- Swing timing.
- Gameplay contact.
- `contactT`.
- Paddle/contact timing.
- Hit dispatch.
- `paddleWorld`.

The authored GLB can hide the primitive body and drive visible mesh/animation
presentation, but it must not silently become the gameplay collision or contact
source. The visible paddle may attach to `paddle_socket`, but `paddleWorld` must
continue to be refreshed from the gameplay-canonical paddle blade.

## Current Asset Pipeline

Runtime graphics assets live under `assets/`:

```text
assets/
  manifest.js
  models/
    players/
      mixamo/
        ch01.glb .. ch12.glb  (full Mixamo catalog, all 12 gameplay-calibrated)
    venues/
      park-props.glb
      tropical-props.glb
      indoor-props.glb
  textures/
  environments/
  animations/
    pickleball-swings.glb   (shared forehand/backhand/overhead clip library)
```

Important contracts:

- `assets/manifest.js` is the runtime slot map.
- `player-ch01-v1` through `player-ch12-v1` are the active selectable player
  slots, resolved from `src/characters.js`; non-`ch01` slots fall back to
  `player-ch01-v1` if their GLB is absent or fails to load.
- `src/assets.js` loads optional GLB assets and provides fallback-safe access.
- Optional entries should stay optional until their procedural fallback has been
  replaced and verified.
- `tools/copy-static-assets.mjs` copies `assets/` into `dist/assets` during the
  build.
- Prefer `.glb` for bundled models.
- Use shared materials and instancing for repeated props.
- Optimize large GLBs/textures before shipping them.
- Keep music discovery data-driven through `music/catalog.js`; do not introduce
  browser-side folder enumeration.

See `assets/README.md` for the detailed player-model adapter contract.
`PLAYER-IMPORT.md` is retained as the historical Quaternius CC0 pipeline that
once built `player-male-v1` and `player-female-v1`; it is not the active roster
workflow, and those runtime GLBs are no longer shipped.

## Future Player Import Target

For future premium or near-photoreal player graphics, import a real authored or
licensed `.glb` into a new or replacement `player-*` manifest slot and expose it
through `src/characters.js` if it should be selectable. The expected contract is:

- Local `+z` faces forward, origin at the feet, real-world height around
  1.7-1.9 m before manifest scale/offset.
- A named `paddle_socket` lives under the right hand or forearm. The visible
  paddle may attach there, but gameplay contact still comes from the primitive
  paddle blade and `paddleWorld`.
- Color slots are provided through mesh/material names or glTF `extras`
  (`userData.slot` / `userData.materialSlot`) using `jersey`, `shorts`, `skin`,
  `hair`, `shoe`, `headband`, and optionally `paddle`.
- Swing clips keep contact at 50% of the 0.44 s visual swing, matching
  `contactT = 0.5`. Do not change `HIT.SWING_WINDOW` or gameplay timing to fit
  art.
- Player 1 budget target: roughly 30k-60k triangles, optimized GLB, 1k-2k PBR
  textures where needed. Use a lower LOD or the primitive fallback for mobile
  if the premium model is too heavy.
- Run the validator and Player 1 screenshot workflow before accepting the asset.

### Mixamo Character Pipeline

The active character source is 12 Mixamo characters + a shared pickleball
swing-clip library, converted/optimized via a Blender + `@gltf-transform`
pipeline (`tools/blender-fbx-to-gltf.py`, `tools/build-mixamo-character.mjs`,
`tools/build-mixamo-clip-library.mjs`, `tools/lib/mixamo-bones.mjs`). Full
history, every bug found and fixed, and the detailed open-items list live in
[`character-preview/CONTEXT.md`](character-preview/CONTEXT.md) — read it
before touching this pipeline again. `character-preview/` (`index.html`,
`main.js`, `CONTEXT.md`) is git-tracked; only `character-preview/local-clips/`
(the 7 raw FBX sport clips) stays untracked. It's
reached at `/character-preview/` under the normal `npm run dev` server —
there is no separate dev-server process anymore. Status summary:

- **All 12 characters are wired end-to-end and gameplay-calibrated** —
  `assets/manifest.js` has `player-ch01-v1`…`player-ch12-v1` model entries
  (facing measured via `tools/validate-player-glb.mjs` for each — all 12 rest
  poses face `+Z`, matching the primitive rig's convention, so no rotation
  correction was needed for any of them) and a shared
  `pickleball-swings.glb` animations-bucket entry (forehand/backhand/overhead
  only). `ch12`'s original proof-of-concept calibration values
  (`paddleSocketRotation`/`paddleSocketScale`) were reused as the starting
  point for `ch01`-`ch11` and confirmed correct per-character via the
  in-menu character picker's live preview — no per-character adjustment was
  needed. `src/characters.js` no longer has a gender concept or a
  `GENDERS.male.playerModelKey` substitution; each roster slot independently
  picks one of the 12 characters by id (`CHARACTERS`/`DEFAULT_ROSTER`/
  `resolveSlotCharacter` in that file).
- **`customizable: false` manifest field.** Read in `src/players.js`'s
  `applyModelMaterials`/`applyAuthoredIdentity`; set on all 12 Mixamo
  entries, it skips the jersey/shorts/hair/headwear tinting and
  variant-hiding system entirely so each model renders with its own imported
  look untouched. Team/paddle color stays keyed by slot, not by character
  (`src/characters.js`).
- **Two real, general (non-Mixamo-specific) adapter bugs were found and
  fixed during the `ch12` proof-of-concept work** via the screenshot-driven
  verification loop `CLAUDE.md` mandates — not by reasoning about the code
  in the abstract:
  1. `src/players.js`'s `clipKey()` tested the generic
     `backpedal|backward|back` pattern before the specific `backhand|bh`
     pattern, so any clip literally named `"backhand"` (true of
     `player-male-v1.glb` too) was misfiled as locomotion, silently losing
     the backhand swing to the `fh` fallback. This likely explains a
     previously-flagged "only forehand seems to work" symptom.
  2. `tools/lib/mixamo-bones.mjs`'s `freezeRootHorizontalMotion` zeroed the
     wrong two local axes for this Blender-exported pipeline (a rule
     correctly ported from the `character-preview` viewer's FBX-native,
     wrapper-free coordinate frame, but wrong for these Blender-glTF-wrapped
     assets), pinning every swinging character's hips to the floor for the
     whole clip. Fixed; `pickleball-swings.glb` was rebuilt and reverified.
- **Known, accepted gap:** no idle/ready/run/serve clips exist yet (only
  forehand/backhand/overhead), so every character freezes in its bind pose
  whenever not mid-swing. Documented, not yet fixed — see the TODO list in
  `character-preview/CONTEXT.md`.
- **All 12 characters are sourced from the single common location**
  `assets/models/players/mixamo/chNN.glb` (also the file
  `character-preview/` reads — no duplicated GLB bytes between the two
  surfaces).
- **Loading is scoped and lazy**, not "load every player model up front":
  `src/assets.js`'s `preloadAssetPack`/`preloadPlayerModels` accept a
  `neededPlayerKeys`/`neededKeys` list (expanded through each key's
  `fallbackKey` chain via a shared `expandFallbackKeys` helper) and skip
  every `scope: 'player'` manifest entry not in that list. Real match start
  (`src/main.js`'s `startMatch`) computes the needed keys from the actual
  resolved roster for the active mode (`practice` fetches one model,
  `singles` two, `doubles` up to four); the character-picker preview
  (`src/characterPreview.js`'s `show()`) fetches only the one character
  being previewed/highlighted in the picker grid. This matters across the
  full 12-character catalog — without scoping, every match start or picker
  open would fetch the whole catalog regardless of what's actually shown.
- **The character-chooser UI is done**: the main menu's "Choose" button opens
  a fighting-game-style modal (`#characterModal` in `index.html`, behavior in
  `src/main.js`) — a P1/P2/P3/P4 tab strip (filtered by mode, same as
  before) switches which roster slot is "active," and clicking a tile in a
  shared 12-character grid assigns that character to the active slot.
  Duplicate picks across slots are allowed. This fully replaces the old
  gender/hair/color customization modal.
- **Not yet done:** real team-color/identity art beyond the flat swatch
  tiles, and the missing idle/run/serve clips above. Full tracked list:
  `character-preview/CONTEXT.md`'s "Open TODOs" section.
- **Licensing is resolved.** The 12 characters are confirmed Mixamo content,
  free for unlimited commercial use (checked against Adobe's current terms)
  — no restriction on shipping them in this game. The project owner also
  confirmed there are no remaining licensing blockers for the swing/sports
  mocap clips. See `character-preview/CONTEXT.md`'s "Licensing status"
  section.

### Roster-Wide Players

The full doubles roster resolves all active slots through `src/characters.js`.
Each slot independently picks one of `ch01`-`ch12`, while team/role identity
stays keyed by slot rather than by character. Keep the primitive rig
authoritative for every player and reuse the same socket/material/clip contract
for any future replacement or upgrade of these models. The legacy
`player-male-v1` and `player-female-v1` runtime assets have been removed; use
`PLAYER-IMPORT.md` only as archival build-pipeline reference.
`roster-closeup.png` (via `npm run shots`) is the roster comparison shot — check
it after touching any player slot.

## Rendering And Visual Priorities

Priority order:

1. Ball readability.
2. Swing/contact clarity.
3. Court-line and kitchen readability.
4. Player team/role distinction.
5. Mobile HUD usability.
6. Venue richness and effects.

Effects should be short-lived, low-opacity, and quality-gated when appropriate.
Low quality should skip nonessential effects. Night/indoor/tropical variants
must stay visually distinct without hiding the neon ball.

Practice-mode additions should follow the same rule: make the contact cue
obvious enough to read in motion, but do not bury the ball under decorative FX.

## Verification Commands

Use these after graphics changes:

```bash
npm test
npm run shots
npm run build
npm run player:validate
npm run player:check
```

Use this when gameplay feel or AI movement might have been affected:

```bash
node tools/play.mjs
```

For headed fast-forward checks, useful knobs are:

```bash
SPEED=6 MATCHES=1 MAXSEC=45 node tools/play.mjs
VENUE=indoor PALETTE=green DIFF=4.5 node tools/play.mjs
```

After visual changes, inspect `tools/shots/*.png` manually. Passing scripts are
not enough.

For Player 1-specific character checks, inspect:

- `tools/shots/player1-closeup-idle.png`
- `tools/shots/player1-closeup-forehand.png`
- `tools/shots/player1-gameplay.png`
- `tools/shots/player1-mobile.png`

For mobile, verify at least:

- `390x844` portrait.
- `320x740` small portrait.
- `844x390` landscape.

Check for:

- Nonblank canvas.
- No page errors.
- Ball readable against court/venue.
- Scorebar/callout/top-right controls not overlapping.
- Transient banner not colliding with top controls in landscape.
- Serve button and joystick not making play unreadable.

## Known Size And Build Notes

The latest verified build still warns that the main JS chunk is over 500 kB:

- `dist/assets/index-*.js`: about 685 kB minified / 183 kB gzip.
- Source `assets/`: about 664 kB.
- Copied `dist/assets/`: about 1.3 MB.
- Copied `dist/music/`: about 37 MB.

Music is the dominant static payload. For graphics work, the next likely build
cleanup is code-splitting/manual chunks for Three.js/post-processing/asset-loader
paths before adding much larger authored art.

## Last Verified Baseline

Phase 9 verification covered:

- `npm test`: 29 assertions passed.
- `npm run shots`: passed, with serve/rally/point loop verified.
- `npm run build`: passed, with the known >500 kB bundle warning.
- Production preview: HTTP 200, no page errors, four players, `serve` state.
- Mobile Playwright checks at `390x844`, `320x740`, and `844x390`: passed.
- Headed AI-vs-AI: `SPEED=6 MATCHES=1 MAXSEC=45 node tools/play.mjs` ran repeated
  serve/rally/point cycles to `near 2 : 5 far` before the safety cap, with no
  reported page errors.

Screenshots inspected included:

- `court.png`
- `court-night.png`
- `court-tropical-day.png`
- `court-indoor-blue.png`
- `rally-0.png`
- `rally-1.png`
- `rally-2.png`
- `phase8-effects.png`
- `roster-closeup.png`
- `mobile-portrait-phase9.png`
- `mobile-small-phase9.png`
- `mobile-landscape-phase9.png`

## Next Recommended Work

**Superseded**: the roster now uses the 12-character Mixamo pipeline (see
"Mixamo Character Pipeline" above), not the two-body Quaternius adapter
described below. The history/workflow notes below are kept for background on
how the Quaternius bodies were built, not as an active plan.

Do not spend the next pass on minor procedural crispness. The visual bottleneck
is now character presentation:

- [ ] Add missing idle/ready/run/serve animation states.
- [ ] Calibrate clip contact frames to `contactT = 0.5`.
- [ ] Improve team/role identity for fixed, non-customizable characters.
- [ ] Keep the primitive rig as gameplay authority.
- [ ] Verify paddle socket, contact frame, `paddleWorld`, and gameplay readability.

Only after the full roster reads as premium/appropriate should broader
venue/material polish resume.
