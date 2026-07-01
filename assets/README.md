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

## Optimization Path

- Compress large GLBs with `gltf-transform optimize` or an equivalent pipeline.
- Prefer KTX2/Basis-compressed textures once texture size becomes meaningful.
- Share materials across repeated props; use instancing for repeated venue
  objects where practical.
- Keep ball, court-line, and player-readability checks ahead of visual density.
