# Importing Authored Player Models (Quaternius CC0)

How the two shared base models (`player-male-v1`, `player-female-v1`) used by
all 4 roster slots were built. This is the durable record of the download +
optimization pipeline and the non-obvious traps in it.

Read alongside [`GRAPHICS.md`](GRAPHICS.md) (adapter contract, verification
baseline) and [`assets/README.md`](assets/README.md) (manifest field reference).

## Source assets (CC0)

- Base bodies: <https://quaternius.itch.io/universal-base-characters>
- Animations: <https://quaternius.itch.io/universal-animation-library>

Use the **Standard / free** tier. Both are **CC0** (see `License_Standard.txt`
in each zip). The free base pack ships only the athletic "Superhero" male/female
bodies + separate hairstyle meshes; the "Regular" proportion bodies and any
clothing are SOURCE-tier only (paid).

### Downloading from itch.io (free "name your own price")

The download list is not in the page HTML; itch reveals it after a CSRF POST,
and the final file URL is a **signed R2 URL that expires in ~60 seconds**, so
run the whole chain in one shot. `page="https://quaternius.itch.io/<slug>"`:

1. `GET $page` → scrape `csrf_token` from the HTML.
2. `POST $page/download_url` (form field `csrf_token`, header
   `X-Requested-With: XMLHttpRequest`) → JSON `{ "url": "<download-page>" }`.
3. `GET <download-page>` (with cookies from step 1) → scrape
   `data-upload_id="<id>"`.
4. `POST $page/file/<id>?source=game_download&as_props=1&after_download_lightbox=true`
   (form field `csrf_token`) → JSON whose **first** `url` is the R2 file link
   (a later `url` in the same JSON is a decoy — parse JSON, don't regex).
5. `GET` that R2 URL immediately (< 60s) → the zip.

`data.json` at `$page/data.json` confirms title/price without auth.

## Pipeline: `tools/build-player-model.mjs`

Offline tool (deps not in `package.json`, like the raw music helpers):

```bash
npm i @gltf-transform/core @gltf-transform/extensions \
      @gltf-transform/functions sharp

# quick form (all defaults, no extra meshes)
node tools/build-player-model.mjs \
  "<pack>/Base Characters/Godot - UE/Superhero_Male_FullBody.gltf" \
  "<pack>/Unreal-Godot/UAL1_Standard.glb" \
  assets/models/players/player-male-v1.glb

# config form (per-gender overrides; player-male-v1/player-female-v1 need this
# to merge in hair/pants via extraMeshes)
node tools/build-player-model.mjs path/to/config.json
```

What it does: merges the animation GLB, **retargets every clip channel onto the
base skeleton by bone name** (the two packs share the UE-mannequin rig:
`root/pelvis/spine_*/clavicle_*/upperarm_*/lowerarm_*/hand_*`, fingers,
`thigh/calf/foot`), renames the mapped clips to the adapter keys, strips
root-translation + finger/toe channels, adds a `paddle_socket` node under
`hand_r`, compresses textures to 1k WebP, and prunes to a single-buffer GLB
(~1.1 MB). Config fields are documented in the script header.

Default clip map (source clip → adapter key). Only `idle`/`run` are strictly
required; the rest give swing motion since the packs have **no pickleball
swing**:

| adapter key | source clip          |
|-------------|----------------------|
| idle        | `Idle_Loop`          |
| ready       | `Sword_Idle`         |
| run         | `Jog_Fwd_Loop`       |
| forehand    | `Sword_Attack`       |
| backhand    | `Punch_Cross`        |
| serve       | `Spell_Simple_Shoot` |
| smash       | `Punch_Jab`          |

## Traps that cost real time (don't relearn these)

- **Texture filename mismatch.** The base glTFs reference some textures with a
  `_png` suffix that the pack ships without it. For each `uri` a glTF requests
  that is missing on disk, copy the matching present file to that name, e.g.:
  - Male body: `cp T_Hair_1_Normal.png T_Hair_1_Normal_png.png` and
    `cp T_Eye_Normal.png T_Eye_Normal_png.png`.
  - Female body: `cp T_Eye_Normal.png T_Eye_Normal_png.png`.
  Otherwise every loader errors on the missing file.
- **`Animation.dispose()` does not cascade** to its samplers/channels. Leftover
  samplers keep their accessors alive and get serialized — this bloated the file
  ~6× (6.9 MB → 1.09 MB once fixed). Dispose channels *and* samplers, and sweep
  any accessor left attached only to `Root`.
- **GLB needs a single buffer.** After merge there are 2; reassign all accessors
  to one buffer and dispose the rest before writing.
- **`prune()` deletes empty leaf nodes** — add `paddle_socket` *after* the
  prune/dedup pass, not before, or it vanishes.
- **Facing must be measured, not guessed.** This asset faces **local +Z**
  (matches the primitive rig's "face on +z"), so `playerRotation: [0, 0, 0]`.
  A `[0, π, 0]` guess put the player 180° backward (facing off-court). Verify
  from geometry — toe-vs-ankle Z and eyebrow-vs-head Z both point the facing
  direction — not from the contrived `player:check` close-up pose.
- **Single-material body = no per-slot team color.** The free "Superhero" body
  is one material (`MI_Superhero_Male`) and is shirtless/barefoot/bald. Only the
  eyebrows map to the `hair` slot. Real jersey/shorts/skin/shoe team recoloring
  needs a mesh split (by UV or bone weight) or SOURCE-tier clothing meshes.
- **Validator needs headless shims.** `tools/validate-player-glb.mjs` was built
  for the texture-less POC; it now includes DOM/texture shims + skinned-mesh-safe
  bounds so it can load real textured/skinned GLBs in Node (three's GLTFLoader
  otherwise throws `Image is not defined` and mis-measures skinned height).

### Two shared base models, multi-variant hair + facial hair (done — `player-male-v1` / `player-female-v1`)

All 4 roster slots (`nearYou`/`nearMate`/`farA`/`farB`) now share just two
authored GLBs — one male base, one female base — instead of one baked
"character" per slot. Each slot independently picks gender (which selects
the GLB), a hairstyle, a hair color, and (male only) an independent beard
toggle at runtime via `src/characters.js#resolveSlotCharacter`. The old
fantasy "Ranger" opponent outfits (from a different Quaternius pack, see git
history if you need the old approach) are gone entirely; opponents use the
same sport-neutral base bodies as everyone else.

Both free bodies (`Superhero_Male_FullBody.gltf` / `_Female_FullBody.gltf`)
ship bald aside from eyebrows, so each GLB merges **all of that gender's free
hairstyles** as toggleable variant nodes, using the build tool's
`extraMeshes` config field (an array, replacing the older single
`hairMesh`/`hairVariantValue` fields). The male build also merges
`Hair_Beard` under its own `facialHair` variant group (not `hair`) so a
beard can be shown at the same time as any hairstyle, rather than being one
more mutually-exclusive hair option:

```json
{
  "base": "<pack>/Base Characters/Godot - UE/Superhero_Male_FullBody.gltf",
  "anim": "<pack>/Unreal-Godot/UAL1_Standard.glb",
  "extraMeshes": [
    { "path": "<pack>/Hairstyles/Rigged to Head Bone/glTF (Godot -Unreal)/Hair_SimpleParted.gltf", "variantGroup": "hair", "variantValue": "simpleParted" },
    { "path": "<pack>/Hairstyles/Rigged to Head Bone/glTF (Godot -Unreal)/Hair_Buzzed.gltf", "variantGroup": "hair", "variantValue": "buzzed" },
    { "path": "<pack>/Hairstyles/Rigged to Head Bone/glTF (Godot -Unreal)/Hair_Beard.gltf", "variantGroup": "facialHair", "variantValue": "beard" }
  ],
  "out": "assets/models/players/player-male-v1.glb"
}
```

The female build is the same shape with `Superhero_Female_FullBody.gltf` and
hair values `long`/`buns`/`buzzedFemale` (no `facialHair` entry — the female
`GENDERS` entry's `facialHairOptions` is just `['none']`, so the picker never
shows a "Face" row for that gender). All hairstyle meshes come from the same
"Universal Base Characters" pack as the bodies
(`quaternius.itch.io/universal-base-characters`) — same release, same rest
pose, so the retargeting below "just works" for hair without any extra care.

At runtime, `src/players.js`'s generic variant system (`variantGroup`/
`variantValue` node tagging, matched against roster `hairStyle`/
`facialHair`) shows only the chosen mesh per group and hides the rest — no
per-character rebuild needed to change cosmetics, and two different groups
(`hair` + `facialHair`) can both be visible at once since each is resolved
independently.

**Trap: reusing a merged mesh's own inverse-bind matrices breaks when the
mesh comes from a DIFFERENT donor pack than the base body/anim.** Matching
bone *names* is enough to retarget animation channels (rotations are local
and pose-driven either way) but is **not** enough to safely reuse a donor
skin's inverse-bind matrices — those encode the donor's own rest pose, which
can differ from ours even with identical joint names. `build-player-model.mjs`
precomputes each base-skeleton joint's inverse-bind matrix from the base
body's *own* skin once, up front, and reuses that for every merged mesh's new
skin (see the `baseJointInvBind` map), instead of trusting whatever the donor
mesh shipped. Verify any new cross-pack mesh merge by rendering the raw GLB
with no animation applied at all (pure bind pose) — a correctly retargeted
mesh should look clean and undistorted there; if it doesn't, the inverse-bind
data is wrong before pose even enters the picture. This fix stays in place
even though hair no longer strictly needs it (same-pack rest poses already
matched) — it's a correctness fix, not a workaround, and protects the next
cross-pack merge attempt too.

**Retired: a free "peasant pants" attachment was tried and removed.** An
earlier version of this pipeline merged a `Male_Peasant_Legs`/
`Female_Peasant_Legs` mesh (cut from Quaternius's "Modular Character Outfits
- Fantasy" pack) onto these bodies as a `pants` variant group. It never
worked well and was pulled rather than shipped as a permanent workaround —
see the "why doesn't clothing fit" question this always raises:

- Quaternius's **"Universal Base Characters"** pack (the base bodies + hair
  used here) ships **no clothing at all** — bare bodies and hairstyles only,
  confirmed on the pack's own product page.
- Quaternius's **"Modular Character Outfits - Fantasy"** pack (source of the
  peasant-pants mesh) states its outfits are *"Compatible with Universal
  Base Character **heads** but you can use your own too"* — compatibility is
  head-only. Each outfit (Ranger, Peasant, ...) is a complete standalone
  body (its own torso/arms/legs); the pack was never designed to have its
  clothing split apart and layered onto a different body's limbs.
- Practical result: the pants mesh sat almost flush against (and often
  slightly inside) the Superhero body's own thicker leg surface, since it
  was modeled to fit a different, slimmer character. It z-fought with the
  base body — badly during animated poses (running/swinging), where the two
  differently-proportioned rigs bulge differently under the same skeleton
  pose. A `polygonOffset` bias on the pants material (forcing it to always
  win the depth-test tie) mostly papered over this in some poses but not
  reliably across all of them, and it was a rendering-side cheat over a
  genuine geometry mismatch, not a real fix.
- If clothing is revisited, look for CC0/licensed assets explicitly modeled
  to fit "Universal Base Characters" proportions (or plan to reshape a
  donor mesh in a 3D tool first) rather than repeating this shortcut.

## Reproducing a build from scratch

1. Re-download both packs via the itch.io CSRF flow (GET page → scrape
   `csrf_token` → POST `download_url` → GET the returned download page →
   scrape `data-upload_id` → POST `file/<id>?source=game_download&as_props=1&after_download_lightbox=true`
   → GET the first `url` in that JSON, a signed R2 link expiring in ~60s).
   Apply the texture-filename fixups (copy `T_Hair_1_Normal.png` →
   `T_Hair_1_Normal_png.png`, `T_Eye_Normal.png` → `T_Eye_Normal_png.png`, for
   both base bodies) before building.
2. Write a config.json per gender (see above) and run
   `node tools/build-player-model.mjs config.json`.
3. `node tools/validate-player-glb.mjs <out.glb>` — require `paddle_socket:
   OK`, height ~1.7–1.9 m, all 7 clips recognized; slot/arm-sync warnings are
   expected for this asset (single-material body, see the team-color trap
   above).
4. Wire it up: `assets/manifest.js` `models[]` entry (`player-male-v1`/
   `player-female-v1`), and `src/characters.js`'s `GENDERS` map
   (`playerModelKey`, `hairOptions`, `defaultHair`, `facialHairOptions`).
5. `npm run player:check` + `npm run shots` — **look at the PNGs** (facing,
   paddle, scale vs teammates, hair/facial-hair toggling across all
   combinations), then `npm test` + `npm run build`.
6. Keep the primitive rig gameplay-authoritative: do not touch
   `constants/physics/shots/rules/ai/utils`, `HIT.SWING_WINDOW`, or `contactT`.
