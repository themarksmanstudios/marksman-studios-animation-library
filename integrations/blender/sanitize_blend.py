"""Export a Blender source rig/action as FBX without its separate head mesh."""
import re
import sys
from pathlib import Path

import bpy


def is_head_mesh(obj):
    if obj.type != "MESH":
        return False
    for value in (obj.name, obj.data.name if obj.data else ""):
        name = re.sub(r"\.\d+$", "", value).lower()
        compact = re.sub(r"[^a-z0-9]", "", name)
        if re.search(r"(^|[^a-z0-9])head[a-z0-9]*(?=$|[^a-z0-9])", name):
            return True
        if re.search(r"head(?:face|mesh|geo|lod\d*)?$", compact):
            return True
    return False


args = sys.argv
if "--" not in args or len(args) <= args.index("--") + 1:
    raise SystemExit("Expected sanitized output path after --")
output_path = args[args.index("--") + 1]
for obj in list(bpy.data.objects):
    if is_head_mesh(obj):
        bpy.data.objects.remove(obj, do_unlink=True)

scene_objects = list(bpy.context.scene.objects)
armatures = [obj for obj in scene_objects if obj.type == "ARMATURE"]
if not armatures:
    raise RuntimeError("No source armature was found in the Blender input.")


def action_curve_count(action):
    count = len(getattr(action, "fcurves", ()))
    for layer in getattr(action, "layers", ()):
        for strip in getattr(layer, "strips", ()):
            for bag in getattr(strip, "channelbags", ()):
                count += len(bag.fcurves)
    return count


selected = set(armatures)
for obj in scene_objects:
    if obj.type != "MESH":
        continue
    if obj.parent in armatures or obj.parent_type == "BONE" or any(
        modifier.type == "ARMATURE" and modifier.object in armatures for modifier in obj.modifiers
    ):
        selected.add(obj)
for obj in scene_objects:
    obj.select_set(False)
for obj in selected:
    obj.select_set(True)
bpy.context.view_layer.objects.active = armatures[0]
actions = []
for armature in armatures:
    animation = armature.animation_data_create()
    action = animation.action
    if not action:
        action = next((strip.action for track in animation.nla_tracks for strip in track.strips if strip.action), None)
    if not action or not action_curve_count(action):
        continue
    slot = getattr(animation, "action_slot", None)
    animation.action = action
    if hasattr(action, "slots") and len(action.slots):
        if slot not in list(action.slots):
            slot = action.slots[0]
        animation.action_slot = slot
    track = animation.nla_tracks.new()
    track.name = "Source FBX Export"
    track.is_solo = True
    strip = track.strips.new(action.name, int(action.frame_range[0]), action)
    if slot and hasattr(strip, "action_slot"):
        strip.action_slot = slot
    animation.action = None
    actions.append(action)
if not actions:
    raise RuntimeError("No animated source action was found in the Blender input.")
scene = bpy.context.scene
scene.frame_start = min(int(action.frame_range[0]) for action in actions)
scene.frame_end = max(int(action.frame_range[1]) for action in actions)
scene.frame_set(scene.frame_start)
Path(output_path).unlink(missing_ok=True)
bpy.ops.export_scene.fbx(
    filepath=output_path, use_selection=True, object_types={"ARMATURE", "MESH", "EMPTY"},
    add_leaf_bones=False, use_armature_deform_only=False, bake_anim=True,
    bake_anim_use_nla_strips=True, bake_anim_use_all_bones=True,
)
