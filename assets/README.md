# PB3D Asset Pipeline

This folder is for optional authored graphics assets. The game must still run
with the procedural fallback when any of these files are absent.

For the broader graphics-overhaul state, visual verification baseline, and next
character-model priorities, see [`../GRAPHICS.md`](../GRAPHICS.md).

To import a real CC0 humanoid into a `player-*` slot (download flow, the
`tools/build-player-model.mjs` pipeline, and the traps), see
[`../PLAYER-IMPORT.md`](../PLAYER-IMPORT.md). `player-human-v1` and
`player-partner-v1` were built this way.

## Structure

```text
assets/
  models/
    venues/       Optional `.glb` / `.gltf` venue props or full venue shells.
    players/      Future skinned or static player models.
  textures/
    court/        Optional court/surface texture sets.
    venues/       Optional prop and venue texture sets.
  environments/   Optional HDR/equirect environment maps.
  animations/     Future player animation clips or animation-only GLBs.
  manifest.js     Runtime asset slots consumed by `src/assets.js`.
```

Prefer `.glb` for bundled models. Keep generated or source art out of the
runtime path unless it is meant to ship.

## Adding A Model

1. Put the optimized `.glb` under the matching folder.
2. Add or update a manifest entry in `assets/manifest.js`.
3. Set `url` to the static path, for example
   `/assets/models/venues/park-props.glb`.
4. Keep `optional: true` until the procedural fallback has been fully replaced
   and verified.

The loader only fetches entries with a non-empty `url`, so placeholder manifest
entries are safe and do not produce missing-file requests.

## Player Model Contract

- Put Player 1's real authored GLB under `assets/models/players/` and set the
  `player-human-v1` manifest URL. That slot is Player 1-only and falls back to
  `player-poc` while the URL is empty.
- Use `player-base` only for future shared roster-wide replacement work.
- Authored player GLBs should face local `+z`, use an origin at the feet, and
  arrive at real-world scale around 1.7-1.9 m before manifest alignment.
- Skinned meshes are cloned with skeleton-safe cloning so the four roster
  instances can animate independently.
- The current primitive rig remains the fallback and gameplay driver. When a
  player model is loaded, the primitive body is hidden but its paddle stays
  visible; `contactT` and `paddleWorld` still come from the same paddle blade.
- Authored models may include a named `paddle_socket` node under the right hand
  or forearm. When present, the visible primitive paddle is attached there and
  `paddleWorld` is refreshed from that same blade after arm sync. Older models
  without the socket keep the previous primitive-paddle attachment.
- Optional manifest fields `paddleSocketOffset`, `paddleSocketRotation`, and
  `paddleSocketScale` fine-tune the attached paddle after it is parented to the
  socket.
- Optional manifest fields `playerScale`, `playerOffset`, and `playerRotation`
  align authored models with the primitive rig.
- Optional manifest field `fallbackKey` lets an empty or failed optional player
  slot resolve to another loaded model, such as `player-poc`.
- Roster `height` still scales the player root for authored and primitive
  players; roster `build` scales authored-model width/depth in addition to the
  primitive fallback.
- `syncPrimitiveArms: true` lets named authored arm nodes follow the existing
  primitive swing rotations during transition work. The expected node names are
  `visual_left_upper_arm`, `visual_left_forearm`, `visual_right_upper_arm`, and
  `visual_right_forearm`.
- Mesh or material names, or `userData.slot` / `userData.materialSlot`, may use
  `jersey`, `shorts`, `skin`, `hair`, `shoe`, `headband`, or `paddle` to receive
  roster colors.
- Variant groups may be named `variant_hair_short`, `variant_hair_long`,
  `variant_hair_ponytail`, `variant_headwear_headband`, or
  `variant_headwear_cap`; matching `userData.variantGroup` /
  `userData.variantValue` fields are also supported. The adapter shows the group
  matching roster `hairStyle` and `headwear`, and hides the others.
- Animation clips may live on the player GLB or optional animation GLBs. Names
  containing `idle`, `ready`, `run`/`jog`, `forehand`/`fh`, `backhand`/`bh`,
  `serve`, or `smash` are recognized by the adapter. In-match stationary players
  prefer `ready` when available and fall back to `idle`. Swing clips are scaled
  to the primitive swing duration, while the primitive rig remains the gameplay
  timing source.
- Swing clips should place paddle contact at 50% of a 0.44 s swing clip so they
  line up with `contactT = 0.5`. Do not change gameplay timing to fit the art.
- Player 1 high-quality target budget is roughly 30k-60k triangles, optimized
  GLB, and 1k-2k PBR textures where they materially improve face, skin, hair,
  clothes, and shoes. Provide a lower LOD or rely on the existing POC/primitive
  fallback for mobile if needed.
- Roster-wide replacement uses separate optional slots. `player-partner-v1`
  (the `nearMate` CPU partner) is filled; `player-opponent-a-v1` and
  `player-opponent-b-v1` still fall back to `player-poc` until each is
  imported and verified. Keep the same visual-only primitive-rig contract for
  all four players.

Validate a candidate player GLB without rendering:

```bash
node tools/validate-player-glb.mjs assets/models/players/player-poc.glb
```

Capture Player 1 comparison screenshots:

```bash
npm run player:check
```

## Player POC

`assets/models/players/player-poc.glb` is a generated visual POC used by all
four roster slots when it loads. Regenerate it with:

```bash
node tools/generate-player-poc.mjs
```

It is deliberately not final character art. Its job is to prove that a visibly
different authored-style player can sit on top of the current gameplay rig while
the primitive fallback, swing timing, socketed paddle, identity variants, and
`paddleWorld` contract stay intact.

Do not use this POC as the target quality bar for premium or photoreal players.

## Optimization Path

- Compress large GLBs with `gltf-transform optimize` or an equivalent pipeline.
- Prefer KTX2/Basis-compressed textures once texture size becomes meaningful.
- Share materials across repeated props; use instancing for repeated venue
  objects where practical.
- Keep ball, court-line, and player-readability checks ahead of visual density.
