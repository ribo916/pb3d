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
- A generated player-model POC (`assets/models/players/player-poc.glb`) loaded
  through the authored-player adapter.
- Player 1 (`player-human-v1`) and the CPU partner (`player-partner-v1`) filled
  with real CC0 Quaternius humanoids (skinned, textured, real idle/ready/run/
  swing clips) built via `tools/build-player-model.mjs`; see `PLAYER-IMPORT.md`.
  Both merge a pre-rigged hair mesh onto the base skeleton (a reusable
  `hairMesh` config field on the build tool) since the free bodies ship bald:
  Player 1 gets `Hair_SimpleParted`, the partner gets `Hair_Long`. Both still
  fall back to the POC if their GLB is absent. The two CPU opponents
  (`farA`/`farB`, `player-opponent-a-v1` / `player-opponent-b-v1`) are now
  filled with the free Male/Female Ranger outfits from Quaternius's
  "Modular Character Outfits - Fantasy" pack, built the same way; see
  `PLAYER-IMPORT.md`.
- Authored-player identity hooks for color slots, scale/build, hair/headwear
  variants, paddle socket, and animation clip names.
- Visual-only idle/ready/run/forehand/backhand/serve/smash animation blending.
- Player GLB validation and Player 1 comparison screenshot tooling.
- Visual-only paddle-hit, bounce/contact, net-hit, serve camera shake, and point
  reaction effects.
- Compact mobile HUD fixes for portrait and short landscape viewports.

The result is crisper and more presentable than the original primitive-only
version, but it is not final premium character art. The generated player POC is
intentionally a technical proof, not an acceptable final or photoreal player
model. Do not treat it as the target quality bar.

## Branch And Release Status

- Latest graphics checkpoint: `f61aeb4 Complete Phase 9 verification`.
- Work remains on `feature/graphics-overhaul`.
- Do not merge this branch to `master` as-is.
- The branch is useful as a verified rendering/asset/animation scaffold.
- The next serious graphics investment should focus on real character models,
  not further code-only crispness.

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
      player-poc.glb
      player-human-v1.glb
      player-partner-v1.glb
    venues/
      park-props.glb
      tropical-props.glb
      indoor-props.glb
  textures/
  environments/
  animations/
```

Important contracts:

- `assets/manifest.js` is the runtime slot map.
- `player-human-v1` (Player 1), `player-partner-v1` (CPU partner/`nearMate`),
  `player-opponent-a-v1` (`farA`), and `player-opponent-b-v1` (`farB`) are all
  filled authored character slots; each falls back to `player-poc` if its GLB
  is absent or fails to load.
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

See `assets/README.md` for the detailed player-model adapter contract, and
`PLAYER-IMPORT.md` for the Quaternius CC0 download + `tools/build-player-model.mjs`
pipeline used to build `player-human-v1` (and to extend to the rest of the
roster).

## Current Player POC Reality Check

`assets/models/players/player-poc.glb` is generated by
`tools/generate-player-poc.mjs`. It proves the adapter can handle:

- Four independent authored-looking roster instances.
- Team and role color slots.
- Paddle socket attachment.
- Height/build/hair/headwear variants.
- Recognized animation clips.
- Primitive-arm sync during the transition period.

It does not prove that the game has premium or photoreal character art. The mesh
is still generated from simple Three.js primitives and reads as a placeholder.

Next character work should replace or substantially upgrade this asset with a
real authored character model pipeline:

- Higher-quality human proportions and silhouette.
- More credible face/head/hair/headwear shapes.
- Better clothing folds and material response.
- Clean paddle-hand alignment at the same contact frame.
- Explicit LOD or low-quality fallback for mobile.
- Verified readability from gameplay camera distance, not only close-up shots.

If the project goal is genuinely photoreal, use real authored/scanned/licensed
human assets or a professional character-generation workflow. Procedural code
will not get there by adding more small primitives.

### POC Audit Findings

The current generated POC looks bad for reasons that are inherent to its source
method, not just missing polish:

- Shoulders and arms read as separate spheres/cylinders; shoulder caps form
  obvious circles from both gameplay and close-up cameras.
- Body proportions are toy-like: oversized head, simplified torso/hips, short
  limb segments, and no believable athletic stance.
- Head, face, and hair lack real facial planes, expression, ears, brows, skin
  detail, or credible hair volume.
- Clothing is only material-color blocking; there are no fabric folds, seams,
  normals, footwear details, or premium sportswear materials.
- Paddle socket alignment works technically, but the hand/grip reads abstract
  because the hand is a sphere and the forearm is a cylinder.
- Animation silhouette preserves gameplay timing, but it is broad POC body
  language rather than real shoulder, wrist, spine, and weight-transfer motion.

### Player 1 Import Target

For true photoreal or near-photoreal Player 1 graphics, import a real authored
or licensed `.glb` into the `player-human-v1` manifest slot. The expected
contract is:

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
  textures where needed. Use a lower LOD or the existing POC/primitive fallback
  for mobile if the premium model is too heavy.
- Run the validator and Player 1 screenshot workflow before accepting the asset.

### Future Roster-Wide Players

The full doubles roster now has an authored model. `player-partner-v1` (the
`nearMate` CPU partner, female Quaternius body + merged `Hair_Long` hairstyle),
`player-opponent-a-v1` (`farA`, Male Ranger outfit), and `player-opponent-b-v1`
(`farB`, Female Ranger outfit) are all done; see `PLAYER-IMPORT.md` for how the
opponent outfits were built and sourced. Keep the primitive rig authoritative
for every player and reuse the same socket/material/clip contract for any
future replacement or upgrade of these slots.
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

Do not spend the next pass on minor procedural crispness. The visual bottleneck
is player quality.

All four roster slots (`player-human-v1`, `player-partner-v1`,
`player-opponent-a-v1`, `player-opponent-b-v1`) now have an authored model
behind the adapter, built with this workflow:

1. Decide whether the target is premium stylized or genuinely photoreal.
2. Pick a real character asset source/workflow.
3. Add one high-quality player model behind the existing adapter.
4. Keep the primitive rig as gameplay authority.
5. Verify paddle socket, contact frame, `paddleWorld`, and gameplay readability.
6. Compare close-up and gameplay-camera screenshots against the current POC.

The two opponents currently wear generic fantasy "Ranger" outfits (hood +
leather gear, one of only two complete-head outfits available in the free
tier of the pack used — the other, "Peasant", ships with no head mesh at all)
— thematically mismatched with a pickleball court. A future pass should
replace them with sport-appropriate authored models or clothing once a
suitable CC0/licensed source is found; the adapter/manifest/build pipeline
does not need to change, only the source GLBs.

Only after the full roster reads as premium/appropriate should broader
venue/material polish resume.
