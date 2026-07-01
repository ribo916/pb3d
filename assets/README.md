# PB3D Asset Pipeline

This folder is for optional authored graphics assets. The game must still run
with the procedural fallback when any of these files are absent.

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

- Put the base player GLB under `assets/models/players/` and set the
  `player-base` manifest URL.
- Skinned meshes are cloned with skeleton-safe cloning so the four roster
  instances can animate independently.
- The current primitive rig remains the fallback and gameplay driver. When a
  player model is loaded, the primitive body is hidden but its paddle stays
  visible; `contactT` and `paddleWorld` still come from the same paddle blade.
- Optional manifest fields `playerScale`, `playerOffset`, and `playerRotation`
  align authored models with the primitive rig.
- `syncPrimitiveArms: true` lets named authored arm nodes follow the existing
  primitive swing rotations during transition work. The expected node names are
  `visual_left_upper_arm`, `visual_left_forearm`, `visual_right_upper_arm`, and
  `visual_right_forearm`.
- Mesh or material names, or `userData.slot` / `userData.materialSlot`, may use
  `jersey`, `shorts`, `skin`, `hair`, `shoe`, `headband`, or `paddle` to receive
  roster colors.
- Animation clips may live on the player GLB or optional animation GLBs. Names
  containing `idle`, `run`/`jog`, `forehand`/`fh`, `backhand`/`bh`, `serve`, or
  `smash` are recognized by the adapter. The primitive swing remains the timing
  source until the Phase 7 contact-frame alignment is verified.

## Player POC

`assets/models/players/player-poc.glb` is a generated, one-character visual POC
used by the human player only. Regenerate it with:

```bash
node tools/generate-player-poc.mjs
```

It is deliberately not final character art. Its job is to prove that a visibly
different authored-style player can sit on top of the current gameplay rig while
the primitive fallback, swing timing, and `paddleWorld` contract stay intact.

## Optimization Path

- Compress large GLBs with `gltf-transform optimize` or an equivalent pipeline.
- Prefer KTX2/Basis-compressed textures once texture size becomes meaningful.
- Share materials across repeated props; use instancing for repeated venue
  objects where practical.
- Keep ball, court-line, and player-readability checks ahead of visual density.
