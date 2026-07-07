"""Headless Blender FBX -> glTF converter for Mixamo assets.

OFFLINE, ONE-OFF TOOL (like tools/build-player-model.mjs). Not wired into npm
scripts. Requires Blender (tested with 5.1.2, /Applications/Blender.app).

Usage:
    blender --background --factory-startup --python tools/blender-fbx-to-gltf.py \
        -- character <in.fbx> <out.glb>
    blender --background --factory-startup --python tools/blender-fbx-to-gltf.py \
        -- clip <in.fbx> <out.glb>

Modes:
    character   Import FBX, export GLB with NO animation (export_skins=True).
                Raw Mixamo character exports only carry a throwaway idle/
                T-pose (and Mixamo's own watermark track); real pickleball
                swing clips come from a separately-built shared clip-library
                GLB (tools/build-mixamo-clip-library.mjs), not from baking
                per-character.
    clip        Import FBX, delete every non-armature object (mesh/camera/
                light), export GLB WITH animation, armature-only. For
                forehand.fbx/backhand.fbx/overhead.fbx and similar mocap-only
                sources.

Does not attempt any bone-name normalization or retargeting fixes here --
that happens downstream in tools/lib/mixamo-bones.mjs against the exported
glTF (gltf-transform operates on JSON/binary directly and is far easier to
unit-test/iterate on than round-tripping through Blender's Python API).
"""
import sys
import bpy


def parse_args():
    argv = sys.argv
    if '--' not in argv:
        raise SystemExit('usage: blender ... --python blender-fbx-to-gltf.py -- <character|clip> <in.fbx> <out.glb>')
    args = argv[argv.index('--') + 1:]
    if len(args) != 3 or args[0] not in ('character', 'clip'):
        raise SystemExit('usage: blender ... --python blender-fbx-to-gltf.py -- <character|clip> <in.fbx> <out.glb>')
    return args[0], args[1], args[2]


def reset_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def import_fbx(path):
    bpy.ops.import_scene.fbx(filepath=path, automatic_bone_orientation=False)


def strip_non_armature_objects():
    for obj in list(bpy.data.objects):
        if obj.type != 'ARMATURE':
            bpy.data.objects.remove(obj, do_unlink=True)


def export_glb(path, export_animations):
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format='GLB',
        export_animations=export_animations,
        export_skins=True,
        export_morph=False,
        export_apply=False,
        export_yup=True,
    )


def main():
    mode, in_path, out_path = parse_args()
    reset_scene()
    import_fbx(in_path)

    if mode == 'character':
        export_glb(out_path, export_animations=False)
    else:
        strip_non_armature_objects()
        export_glb(out_path, export_animations=True)

    print('wrote', out_path)


main()
